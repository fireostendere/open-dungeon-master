#!/usr/bin/env python3
"""Bound only ODM-owned history; never prune Docker globally or live game state.

All callers hold odmctl's .ops.lock. Dry-run is the CLI default. Automatic
cleanup runs only after a committed healthy release or a successful restic check.
Operator pins live in config/retention-pins.json (snapshotIds, releaseShas,
stateDirs). Unknown files, dirty worktrees and unlabelled images are preserved.
"""
from __future__ import annotations
import datetime as dt
import json
from pathlib import Path
import re
import shutil

SHA = re.compile(r'^[0-9a-f]{40}$')
SNAPSHOT = re.compile(r'^[0-9a-f]{8,64}$')
DIGEST = re.compile(r'^sha256:[0-9a-f]{64}$')
DISPLACED = re.compile(r'^state-before-restore-[0-9]{15,22}$')
COMPOSE = re.compile(r'^compose-[0-9a-f]{12}\.json$')
DEFAULT_POLICY = {'keepReleases': 5, 'keepDisplaced': 2, 'keepLast': 4,
                  'keepDaily': 7, 'keepWeekly': 4, 'keepMonthly': 6}

class RetentionError(RuntimeError):
    pass

def read_object(path: Path, default=None):
    if not path.exists(): return {} if default is None else default
    if path.is_symlink(): raise RetentionError('Retention metadata must not be a symlink')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict): raise RetentionError('Retention metadata must be an object')
    return value

def policy_at(root: Path) -> dict:
    raw = read_object(root / 'config/retention.json')
    if set(raw) - set(DEFAULT_POLICY): raise RetentionError('Unknown retention policy field')
    result = {**DEFAULT_POLICY, **raw}
    for key, value in result.items():
        if type(value) is not int or not 1 <= value <= 100:
            raise RetentionError(f'{key} must be 1..100')
    return result

def pins_at(root: Path) -> dict:
    raw = read_object(root / 'config/retention-pins.json')
    if set(raw) - {'snapshotIds', 'releaseShas', 'stateDirs'}:
        raise RetentionError('Unknown retention pin field')
    for key, pattern in [('snapshotIds', SNAPSHOT), ('releaseShas', SHA), ('stateDirs', DISPLACED)]:
        values = raw.get(key, [])
        if not isinstance(values, list) or any(not isinstance(x, str) or not pattern.fullmatch(x) for x in values):
            raise RetentionError('Invalid retention pins: ' + key)
        raw[key] = values
    return raw

def protects(identifier: str, protected: set[str]) -> bool:
    return any(identifier.startswith(pin) or pin.startswith(identifier) for pin in protected)

def snapshot_plan(snapshots: list, protected: set[str], policy: dict) -> list[str]:
    """Keep rolling daily/weekly/monthly representatives across ALL ODM tags."""
    if not isinstance(snapshots, list): raise RetentionError('Invalid restic snapshot listing')
    groups: dict[tuple, list] = {}
    seen = set()
    for item in snapshots:
        if not isinstance(item, dict): raise RetentionError('Invalid restic snapshot record')
        identifier = item.get('id', '')
        if not isinstance(identifier, str) or not re.fullmatch(r'[0-9a-f]{64}', identifier) or identifier in seen:
            raise RetentionError('Invalid or duplicate restic snapshot ID')
        seen.add(identifier)
        tags, paths, host = item.get('tags', []), item.get('paths', []), item.get('hostname', '')
        if (not isinstance(tags, list) or not isinstance(paths, list) or not isinstance(host, str)
                or any(not isinstance(x, str) for x in tags + paths)):
            raise RetentionError('Invalid restic snapshot group')
        if 'odm' not in tags: continue
        try:
            at = dt.datetime.fromisoformat(item['time'].replace('Z', '+00:00'))
            if at.tzinfo is None: raise ValueError('Missing timezone')
            at = at.astimezone(dt.timezone.utc)
        except (KeyError, TypeError, AttributeError, ValueError) as exc:
            raise RetentionError('Invalid restic snapshot timestamp') from exc
        groups.setdefault((host, tuple(sorted(paths))), []).append((at, identifier, tags))
    remove = []
    for records in groups.values():
        records.sort(reverse=True)
        keep = {record[1] for record in records[:policy['keepLast']]}
        keep.update(identifier for _, identifier, tags in records if 'odm-pin' in tags or protects(identifier, protected))
        for key, bucket in [('keepDaily', lambda d: d.date()),
                            ('keepWeekly', lambda d: d.isocalendar()[:2]),
                            ('keepMonthly', lambda d: (d.year, d.month))]:
            buckets = set()
            for at, identifier, _ in records:
                value = bucket(at)
                if value in buckets: continue
                if len(buckets) >= policy[key]: break
                buckets.add(value); keep.add(identifier)
        remove.extend(identifier for _, identifier, _ in records if identifier not in keep)
    return sorted(remove)

def release_references(root: Path, pins: dict) -> tuple[set[str], set[str], set[str]]:
    releases = set(pins['releaseShas']); images = set(); snapshots = set(pins['snapshotIds'])
    active = read_object(root / 'config/active.json')
    previous = read_object(root / 'config/previous.json')
    transaction = read_object(root / 'config/transaction.json')
    last_backup = read_object(root / 'config/last-backup.json')
    records = [active, previous.get('release'), transaction.get('old'), transaction.get('target')]
    for record in records:
        if record is None or record == {}: continue
        if not isinstance(record, dict) or not SHA.fullmatch(str(record.get('sha', ''))):
            raise RetentionError('Invalid protected release metadata')
        releases.add(record['sha'])
        for key in ('image', 'mcpImage'):
            value = record.get(key)
            if value is None: continue
            if not isinstance(value, str) or not DIGEST.fullmatch(value):
                raise RetentionError('Invalid protected image metadata')
            images.add(value)
    for record, key in [(previous, 'snapshot'), (transaction, 'snapshot'), (last_backup, 'id')]:
        value = record.get(key)
        if value is None: continue
        if not isinstance(value, str) or not SNAPSHOT.fullmatch(value):
            raise RetentionError('Invalid protected snapshot metadata')
        snapshots.add(value)
    return releases, images, snapshots

def apply_retention(controller, *, apply=False, prune=False) -> dict:
    root = controller.root; policy = policy_at(root); pins = pins_at(root)
    if (root / 'config/transaction.json').exists():
        raise RetentionError('An active/recoverable transaction prevents retention')
    if not controller.active() or (root / 'config/stopped').exists():
        raise RetentionError('Retention requires an active, running installation')
    if not controller.probe(): raise RetentionError('Retention requires healthy live state')
    releases_keep, images_keep, snapshots_keep = release_references(root, pins)
    snapshots = json.loads(controller.restic('snapshots', '--tag', 'odm', '--json', timeout=120))
    remove_snapshots = snapshot_plan(snapshots, snapshots_keep, policy)
    last = read_object(root / 'config/last-backup.json').get('id')
    if not last or not any(item['id'].startswith(last) for item in snapshots if 'odm' in item.get('tags', [])):
        raise RetentionError('No confirmed recovery snapshot; history was not deleted')
    report = {'applied': apply, 'snapshots': remove_snapshots, 'releases': [], 'states': [], 'images': [], 'preserved': []}
    release_root = root / 'releases'
    if release_root.is_symlink(): raise RetentionError('Managed release root must not be a symlink')
    directories = sorted((p for p in release_root.iterdir() if SHA.fullmatch(p.name) and p.is_dir() and not p.is_symlink()),
                         key=lambda p: p.stat().st_mtime_ns, reverse=True) if release_root.exists() else []
    releases_keep.update(p.name for p in directories[:policy['keepReleases']])
    for directory in directories:
        if directory.name in releases_keep:
            metadata = read_object(directory / 'release.json')
            for field in ('image', 'mcpImage'):
                value = metadata.get(field)
                if value is not None:
                    if not isinstance(value, str) or not DIGEST.fullmatch(value):
                        raise RetentionError('Invalid retained release image digest')
                    images_keep.add(value)
            continue
        source = directory / 'source'
        if source.is_symlink() or not source.is_dir() or not (source / '.git').is_file():
            report['preserved'].append(directory.name + ': not a managed worktree'); continue
        if any(p.name not in ('source', 'release.json') and not COMPOSE.fullmatch(p.name) for p in directory.iterdir()):
            report['preserved'].append(directory.name + ': unknown files'); continue
        try:
            head = controller.run(['git', '-C', source, 'rev-parse', 'HEAD'], timeout=30).strip()
            dirty = controller.run(['git', '-C', source, 'status', '--porcelain', '--untracked-files=all'], timeout=30).strip()
            common = Path(controller.run(['git', '-C', source, 'rev-parse', '--path-format=absolute', '--git-common-dir'], timeout=30).strip())
            own_common = Path(controller.run(['git', '-C', controller.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], timeout=30).strip())
        except Exception:
            report['preserved'].append(directory.name + ': unverifiable worktree'); continue
        if head != directory.name or dirty or common.resolve() != own_common.resolve():
            report['preserved'].append(directory.name + ': modified or foreign worktree'); continue
        report['releases'].append(directory.name)
    states = sorted((p for p in root.iterdir() if DISPLACED.fullmatch(p.name) and p.is_dir() and not p.is_symlink()),
                    key=lambda p: int(p.name.rsplit('-', 1)[1]), reverse=True)
    states_keep = {p.name for p in states[:policy['keepDisplaced']]} | set(pins['stateDirs'])
    report['states'] = [p.name for p in states if p.name not in states_keep]
    # Images are scoped by the installation label, never docker system prune.
    image_ids = set(controller.docker('image', 'ls', '--no-trunc', '--quiet',
        '--filter', 'label=odm.managed=1', '--filter', 'label=odm.root=' + controller.env['COMPOSE_PROJECT_NAME'], timeout=60).split())
    for image in sorted(image_ids - images_keep):
        if not DIGEST.fullmatch(image): raise RetentionError('Invalid managed Docker image ID')
        info = json.loads(controller.docker('image', 'inspect', image, timeout=30))
        if not isinstance(info, list) or len(info) != 1: raise RetentionError('Invalid image inspection')
        labels = info[0].get('Config', {}).get('Labels', {})
        if labels.get('odm.managed') == '1' and labels.get('odm.root') == controller.env['COMPOSE_PROJECT_NAME']:
            # Missing/foreign release ownership fails closed.
            sha = labels.get('odm.release', '')
            if isinstance(sha, str) and SHA.fullmatch(sha) and sha not in releases_keep:
                report['images'].append(image)
    if apply:
        for offset in range(0, len(remove_snapshots), 100):
            controller.restic('forget', *remove_snapshots[offset:offset+100], timeout=300)
        if prune: controller.restic('prune', timeout=7200)
        for sha in report['releases']:
            directory = release_root / sha
            controller.run(['git', '-C', controller.repo, 'worktree', 'remove', str(directory / 'source')], timeout=60)
            # No force: a concurrent operator edit prevents deletion.
            shutil.rmtree(directory)
        for name in report['states']: shutil.rmtree(root / name)
        for image in report['images']:
            try: controller.docker('image', 'rm', image, timeout=60)
            except Exception: report['preserved'].append(image + ': still referenced or unavailable')
    print(json.dumps(report, indent=2))
    return report

if __name__ == '__main__':
    from odmctl import Controller, locked
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', required=True); p.add_argument('--apply', action='store_true'); p.add_argument('--prune', action='store_true')
    args = p.parse_args()
    with locked(Path(args.root).expanduser().absolute()):
        apply_retention(Controller(args.root), apply=args.apply, prune=args.prune)
