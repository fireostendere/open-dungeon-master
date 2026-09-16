#!/usr/bin/env python3
"""Behavioral operations regressions: real temp files/Git/locks, fake Docker/restic.

These tests do not claim a Docker, HTTPS, systemd or production-database E2E run.
"""
from __future__ import annotations
import contextlib
import copy
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1] / 'deploy'
sys.path.insert(0, str(DEPLOY))
import odmctl as ops
import mcpctl as mcp
import retention

OLD = '1' * 40; NEW = '2' * 40; OTHER = '3' * 40
OLD_IMAGE = 'sha256:' + 'a' * 64; NEW_IMAGE = 'sha256:' + 'b' * 64
OLD_MCP = 'sha256:' + 'c' * 64; NEW_MCP = 'sha256:' + 'd' * 64
SNAP = 'e' * 64; TOKEN = 'test-only-' + 'f' * 64

def config():
    return dict(schema=1, repo='owner/repo', branch='main', port=3005, listen='127.0.0.1', domain='game.example.org',
                runtime='none', accelerator='cpu', model='', llm_url='', comfy_url='', auto_update=False, assets=False)

def setup(root):
    (root / 'config').mkdir()
    ops.write_json(root / 'config/install.json', config())
    ops.atomic(root / 'config/app.env', 'DB_ENCRYPTION_KEY=isolated-fixture\nODM_MCP_TOKEN=' + TOKEN + '\n')
    ops.atomic(root / 'config/admin.json', '{}')
    for name in ops.STATE_DIRS: (root / 'state' / name).mkdir(parents=True)
    (root / 'state/data/local-roleplay.sqlite').write_text('original-state')
    releases = []
    for sha, image, mcp_image in [(OLD, OLD_IMAGE, OLD_MCP), (NEW, NEW_IMAGE, NEW_MCP)]:
        directory = root / 'releases' / sha
        (directory / 'source/mcp').mkdir(parents=True)
        (directory / 'source/mcp/Dockerfile').write_text('fixture')
        release = {'sha': sha, 'image': image, 'mcpImage': mcp_image, 'compose': str(directory / ('compose-' + image[7:19] + '.json'))}
        ops.write_json(Path(release['compose']), {'services': {}})
        ops.write_json(directory / 'release.json', release)
        releases.append(release)
    ops.write_json(root / 'config/active.json', releases[0])
    return releases

class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='odm-review-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.old, self.new = setup(self.root)

class FakeMcp(mcp.McpController):
    def __init__(self, root, release, *, fail=None):
        super().__init__(str(root), release)
        self.store = {}; self.calls = []; self.fail = fail; self.serial = 0
    def trip(self, point):
        if self.fail == point:
            self.fail = None; raise mcp.McpOpsError('fixture: ' + point)
    def add_old(self):
        self.store[self.container] = {'Id': 'original-container', 'Image': OLD_MCP, 'Config': {'Labels': {
            'odm.mcp.managed': '1', 'odm.root': self.project, 'odm.mcp.sha': OLD,
            'odm.mcp.token': hashlib.sha256(TOKEN.encode()).hexdigest()[:16]}}, 'State': {'Running': True}}
    def docker(self, *args, **kwargs):
        self.calls.append(args)
        if args[0] == 'inspect':
            if args[1] not in self.store: raise mcp.McpOpsError('No such container')
            return json.dumps([self.store[args[1]]])
        if args[0] == 'stop':
            self.trip('stop-before'); self.store[args[-1]]['State']['Running'] = False; return ''
        if args[0] == 'start': self.store[args[1]]['State']['Running'] = True; return ''
        if args[0] == 'rename':
            self.trip('rename-before')
            self.store[args[2]] = self.store.pop(args[1]); self.trip('rename-after'); return ''
        if args[:2] == ('rm', '-f'): self.store.pop(args[2], None); return ''
        if args[:2] == ('run', '-d'):
            name = args[args.index('--name') + 1]
            if name == self.container: self.trip('publish-before')
            if name in self.store: raise mcp.McpOpsError('Name already exists')
            labels = dict(args[i+1].split('=', 1) for i, arg in enumerate(args) if arg == '--label')
            self.serial += 1
            self.store[name] = {'Id': f'candidate-{self.serial}', 'Image': args[-1], 'Config': {'Labels': labels}, 'State': {'Running': True}}
            if name == self.container: self.trip('publish-after')
            return ''
        if args[:2] == ('image', 'inspect'):
            return self.image if '--format' in args else '[{}]'
        return ''
    def wait_ready(self, container=None, seconds=90):
        name = container or self.container
        self.calls.append(('health', name))
        if name == self.candidate: self.trip('candidate-health')
        else: self.trip('published-health')
        if name not in self.store or not self.store[name]['State']['Running']: raise mcp.McpOpsError('Not ready')

class McpLifecycle(Fixture):
    def test_candidate_failure_keeps_original_running(self):
        c = FakeMcp(self.root, self.new, fail='candidate-health'); c.add_old()
        with self.assertRaises(mcp.McpOpsError): c.run_container(TOKEN)
        self.assertEqual(c.store[c.container]['Id'], 'original-container')
        self.assertTrue(c.store[c.container]['State']['Running'])
        self.assertFalse(any(call[0] in ('stop', 'rename') for call in c.calls))
        self.assertNotIn(c.candidate, c.store)
    def test_replacement_failure_restores_exact_old_container(self):
        for point in ('publish-before', 'publish-after', 'published-health', 'stop-before', 'rename-before', 'rename-after'):
            with self.subTest(point=point):
                c = FakeMcp(self.root, self.new, fail=point); c.add_old()
                with self.assertRaises(mcp.McpOpsError): c.run_container(TOKEN)
                self.assertEqual(c.store[c.container]['Id'], 'original-container')
                self.assertTrue(c.store[c.container]['State']['Running'])
                self.assertNotIn(c.candidate, c.store)
    def test_success_keeps_old_until_the_coordinator_commits(self):
        c = FakeMcp(self.root, self.new); c.add_old(); c.run_container(TOKEN)
        self.assertEqual(c.store[c.container]['Image'], NEW_MCP)
        self.assertEqual(c.store[c.previous]['Id'], 'original-container')
        health = c.calls.index(('health', c.candidate))
        stop = next(i for i, call in enumerate(c.calls) if call[0] == 'stop')
        self.assertLess(health, stop)
        candidate_run = next(call for call in c.calls if call[:2] == ('run', '-d') and c.candidate in call)
        self.assertNotIn('--publish', candidate_run); self.assertNotIn('--network-alias', candidate_run)
        c.finalize(); self.assertNotIn(c.previous, c.store)
    def test_recovery_reuses_preserved_old_container(self):
        target = FakeMcp(self.root, self.new); target.add_old(); target.run_container(TOKEN)
        old = FakeMcp(self.root, self.old); old.store = target.store
        old.run_container(TOKEN)
        self.assertEqual(old.store[old.container]['Id'], 'original-container')
        self.assertTrue(old.store[old.container]['State']['Running'])
    def test_same_release_is_health_checked_not_replaced(self):
        c = FakeMcp(self.root, self.old); c.add_old(); c.run_container(TOKEN)
        self.assertEqual(c.store[c.container]['Id'], 'original-container')
        self.assertIn(('health', c.container), c.calls)
        self.assertFalse(any(call[:2] == ('run', '-d') for call in c.calls))
    def test_foreign_container_is_never_removed(self):
        c = FakeMcp(self.root, self.new); c.add_old()
        c.store[c.container]['Config']['Labels']['odm.root'] = 'some-other-install'
        with self.assertRaises(mcp.McpOpsError): c.run_container(TOKEN)
        self.assertEqual(c.store[c.container]['Id'], 'original-container')
    def test_stdio_command_includes_preload_before_server(self):
        command = mcp.stdio_command('fixture')
        self.assertIn('--import', command)
        self.assertLess(command.index('/app/external-tools-preload.mjs'), command.index('/app/server.mjs'))
        self.assertEqual(command[-1], '--stdio')
    def test_token_not_printed_without_explicit_show(self):
        c = FakeMcp(self.root, self.old)
        c.ensure_token()
        with contextlib.redirect_stdout(io.StringIO()) as output: c.token()
        self.assertNotIn(TOKEN, output.getvalue()); self.assertIn('mcp.token', output.getvalue())
        with contextlib.redirect_stdout(io.StringIO()) as output: c.token(True)
        self.assertEqual(output.getvalue().strip(), TOKEN)
        if os.name != 'nt':
            c.token_file.chmod(0o644)
            with self.assertRaises(mcp.McpOpsError): c.token(True)
    def test_stopped_install_cannot_be_started_by_repair_timer(self):
        c = FakeMcp(self.root, self.old); c.add_old()
        (self.root / 'config/stopped').touch()
        with self.assertRaises(mcp.McpOpsError): c.sync()
        self.assertEqual(c.calls, [])

class ProxyController(ops.Controller):
    def __init__(self, root, fail=False): super().__init__(str(root)); self.calls=[]; self.fail=fail
    def docker(self, *args, **kwargs):
        self.calls.append(args)
        if 'validate' in args:
            candidate = self.config_dir / 'caddy' / Path(args[args.index('--config')+1]).name
            assert 'reverse_proxy mcp:3006' in candidate.read_text()
            if self.fail: raise ops.OpsError('fixture validation failure')
        return ''
    def compose(self, *args, **kwargs): self.calls.append(('compose', *args)); return ''

class ProxyAndCli(Fixture):
    def test_manifest_is_pure_and_mounts_only_caddy_directory(self):
        c = ProxyController(self.root)
        old = self.root / 'config/Caddyfile'; old.write_text('old-live')
        before = old.stat().st_mtime_ns
        manifest = c.manifest(self.new)
        self.assertEqual(old.read_text(), 'old-live'); self.assertEqual(old.stat().st_mtime_ns, before)
        self.assertFalse((self.root / 'config/caddy').exists())
        mounts = manifest['services']['proxy']['volumes']
        self.assertEqual(mounts[0]['source'], str(self.root / 'config/caddy'))
        self.assertEqual(mounts[0]['target'], '/etc/caddy'); self.assertTrue(mounts[0]['read_only'])
        self.assertNotIn(str(self.root / 'config'), [v['source'] for v in mounts])
    def test_invalid_candidate_does_not_replace_live_config(self):
        c = ProxyController(self.root, fail=True)
        directory = self.root / 'config/caddy'; directory.mkdir(); live = directory / 'Caddyfile'; live.write_text('live-before')
        (self.root / 'config/mcp.env').touch()
        with self.assertRaises(ops.OpsError): c.configure_proxy(self.new)
        self.assertEqual(live.read_text(), 'live-before')
        self.assertFalse(any(call[0] == 'compose' for call in c.calls))
        self.assertEqual(list(directory.iterdir()), [live])
    def test_validated_config_is_recreated_through_directory_bind(self):
        c = ProxyController(self.root); (self.root / 'config/mcp.env').touch()
        c.configure_proxy(self.new)
        live = self.root / 'config/caddy/Caddyfile'; first_inode = live.stat().st_ino
        c.configure_proxy(self.new)
        self.assertNotEqual(live.stat().st_ino, first_inode)
        self.assertIn('reverse_proxy mcp:3006', live.read_text())
        self.assertIn('respond 404', live.read_text())
        self.assertTrue(any('--force-recreate' in call for call in c.calls))
        self.assertEqual(json.loads(Path(self.new['compose']).read_text())['services']['proxy']['volumes'][0]['source'], str(live.parent))
    def test_renderer_rejects_injected_domain(self):
        for domain in ('https://bad.example', 'a.example {', 'a.example\n:80', 'localhost'):
            with self.subTest(domain=domain), self.assertRaises(ops.OpsError): ops.render_caddy(domain)
        self.assertIn('respond 503', ops.render_caddy('game.example.org', False))
    def test_documented_cli_arguments_parse(self):
        self.assertTrue(ops.parser().parse_args(['logs', '-f']).follow)
        self.assertTrue(ops.parser().parse_args(['logs', '--follow']).follow)
        self.assertTrue(mcp.parser().parse_args(['--root', str(self.root), 'token', '--show']).show)
        self.assertFalse(ops.parser().parse_args(['retention']).apply)
    def test_follow_logs_does_not_acquire_writer_lock(self):
        class Stub:
            config=True
            def __init__(self, root): pass
            def compose(_self, *args, **kwargs):
                self.assertIn('--follow', args); self.assertIsNone(kwargs['timeout'])
        with patch.object(ops, 'Controller', Stub), patch.object(ops, 'locked', side_effect=AssertionError('writer lock used')), patch.object(sys, 'argv', ['odmctl', 'logs', '-f']):
            self.assertEqual(ops.main(), 0)
    def test_mcp_and_web_cli_share_an_actual_process_lock(self):
        # A second process cannot enter even via the direct Python entrypoint.
        with ops.locked(self.root):
            result = subprocess.run([sys.executable, str(DEPLOY / 'mcpctl.py'), '--root', str(self.root), 'sync'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn('Another ODM operation', result.stderr)
        with ops.locked(self.root): pass

class TransitionController(ops.Controller):
    def __init__(self, root, fail=None):
        super().__init__(str(root)); self.events=[]; self.fail=fail; self.web=OLD; self.mcp=OLD; self.backup_tree=None
    def prepare_mcp_env(self, release): self.events.append(('env', release['sha']))
    def pause_mcp(self, release=None): self.events.append(('pause-mcp', (release or self.active())['sha']))
    def wait_ready(self, seconds=120): self.events.append(('web-ready', self.web))
    def compose(self, *args, release=None, **kw):
        release = release or self.active(); self.events.append(('compose', release['sha'], args))
        if 'up' in args and 'app' in args:
            self.web = release['sha']
            if self.web == NEW: (self.root / 'state/data/local-roleplay.sqlite').write_text('new-migration')
        return ''
    def backup(self, resume=True, tag='scheduled'):
        directory = self.root / 'fixture-backup'; directory.mkdir(exist_ok=True)
        shutil.copytree(self.root / 'state', directory / 'state')
        shutil.copytree(self.root / 'config', directory / 'config')
        self.backup_tree=directory; self.events.append(('backup', tag)); return SNAP
    def stage_restore(self, snapshot, remote=False):
        parent = Path(tempfile.mkdtemp(dir=self.root)); target = parent / 'copy'
        shutil.copytree(self.backup_tree, target); return parent, target
    def check_restored(self, source, release): self.events.append(('check-restored', release['sha']))
    def release_gate(self, release):
        self.events.append(('gate', release['sha'], self.active()['sha']))
        if self.fail == 'new-mcp' and release['sha'] == NEW: raise ops.OpsError('new MCP failed')
        if self.fail == 'rollback-mcp' and release['sha'] == OLD: raise ops.OpsError('rollback MCP failed')
        self.mcp=release['sha']
    def sync_tools(self):
        self.events.append(('tools', self.active()['sha']))
        if self.fail in ('tools', 'rollback-mcp') and self.active()['sha'] == NEW: raise ops.OpsError('tool installation failed')
    def configure_proxy(self, release=None): self.events.append(('proxy', (release or self.active())['sha']))
    def install_timers(self): self.events.append(('timers',))
    def release_cleanup(self): self.events.append(('cleanup',))
    def alert(self, *args): self.events.append(('alert', *args))

class ReleaseTransactions(Fixture):
    def test_success_commits_only_after_both_health_gates(self):
        c = TransitionController(self.root)
        c.upgrade(self.new)
        self.assertEqual(c.active(), self.new)
        self.assertEqual(c.web, NEW); self.assertEqual(c.mcp, NEW)
        self.assertIn(('gate', NEW, OLD), c.events)
        self.assertGreater(c.events.index(('proxy', NEW)), c.events.index(('tools', NEW)))
        self.assertFalse((self.root / 'config/transaction.json').exists())
        self.assertEqual(ops.read_json(self.root / 'config/previous.json')['snapshot'], SNAP)
    def test_failed_mcp_rolls_back_release_state_and_prior_metadata(self):
        previous = {'release': self.old, 'snapshot': '9' * 64}
        ops.write_json(self.root / 'config/previous.json', previous)
        c = TransitionController(self.root, 'new-mcp')
        with patch.object(ops.os, 'chown', return_value=None), self.assertRaises(ops.OpsError): c.upgrade(self.new)
        self.assertEqual(c.active(), self.old); self.assertEqual(c.web, OLD); self.assertEqual(c.mcp, OLD)
        self.assertEqual((self.root / 'state/data/local-roleplay.sqlite').read_text(), 'original-state')
        self.assertEqual(ops.read_json(self.root / 'config/previous.json'), previous)
        self.assertFalse((self.root / 'config/transaction.json').exists())
    def test_failure_after_active_write_still_restores_previous_metadata(self):
        previous = {'release': self.old, 'snapshot': '8' * 64}
        ops.write_json(self.root / 'config/previous.json', previous)
        c = TransitionController(self.root, 'tools')
        with patch.object(ops.os, 'chown', return_value=None), self.assertRaises(ops.OpsError): c.upgrade(self.new)
        self.assertEqual(c.active(), self.old)
        self.assertEqual(ops.read_json(self.root / 'config/previous.json'), previous)
    def test_failed_rollback_preserves_recoverable_journal(self):
        c = TransitionController(self.root, 'rollback-mcp')
        with patch.object(ops.os, 'chown', return_value=None), self.assertRaises(ops.OpsError): c.upgrade(self.new)
        self.assertTrue((self.root / 'config/transaction.json').exists())
        c.fail=None
        with patch.object(ops.os, 'chown', return_value=None): c.recover_pending()
        self.assertEqual(c.active(), self.old); self.assertEqual(c.web, OLD); self.assertEqual(c.mcp, OLD)
        self.assertFalse((self.root / 'config/transaction.json').exists())
    def test_legacy_game_rollback_does_not_downgrade_ops_controller(self):
        c = ops.Controller(str(self.root))
        source = self.root / 'releases' / OLD / 'source/deploy'; source.mkdir()
        (source / 'odmctl.py').write_text('old controller without a common MCP lock')
        (self.root / 'tools').mkdir(); (self.root / 'tools/odmctl.py').write_text('current safe controller')
        c.sync_tools()
        self.assertEqual((self.root / 'tools/odmctl.py').read_text(), 'current safe controller')

class SnapshotRetention(unittest.TestCase):
    def sample(self, n=120):
        origin=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
        return [{'id': f'{i+1:064x}', 'time': (origin+dt.timedelta(days=i)).isoformat(),
                 'tags': ['odm', ('scheduled', 'pre-update', 'pre-restore')[i % 3]], 'hostname': 'fixture', 'paths': ['/opt/odm/state']} for i in range(n)]
    def test_all_backup_classes_are_bounded_together(self):
        snapshots=self.sample(); removed=retention.snapshot_plan(snapshots, set(), retention.DEFAULT_POLICY)
        kept=[s for s in snapshots if s['id'] not in removed]
        self.assertLessEqual(len(kept), sum(retention.DEFAULT_POLICY[k] for k in ('keepLast','keepDaily','keepWeekly','keepMonthly')))
        for tag in ('scheduled','pre-update','pre-restore'):
            self.assertTrue(any(s['id'] in removed for s in snapshots if tag in s['tags']))
    def test_protected_rollback_and_operator_pins_survive(self):
        snapshots=self.sample(); snapshots[0]['tags'].append('odm-pin')
        protected={snapshots[1]['id'], snapshots[2]['id'][:8]}
        removed=retention.snapshot_plan(snapshots, protected, retention.DEFAULT_POLICY)
        for s in snapshots[:3]: self.assertNotIn(s['id'], removed)
    def test_non_odm_snapshots_are_never_selected(self):
        snapshots=self.sample(); snapshots[0]['tags']=['another-application']
        self.assertNotIn(snapshots[0]['id'], retention.snapshot_plan(snapshots,set(),retention.DEFAULT_POLICY))
    def test_malformed_metadata_fails_closed(self):
        for change in ({'id':'--all'}, {'time':'bad'}, {'paths':[123]}, {'tags':{}}, {'hostname':5}):
            snapshots=self.sample(2); snapshots[0].update(change)
            with self.subTest(change=change), self.assertRaises(retention.RetentionError): retention.snapshot_plan(snapshots,set(),retention.DEFAULT_POLICY)

class RetentionFixture(ops.Controller):
    def __init__(self, root, snapshots): super().__init__(str(root)); self.snapshots=snapshots; self.commands=[]
    def probe(self): return True
    def restic(self,*args,**kwargs):
        self.commands.append(('restic',*args))
        if args[0]=='snapshots': return json.dumps(self.snapshots)
        return ''
    def docker(self,*args,**kwargs):
        self.commands.append(('docker',*args))
        if args[:2]==('image','ls'): return ''
        return ''
    def run(self,args,**kwargs):
        self.commands.append(tuple(str(x) for x in args))
        result=subprocess.run([str(x) for x in args],capture_output=True,text=True,check=True)
        return result.stdout

class ManagedRetention(Fixture):
    def make_history(self):
        snapshots=SnapshotRetention().sample(30)
        ops.write_json(self.root/'config/last-backup.json',{'id':snapshots[-1]['id']})
        for i in range(20): (self.root/f'state-before-restore-{10**18+i}').mkdir()
        return snapshots
    def test_twenty_displaced_states_are_bounded_and_pinned_states_survive(self):
        snapshots=self.make_history(); pin=f'state-before-restore-{10**18}'
        ops.write_json(self.root/'config/retention-pins.json',{'stateDirs':[pin]})
        c=RetentionFixture(self.root,snapshots)
        with contextlib.redirect_stdout(io.StringIO()): plan=retention.apply_retention(c)
        self.assertEqual(len(plan['states']),17)
        self.assertEqual(len(list(self.root.glob('state-before-restore-*'))),20)
        with contextlib.redirect_stdout(io.StringIO()): retention.apply_retention(c,apply=True)
        self.assertEqual(len(list(self.root.glob('state-before-restore-*'))),3)
        self.assertTrue((self.root/pin).exists()); self.assertTrue((self.root/'state/data/local-roleplay.sqlite').exists())
        self.assertFalse(any('system' in cmd and 'prune' in cmd for cmd in c.commands))
    def test_symlink_and_unknown_directory_are_never_deleted(self):
        snapshots=self.make_history(); outside=self.root/'operator-files'; outside.mkdir()
        (outside/'keep').write_text('important')
        link=self.root/f'state-before-restore-{10**18-1}'
        try: link.symlink_to(outside,target_is_directory=True)
        except OSError: self.skipTest('Symlinks unavailable')
        c=RetentionFixture(self.root,snapshots)
        with contextlib.redirect_stdout(io.StringIO()): retention.apply_retention(c,apply=True)
        self.assertEqual((outside/'keep').read_text(),'important'); self.assertTrue(link.is_symlink())
    def test_pending_transaction_blocks_all_pruning(self):
        c=RetentionFixture(self.root,self.make_history()); (self.root/'config/transaction.json').write_text('{}')
        with self.assertRaises(retention.RetentionError): retention.apply_retention(c,apply=True)
        self.assertEqual(c.commands,[])
    def test_missing_confirmed_backup_blocks_all_pruning(self):
        c=RetentionFixture(self.root,self.make_history()); (self.root/'config/last-backup.json').unlink()
        with self.assertRaises(retention.RetentionError): retention.apply_retention(c,apply=True)
        self.assertEqual(len(list(self.root.glob('state-before-restore-*'))),20)
    def test_clean_real_git_worktrees_are_pruned_but_dirty_one_is_kept(self):
        snapshots=self.make_history(); repo=self.root/'repository'
        subprocess.run(['git','init',str(repo)],check=True,capture_output=True)
        def git(*args): return subprocess.run(['git','-C',str(repo),*args],check=True,capture_output=True,text=True).stdout.strip()
        git('config','user.email','fixture@example.invalid'); git('config','user.name','Fixture')
        histories=[]
        for i in range(8):
            (repo/'fixture').write_text(str(i)); git('add','fixture'); git('commit','-m',str(i)); sha=git('rev-parse','HEAD')
            directory=self.root/'releases'/sha; directory.mkdir()
            git('worktree','add','--detach',str(directory/'source'),sha)
            histories.append(directory)
        (histories[0]/'source/operator-note').write_text('uncommitted work')
        c=RetentionFixture(self.root,snapshots)
        with contextlib.redirect_stdout(io.StringIO()): result=retention.apply_retention(c,apply=True)
        self.assertTrue(histories[0].exists())
        self.assertFalse(histories[1].exists()); self.assertFalse(histories[2].exists())
        self.assertTrue((self.root/'releases'/OLD).exists())
        self.assertEqual((histories[0]/'source/operator-note').read_text(),'uncommitted work')
        self.assertTrue(any('modified' in x for x in result['preserved']))

class BootstrapAndIsolation(Fixture):
    def test_incomplete_bundle_cannot_partially_replace_tools(self):
        source = self.root / 'bundle'; source.mkdir()
        tools = self.root / 'tools'; tools.mkdir()
        for name in ('mcpctl.py', 'retention.py', 'odmctl.py'):
            (tools / name).write_text('original')
            (source / name).write_text('OPS_API_VERSION = 2\n')
        (source / 'odmctl.py').write_text('def invalid syntax')
        with ops.locked(self.root), self.assertRaises(ops.OpsError): ops.install_ops_tools(self.root, source)
        self.assertTrue(all(p.read_text() == 'original' for p in tools.iterdir()))
    def test_bundle_bootstrap_is_idempotent_and_has_all_modules(self):
        with ops.locked(self.root): ops.install_ops_tools(self.root, DEPLOY)
        paths = [self.root / 'tools' / x for x in ('odmctl.py', 'mcpctl.py', 'retention.py')]
        before = [p.stat().st_mtime_ns for p in paths]
        with ops.locked(self.root): ops.install_ops_tools(self.root, DEPLOY)
        self.assertEqual(before, [p.stat().st_mtime_ns for p in paths])
        self.assertEqual(ops.parser().parse_args(['install', '--bootstrap-tools']).bootstrap_tools, True)
    @unittest.skipIf(os.name == 'nt', 'POSIX inherited descriptor test')
    def test_inherited_lock_is_the_same_kernel_lock_and_stays_held(self):
        import fcntl
        program = "import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from odmctl import locked; "
        program += "\nwith locked(Path(sys.argv[2]), int(sys.argv[3]) if len(sys.argv)>3 else None): pass"
        with open(self.root / '.ops.lock', 'a+b') as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            child = subprocess.run([sys.executable, '-c', program, str(DEPLOY), str(self.root), str(f.fileno())], pass_fds=(f.fileno(),), capture_output=True)
            self.assertEqual(child.returncode, 0, child.stderr)
            blocked = subprocess.run([sys.executable, '-c', program, str(DEPLOY), str(self.root)], capture_output=True)
            self.assertNotEqual(blocked.returncode, 0)
            self.assertIn(b'Another ODM operation', blocked.stderr)
    @unittest.skipIf(os.name == 'nt', 'POSIX inherited descriptor test')
    def test_a_different_file_descriptor_cannot_bypass_lock(self):
        (self.root / '.ops.lock').touch()
        with open(self.root / 'wrong-file', 'a+b') as f:
            with self.assertRaises(ops.OpsError):
                with ops.locked(self.root, f.fileno()): pass
        with self.assertRaises(ops.OpsError):
            with ops.locked(self.root, 999999): pass
    def test_restore_check_does_not_touch_active_state_credentials_or_proxy(self):
        c = ops.Controller(str(self.root))
        ingress = self.root / 'config/caddy/Caddyfile'; ingress.parent.mkdir(); ingress.write_text('live-proxy')
        staging = self.root / 'staging'; staging.mkdir()
        source = staging / 'snapshot'; source.mkdir()
        shutil.copytree(self.root / 'state', source / 'state')
        shutil.copytree(self.root / 'config', source / 'config')
        ops.write_json(source / 'config/recovery.json', {'release': self.old})
        protected = [self.root / p for p in ('config/active.json', 'config/app.env', 'state/data/local-roleplay.sqlite', 'config/caddy/Caddyfile')]
        protected.append(Path(self.old['compose']))
        before = [(p.read_bytes(), p.stat().st_mtime_ns) for p in protected]
        with patch.object(c, 'stage_restore', return_value=(staging, source)), patch.object(c, 'docker', return_value=''), patch.object(c, 'check_restored') as check, patch.object(c, 'mcp_controller', side_effect=AssertionError('MCP activation during restore-check')), patch.object(c, 'configure_proxy', side_effect=AssertionError('Proxy mutation during restore-check')):
            c.restore(SNAP, check_only=True)
        check.assert_called_once()
        self.assertEqual(before, [(p.read_bytes(), p.stat().st_mtime_ns) for p in protected])
    def test_linux_installer_help_plan_and_bad_options_are_read_only(self):
        script = DEPLOY.parent / 'install-server.sh'
        for args in (['--help'], ['--plan', '--root', str(self.root / 'absent')]):
            result = subprocess.run(['bash', str(script), *args], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / 'absent').exists())
        bad = subprocess.run(['bash', str(script), '--not-an-option'], capture_output=True)
        self.assertEqual(bad.returncode, 2)

if __name__=='__main__': unittest.main(verbosity=2)
