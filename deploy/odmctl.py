#!/usr/bin/env python3
"""Single-node ODM operations. Python stdlib; Docker Compose and restic are external.

The same controller runs on Linux and Windows. Code/images are replaceable;
state, credentials and encrypted backups are separate. No shell=True or eval.
"""
from __future__ import annotations
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse
import urllib.error
import zipfile

SCHEMA = 1
OPS_API_VERSION = 2
STATE_DIRS = ('data', 'uploads', 'generated', 'audio', 'provider-auth')
REPO_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$')
REF_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._/-]*$')
SHA_RE = re.compile(r'^[0-9a-f]{40}$')
DOMAIN_RE = re.compile(r'^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')

class OpsError(RuntimeError):
    pass

def atomic(path: Path, data: str, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
        if os.name != 'nt':
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
    finally:
        if os.path.exists(name): os.unlink(name)

def write_json(path, data):
    atomic(Path(path), json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def read_json(path, default=None):
    p = Path(path)
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else default

def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def validate_root(raw):
    p = Path(raw).expanduser().absolute()
    if p == Path(p.anchor) or p.is_symlink(): raise OpsError('Unsafe installation directory')
    # Docker mount specs and generated service files must not be injectable.
    if any(c in str(p) for c in '\r\n"%$`') or (os.name != 'nt' and (':' in str(p) or ' ' in str(p))):
        raise OpsError('Use a simple installation path (Linux: no spaces or colons)')
    return p

def validate_config(c):
    if c.get('schema') != SCHEMA: raise OpsError('Unsupported deployment configuration version')
    if not REPO_RE.fullmatch(c.get('repo', '')): raise OpsError('Repository must be owner/name')
    if not REF_RE.fullmatch(c.get('branch', '')) or '..' in c['branch']: raise OpsError('Invalid branch')
    if c.get('runtime') not in ('none', 'ollama', 'external'): raise OpsError('Unknown runtime')
    if c.get('accelerator') not in ('cpu', 'nvidia', 'amd'): raise OpsError('Unknown accelerator')
    if c.get('listen') not in ('127.0.0.1', '0.0.0.0'): raise OpsError('Unsupported listen address')
    if not isinstance(c.get('port'), int) or not 1024 <= c['port'] <= 65535: raise OpsError('Port must be 1024..65535')
    if c.get('domain') and not DOMAIN_RE.fullmatch(c['domain']): raise OpsError('Expected a public DNS name without scheme or path')
    if c.get('domain') and c['listen'] != '127.0.0.1': raise OpsError('HTTPS deployment must keep the application port private')
    if c['accelerator'] == 'amd' and os.name == 'nt': raise OpsError('AMD Docker requires Linux; use an external Windows runtime instead')
    if c['runtime'] != 'none' and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}', c.get('model', '')):
        raise OpsError('Enter a valid exact model ID')
    for key in ('llm_url', 'comfy_url'):
        value = c.get(key, '')
        if value:
            u = urllib.parse.urlsplit(value)
            if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or u.query or u.fragment:
                raise OpsError(f'Invalid {key}; put credentials in the provider wizard, not the URL')
    return c

def render_caddy(domain: str, mcp_enabled: bool = True) -> str:
    """Pure renderer: builds and restore-checks must never rewrite live ingress."""
    if not DOMAIN_RE.fullmatch(domain): raise OpsError('Invalid public domain')
    mcp = 'reverse_proxy mcp:3006 {\n   flush_interval -1\n  }' if mcp_enabled else 'respond 503'
    return (domain + ' {\n encode zstd gzip\n'
            ' @private path /api/internal /api/internal/*\n'
            ' handle @private {\n  respond 404\n }\n'
            ' @mcp path /mcp /mcp/*\n handle @mcp {\n  ' + mcp + '\n }\n'
            ' handle {\n  reverse_proxy app:3005\n }\n}\n')

@contextlib.contextmanager
def locked(root, inherited_fd=None):
    root.mkdir(parents=True, exist_ok=True)
    lock_path = root / '.ops.lock'
    if inherited_fd is not None:
        if os.name == 'nt': raise OpsError('Inherited lock descriptors are only supported on POSIX')
        try:
            descriptor = os.fstat(inherited_fd)
            expected = lock_path.stat(follow_symlinks=False)
            if not stat.S_ISREG(expected.st_mode) or (descriptor.st_dev, descriptor.st_ino) != (expected.st_dev, expected.st_ino):
                raise OpsError('Inherited lock is not this installation lock')
            handle = os.fdopen(os.dup(inherited_fd), 'a+b')
        except OSError as error: raise OpsError('Invalid inherited installation lock') from error
    else:
        if lock_path.is_symlink(): raise OpsError('Installation lock must not be a symlink')
        handle = open(lock_path, 'a+b')
    with handle as f:
        try:
            if os.name == 'nt':
                import msvcrt
                f.seek(0); f.write(b'0'); f.flush(); f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as e: raise OpsError('Another ODM operation is running; try again after it finishes') from e
        try: yield
        finally:
            if os.name == 'nt':
                f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)

def install_ops_tools(root: Path, source: Path):
    """Called only under .ops.lock. Validate the entire bundle before replacing it."""
    contents = {}
    for name in ('mcpctl.py', 'retention.py', 'odmctl.py'):
        candidate = source / name
        if candidate.is_symlink() or not candidate.is_file(): raise OpsError('Incomplete operations bundle: ' + name)
        text = candidate.read_text(encoding='utf-8')
        try: compile(text, str(candidate), 'exec')
        except SyntaxError as error: raise OpsError('Invalid operations module: ' + name) from error
        contents[name] = text
    version = re.search(r'^OPS_API_VERSION = (\d+)$', contents['odmctl.py'], re.M)
    if not version or int(version.group(1)) < 2: raise OpsError('Selected installer lacks coordinated operations; use a current installer')
    # Core is last: older cores do not depend on the new helper modules.
    for name, text in contents.items():
        target = root / 'tools' / name
        if target.is_symlink(): raise OpsError('Operations module must not be a symlink: ' + name)
        if not target.is_file() or target.read_text(encoding='utf-8') != text:
            atomic(target, text, 0o700)
    watch_sh = source / 'watch-player.sh'
    if watch_sh.is_file() and not watch_sh.is_symlink():
        target_sh = root / 'tools' / 'watch-player.sh'
        if not target_sh.is_file() or target_sh.read_text(encoding='utf-8') != watch_sh.read_text(encoding='utf-8'):
            atomic(target_sh, watch_sh.read_text(encoding='utf-8'), 0o755)

class Controller:
    def __init__(self, root):
        self.root = validate_root(root)
        self.config_dir = self.root / 'config'
        self.config = read_json(self.config_dir / 'install.json')
        if self.config: validate_config(self.config)
        self.repo = self.root / 'repository'
        self.env = os.environ.copy()
        self.env.update({'COMPOSE_PROJECT_NAME': 'odm-' + hashlib.sha256(str(self.root).encode()).hexdigest()[:10],
                         'GIT_TERMINAL_PROMPT': '0', 'RESTIC_PASSWORD_FILE': str(self.config_dir / 'backup.password')})
        # A bootstrap-provided helper reads a read-only repository credential.
        helper = self.config_dir / ('git-askpass.cmd' if os.name == 'nt' else 'git-askpass.sh')
        if helper.exists(): self.env['GIT_ASKPASS'] = str(helper)

    def run(self, args, *, cwd=None, input=None, timeout=1800, capture=True, env=None):
        try:
            r = subprocess.run([str(a) for a in args], cwd=cwd or self.root, env=env or self.env,
                               input=input, text=True, encoding='utf-8', errors='replace',
                               stdout=subprocess.PIPE if capture else None,
                               stderr=subprocess.PIPE if capture else None, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise OpsError(f'{Path(str(args[0])).name}: unavailable or timed out') from e
        if r.returncode:
            atomic(self.root / 'logs/last-command-error.log', r.stderr or 'No captured stderr; see terminal output')
            # Do not dump command arguments, provider output, environment or backup credentials.
            raise OpsError(f'{Path(str(args[0])).name} failed (exit {r.returncode}); inspect the service journal locally')
        return r.stdout or ''

    def docker(self, *args, **kw): return self.run(['docker', *args], **kw)
    def active(self): return read_json(self.config_dir / 'active.json')
    def compose(self, *args, release=None, **kw):
        release = release or self.active()
        if not release: raise OpsError('No active release; finish installation first')
        return self.docker('compose', '--project-name', self.env['COMPOSE_PROJECT_NAME'], '-f', release['compose'], *args, **kw)

    def require(self):
        if not self.config: raise OpsError('This directory is not an initialized ODM installation')
        self.docker('info', '--format', '{{.ServerVersion}}', timeout=30)
        self.docker('compose', 'version', timeout=30)
        self.run(['restic', 'version'], timeout=30)

    def disk_ok(self, minimum=2 * 1024**3):
        if shutil.disk_usage(self.root).free < minimum: raise OpsError('Insufficient free disk space; live state was not changed')

    def init(self, options):
        if self.config:
            self.require()
            if not (self.root / 'backups' / 'config').exists(): self.restic('init')
            return False
        c = validate_config(dict(schema=SCHEMA, repo=options.repo, branch=options.branch, port=options.port,
            listen=options.listen, domain=options.domain.lower(), runtime=options.runtime, model=options.model,
            accelerator=options.accelerator, llm_url=options.llm_url, comfy_url=options.comfy_url,
            auto_update=options.auto_update, assets=not options.skip_assets))
        self.config_dir.mkdir(parents=True, exist_ok=True); os.chmod(self.config_dir, 0o700)
        for d in (*STATE_DIRS,):
            p = self.root / 'state' / d; p.mkdir(parents=True, exist_ok=True)
            if os.name != 'nt': os.chown(p, 1000, 1000); os.chmod(p, 0o700)
        for d in ('cache/embeddings', 'cache/ollama', 'proxy', 'logs', 'releases'):
            p = self.root / d; p.mkdir(parents=True, exist_ok=True)
            if os.name != 'nt' and d == 'cache/embeddings': os.chown(p, 1000, 1000)
        dbkey = secrets.token_hex(32)
        appenv = {'DB_ENCRYPTION_KEY': dbkey, 'SQLITE_DB_PATH': '/app/data/local-roleplay.sqlite',
            'CONTENT_DB_PATH': '/app/data/content/open5e.sqlite', 'ODM_PROVIDER_AUTH_HOME': '/app/provider-auth',
            'ODM_LOCAL_ORIGIN': 'http://127.0.0.1:3005', 'VOICE_ENABLED': '0', 'NODE_ENV': 'production',
            'NEXT_TELEMETRY_DISABLED': '1', 'DEFAULT_TEXT_PROVIDER': 'none', 'PORT': '3005',
            'COOKIE_SECURE': '1' if c['domain'] else '0'}
        if c['domain']:
            appenv.update(APP_PUBLIC_URL='https://' + c['domain'], ODM_PUBLIC_ORIGIN='https://' + c['domain'])
        if c['comfy_url']: appenv['COMFYUI_URL'] = c['comfy_url']
        if not (self.config_dir / 'app.env').exists():
            atomic(self.config_dir / 'app.env', ''.join(k + '=' + v + '\n' for k, v in appenv.items()))
        # Never regenerate passwords or encryption keys on an interrupted re-run.
        password = self.config_dir / 'backup.password'
        if not password.exists(): atomic(password, secrets.token_hex(32) + '\n')
        admin = self.config_dir / 'admin.json'
        if not admin.exists(): write_json(admin, {'username': 'odm_admin', 'password': secrets.token_urlsafe(24)})
        write_json(self.config_dir / 'install.json', c); self.config = c
        self.require()
        if not (self.root / 'backups' / 'config').exists(): self.restic('init')
        return True

    def restic(self, *args, remote=False, **kw):
        env = self.env.copy()
        repository = str(self.root / 'backups')
        if remote:
            r = read_json(self.config_dir / 'remote.json')
            if not r: raise OpsError('Off-site repository is not configured')
            repository = r['repository']; env.update(r.get('environment', {}))
            env['RESTIC_PASSWORD_FILE'] = str(self.config_dir / 'remote.password')
        return self.run(['restic', '-r', repository, *args], env=env, **kw)

    def build(self, ref=None, fetch=True):
        self.disk_ok(6 * 1024**3)
        if fetch: self.run(['git', '-C', self.repo, 'fetch', '--prune', 'origin'], timeout=300)
        ref = ref or ('refs/remotes/origin/' + self.config['branch'])
        if not REF_RE.fullmatch(ref) or '..' in ref: raise OpsError('Invalid ref')
        sha = self.run(['git', '-C', self.repo, 'rev-parse', '--verify', ref + '^{commit}']).strip()
        if not SHA_RE.fullmatch(sha): raise OpsError('Invalid commit response')
        directory = self.root / 'releases' / sha
        source = directory / 'source'
        directory.mkdir(parents=True, exist_ok=True)
        if not source.exists(): self.run(['git', '-C', self.repo, 'worktree', 'add', '--detach', str(source), sha])
        image = 'odm-managed:' + self.env['COMPOSE_PROJECT_NAME'] + '-' + sha
        print('Building isolated release ' + sha[:12], flush=True)
        self.docker('build', '--pull', '-f', str(source / 'deploy' / 'Dockerfile'), '--label', 'odm.managed=1', '--label', 'odm.root=' + self.env['COMPOSE_PROJECT_NAME'],
            '--label', 'odm.release=' + sha, '-t', image, str(source), capture=False, timeout=3600)
        # Server-side provider inference was removed; the image build and
        # Next/TypeScript production build are the release gate now.
        image_id = self.docker('image', 'inspect', '--format', '{{.Id}}', image).strip()
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id): raise OpsError('Invalid built image digest')
        release = {'sha': sha, 'image': image_id, 'compose': str(directory / ('compose-' + image_id[7:19] + '.json'))}
        write_json(Path(release['compose']), self.manifest(release))
        mcp = self.mcp_controller(release)
        if mcp: release['mcpImage'] = mcp.build()
        write_json(directory / 'release.json', release)
        self.docker('compose', '-f', release['compose'], 'config', '--quiet')
        return release

    def manifest(self, release):
        c = self.config
        def mount(host, container): return {'type': 'bind', 'source': str(self.root / host), 'target': container}
        app = {'image': release['image'], 'restart': 'unless-stopped', 'init': True,
            'env_file': [str(self.config_dir / 'app.env')],
            'ports': [f"{c['listen']}:{c['port']}:3005"],
            'extra_hosts': ['host.docker.internal:host-gateway'],
            'security_opt': ['no-new-privileges:true'], 'cap_drop': ['ALL'],
            'mem_limit': '512m',
            'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}},
            'stop_grace_period': '60s',
            'volumes': [mount('state/' + d, target) for d, target in zip(STATE_DIRS,
                ('/app/data', '/app/public/uploads', '/app/public/generated', '/app/public/generated-audio', '/app/provider-auth'))]
                + [mount('cache/embeddings', '/app/models/embeddings')],
            'healthcheck': {'test': ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3005/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                            'interval': '30s', 'timeout': '8s', 'start_period': '90s', 'retries': 3}}
        services = {'app': app}
        if c['runtime'] == 'ollama':
            ollama = {'image': 'ollama/ollama:rocm' if c['accelerator'] == 'amd' else 'ollama/ollama:latest',
                'restart': 'unless-stopped', 'volumes': [mount('cache/ollama', '/root/.ollama')],
                'logging': app['logging']}
            if c['accelerator'] == 'amd': ollama['devices'] = ['/dev/kfd:/dev/kfd', '/dev/dri:/dev/dri']
            if c['accelerator'] == 'nvidia': ollama['gpus'] = 'all'
            services['ollama'] = ollama
        if c['domain']:
            services['proxy'] = {'image': 'caddy:2', 'restart': 'unless-stopped', 'ports': ['80:80', '443:443'],
                'volumes': [dict(mount('config/caddy', '/etc/caddy'), read_only=True), mount('proxy', '/data')],
                'logging': app['logging']}
        return {'services': services}

    def mcp_controller(self, release=None):
        release = release or self.active()
        if not release: return None
        source = self.root / 'releases' / release['sha'] / 'source' / 'mcp' / 'Dockerfile'
        if not source.is_file():
            if (self.config_dir / 'mcp.env').exists():
                raise OpsError('Selected release has no MCP sidecar; coordinated rollback cannot use it')
            return None
        from mcpctl import McpController
        return McpController(str(self.root), release=release)

    def prepare_mcp_env(self, release):
        mcp = self.mcp_controller(release)
        if mcp:
            token, _ = mcp.ensure_token(); mcp.ensure_env(token)
        return mcp

    def pause_mcp(self, release=None):
        mcp = self.mcp_controller(release)
        if mcp: mcp.stop()

    def configure_proxy(self, release=None):
        if not self.config['domain']: return
        release = release or self.active()
        directory = self.config_dir / 'caddy'
        directory.mkdir(parents=True, exist_ok=True)
        content = render_caddy(self.config['domain'], (self.config_dir / 'mcp.env').exists())
        fd, temporary = tempfile.mkstemp(prefix='.Caddyfile-', dir=directory)
        os.close(fd)
        candidate = Path(temporary)
        try:
            atomic(candidate, content)
            # Validate a candidate before changing the live file. Mount only the
            # dedicated Caddy directory, never app.env or any other secret.
            self.docker('run', '--rm', '--network', 'none',
                '--mount', f'type=bind,src={directory},dst=/etc/caddy,readonly',
                'caddy:2', 'caddy', 'validate', '--config', '/etc/caddy/' + candidate.name,
                '--adapter', 'caddyfile', timeout=60)
            atomic(directory / 'Caddyfile', content)
            # Refresh legacy single-file mounts too. Directory binds see future
            # atomic replacements, and recreate makes the exact config effective.
            write_json(Path(release['compose']), self.manifest(release))
            self.compose('up', '-d', '--no-deps', '--force-recreate', 'proxy', release=release, timeout=120)
        finally: candidate.unlink(missing_ok=True)

    def release_gate(self, release):
        mcp = self.mcp_controller(release)
        if mcp:
            mcp.sync(keep_previous=True, configure_proxy=False)
        self.wait_ready()
        return mcp

    def release_cleanup(self):
        # Failure to prune old files must not roll back a healthy game release.
        try:
            mcp = self.mcp_controller()
            if mcp: mcp.finalize()
            self.retention(apply=True)
        except Exception as exc:
            self.alert('retention-pending', 'Release is healthy; managed cleanup needs attention: ' + type(exc).__name__)

    def retention(self, apply=False, prune=False):
        from retention import apply_retention
        return apply_retention(self, apply=apply, prune=prune)

    def restore_previous_metadata(self, transaction):
        if 'previousBefore' not in transaction: return
        previous = transaction['previousBefore']
        if previous is None: (self.config_dir / 'previous.json').unlink(missing_ok=True)
        else: write_json(self.config_dir / 'previous.json', previous)

    def wait_ready(self, seconds=120):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.probe(): return
            time.sleep(2)
        raise OpsError('Application readiness failed; database or web server is unavailable')

    def probe(self):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{self.config['port']}/api/ready", timeout=6) as r:
                return r.status == 200 and json.loads(r.read(4096)).get('ok') is True
        except (OSError, ValueError, urllib.error.URLError): return False

    def start(self):
        (self.config_dir / 'stopped').unlink(missing_ok=True)
        self.recover_pending()
        release = self.active()
        write_json(Path(release['compose']), self.manifest(release))
        self.prepare_mcp_env(release)
        self.compose('up', '-d', 'app', *(['ollama'] if self.config['runtime'] == 'ollama' else []))
        self.release_gate(release)
        self.sync_tools()
        self.configure_proxy(release)

    def recover_pending(self):
        journal = self.config_dir / 'transaction.json'
        transaction = read_json(journal)
        if not transaction: return
        if transaction.get('committed') is True:
            journal.unlink(); return
        old = transaction['old']
        self.pause_mcp(transaction['target'])
        self.compose('stop', 'app', *(['proxy'] if self.config['domain'] else []), release=transaction['target'])
        target, source = self.stage_restore(transaction['snapshot'])
        try:
            self.check_restored(source, old); self.replace_state(source)
            write_json(Path(old['compose']), self.manifest(old))
            self.prepare_mcp_env(old)
            self.compose('up', '-d', '--no-deps', 'app', release=old)
            self.release_gate(old)
            write_json(self.config_dir / 'active.json', old)
            self.restore_previous_metadata(transaction)
            self.sync_tools()
            self.configure_proxy(old)
            journal.unlink()
            self.alert('interrupted-update-recovered', 'Recovered the previous web/MCP release and database after an interrupted transition')
        finally: shutil.rmtree(target, ignore_errors=True)

    def stop(self):
        atomic(self.config_dir / 'stopped', timestamp())
        self.pause_mcp()
        self.compose('stop', 'app', *(['proxy'] if self.config['domain'] else []))

    def install(self, options):
        self.init(options)
        complete = self.config_dir / 'installed.json'
        if self.active() and complete.exists():
            self.start(); self.install_timers()
            print('Existing installation preserved. Use odmctl update for a new release.'); return
        if not self.active():
            release = self.build(options.ref, fetch=not options.offline_source)
            # Initialize accounts without publishing a port or running a second web writer.
            admin = self.config_dir / 'admin.json'
            if not admin.exists(): write_json(admin, {'username': 'odm_admin', 'password': secrets.token_urlsafe(24)})
            self.compose('run', '--rm', '--no-deps', '-T', 'app', 'node', 'deploy/db-tool.mjs', 'bootstrap',
                         release=release, input=admin.read_text(encoding='utf-8'), timeout=120)
            write_json(self.config_dir / 'active.json', release)
        self.prepare_mcp_env(self.active())
        self.compose('up', '-d', 'app'); self.release_gate(self.active())
        # Persistence, backup and boot recovery are installed even if an optional
        # model/asset provider is unreachable. A re-run resumes provisioning.
        self.backup()
        self.install_timers()
        pending = []
        if self.config['assets'] and not read_json(self.config_dir / 'assets.json', {}).get('ok'):
            try: self.assets()
            except OpsError:
                pending.append('assets')
                self.alert('assets-unavailable', 'Rules/embedding download failed; run odmctl assets to retry')
        if self.config['runtime'] != 'none':
            try: self.model()
            except OpsError:
                pending.append('model')
                self.alert('model-unavailable', 'Model installation or real tool-call probe failed; default DM was not changed')
        self.configure_proxy()
        self.backup()
        self.sync_tools()
        print('Admin credentials: ' + str(self.config_dir / 'admin.json'))
        print('Save config/backup.password OFF this machine. Local-only backup is not disaster recovery.')
        self.status()
        if pending:
            raise OpsError('Server and backups installed, but provisioning is pending: ' + ', '.join(pending) + '. Rerun the installer to resume.')
        write_json(complete, {'at': timestamp()})
        print('Installation completed. Select/authorize a cloud provider in the admin wizard when using runtime=none.')

    def sync_tools(self):
        source = self.root / 'releases' / self.active()['sha'] / 'source' / 'deploy'
        core = source / 'odmctl.py'
        if not core.is_file(): return
        version = re.search(r'^OPS_API_VERSION = (\d+)$', core.read_text(encoding='utf-8'), re.M)
        # Rolling the game back must not re-introduce the unsafe old scheduler.
        if version and int(version.group(1)) >= 2:
            install_ops_tools(self.root, source)

    def assets(self):
        for cmd in (['node', 'scripts/fetch-content-pack.mjs'], ['npm', 'run', 'fetch-model']):
            self.compose('exec', '-T', 'app', *cmd, timeout=1800)
        self.compose('restart', 'app'); self.wait_ready()
        write_json(self.config_dir / 'assets.json', {'ok': True, 'at': timestamp()})

    def model(self):
        c = self.config
        if c['runtime'] == 'none': raise OpsError('Choose a provider in Admin > Connections LLM')
        if c['runtime'] == 'ollama':
            if c['accelerator'] == 'amd' and not Path('/dev/kfd').exists(): raise OpsError('AMD runtime needs /dev/kfd on the Linux host; no driver changes were made')
            self.compose('up', '-d', 'ollama')
            # Probe startup separately: never repeat a multi-hour model download.
            for attempt in range(20):
                try:
                    self.compose('exec', '-T', 'ollama', 'ollama', 'list', timeout=15); break
                except OpsError:
                    if attempt == 19: raise
                    time.sleep(3)
            self.compose('exec', '-T', 'ollama', 'ollama', 'pull', c['model'], timeout=7200, capture=False)
            url = 'http://ollama:11434/v1'
        else: url = c['llm_url']
        self.compose('exec', '-T', 'app', 'node', 'scripts/odm-auth.mjs', 'connect', 'qwen-local',
                     '--base-url', url, '--model', c['model'], '--apply', timeout=900)
        print('Model completed the actual tool-call probe and is selected as default DM.')

    def backup(self, resume=True, tag='scheduled'):
        self.disk_ok()
        active = self.active()
        if not active: raise OpsError('No release to back up')
        was_stopped = (self.config_dir / 'stopped').exists()
        self.pause_mcp()
        self.compose('stop', 'app')
        succeeded = False
        try:
            # Every writer, including the Codex child, is now stopped. WAL and media
            # are captured together; rsyncing a live encrypted DB is not a backup.
            write_json(self.config_dir / 'recovery.json', {'schema': SCHEMA, 'release': active, 'at': timestamp()})
            out = self.restic('backup', 'state', 'config/app.env', 'config/install.json',
                               'config/recovery.json', 'config/admin.json', '--exclude=state/provider-auth/codex/tmp',
                               '--tag', 'odm', '--tag', tag, '--json', timeout=3600)
            summaries = [json.loads(line) for line in out.splitlines() if line.strip()]
            snapshot = next((s['snapshot_id'] for s in reversed(summaries) if s.get('snapshot_id')), None)
            if not snapshot: raise OpsError('Backup did not produce a confirmed snapshot')
            write_json(self.config_dir / 'last-backup.json', {'id': snapshot, 'at': timestamp(), 'unix': time.time()})
            succeeded = True
        finally:
            if (resume or not succeeded) and not was_stopped:
                self.compose('up', '-d', 'app'); self.wait_ready()
                mcp = self.mcp_controller()
                if mcp: mcp.sync(configure_proxy=False)
        if resume and (self.config_dir / 'remote.json').exists(): self.sync_remote()
        print('Encrypted backup: ' + snapshot)
        return snapshot

    def stage_restore(self, snapshot, remote=False):
        if not re.fullmatch(r'[a-f0-9]{8,64}|latest', snapshot): raise OpsError('Use a snapshot ID or latest')
        target = Path(tempfile.mkdtemp(prefix='.restore-', dir=self.root))
        try:
            self.restic('restore', snapshot, '--target', str(target), remote=remote, timeout=3600)
            # Restic retains the snapshot's absolute source path. Locate exactly
            # one recovery manifest, then validate all expected children.
            manifests = list(target.rglob('config/recovery.json'))
            if len(manifests) != 1: raise OpsError('Ambiguous or missing recovery manifest')
            source = manifests[0].parent.parent
            for item in source.rglob('*'):
                if item.is_symlink(): raise OpsError('Recovery snapshot contains a symlink; refuse privileged restore')
            for item in ('state/data/local-roleplay.sqlite', 'config/app.env', 'config/install.json'):
                if not (source / item).is_file(): raise OpsError('Incomplete snapshot: ' + item)
            for directory in STATE_DIRS:
                if not (source / 'state' / directory).is_dir(): raise OpsError('Incomplete state directory: ' + directory)
            return target, source
        except BaseException:
            shutil.rmtree(target, ignore_errors=True); raise

    def check_restored(self, source, release):
        self.docker('run', '--rm', '--network', 'none', '--user', '0:0', '--env-file', str(source / 'config/app.env'),
            '--mount', f'type=bind,src={source / "state/data"},dst=/app/data,readonly', '--entrypoint', 'node',
            release['image'], 'deploy/db-tool.mjs', 'check', timeout=120)

    def state_credentials(self):
        """Read the credentials paired with the current game database, including absence."""
        return {name: (self.config_dir / name).read_text(encoding='utf-8')
                if (self.config_dir / name).exists() else None
                for name in ('app.env', 'admin.json')}

    def restore_credentials(self, values):
        for name, value in values.items():
            path = self.config_dir / name
            if value is None:
                path.unlink(missing_ok=True)
            else:
                atomic(path, value)

    def replace_state(self, source):
        # Prepare the entire tree and its ownership before moving the live state.
        # A disk/copy/chown error must not remove the only usable database.
        live = self.root / 'state'
        previous_credentials = self.state_credentials()
        candidate = Path(tempfile.mkdtemp(prefix='.state-candidate-', dir=self.root))
        prepared = candidate / 'state'
        old = None
        installed = False
        credentials_started = False
        try:
            shutil.copytree(source / 'state', prepared)
            if os.name != 'nt':
                for p in [prepared, *prepared.rglob('*')]:
                    os.chown(p, 1000, 1000)
            if live.exists():
                displaced = self.root / ('state-before-restore-' + str(time.time_ns()))
                os.replace(live, displaced)
                old = displaced
            # Missing live state is valid during journal recovery: a terminated
            # process may have completed the first rename, but not the second.
            os.replace(prepared, live)
            installed = True
            credentials_started = True
            atomic(self.config_dir / 'app.env', (source / 'config/app.env').read_text(encoding='utf-8'))
            if (source / 'config/admin.json').exists():
                atomic(self.config_dir / 'admin.json', (source / 'config/admin.json').read_text(encoding='utf-8'))
        except BaseException:
            if installed:
                shutil.rmtree(live)
            if old is not None:
                os.replace(old, live)
            if credentials_started:
                self.restore_credentials(previous_credentials)
            raise
        finally:
            shutil.rmtree(candidate, ignore_errors=True)
        return old  # Preserve the displaced state for operator review, if present.

    def upgrade(self, release):
        old = self.active()
        if not old: raise OpsError('Install before updating')
        if all(release.get(key) == old.get(key) for key in ('sha', 'image', 'mcpImage')):
            print('Already at selected release.'); return
        snapshot = None
        transaction = {'old': old, 'target': release, 'previousBefore': read_json(self.config_dir / 'previous.json')}
        try:
            # MCP bytes and dependency registration are prepared before downtime.
            self.prepare_mcp_env(release)
            snapshot = self.backup(resume=False, tag='pre-update')
            transaction['snapshot'] = snapshot
            write_json(self.config_dir / 'transaction.json', transaction)
            if self.config['domain']: self.compose('stop', 'proxy', release=old)
            self.compose('up', '-d', '--no-deps', 'app', release=release); self.wait_ready()
            self.release_gate(release)
            write_json(self.config_dir / 'active.json', release)
            write_json(self.config_dir / 'previous.json', {'release': old, 'snapshot': snapshot})
            self.sync_tools(); self.install_timers()
            self.configure_proxy(release)
            write_json(self.config_dir / 'transaction.json', {**transaction, 'committed': True})
            (self.config_dir / 'transaction.json').unlink(missing_ok=True)
            print('Updated web and MCP to ' + release['sha'])
        except BaseException:
            if snapshot:
                self.pause_mcp(release)
                self.compose('stop', 'app', *(['proxy'] if self.config['domain'] else []), release=release)
                target, source = self.stage_restore(snapshot)
                try:
                    self.check_restored(source, old); self.replace_state(source)
                finally: shutil.rmtree(target, ignore_errors=True)
            write_json(Path(old['compose']), self.manifest(old))
            self.prepare_mcp_env(old)
            self.compose('up', '-d', '--no-deps', 'app', release=old); self.wait_ready()
            self.release_gate(old)
            write_json(self.config_dir / 'active.json', old)
            self.restore_previous_metadata(transaction)
            self.sync_tools()
            self.configure_proxy(old)
            # Keep the journal if either rollback health gate fails above.
            (self.config_dir / 'transaction.json').unlink(missing_ok=True)
            self.alert('update-rolled-back', 'Update failed; previous web/MCP images and database restored')
            raise
        self.release_cleanup()
        if (self.config_dir / 'remote.json').exists(): self.sync_remote()

    def update(self, ref=None):
        if (self.config_dir / 'stopped').exists(): raise OpsError('Installation intentionally stopped; no update performed')
        self.recover_pending()
        self.upgrade(self.build(ref))

    def restore(self, snapshot, yes=False, remote=False, check_only=False):
        if not check_only and not yes: raise OpsError('Restore replaces current game state; repeat with --yes after reviewing the snapshot')
        target, source = self.stage_restore(snapshot, remote=remote)
        try:
            recovery = read_json(source / 'config/recovery.json')
            sha = recovery['release']['sha']
            if not SHA_RE.fullmatch(sha): raise OpsError('Invalid recovery commit')
            image = recovery['release'].get('image', '')
            if not re.fullmatch(r'sha256:[a-f0-9]{64}', image): raise OpsError('Invalid recovery image digest')
            try: self.docker('image', 'inspect', image, timeout=30)
            except OpsError: image = self.build(sha)['image']
            release = {'sha': sha, 'image': image, 'compose': str(self.root / 'releases' / sha / ('compose-' + image[7:19] + '.json'))}
            # Check-only never rewrites even an existing active compose file.
            self.check_restored(source, release)
            if check_only:
                write_json(self.config_dir / 'last-restore-check.json', {'at': timestamp(), 'snapshot': snapshot})
                print('Restored snapshot passed SQLite integrity check; live state and ingress untouched.'); return
            write_json(Path(release['compose']), self.manifest(release))
            mcp = self.mcp_controller(release)
            if mcp:
                recorded = recovery['release'].get('mcpImage')
                if recorded is not None and not re.fullmatch(r'sha256:[a-f0-9]{64}', str(recorded)):
                    raise OpsError('Invalid recovery MCP image digest')
                if recorded:
                    try: self.docker('image', 'inspect', recorded, timeout=30); mcp.image = recorded
                    except OpsError: pass  # A rebuild records its new digest explicitly below.
                release['mcpImage'] = mcp.build()
            write_json(self.root / 'releases' / sha / 'release.json', release)
            current = self.active(); current_credentials = self.state_credentials()
            undo_snapshot = self.backup(resume=False, tag='pre-restore')
            transaction = {'old': current, 'target': release, 'snapshot': undo_snapshot,
                           'previousBefore': read_json(self.config_dir / 'previous.json')}
            write_json(self.config_dir / 'transaction.json', transaction)
            old_state = None
            try:
                if self.config['domain']: self.compose('stop', 'proxy', release=current)
                old_state = self.replace_state(source)
                self.prepare_mcp_env(release)
                self.compose('up', '-d', '--no-deps', 'app', release=release); self.wait_ready()
                self.release_gate(release)
                write_json(self.config_dir / 'active.json', release)
                write_json(self.config_dir / 'previous.json', {'release': current, 'snapshot': undo_snapshot})
                self.sync_tools()
                self.configure_proxy(release)
                write_json(self.config_dir / 'transaction.json', {**transaction, 'committed': True})
                (self.config_dir / 'transaction.json').unlink(missing_ok=True)
            except BaseException:
                self.pause_mcp(release)
                self.compose('stop', 'app', *(['proxy'] if self.config['domain'] else []), release=release)
                if old_state:
                    shutil.rmtree(self.root / 'state'); os.replace(old_state, self.root / 'state')
                self.restore_credentials(current_credentials)
                self.prepare_mcp_env(current)
                self.compose('up', '-d', '--no-deps', 'app', release=current); self.wait_ready()
                self.release_gate(current)
                write_json(self.config_dir / 'active.json', current)
                self.restore_previous_metadata(transaction)
                self.sync_tools()
                self.configure_proxy(current)
                (self.config_dir / 'transaction.json').unlink(missing_ok=True)
                raise
            print('Restored; displaced state retained at ' + str(old_state))
            self.release_cleanup()
        finally: shutil.rmtree(target, ignore_errors=True)

    def status(self):
        last = read_json(self.config_dir / 'last-backup.json', {})
        free = shutil.disk_usage(self.root).free
        result = {'at': timestamp(), 'ready': self.probe(), 'active': (self.active() or {}).get('sha'),
            'intentionally_stopped': (self.config_dir / 'stopped').exists(), 'free_bytes': free,
            'backup_age_hours': round((time.time() - last['unix']) / 3600, 1) if last.get('unix') else None,
            'offsite_configured': (self.config_dir / 'remote.json').exists(),
            'last_offsite': read_json(self.config_dir / 'last-offsite.json'),
            'last_restore_check': read_json(self.config_dir / 'last-restore-check.json'),
            'assets': read_json(self.config_dir / 'assets.json', {'ok': False})}
        write_json(self.root / 'logs/health.json', result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return result

    def alert(self, kind, message):
        event = {'at': timestamp(), 'kind': kind, 'message': message}
        write_json(self.root / 'logs/last-alert.json', event)
        url_file = self.config_dir / 'webhook.url'
        if url_file.exists():
            url = url_file.read_text(encoding='utf-8').strip()
            if not url.startswith('https://'): raise OpsError('Alert webhook must use HTTPS')
            try:
                request = urllib.request.Request(url, data=json.dumps(event).encode(), headers={'Content-Type': 'application/json'}, method='POST')
                with urllib.request.urlopen(request, timeout=10) as r: r.read(1024)
            except OSError: print('WARNING: alert delivery failed; event is saved locally', file=sys.stderr)

    def watchdog(self):
        if (self.config_dir / 'stopped').exists(): return
        self.recover_pending()
        ready = self.probe(); now = time.time()
        record = read_json(self.config_dir / 'watchdog.json', {'failures': 0, 'restarts': []})
        record['restarts'] = [t for t in record['restarts'] if now - t < 3600]
        record['failures'] = 0 if ready else record['failures'] + 1
        if not ready and record['failures'] >= 3:
            if len(record['restarts']) < 3 and (not record['restarts'] or now - record['restarts'][-1] > 600):
                self.compose('restart', 'app'); record['restarts'].append(now); record['failures'] = 0
                self.alert('app-restarted', 'Application failed three readiness checks and was restarted')
            else: self.alert('app-unavailable', 'Restart budget exhausted; operator investigation required')
        write_json(self.config_dir / 'watchdog.json', record)
        last = read_json(self.config_dir / 'last-backup.json', {})
        if not last.get('unix') or now - last['unix'] > 26 * 3600: self.alert('backup-stale', 'No successful backup in the last 26 hours')
        offsite = read_json(self.config_dir / 'last-offsite.json', {})
        if (self.config_dir / 'remote.json').exists() and (not offsite.get('unix') or now - offsite['unix'] > 26 * 3600):
            self.alert('offsite-stale', 'No successful off-site copy in the last 26 hours')
        if shutil.disk_usage(self.root).free < 2 * 1024**3: self.alert('disk-low', 'Less than 2 GiB of disk space remains')
        if ready:
            mcp = self.mcp_controller()
            if mcp:
                info = mcp.inspect_container(mcp.container) or {}
                labels = info.get('Config', {}).get('Labels', {})
                if labels.get('odm.mcp.sha') != self.active()['sha'] or info.get('State', {}).get('Health', {}).get('Status') != 'healthy':
                    try: mcp.sync(configure_proxy=False)
                    except Exception: self.alert('mcp-unavailable', 'MCP health/version check failed; operator investigation required')
        self.status()

    def sync_remote(self):
        # Ubuntu 22.04 ships restic 0.12: copy used -r SOURCE --repo2 DEST.
        # New versions use -r DEST --from-repo SOURCE. Detect the supported
        # interface instead of reversing copy direction or replacing system packages.
        help_text = self.run(['restic', 'copy', '--help'], timeout=30)
        if '--from-repo' in help_text:
            self.restic('copy', '--from-repo', str(self.root / 'backups'), '--from-password-file',
                        str(self.config_dir / 'backup.password'), remote=True, timeout=7200)
        else:
            remote = read_json(self.config_dir / 'remote.json')
            if not remote: raise OpsError('Off-site repository is not configured')
            env = self.env.copy(); env.update(remote.get('environment', {}))
            self.run(['restic', '-r', str(self.root / 'backups'), 'copy',
                      '--repo2', remote['repository'], '--password-file2',
                      str(self.config_dir / 'remote.password')], env=env, timeout=7200)
        write_json(self.config_dir / 'last-offsite.json', {'at': timestamp(), 'unix': time.time()})
        print('Off-site snapshots copied.')

    def remote_config(self, repository, password_file, credentials_file=None):
        if not repository or '\n' in repository: raise OpsError('Invalid repository address')
        if not password_file: raise OpsError('Provide --password-file (never the password in command arguments)')
        password = Path(password_file).read_text(encoding='utf-8').strip()
        if len(password) < 16: raise OpsError('Use a backup password of at least 16 characters')
        credentials = read_json(credentials_file, {}) if credentials_file else {}
        allowed = {'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_DEFAULT_REGION', 'B2_ACCOUNT_ID', 'B2_ACCOUNT_KEY', 'AZURE_ACCOUNT_NAME', 'AZURE_ACCOUNT_KEY'}
        if not isinstance(credentials, dict) or any(k not in allowed or not isinstance(v, str) for k, v in credentials.items()):
            raise OpsError('Unsupported remote credentials; use a JSON object of supported cloud credential variables')
        write_json(self.config_dir / 'remote.json', {'repository': repository, 'environment': credentials})
        atomic(self.config_dir / 'remote.password', password + '\n')
        # Existing repositories are never recreated on an authentication error.
        print('Remote configured. For a NEW empty repository run odmctl remote-init; otherwise run odmctl offsite.')

    def recovery_kit(self):
        output = self.config_dir / ('recovery-kit-' + str(time.time_ns()) + '.zip')
        fd, temporary = tempfile.mkstemp(prefix='.recovery-kit-', dir=self.config_dir)
        os.close(fd)
        try:
            with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for name in ('backup.password', 'app.env', 'install.json', 'remote.json', 'remote.password'):
                    file = self.config_dir / name
                    if file.exists(): archive.write(file, name)
                archive.writestr('READ-ME.txt',
                    'SECRET RECOVERY KIT. Store offline or in an encrypted password manager.\n'
                    'It is not a game backup: game data is in the restic repository.\n'
                    'Install this fork on a new machine, configure the original restic repository/password,\n'
                    'then use odmctl restore-check SNAPSHOT and odmctl restore SNAPSHOT --yes.\n'
                    'Do not publish this archive or attach it to GitHub issues.\n')
            os.chmod(temporary, 0o600); os.replace(temporary, output)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
        print('Secret recovery kit: ' + str(output))
        return output

    def check_update(self):
        self.run(['git', '-C', self.repo, 'fetch', 'origin'], timeout=300)
        sha = self.run(['git', '-C', self.repo, 'rev-parse', 'refs/remotes/origin/' + self.config['branch']]).strip()
        available = sha != self.active()['sha']
        print(json.dumps({'update_available': available, 'commit': sha}))
        if available: self.alert('update-available', 'A new deployment commit is available')

    def install_timers(self):
        if os.name == 'nt': return  # PowerShell bootstrap installs native scheduled tasks.
        if not Path('/run/systemd/system').exists():
            print('WARNING: systemd is unavailable; timers were not installed'); return
        name = self.env['COMPOSE_PROJECT_NAME']
        ctl = self.root / 'tools/odmctl.py'
        command = f'/usr/bin/python3 {ctl} --root {self.root}'
        units = Path('/etc/systemd/system')
        atomic(units / f'{name}.service', f'[Unit]\nDescription=ODM single-node game server\nAfter=docker.service network-online.target\nRequires=docker.service\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart={command} start\nExecStop={command} stop\nTimeoutStartSec=300\nTimeoutStopSec=180\n[Install]\nWantedBy=multi-user.target\n', 0o644)
        timers = {'watchdog': ('*-*-* *:*:00', 'watchdog'), 'backup': ('*-*-* 03:30:00', 'backup'),
            'check': ('Sun *-*-* 04:15:00', 'check'), 'restore-check': ('*-*-01 05:00:00', 'restore-check latest'),
            'update': ('*-*-* 05:30:00', 'update' if self.config['auto_update'] else 'check-update')}
        for task, (schedule, operation) in timers.items():
            atomic(units / f'{name}-{task}.service', f'[Unit]\nDescription=ODM {task}\nAfter=docker.service\n[Service]\nType=oneshot\nExecStart={command} {operation}\nTimeoutStartSec=10800\n', 0o644)
            atomic(units / f'{name}-{task}.timer', f'[Unit]\nDescription=ODM {task} schedule\n[Timer]\nOnCalendar={schedule}\nPersistent=true\nRandomizedDelaySec=10\n[Install]\nWantedBy=timers.target\n', 0o644)
        self.run(['systemctl', 'daemon-reload'])
        self.run(['systemctl', 'enable', f'{name}.service'])
        self.run(['systemctl', 'enable', '--now', *[f'{name}-{task}.timer' for task in timers]])
        # Do not start the oneshot here: it would contend with the install lock.


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', default=os.environ.get('ODM_HOME', '/opt/odm' if os.name != 'nt' else str(Path.home() / 'ODM')))
    p.add_argument('--lock-fd', type=int, help=argparse.SUPPRESS)
    sub = p.add_subparsers(dest='command', required=True)
    install = sub.add_parser('install')
    install.add_argument('--bootstrap-tools', action='store_true', help='Install this verified operations bundle under the common lock')
    install.add_argument('--repo', default='fireostendere/dungeon_master'); install.add_argument('--branch', default='main')
    install.add_argument('--ref'); install.add_argument('--port', type=int, default=3005)
    install.add_argument('--listen', choices=['127.0.0.1', '0.0.0.0'], default='127.0.0.1'); install.add_argument('--domain', default='')
    install.add_argument('--runtime', choices=['none', 'ollama', 'external'], default='none')
    install.add_argument('--model', default='qwen3:8b'); install.add_argument('--llm-url', default='http://host.docker.internal:11434/v1')
    install.add_argument('--accelerator', choices=['cpu', 'amd', 'nvidia'], default='cpu')
    install.add_argument('--comfy-url', default=''); install.add_argument('--auto-update', action='store_true')
    install.add_argument('--skip-assets', action='store_true'); install.add_argument('--offline-source', action='store_true', help='Use a supplied local Git checkout; CI/offline mirror only')
    for name in ('start', 'stop', 'status', 'watchdog', 'backup', 'check', 'check-update', 'assets', 'model', 'offsite', 'remote-init', 'snapshots', 'recovery-kit'):
        sub.add_parser(name)
    logs = sub.add_parser('logs'); logs.add_argument('-f', '--follow', action='store_true')
    logs.add_argument('--tail', type=int, default=200)
    retention = sub.add_parser('retention'); retention.add_argument('--apply', action='store_true')
    retention.add_argument('--prune', action='store_true')
    update = sub.add_parser('update'); update.add_argument('--ref')
    for name in ('restore', 'restore-check'):
        restore = sub.add_parser(name); restore.add_argument('snapshot'); restore.add_argument('--yes', action='store_true'); restore.add_argument('--remote', action='store_true')
    rollback = sub.add_parser('rollback'); rollback.add_argument('--yes', action='store_true')
    remote = sub.add_parser('remote-config'); remote.add_argument('repository'); remote.add_argument('--password-file', required=True); remote.add_argument('--credentials-file')
    alerts = sub.add_parser('alerts-config'); alerts.add_argument('--url-stdin', action='store_true', required=True)
    auth = sub.add_parser('auth'); auth.add_argument('args', nargs=argparse.REMAINDER)
    return p

def main():
    args = parser().parse_args(); c = Controller(args.root)
    if args.command == 'status':
        if not c.config: raise OpsError('No deployment configuration')
        return 0 if c.status()['ready'] else 1
    if args.command == 'logs':
        if not c.config: raise OpsError('No deployment configuration')
        if not 1 <= args.tail <= 10000: raise OpsError('--tail must be 1..10000')
        c.compose('logs', '--tail', str(args.tail), *(['--follow'] if args.follow else []), capture=False, timeout=None if args.follow else 60)
        return 0
    with locked(c.root, inherited_fd=args.lock_fd):
        # Re-read install metadata after acquiring the lock, not before another
        # process may have finished a release/restore.
        c = Controller(args.root)
        # A legacy controller may have copied only this core file during its
        # last update. Hydrate matching helper modules before their first use.
        if c.active(): c.sync_tools()
        if args.command == 'install':
            if args.bootstrap_tools: install_ops_tools(c.root, Path(__file__).resolve().parent)
            c.install(args); return 0
        c.require()
        if args.command == 'update': c.update(args.ref)
        elif args.command in ('restore', 'restore-check'): c.restore(args.snapshot, args.yes, args.remote, args.command == 'restore-check')
        elif args.command == 'rollback':
            prev = read_json(c.config_dir / 'previous.json')
            if not prev: raise OpsError('No previous deployment snapshot')
            c.restore(prev['snapshot'], args.yes)
        elif args.command == 'remote-config': c.remote_config(args.repository, args.password_file, args.credentials_file)
        elif args.command == 'alerts-config':
            url = sys.stdin.read(4097).strip()
            if len(url) > 4096 or not url.startswith('https://') or '\n' in url: raise OpsError('Enter one HTTPS webhook URL on stdin')
            atomic(c.config_dir / 'webhook.url', url)
            c.alert('alert-test', 'ODM alert destination configured')
        elif args.command == 'offsite': c.sync_remote()
        elif args.command == 'remote-init': c.restic('init', remote=True)
        elif args.command == 'check':
            c.restic('check', '--read-data-subset=10%', timeout=7200)
            c.retention(apply=True, prune=True)
        elif args.command == 'snapshots': print(c.restic('snapshots'))
        elif args.command == 'retention': c.retention(apply=args.apply, prune=args.prune)
        elif args.command == 'auth': c.compose('exec', 'app', 'node', 'scripts/odm-auth.mjs', *args.args, capture=False, timeout=900)
        else: getattr(c, args.command.replace('-', '_'))()
    return 0

if __name__ == '__main__':
    try: sys.exit(main())
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        print('ODM: ' + str(error), file=sys.stderr); sys.exit(1)
    except KeyboardInterrupt:
        print('ODM: operation interrupted; inspect odmctl status before retrying', file=sys.stderr); sys.exit(130)
