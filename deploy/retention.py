#!/usr/bin/env python3
"""Retention for ODM artifacts not covered by the scheduled backup policy.

Scheduled snapshots keep the existing daily/weekly/monthly policy in odmctl.
This companion bounds pre-update/pre-restore snapshots, old release worktrees,
managed Docker image tags and displaced restore-state directories while always
preserving the active and previous releases. Explicit recovery-kit archives are
operator-created/pinned artifacts and are never deleted automatically.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
KEEP_RELEASES = 3
KEEP_DISPLACED_STATES = 2
STALE_TEMP_SECONDS = 24 * 3600


class RetentionError(RuntimeError):
    pass


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def run(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        args,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check and result.returncode:
        detail = (result.stderr or result.stdout).strip().splitlines()
        suffix = f": {detail[-1]}" if detail else ""
        raise RetentionError(f"{Path(args[0]).name} failed with exit {result.returncode}{suffix}")
    return result


def active_shas(root: Path) -> set[str]:
    keep: set[str] = set()
    active = read_json(root / "config" / "active.json")
    previous = read_json(root / "config" / "previous.json")
    transaction = read_json(root / "config" / "transaction.json")
    candidates = [active, previous.get("release", {}), transaction.get("old", {}), transaction.get("target", {})]
    for release in candidates:
        sha = str(release.get("sha", "")) if isinstance(release, dict) else ""
        if SHA_RE.fullmatch(sha):
            keep.add(sha)
    return keep


def prune_releases(root: Path, report: dict) -> None:
    releases = root / "releases"
    repository = root / "repository"
    if not releases.is_dir():
        return
    keep = active_shas(root)
    candidates = [path for path in releases.iterdir() if path.is_dir() and SHA_RE.fullmatch(path.name)]
    candidates.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    for path in candidates:
        if len(keep) >= KEEP_RELEASES:
            break
        keep.add(path.name)
    removed: list[str] = []
    for path in candidates:
        if path.name in keep:
            continue
        source = path / "source"
        if source.exists() and repository.is_dir():
            run(["git", "-C", str(repository), "worktree", "remove", "--force", str(source)], check=False)
        shutil.rmtree(path, ignore_errors=True)
        removed.append(path.name)
    if repository.is_dir():
        run(["git", "-C", str(repository), "worktree", "prune"], check=False)
    report["removedReleases"] = removed
    report["keptReleaseShas"] = sorted(keep)


def prune_images(root: Path, report: dict) -> None:
    keep_shas = active_shas(root)
    keep_tags = {
        f"{prefix}:{sha}"
        for sha in keep_shas
        for prefix in ("odm-managed", "odm-mcp-managed")
    }
    result = run(["docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}"], check=False)
    if result.returncode:
        report["imagePruneSkipped"] = True
        return
    removed: list[str] = []
    for tag in sorted(set(result.stdout.splitlines())):
        if not (tag.startswith("odm-managed:") or tag.startswith("odm-mcp-managed:")):
            continue
        if tag in keep_tags or tag.endswith(":<none>"):
            continue
        removed_result = run(["docker", "image", "rm", tag], check=False)
        if removed_result.returncode == 0:
            removed.append(tag)
    report["removedImageTags"] = removed


def prune_displaced_states(root: Path, report: dict) -> None:
    states = sorted(
        [path for path in root.glob("state-before-restore-*") if path.is_dir()],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    removed: list[str] = []
    for path in states[KEEP_DISPLACED_STATES:]:
        shutil.rmtree(path, ignore_errors=True)
        removed.append(path.name)
    report["removedDisplacedStates"] = removed


def prune_stale_temporaries(root: Path, report: dict) -> None:
    cutoff = time.time() - STALE_TEMP_SECONDS
    removed: list[str] = []
    for pattern in (".restore-*", ".state-candidate-*"):
        for path in root.glob(pattern):
            try:
                old = path.stat().st_mtime < cutoff
            except OSError:
                continue
            if not old:
                continue
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
            removed.append(path.name)
    report["removedStaleTemporaries"] = removed


def prune_snapshots(root: Path, report: dict) -> None:
    repository = root / "backups"
    password = root / "config" / "backup.password"
    if not (repository / "config").is_file() or not password.is_file():
        report["snapshotRetentionSkipped"] = True
        return
    base = ["restic", "-r", str(repository), "--password-file", str(password)]
    policies = [
        ("pre-update", ["--keep-last", "2"]),
        ("pre-restore", ["--keep-last", "2"]),
    ]
    for tag, policy in policies:
        run([*base, "forget", "--tag", tag, "--group-by", "tags", *policy])
    # scheduled retention is deliberately still owned by odmctl check; prune
    # here reclaims blobs forgotten by any of the three policies in one pass.
    run([*base, "prune"])
    report["snapshotPolicies"] = {"pre-update": 2, "pre-restore": 2}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()
    root = Path(args.root).expanduser().absolute()
    if root == Path(root.anchor) or root.is_symlink() or not (root / ".odm-managed").is_file():
        print("retention: unsafe or unmanaged ODM root", file=sys.stderr)
        return 2

    report: dict[str, object] = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        prune_releases(root, report)
        prune_images(root, report)
        prune_displaced_states(root, report)
        prune_stale_temporaries(root, report)
        if not args.local_only:
            prune_snapshots(root, report)
    except RetentionError as exc:
        print("retention: " + str(exc), file=sys.stderr)
        return 1

    free = shutil.disk_usage(root).free
    report["freeBytes"] = free
    if free < 4 * 1024**3:
        report["warning"] = "Less than 4 GiB free after retention"
    logs = root / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    (logs / "retention.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
