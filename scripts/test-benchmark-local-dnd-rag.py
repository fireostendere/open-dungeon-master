#!/usr/bin/env python3
"""No-network fake-engine regression checks for the local RAG benchmark."""
import importlib.util
import unittest
from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("benchmark", Path(__file__).with_name("benchmark-local-dnd-rag.py"))
benchmark = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(benchmark)


class FakeModel:
    def query_embed(self, _texts):
        yield [1.0]


class FakeEmbedder:
    def __init__(self):
        self._model, self._query_cache = FakeModel(), {}

    def embed_query(self, text):
        if text in self._query_cache:
            return self._query_cache[text]
        value = next(self._model.query_embed([text]))
        self._query_cache[text] = value
        return value


class FakeSparse:
    non_empty = True


class FakeSearch:
    @staticmethod
    def sparse_query(_text): return FakeSparse()

    @staticmethod
    def get_reranker(_name): return None


class FakeStore:
    def hybrid_search(self, _dense, _sparse, *_args): return []


class BenchmarkTest(unittest.TestCase):
    def test_model_miss_hit_counts_and_restoration(self):
        module, embedder, store = FakeSearch(), FakeEmbedder(), FakeStore()
        original = (module.sparse_query, module.get_reranker, embedder.embed_query,
                    embedder._model.query_embed, FakeStore.hybrid_search)
        counts = benchmark.new_counts()
        with benchmark.Monitor(module, embedder, FakeStore) as monitor:
            with monitor.scenario(counts):
                embedder.embed_query("public")
                embedder.embed_query("public")
                sparse = module.sparse_query("public")
                store.hybrid_search([], sparse, None, 8)
        self.assertEqual(counts["query_api_calls"], 2)
        self.assertEqual(counts["embedding_cache_hits"], 1)
        self.assertEqual(counts["model_query_inferences"], 1)
        self.assertEqual(counts["dense_searches"], 1)
        self.assertEqual(counts["lexical_searches"], 1)
        self.assertEqual((module.sparse_query, module.get_reranker, embedder.embed_query,
                          embedder._model.query_embed, FakeStore.hybrid_search), original)

    def test_identity_uses_real_page_fields_and_rejects_errors(self):
        first = {"hits": [{"source": "s", "document_id": "d", "page_start": 1, "page_end": 1, "section": "x"}]}
        changed_page = {"hits": [{"source": "s", "document_id": "d", "page_start": 2, "page_end": 2, "section": "x"}]}
        self.assertNotEqual(benchmark.identity(first)[0], benchmark.identity(changed_page)[0])
        self.assertIsNone(benchmark.identity({"error": "private message"}))
        self.assertIsNone(benchmark.identity({"hits": []}))

    def test_nonzero_child_is_classified_incomplete(self):
        args = Namespace(external_root=benchmark.DEFAULT_ROOT, data_dir=benchmark.DEFAULT_DATA,
                         collection=benchmark.DEFAULT_COLLECTION, samples=20, batches=5,
                         width=4, timeout=1)
        with patch.object(benchmark.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="{}")):
            output, code = benchmark.parent(args)
        self.assertEqual(code, 1)
        self.assertTrue(output["incomplete"])


if __name__ == "__main__":
    unittest.main()
