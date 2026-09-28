"""Fast offline tests. Docker/restic are simulated; filesystem transitions are real.
The separate live workflow tests actual containers, encrypted SQLite and restic.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[2] / 'deploy/odmctl.py'
spec = importlib.util.spec_from_file_location('odmctl', MODULE)
ops = importlib.util.module_from_spec(spec); spec.loader.exec_module(ops)
GOOD = 'a' * 40
BAD = 'b' * 40
IMAGE = 'sha256:' + 'c' * 64

def config(**kw):
    c = dict(schema=1, repo='owner/repo', branch='main', port=13005, listen='127.0.0.1', domain='',
             runtime='none', model='qwen3:8b', accelerator='cpu', llm_url='http://localhost:11434/v1',
             comfy_url='', auto_update=False, assets=False)
    c.update(kw); return c

class Fake(ops.Controller):
    def __init__(self, root):
        super().__init__(root); self.calls=[]; self.running=True; self.fail_backup=False; self.fail_sha=None
        self.saved={}; self.counter=0; self.timers=False; self.fail_model=False
    def require(self): pass
    def disk_ok(self, minimum=0): pass
    def compose(self, *args, release=None, **kw):
        self.calls.append(('compose', args, release))
        if args[0]=='stop': self.running=False
        if args[0] in ('up','restart'):
            self.running=True
            self.started=release or self.active()
            if self.started and self.started['sha']==self.fail_sha:
                (self.root/'state/data/local-roleplay.sqlite').write_text('failed migration')
        return ''
    def docker(self, *args, **kw): self.calls.append(('docker',args)); return ''
    def restic(self,*args,remote=False,**kw):
        self.calls.append(('restic',args))
        if args[0]=='init':
            (self.root/'backups').mkdir(exist_ok=True); (self.root/'backups/config').write_text('fixture'); return ''
        if args[0]=='backup':
            if self.running: raise AssertionError('Snapshot attempted while a writer was running')
            if self.fail_backup: raise ops.OpsError('fixture backup failed')
            self.counter+=1; ident=f'{self.counter:064x}'
            directory=self.root/'fixtures'/ident; directory.mkdir(parents=True)
            shutil.copytree(self.root/'state',directory/'state')
            (directory/'config').mkdir()
            for f in ['app.env','install.json','recovery.json','admin.json']:
                shutil.copy2(self.config_dir/f,directory/'config'/f)
            self.saved[ident]=directory
            return json.dumps({'message_type':'summary','snapshot_id':ident})+'\n'
        if args[0]=='restore':
            ident=args[1]
            if ident=='latest': ident=list(self.saved)[-1]
            target=Path(args[args.index('--target')+1])/'old-root'
            shutil.copytree(self.saved[ident],target)
        return ''
    def probe(self): return self.running and getattr(self,'started',self.active())['sha']!=self.fail_sha
    def wait_ready(self, seconds=120):
        if not self.probe(): raise ops.OpsError('fixture readiness failed')
    def check_restored(self, source, release):
        if (source/'state/data/local-roleplay.sqlite').read_text()=='corrupt': raise ops.OpsError('fixture corrupt database')
    def install_timers(self): self.timers=True
    def sync_tools(self): pass
    def model(self):
        if self.fail_model: raise ops.OpsError('fixture model failed')
    def build(self, *args, **kw): return release(self.root,GOOD)


def release(root, sha):
    r=dict(sha=sha,image=IMAGE,compose=str(root/'releases'/sha/'compose.json'))
    ops.write_json(Path(r['compose']),{'services':{}}); return r

def seed(root):
    (root/'config').mkdir(parents=True)
    ops.write_json(root/'config/install.json',config())
    ops.atomic(root/'config/app.env','DB_ENCRYPTION_KEY=fixture-secret\n')
    ops.atomic(root/'config/backup.password','fixture-backup-secret\n')
    ops.write_json(root/'config/admin.json',{'username':'fixture','password':'fixture-not-live'})
    for directory in ops.STATE_DIRS: (root/'state'/directory).mkdir(parents=True)
    (root/'state/data/local-roleplay.sqlite').write_text('characters and campaign before update')
    (root/'state/uploads/portrait.png').write_bytes(b'portrait fixture')
    (root/'state/provider-auth/account.json').write_text('isolated account fixture')
    ops.write_json(root/'config/active.json',release(root,GOOD))

class OpsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'odm';seed(self.root);self.c=Fake(self.root)
        if os.name!='nt':
            self.chown=patch.object(ops.os,'chown',return_value=None);self.chown.start();self.addCleanup(self.chown.stop)
        self.out=contextlib.redirect_stdout(io.StringIO());self.out.__enter__()
    def tearDown(self): self.out.__exit__(None,None,None);self.temp.cleanup()
    def test_valid_config(self): self.assertEqual(ops.validate_config(config())['port'],13005)
    def test_bad_repo(self):
        for repo in ['https://github.com/a/b','a/b/c','a;whoami/b','../b']:
            with self.subTest(repo=repo),self.assertRaises(ops.OpsError): ops.validate_config(config(repo=repo))
    def test_bad_branch(self):
        for branch in ['--exec=x','a..b','a\nb','a b']:
            with self.subTest(branch=branch),self.assertRaises(ops.OpsError): ops.validate_config(config(branch=branch))
    def test_bad_domain(self):
        for domain in ['https://table.test','foo { reverse_proxy evil }','localhost','table.test/path','-x.test']:
            with self.subTest(domain=domain),self.assertRaises(ops.OpsError):ops.validate_config(config(domain=domain))
    def test_public_domain_requires_loopback(self):
        with self.assertRaises(ops.OpsError):ops.validate_config(config(domain='table.test',listen='0.0.0.0'))
    def test_port_bounds(self):
        for port in [0,80,65536,'3005']:
            with self.subTest(port=port),self.assertRaises(ops.OpsError):ops.validate_config(config(port=port))
    def test_key_cannot_go_into_url(self):
        for value in ['file:///etc/passwd','http://user:key@server/v1','https://a.test?key=x']:
            with self.subTest(url=value),self.assertRaises(ops.OpsError):ops.validate_config(config(llm_url=value))
    def test_model_id_validation(self):
        with self.assertRaises(ops.OpsError):ops.validate_config(config(runtime='ollama',model='--delete'))
    def test_root_is_not_drive_root(self):
        with self.assertRaises(ops.OpsError):ops.validate_root(Path.cwd().anchor)
    def test_atomic_secret_file(self):
        p=self.root/'config/secret';ops.atomic(p,'one');ops.atomic(p,'two')
        self.assertEqual(p.read_text(),'two')
        if os.name!='nt':self.assertEqual(p.stat().st_mode&0o777,0o600)
    @unittest.skipIf(os.name=='nt','Unix flock behavior')
    def test_exclusive_operation_lock(self):
        with ops.locked(self.root):
            with self.assertRaises(ops.OpsError):
                with ops.locked(self.root):pass
    def test_manifest_is_single_private_app(self):
        manifest=self.c.manifest(self.c.active());app=manifest['services']['app']
        self.assertEqual(app['ports'],['127.0.0.1:13005:3005']);self.assertEqual(app['restart'],'unless-stopped')
        self.assertNotIn('replicas',json.dumps(manifest));self.assertNotIn('fixture-secret',json.dumps(manifest))
    def test_managed_build_reuses_cached_multistage_dockerfile(self):
        project=MODULE.parents[1];dockerfile=(project/'Dockerfile').read_text()
        self.assertLess(dockerfile.index('COPY package.json package-lock.json ./'),dockerfile.index('RUN npm ci'))
        self.assertLess(dockerfile.index('RUN npm ci'),dockerfile.index('COPY . .'))
        self.assertLess(dockerfile.index('RUN node scripts/fetch-content-pack.mjs'),dockerfile.index('COPY . .'))
        self.assertIn('COPY src/lib/srd/ ./src/lib/srd/',dockerfile)
        self.assertIn('AS runner',dockerfile);self.assertIn('/app/deploy/db-tool.mjs ./deploy/db-tool.mjs',dockerfile)
        controller=MODULE.read_text();self.assertIn("str(source / 'Dockerfile')",controller)
        self.assertNotIn("source / 'deploy' / 'Dockerfile'",controller)
    def test_all_game_data_and_auth_are_persistent(self):
        mounts=self.c.manifest(self.c.active())['services']['app']['volumes']
        self.assertEqual(len(mounts),6);self.assertTrue(any(m['target']=='/app/provider-auth' for m in mounts))
        self.assertTrue(all('/repository/' not in m['source'].replace('\\','/') for m in mounts))
    def test_ollama_is_not_published_to_network(self):
        self.c.config['runtime']='ollama';model=self.c.manifest(self.c.active())['services']['ollama']
        self.assertNotIn('ports',model);self.assertNotIn('devices',model);self.assertNotIn('gpus',model)
    def test_gpu_modes_are_explicit(self):
        self.c.config.update(runtime='ollama',accelerator='nvidia');self.assertEqual(self.c.manifest(self.c.active())['services']['ollama']['gpus'],'all')
        self.c.config['accelerator']='amd';self.assertIn('/dev/kfd:/dev/kfd',self.c.manifest(self.c.active())['services']['ollama']['devices'])
    def test_https_proxy_blocks_internal_control(self):
        self.c.config['domain']='table.test';m=self.c.manifest(self.c.active())
        self.assertEqual(m['services']['proxy']['ports'],['80:80','443:443'])
        self.c.configure_proxy()
        self.assertIn('/api/internal/*',(self.c.config_dir/'caddy/Caddyfile').read_text())
    def test_backup_pauses_and_resumes_writer(self):
        ident=self.c.backup();self.assertTrue(self.c.running);self.assertIn(ident,self.c.saved)
        self.assertEqual((self.c.saved[ident]/'state/uploads/portrait.png').read_bytes(),b'portrait fixture')
    def test_backup_excludes_only_transient_codex_auth_tmp(self):
        ident=self.c.backup()
        command=next(call[1] for call in self.c.calls if call[0]=='restic' and call[1][0]=='backup')
        self.assertIn('--exclude=state/provider-auth/codex/tmp',command)
        self.assertNotIn('--exclude=state/provider-auth',command)
        self.assertTrue((self.c.saved[ident]/'state/provider-auth/account.json').is_file())
    def test_backup_does_not_include_github_credentials(self):
        (self.c.config_dir/'github.token').write_text('must-not-leave');ident=self.c.backup()
        self.assertFalse((self.c.saved[ident]/'config/github.token').exists())
        self.assertTrue((self.c.saved[ident]/'config/app.env').exists())
    def test_failed_backup_always_resumes_before_update(self):
        self.c.fail_backup=True
        with self.assertRaises(ops.OpsError):self.c.backup(resume=False)
        self.assertTrue(self.c.running);self.assertFalse((self.c.config_dir/'last-backup.json').exists())
    def test_planned_stop_is_not_undone_by_backup(self):
        ops.atomic(self.c.config_dir/'stopped','intentional');self.c.backup();self.assertFalse(self.c.running)
    def test_power_loss_transition_recovers_at_start(self):
        snapshot=self.c.backup();bad=release(self.root,BAD)
        ops.write_json(self.c.config_dir/'transaction.json',{'old':self.c.active(),'target':bad,'snapshot':snapshot})
        (self.root/'state/data/local-roleplay.sqlite').write_text('interrupted migration')
        self.c.start()
        self.assertEqual((self.root/'state/data/local-roleplay.sqlite').read_text(),'characters and campaign before update')
        self.assertFalse((self.c.config_dir/'transaction.json').exists());self.assertTrue(self.c.probe())
    def test_interrupted_fast_update_recovers_code_without_database_snapshot(self):
        old=self.c.active();bad=release(self.root,BAD)
        ops.write_json(self.c.config_dir/'transaction.json',{'old':old,'target':bad,'snapshot':None})
        self.c.recover_pending()
        self.assertEqual(self.c.active()['sha'],GOOD)
        self.assertEqual((self.root/'state/data/local-roleplay.sqlite').read_text(),'characters and campaign before update')
        self.assertFalse((self.c.config_dir/'transaction.json').exists());self.assertTrue(self.c.probe())
    def test_committed_transition_is_not_rolled_back(self):
        snapshot=self.c.backup();old=self.c.active();new=release(self.root,BAD)
        ops.write_json(self.c.config_dir/'active.json',new)
        ops.write_json(self.c.config_dir/'transaction.json',{'old':old,'target':new,'snapshot':snapshot,'committed':True})
        (self.root/'state/data/local-roleplay.sqlite').write_text('committed newer game state')
        self.c.start();self.assertEqual((self.root/'state/data/local-roleplay.sqlite').read_text(),'committed newer game state')
    def test_successful_update_records_rollback_snapshot(self):
        self.c.upgrade(release(self.root,BAD));self.assertEqual(self.c.active()['sha'],BAD)
        previous=ops.read_json(self.c.config_dir/'previous.json');self.assertEqual(previous['release']['sha'],GOOD)
        self.assertIn(previous['snapshot'],self.c.saved)
    def test_fast_update_skips_backup_retention_and_offsite_sync(self):
        with patch.object(self.c,'retention') as retention,patch.object(self.c,'sync_remote') as offsite:
            self.c.upgrade(release(self.root,BAD),fast=True)
        retention.assert_not_called();offsite.assert_not_called()
        self.assertFalse(any(call[0]=='restic' and call[1][0]=='backup' for call in self.c.calls))
        self.assertIsNone(ops.read_json(self.c.config_dir/'previous.json')['snapshot'])
    def test_failed_fast_update_restores_code_but_leaves_database_untouched_by_rollback(self):
        self.c.fail_sha=BAD
        with self.assertRaises(ops.OpsError): self.c.upgrade(release(self.root,BAD),fast=True)
        self.assertEqual(self.c.active()['sha'],GOOD)
        self.assertEqual((self.root/'state/data/local-roleplay.sqlite').read_text(),'failed migration')
        self.assertIn('without database rollback',ops.read_json(self.root/'logs/last-alert.json')['message'])
    def test_failed_update_restores_actual_files_and_old_release(self):
        self.c.fail_sha=BAD
        with self.assertRaises(ops.OpsError):self.c.upgrade(release(self.root,BAD))
        self.assertEqual(self.c.active()['sha'],GOOD)
        self.assertEqual((self.root/'state/data/local-roleplay.sqlite').read_text(),'characters and campaign before update')
        self.assertTrue(self.c.probe())
    def test_no_switch_after_failed_preupdate_backup(self):
        self.c.fail_backup=True
        with self.assertRaises(ops.OpsError):self.c.upgrade(release(self.root,BAD))
        self.assertEqual(self.c.active()['sha'],GOOD);self.assertTrue(self.c.probe())
    def test_restore_check_never_replaces_live_state(self):
        snapshot=self.c.backup();(self.root/'state/data/local-roleplay.sqlite').write_text('live newer data')
        self.c.restore(snapshot,check_only=True)
        self.assertEqual((self.root/'state/data/local-roleplay.sqlite').read_text(),'live newer data')
        self.assertTrue((self.c.config_dir/'last-restore-check.json').exists())
    def test_restore_requires_confirmation(self):
        with self.assertRaises(ops.OpsError):self.c.restore('latest')
        self.assertTrue(self.c.running)
    def test_restore_keeps_pre_restore_state(self):
        snapshot=self.c.backup();(self.root/'state/data/local-roleplay.sqlite').write_text('new data')
        self.c.restore(snapshot,yes=True)
        old=list(self.root.glob('state-before-restore-*'));self.assertEqual(len(old),1)
        self.assertEqual((old[0]/'data/local-roleplay.sqlite').read_text(),'new data')
        self.assertEqual((self.root/'state/data/local-roleplay.sqlite').read_text(),'characters and campaign before update')
    def test_corrupt_restore_rejected_before_stopping_live(self):
        snapshot=self.c.backup();(self.c.saved[snapshot]/'state/data/local-roleplay.sqlite').write_text('corrupt')
        calls=len(self.c.calls)
        with self.assertRaises(ops.OpsError):self.c.restore(snapshot,yes=True)
        self.assertFalse(any(x[0]=='compose' and x[1][0]=='stop' for x in self.c.calls[calls:]));self.assertTrue(self.c.running)
    def test_missing_key_rejected_before_state_swap(self):
        snapshot=self.c.backup();(self.c.saved[snapshot]/'config/app.env').unlink()
        with self.assertRaises(ops.OpsError):self.c.restore(snapshot,yes=True)
        self.assertTrue(self.c.running)
    def test_invalid_snapshot_id(self):
        for snapshot in ['--delete','../a','x'*64]:
            with self.subTest(id=snapshot),self.assertRaises(ops.OpsError):self.c.stage_restore(snapshot)
    def test_watchdog_three_failures_not_one(self):
        self.c.running=False;self.c.watchdog();self.c.watchdog()
        self.assertFalse(any(x[0]=='compose' and x[1][0]=='restart' for x in self.c.calls))
        self.c.watchdog();self.assertTrue(any(x[0]=='compose' and x[1][0]=='restart' for x in self.c.calls))
    def test_watchdog_restart_budget(self):
        import time
        ops.write_json(self.c.config_dir/'watchdog.json',{'failures':3,'restarts':[time.time()-1800,time.time()-1200,time.time()-10]})
        self.c.running=False;self.c.watchdog()
        self.assertFalse(any(x[0]=='compose' and x[1][0]=='restart' for x in self.c.calls))
    def test_watchdog_respects_operator_stop(self):
        ops.atomic(self.c.config_dir/'stopped','intentional');self.c.running=False;self.c.watchdog();self.assertEqual(self.c.calls,[])
    def test_initial_secrets_survive_retry(self):
        before=(self.c.config_dir/'app.env').read_bytes();options=ops.parser().parse_args(['install'])
        self.c.init(options);self.assertEqual((self.c.config_dir/'app.env').read_bytes(),before)
    def test_missing_restic_repo_initialized_on_retry(self):
        self.c.init(ops.parser().parse_args(['install']));self.assertTrue((self.root/'backups/config').exists())
    def test_failed_model_still_installs_backup_and_timers(self):
        self.c.config['runtime']='ollama';self.c.fail_model=True
        with self.assertRaises(ops.OpsError):self.c.install(ops.parser().parse_args(['install']))
        self.assertTrue(self.c.timers);self.assertTrue(self.c.probe());self.assertTrue(self.c.saved)
        self.assertFalse((self.c.config_dir/'installed.json').exists())
    def test_recovery_kit_contains_keys_but_not_git_token(self):
        import zipfile
        (self.c.config_dir/'github.token').write_text('do-not-export')
        output=self.c.recovery_kit()
        with zipfile.ZipFile(output) as archive:
            self.assertIn('backup.password',archive.namelist());self.assertIn('app.env',archive.namelist())
            self.assertNotIn('github.token',archive.namelist())
        if os.name!='nt':self.assertEqual(output.stat().st_mode&0o777,0o600)
    def test_same_release_restore_recovers_uncommitted_data(self):
        snapshot=self.c.backup();same=self.c.active()
        ops.write_json(self.c.config_dir/'transaction.json',{'old':same,'target':same,'snapshot':snapshot})
        (self.root/'state/data/local-roleplay.sqlite').write_text('interrupted same-version restore')
        self.c.start();self.assertEqual((self.root/'state/data/local-roleplay.sqlite').read_text(),'characters and campaign before update')
    def test_health_has_no_account_or_key(self):
        text=json.dumps(self.c.status());self.assertNotIn('fixture-secret',text);self.assertNotIn('fixture-not-live',text)
    def test_cli_command_parsing(self):
        p=ops.parser();self.assertEqual(p.parse_args(['auth','login','chatgpt','--device']).args,['login','chatgpt','--device'])
        self.assertTrue(p.parse_args(['restore','latest','--yes']).yes)
        update=p.parse_args(['update','--fast','--refresh-base'])
        self.assertTrue(update.fast);self.assertTrue(update.refresh_base)
    @unittest.skipIf(os.name=='nt','Bash belongs to Linux installer')
    def test_standalone_server_dry_plan(self):
        script=MODULE.parents[1]/'install-server.sh'
        r=subprocess.run(['bash',str(script),'--plan','--root',str(self.root/'unused')],capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr);self.assertFalse((self.root/'unused').exists())

if __name__=='__main__':unittest.main()
