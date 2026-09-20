#!/usr/bin/env python3
"""Content-free, read-only direct-engine kernel benchmark for local D&D RAG."""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
import socket
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

DEFAULT_ROOT = Path("/mnt/c/Users/fireo/mcp-rag")
DEFAULT_DATA = DEFAULT_ROOT / "data_dnd"
DEFAULT_COLLECTION = "dnd_srd"
PUBLIC_QUERY = "What does the blinded condition do?"
AMBIGUOUS_QUERY = "condition"


def stats(values: list[float]) -> dict[str, float | int]:
    ordered = sorted(values)
    pick = lambda q: round(ordered[round((len(ordered) - 1) * q)], 3) if ordered else 0.0
    return {"count": len(values), "p50_ms": pick(.5), "p95_ms": pick(.95)}


def new_counts() -> dict[str, int | float]:
    return {"query_api_calls": 0, "embedding_cache_hits": 0, "model_query_inferences": 0,
            "sparse_calls": 0, "dense_searches": 0, "lexical_searches": 0,
            "reranker_gets": 0, "reranker_runs": 0, "errors": 0,
            "embedding_ms": 0.0, "bm25_ms": 0.0, "vector_ms": 0.0, "rerank_ms": 0.0}


def merge_counts(target: dict[str, int | float], source: dict[str, int | float]) -> None:
    for key, value in source.items():
        target[key] = target.get(key, 0) + value
    for key in ("embedding_ms", "bm25_ms", "vector_ms", "rerank_ms"):
        target[key] = round(float(target[key]), 3)


def identity(result: dict[str, Any]) -> tuple[str, int] | None:
    """Only a non-error hit set has an identity; the hash never leaves memory."""
    hits = result.get("hits")
    if result.get("error") or not isinstance(hits, list) or not hits:
        return None
    citations = [(hit.get("source"), hit.get("document_id"), hit.get("page_start"),
                  hit.get("page_end"), hit.get("section")) for hit in hits]
    encoded = json.dumps(citations, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest(), len(json.dumps(result, ensure_ascii=False).encode())


class Monitor:
    """Temporary process-local wrappers with a thread-local scenario counter."""
    def __init__(self, search_module: Any, embedder: Any, vector_store: Any):
        self.search_module, self.embedder, self.vector_store = search_module, embedder, vector_store
        self.local = threading.local()
        self.reranker_methods: list[tuple[Any, Any]] = []

    @contextmanager
    def scenario(self, counts: dict[str, int | float]):
        previous = getattr(self.local, "counts", None)
        self.local.counts = counts
        try:
            yield
        finally:
            self.local.counts = previous

    def _counts(self) -> dict[str, int | float]:
        return getattr(self.local, "counts", new_counts())

    def __enter__(self):
        self.old_embed = self.embedder.embed_query
        self.old_model_query = self.embedder._model.query_embed
        self.old_sparse = self.search_module.sparse_query
        self.old_hybrid = self.vector_store.hybrid_search
        self.old_reranker = self.search_module.get_reranker

        def embed(*args: Any, **kwargs: Any):
            counts = self._counts(); counts["query_api_calls"] += 1
            if args and args[0] in getattr(self.embedder, "_query_cache", {}):
                counts["embedding_cache_hits"] += 1
            started = time.perf_counter()
            try:
                return self.old_embed(*args, **kwargs)
            finally:
                counts["embedding_ms"] += (time.perf_counter() - started) * 1000

        def model_query(*args: Any, **kwargs: Any):
            iterator = self.old_model_query(*args, **kwargs)
            def measured():
                self._counts()["model_query_inferences"] += 1
                yield from iterator
            return measured()

        def sparse(*args: Any, **kwargs: Any):
            counts = self._counts(); counts["sparse_calls"] += 1; started = time.perf_counter()
            try:
                return self.old_sparse(*args, **kwargs)
            finally:
                counts["bm25_ms"] += (time.perf_counter() - started) * 1000

        def hybrid(store: Any, dense: Any, sparse_vector: Any, *args: Any, **kwargs: Any):
            counts = self._counts(); counts["dense_searches"] += 1
            counts["lexical_searches"] += int(getattr(sparse_vector, "non_empty", False))
            started = time.perf_counter()
            try:
                return self.old_hybrid(store, dense, sparse_vector, *args, **kwargs)
            finally:
                counts["vector_ms"] += (time.perf_counter() - started) * 1000

        def reranker(*args: Any, **kwargs: Any):
            self._counts()["reranker_gets"] += 1
            candidate = self.old_reranker(*args, **kwargs)
            if candidate is None or any(item is candidate for item, _ in self.reranker_methods):
                return candidate
            old_run = candidate.rerank
            def run(*run_args: Any, **run_kwargs: Any):
                counts = self._counts(); counts["reranker_runs"] += 1; started = time.perf_counter()
                try:
                    return old_run(*run_args, **run_kwargs)
                finally:
                    counts["rerank_ms"] += (time.perf_counter() - started) * 1000
            candidate.rerank = run
            self.reranker_methods.append((candidate, old_run))
            return candidate

        self.embedder.embed_query = embed
        self.embedder._model.query_embed = model_query
        self.search_module.sparse_query = sparse
        self.search_module.get_reranker = reranker
        self.vector_store.hybrid_search = hybrid
        return self

    def __exit__(self, *_: Any) -> None:
        self.embedder.embed_query = self.old_embed
        self.embedder._model.query_embed = self.old_model_query
        self.search_module.sparse_query = self.old_sparse
        self.search_module.get_reranker = self.old_reranker
        self.vector_store.hybrid_search = self.old_hybrid
        for candidate, old_run in self.reranker_methods:
            candidate.rerank = old_run


def require_loopback(url: str) -> None:
    host = urlparse(url).hostname
    try:
        if host == "localhost":
            addresses = {item[4][0] for item in socket.getaddrinfo(host, None)}
            allowed = bool(addresses) and all(ipaddress.ip_address(item).is_loopback for item in addresses)
        else:
            allowed = host is not None and ipaddress.ip_address(host).is_loopback
        if not allowed:
            raise ValueError
    except ValueError:
        raise RuntimeError("non_loopback_qdrant")


def require_manifest(settings: Any) -> None:
    """Read the existing manifest through SQLite URI mode=ro; never instantiate Registry."""
    from knowledge_base.index_guard import validate_pipeline_versions
    uri = f"file:{settings.db_path}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        row = connection.execute("SELECT value FROM meta WHERE key = ?", ("index_manifest",)).fetchone()
    if row is None:
        raise RuntimeError("missing_index_manifest")
    validate_pipeline_versions(json.loads(row[0]), settings)


def child(root: Path, data: Path, collection: str, samples: int, batches: int, width: int) -> dict[str, Any]:
    if collection != DEFAULT_COLLECTION or not data.is_relative_to(root):
        raise RuntimeError("unsafe_target")
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "NO_PROXY": "*"})
    started_import = time.perf_counter()
    sys.path.insert(0, str(root / "src"))
    from knowledge_base.config import load_settings
    from knowledge_base.embed import get_embedder, release_models
    from knowledge_base.index_guard import require_existing_collection
    from knowledge_base.mcp_server import _replace_store_client
    from knowledge_base.search import search as do_search
    import knowledge_base.search as search_module
    from knowledge_base.store import VectorStore
    import_ms = (time.perf_counter() - started_import) * 1000

    settings = load_settings()  # .env is allowed to load; its values are never emitted.
    if settings.collection != collection or settings.data_dir != data.resolve():
        raise RuntimeError("settings_drift")
    require_loopback(settings.qdrant_url)
    require_existing_collection(settings)
    require_manifest(settings)
    model_started = time.perf_counter()
    embedder = get_embedder(settings.embedding_model)
    dimension = embedder.dim
    model_init_ms = (time.perf_counter() - model_started) * 1000

    def one(query: str) -> tuple[float, float, tuple[str, int] | None, dict[str, int | float]]:
        setup_started = time.perf_counter()
        store = VectorStore(settings.qdrant_url, settings.collection, dimension)
        _replace_store_client(store, settings)
        setup_ms = (time.perf_counter() - setup_started) * 1000
        counts = new_counts(); query_started = time.perf_counter()
        try:
            with monitor.scenario(counts):
                result = do_search(query, settings, store, top_k=8, compact=True)
            fingerprint = identity(result)
            if fingerprint is None:
                counts["errors"] += 1
        except BaseException:
            counts["errors"] += 1
            fingerprint = None
        finally:
            store.close()
        return setup_ms, (time.perf_counter() - query_started) * 1000, fingerprint, counts

    monitor = Monitor(search_module, embedder, VectorStore)
    try:
        with monitor:
            first = one(PUBLIC_QUERY)
            def series(query: str, n: int): return [one(query) for _ in range(n)]
            warm = series(PUBLIC_QUERY, samples)
            ambiguous = series(AMBIGUOUS_QUERY, samples)
            batch_walls: list[float] = []; callers: list[tuple[float, tuple[str, int] | None, dict[str, int | float]]] = []
            for _ in range(batches):
                barrier = threading.Barrier(width); records: list[Any] = []; lock = threading.Lock()
                def worker():
                    try:
                        barrier.wait(); item = one(PUBLIC_QUERY)
                    except BaseException:
                        failed = new_counts(); failed["errors"] = 1
                        item = (0.0, 0.0, None, failed)
                    with lock: records.append(item)
                threads = [threading.Thread(target=worker) for _ in range(width)]
                wall = time.perf_counter()
                for thread in threads: thread.start()
                for thread in threads: thread.join()
                batch_walls.append((time.perf_counter() - wall) * 1000)
                callers.extend(records)
    finally:
        release_models()

    def report(items: list[Any]) -> dict[str, Any]:
        durations = [item[1] for item in items]
        aggregate = new_counts()
        for item in items: merge_counts(aggregate, item[3])
        valid = [item[2] for item in items]
        deterministic = bool(valid) and all(value is not None and value == valid[0] for value in valid)
        return {"duration": stats(durations), "counts": aggregate,
                "client_setup": stats([item[0] for item in items]),
                "setup_plus_query": stats([item[0] + item[1] for item in items]),
                "deterministic_citation_identity": deterministic,
                "output_bytes": sorted({value[1] for value in valid if value is not None})}

    first_report = report([first])
    output = {"classification": "direct_engine_kernel_per_query_client_lifecycle",
              "actual_mcp_query_lifecycle": "not_measured_write_risk",
              "measurement_scope": "direct search.search; new VectorStore/client per query; no Registry/_stores/ensure_collection",
              "import_startup": stats([import_ms]), "model_init_dim_probe": stats([model_init_ms]),
              "first_query": first_report,
              "warm_identical": report(warm),
              "ambiguous": report(ambiguous),
              "concurrent_identical": {"batch_wall": stats(batch_walls), "per_caller": report(callers),
                                       "batches": batches, "width": width},
              "reranker_configuration_counts": {"configured": int(bool(settings.rerank_model)),
                                                   "not_configured": int(not settings.rerank_model)},
              "reranker_exercised": False, "process_wall_total_ms": 0.0,
              "incomplete": False}
    output["reranker_exercised"] = any(group["counts"]["reranker_runs"] > 0 for group in
        (output["first_query"], output["warm_identical"], output["ambiguous"], output["concurrent_identical"]["per_caller"]))
    output["incomplete"] = (len(callers) != batches * width or any(group["counts"]["errors"] > 0 for group in
        (output["first_query"], output["warm_identical"], output["ambiguous"], output["concurrent_identical"]["per_caller"])))
    return output


def parent(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    root, data = args.external_root.resolve(), args.data_dir.resolve()
    python = root / ".venv/bin/python"
    if args.collection != DEFAULT_COLLECTION or not data.is_relative_to(root):
        return {"classification": "incomplete", "error_type": "unsafe_target", "incomplete": True}, 2
    env = {"PATH": os.environ.get("PATH", ""), "KB_COLLECTION": args.collection, "KB_DATA_DIR": str(data),
           "KB_ALLOWED_ROOTS": "/mnt/c/Users/fireo/dungeon_master/dnd_rag_vault", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "NO_PROXY": "*"}
    command = [str(python), str(Path(__file__).resolve()), "--child", "--external-root", str(root), "--data-dir", str(data),
               "--collection", args.collection, "--samples", str(args.samples), "--batches", str(args.batches), "--width", str(args.width)]
    started = time.perf_counter()
    try:
        completed = subprocess.run(command, env=env, capture_output=True, text=True, timeout=args.timeout, check=False)
    except subprocess.TimeoutExpired:
        return {"classification": "incomplete", "error_type": "timeout", "incomplete": True,
                "process_wall_total_ms": round((time.perf_counter() - started) * 1000, 3)}, 1
    wall = round((time.perf_counter() - started) * 1000, 3)
    try: payload = json.loads(completed.stdout)
    except json.JSONDecodeError: payload = {"classification": "incomplete", "error_type": "child_output_invalid", "incomplete": True}
    payload["process_wall_total_ms"] = wall
    incomplete = completed.returncode != 0 or payload.get("incomplete", False)
    if incomplete: payload["incomplete"] = True
    return payload, int(incomplete)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--external-root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--batches", type=int, default=5)
    parser.add_argument("--width", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()
    if args.samples < 20 or args.batches < 5 or args.width < 4:
        print(json.dumps({"classification": "incomplete", "error_type": "minimum_samples", "incomplete": True}))
        return 2
    try:
        if args.child:
            started = time.perf_counter(); output = child(args.external_root.resolve(), args.data_dir.resolve(), args.collection, args.samples, args.batches, args.width)
            output["process_wall_total_ms"] = round((time.perf_counter() - started) * 1000, 3); code = int(output["incomplete"])
        else:
            output, code = parent(args)
    except BaseException as exc:
        output, code = {"classification": "incomplete", "error_type": type(exc).__name__, "incomplete": True}, 1
    print(json.dumps(output, sort_keys=True, separators=(",", ":")))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
