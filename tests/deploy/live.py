"""Actual Docker + encrypted ODM database + restic recovery on an installed test root."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import time
import urllib.request

spec=importlib.util.spec_from_file_location('odmctl',Path(__file__).resolve().parents[2]/'deploy/odmctl.py')
ops=importlib.util.module_from_spec(spec);spec.loader.exec_module(ops)
p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args()
c=ops.Controller(a.root);passed=[];completed=False
def record(name):passed.append(name);print('PASS '+name,flush=True)
def fixture(action):
    c.compose('stop','app')
    try:c.compose('run','--rm','--no-deps','-T','app','node','tests/deploy/db-fixture.mjs',action,timeout=120)
    finally:c.compose('up','-d','app');c.wait_ready()

guard=ops.locked(c.root);guard.__enter__()
try:
    c.require();c.wait_ready();record('installed application readiness checks actual encrypted database')
    credentials=ops.read_json(c.config_dir/'admin.json')
    url=f"http://127.0.0.1:{c.config['port']}"
    request=urllib.request.Request(url+'/api/auth/login',data=json.dumps(credentials).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=15) as r:
        assert r.status==200
        body=json.loads(r.read());assert body['user']['isAdmin'];assert body['user']['mustChangePassword']
    record('private bootstrap account can log in and requires password change')
    original_key=(c.config_dir/'app.env').read_bytes();original_admin=(c.config_dir/'admin.json').read_bytes()
    c.install(ops.parser().parse_args(['install','--skip-assets']))
    assert (c.config_dir/'app.env').read_bytes()==original_key
    assert (c.config_dir/'admin.json').read_bytes()==original_admin
    record('re-running installer preserves administrator and database key')
    fixture('seed');snapshot=c.backup();record('real restic snapshot includes game state, images and provider state')
    c.restic('check','--read-data',timeout=300);record('encrypted backup repository passes complete data verification')
    fixture('mutate');c.restore(snapshot,check_only=True);fixture('assert-mutated')
    record('restore drill validates encrypted snapshot without replacing newer live state')
    c.restore(snapshot,yes=True);fixture('assert');record('actual restore recovers character HP, story, message, asset and isolated account file')
    good=c.active()
    container=c.docker('create',good['image']).strip()
    try:bad_image=c.docker('commit','--change','CMD ["node","-e","process.exit(42)"]',container).strip()
    finally:c.docker('rm',container)
    bad={'sha':'b'*40,'image':bad_image,'compose':str(c.root/'releases/broken/compose.json')}
    ops.write_json(Path(bad['compose']),c.manifest(bad))
    wait=c.wait_ready;c.wait_ready=lambda seconds=120:wait(15)
    try:c.upgrade(bad);raise AssertionError('Failed candidate was accepted')
    except ops.OpsError:pass
    finally:c.wait_ready=wait
    assert c.active()==good;c.wait_ready();fixture('assert')
    record('failed real container update restores previous image and database snapshot')
    snapshot=c.backup();fixture('mutate')
    ops.write_json(c.config_dir/'transaction.json',{'old':good,'target':bad,'snapshot':snapshot})
    c.start();fixture('assert');record('interrupted transaction is recovered on the next startup')
    snapshot=c.backup()
    ops.write_json(c.config_dir/'transaction.json',{'old':good,'target':good,'snapshot':snapshot})
    c.compose('stop','app')
    displaced=c.root/'state-before-restore-crash-fixture'
    os.replace(c.root/'state',displaced)
    c.start();fixture('assert');assert displaced.is_dir()
    record('interrupted state-directory rename recovers from the encrypted journal snapshot')
    c.stop();c.watchdog();assert not c.probe();c.start();record('intentional stop is respected by watchdog')
    time.sleep(11)
    container=c.compose('ps','-q','app').strip()
    # Signal the inspected process, not Docker's manual-stop API: this is a crash test.
    pid=int(c.docker('inspect','--format','{{.State.Pid}}',container).strip());assert pid>1
    os.kill(pid,9);c.wait_ready()
    record('Docker restart policy recovers an actual killed server process')
    fixture('assert');record('game data survives process crash and restart')
    logs=c.compose('logs','--no-color','app')
    key=next(line.split('=',1)[1] for line in (c.config_dir/'app.env').read_text().splitlines() if line.startswith('DB_ENCRYPTION_KEY='))
    assert key not in logs;assert credentials['password'] not in logs
    record('database key and generated administrator password are not printed in service logs')
    remote=c.root/'offsite-fixture';remote_key=c.root/'config/offsite-fixture.password'
    ops.atomic(remote_key,'a-different-long-test-backup-password\n')
    c.remote_config(str(remote),str(remote_key));c.restic('init',remote=True);c.sync_remote()
    c.restic('check','--read-data',remote=True,timeout=300);c.restore('latest',remote=True,check_only=True)
    record('off-site copy to a second encrypted repository can be restored and decrypted')
    completed=True
finally:
    guard.__exit__(None,None,None)
    output=Path(os.environ.get('ODM_TEST_RESULTS','deployment-test-results'));output.mkdir(exist_ok=True)
    ops.write_json(output/'live-summary.json',{'completed':completed,'commit':c.active()['sha'],'passed':len(passed),'checks':passed,'real_services':['Docker','ODM SQLite encryption','restic'],'external_model_inference':False})
print(f'All {len(passed)} live deployment and recovery checks passed.')
