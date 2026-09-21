#!/usr/bin/env python3
"""Manage the unprivileged MCP sidecar under the application's operation lock.

The controller can prepare a target release without changing active.json. A
candidate is tested before the existing container is removed; the previous
container is retained until the coordinated application/MCP health gate commits.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")

class McpOpsError(RuntimeError):
    pass

def atomic(path: Path, data: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(data); handle.flush(); os.fsync(handle.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
        if os.name != 'nt':
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict): raise ValueError('Expected an object')
        return value
    except (OSError, ValueError) as exc:
        raise McpOpsError(f"Could not read {path}") from exc

def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists(): return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1); values[key] = value
    return values

def set_env(path: Path, updates: dict[str, str]) -> bool:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    pending = dict(updates); out: list[str] = []; changed = False
    for raw in lines:
        if "=" not in raw or raw.lstrip().startswith("#"):
            out.append(raw); continue
        key = raw.split("=", 1)[0]
        if key in pending:
            new = f"{key}={pending.pop(key)}"; out.append(new); changed |= new != raw
        else: out.append(raw)
    if pending:
        if out and out[-1] != "": out.append("")
        out.append("# MCP control plane")
        out.extend(f"{key}={value}" for key, value in pending.items()); changed = True
    if changed: atomic(path, "\n".join(out).rstrip() + "\n")
    return changed

def stdio_command(container: str) -> list[str]:
    return ["docker", "exec", "-i", container, "node", "--import",
            "/app/external-tools-preload.mjs", "/app/server.mjs", "--stdio"]

class McpController:
    def __init__(self, root: str, release: dict | None = None):
        self.root = Path(root).expanduser().absolute()
        if self.root == Path(self.root.anchor) or self.root.is_symlink():
            raise McpOpsError("Unsafe ODM root")
        self.config_dir = self.root / "config"
        self.active = release if release is not None else read_json(self.config_dir / "active.json")
        self.install = read_json(self.config_dir / "install.json")
        self.sha = str(self.active.get("sha", ""))
        if not SHA_RE.fullmatch(self.sha): raise McpOpsError("Active ODM release has no valid commit SHA")
        self.source = self.root / "releases" / self.sha / "source"
        if not (self.source / "mcp" / "Dockerfile").is_file():
            raise McpOpsError("Release does not contain mcp/Dockerfile")
        self.project = "odm-" + hashlib.sha256(str(self.root).encode()).hexdigest()[:10]
        self.network = self.project + "_default"
        self.container = self.project + "-mcp"
        self.candidate = self.container + "-candidate"
        self.previous = self.container + "-previous"
        self.image_tag = "odm-mcp-managed:" + self.project + "-" + self.sha
        digest = self.active.get('mcpImage')
        if digest is not None and not DIGEST_RE.fullmatch(str(digest)):
            raise McpOpsError('Invalid pinned MCP image digest')
        self.image = digest or self.image_tag
        self.app_env = self.config_dir / "app.env"
        self.mcp_env = self.config_dir / "mcp.env"
        self.token_file = self.config_dir / "mcp.token"
        self.compose_file = Path(str(self.active.get("compose", "")))
        if not self.compose_file.is_file(): raise McpOpsError("ODM compose manifest is missing")

    def run(self, args: list[str], *, capture: bool = True, timeout: int = 1800) -> str:
        try:
            result = subprocess.run(args, text=True, encoding="utf-8", errors="replace",
                stdout=subprocess.PIPE if capture else None, stderr=subprocess.PIPE if capture else None,
                timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise McpOpsError(f"{Path(args[0]).name} unavailable or timed out") from exc
        if result.returncode: raise McpOpsError(f"{Path(args[0]).name} failed with exit {result.returncode}")
        return result.stdout or ""

    def docker(self, *args: str, **kwargs) -> str: return self.run(["docker", *args], **kwargs)
    def compose(self, *args: str, **kwargs) -> str:
        return self.docker("compose", "--project-name", self.project, "-f", str(self.compose_file), *args, **kwargs)

    def ensure_token(self) -> tuple[str, bool]:
        current = parse_env(self.app_env).get("ODM_MCP_TOKEN", "").strip(); created = False
        if current: token = current
        elif self.token_file.exists(): token = self.token_file.read_text(encoding="utf-8").strip()
        else: token = secrets.token_hex(32); created = True
        if len(token) < 32 or any(c.isspace() for c in token):
            raise McpOpsError("ODM_MCP_TOKEN must contain at least 32 non-whitespace characters")
        stored = self.token_file.read_text(encoding="utf-8").strip() if self.token_file.exists() else ""
        if stored != token: atomic(self.token_file, token + "\n", 0o600)
        return token, created

    def ensure_env(self, token: str) -> bool:
        current = parse_env(self.app_env); domain = str(self.install.get("domain", "")).strip()
        public_url = current.get("ODM_PUBLIC_URL", "").strip() or (
            "https://" + domain if domain else f"http://127.0.0.1:{int(self.install.get('port', 3005))}")
        changed = set_env(self.app_env, {"ODM_MCP_TOKEN": token,
            "ODM_MCP_OWNER_USERNAME": current.get("ODM_MCP_OWNER_USERNAME", "odm_admin"), "ODM_PUBLIC_URL": public_url})
        atomic(self.mcp_env, "ODM_MCP_CONTROL_URL=http://app:3005/api/internal/mcp\n"
               f"ODM_MCP_TOKEN={token}\nODM_MCP_NARRATOR_TOKEN={current.get('ODM_MCP_NARRATOR_TOKEN', '')}\n"
               "ODM_MCP_HOST=0.0.0.0\nODM_MCP_PORT=3006\n"
               f"ODM_LATENCY_LOG={current.get('ODM_LATENCY_LOG', '')}\n", 0o600)
        return changed

    def image_exists(self) -> bool:
        try: self.docker('image', 'inspect', self.image, timeout=30); return True
        except McpOpsError: return False

    def build(self) -> str:
        if not self.image_exists():
            print("Building MCP sidecar for " + self.sha[:12], flush=True)
            self.docker("build", "--pull", "-f", str(self.source / "mcp" / "Dockerfile"),
                "--label", "odm.managed=1", "--label", "odm.root=" + self.project,
                "--label", "odm.release=" + self.sha, "-t", self.image_tag, str(self.source),
                capture=False, timeout=1800)
            # A missing pinned image cannot silently be replaced by new bytes.
            # The caller must explicitly rebuild a release to record a new digest.
            if self.active.get('mcpImage') and not self.image_exists():
                raise McpOpsError('The recorded MCP image is unavailable; refusing an unverified replacement')
        digest = self.docker('image', 'inspect', '--format', '{{.Id}}', self.image, timeout=30).strip()
        if not DIGEST_RE.fullmatch(digest): raise McpOpsError('Invalid MCP image digest')
        self.image = digest
        # Registration is checked without dialing the game database.
        self.docker('run', '--rm', '--network', 'none', '--entrypoint', 'node', digest,
            '--import', './external-tools-preload.mjs', '--input-type=module', '-e',
            "const m=await import('./server.mjs'); m.createVerifiedMcpServer();", timeout=60)
        return digest

    def inspect_container(self, name: str) -> dict | None:
        try:
            values = json.loads(self.docker('inspect', name, timeout=30))
            return values[0] if isinstance(values, list) and values else None
        except McpOpsError: return None
        except (ValueError, IndexError, TypeError) as exc: raise McpOpsError('Invalid container inspection response') from exc

    def container_label(self, name: str, container: str | None = None) -> str:
        info = self.inspect_container(container or self.container)
        return str((info or {}).get('Config', {}).get('Labels', {}).get(name, ''))
    def container_sha(self) -> str: return self.container_label("odm.mcp.sha")

    def remove_owned(self, name: str) -> None:
        info = self.inspect_container(name)
        if not info: return
        labels = info.get('Config', {}).get('Labels', {})
        # Legacy fixed-name containers predate the root label; that exact name
        # plus the managed marker is the narrowly-scoped migration case.
        root_ok = labels.get('odm.root') == self.project or (name == self.container and not labels.get('odm.root'))
        if labels.get('odm.mcp.managed') != '1' or not root_ok:
            raise McpOpsError('Refusing to remove a container not owned by this installation')
        self.docker('rm', '-f', name, timeout=60)

    def ensure_network(self) -> None:
        try: self.docker('network', 'inspect', self.network, timeout=30)
        except McpOpsError as exc: raise McpOpsError("ODM Docker network is not running; start the application first") from exc

    def env_fingerprint(self) -> str:
        return hashlib.sha256(self.mcp_env.read_bytes()).hexdigest()[:16]

    def launch(self, name: str, token: str, *, published: bool) -> None:
        extra = ['--network-alias', 'mcp', '--publish', '127.0.0.1:3006:3006'] if published else []
        self.docker('run', '-d', '--name', name, '--restart', 'unless-stopped' if published else 'no',
            '--network', self.network, *extra, '--env-file', str(self.mcp_env),
            '--memory', '256m',
            '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL', '--read-only',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--log-driver', 'json-file',
            '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3',
            '--label', 'odm.mcp.managed=1', '--label', 'odm.root=' + self.project,
            '--label', 'odm.mcp.sha=' + self.sha, '--label', 'odm.mcp.env=' + self.env_fingerprint(),
            '--label', 'odm.mcp.token=' + hashlib.sha256(token.encode()).hexdigest()[:16], self.image, timeout=120)

    def wait_ready(self, container: str | None = None, seconds: int = 90) -> None:
        name = container or self.container; deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                self.docker('exec', name, 'node', '-e',
                    "fetch('http://127.0.0.1:3006/healthz',{signal:AbortSignal.timeout(5000)})"
                    ".then(async r=>process.exit(r.ok&&(await r.json()).ok===true?0:1)).catch(()=>process.exit(1))", timeout=8)
                return
            except McpOpsError: time.sleep(2)
        raise McpOpsError("MCP sidecar did not become healthy")

    def restore_previous(self, token: str) -> bool:
        info = self.inspect_container(self.previous)
        labels = (info or {}).get('Config', {}).get('Labels', {})
        expected = hashlib.sha256(token.encode()).hexdigest()[:16]
        if (not info or labels.get('odm.mcp.sha') != self.sha or labels.get('odm.mcp.token') != expected
                or labels.get('odm.mcp.env') != self.env_fingerprint()):
            return False
        if self.active.get('mcpImage') and info.get('Image') != self.active['mcpImage']: return False
        if labels.get('odm.root') not in (None, self.project) or labels.get('odm.mcp.managed') != '1':
            raise McpOpsError('Previous MCP container is not owned by this installation')
        self.remove_owned(self.container)
        self.docker('rename', self.previous, self.container, timeout=60)
        self.docker('start', self.container, timeout=60); self.wait_ready()
        return True

    def run_container(self, token: str) -> None:
        info = self.inspect_container(self.container)
        labels = (info or {}).get('Config', {}).get('Labels', {})
        fingerprint = hashlib.sha256(token.encode()).hexdigest()[:16]
        if (info and labels.get('odm.mcp.sha') == self.sha and labels.get('odm.mcp.token') == fingerprint
                and labels.get('odm.mcp.env') == self.env_fingerprint() and info.get('Image') == self.image):
            self.docker('start', self.container, timeout=60); self.wait_ready(); return
        if self.restore_previous(token): return
        self.remove_owned(self.candidate)
        # No public port or mcp DNS alias until the candidate has passed health.
        try:
            self.launch(self.candidate, token, published=False)
            self.wait_ready(self.candidate)
        finally:
            self.remove_owned(self.candidate)
        previous_saved = False
        try:
            if info:
                if labels.get('odm.mcp.managed') != '1' or labels.get('odm.root') not in (None, self.project):
                    raise McpOpsError('Existing MCP container is not owned by this installation')
                self.finalize()
                self.docker('stop', '--time', '30', self.container, timeout=45)
                self.docker('rename', self.container, self.previous, timeout=60)
                previous_saved = True
            self.launch(self.container, token, published=True)
            self.wait_ready()
        except BaseException:
            saved = self.inspect_container(self.previous)
            # Docker may have completed rename even if its client timed out.
            moved = previous_saved or bool(info and saved and info.get('Id') == saved.get('Id'))
            if moved:
                self.remove_owned(self.container)
                self.docker('rename', self.previous, self.container, timeout=60)
                self.docker('start', self.container, timeout=60)
            elif info:
                # Stop/rename failed before a replacement existed: never remove
                # the only original container in an exception cleanup path.
                self.docker('start', self.container, timeout=60)
            else:
                self.remove_owned(self.container)
            raise

    def finalize(self) -> None:
        # Only called after the application and MCP have both passed their gate.
        # A renamed legacy container has no root label, but its fixed predecessor
        # name and managed marker are still required before removing it.
        info = self.inspect_container(self.previous)
        if not info: return
        labels = info.get('Config', {}).get('Labels', {})
        if labels.get('odm.mcp.managed') != '1' or labels.get('odm.root') not in (None, self.project):
            raise McpOpsError('Previous MCP container is not owned by this installation')
        self.docker('rm', '-f', self.previous, timeout=60)

    def caddy(self) -> None:
        # The application controller is the ONLY Caddy configuration owner.
        from odmctl import Controller
        Controller(str(self.root)).configure_proxy(self.active)

    def sync(self, *, keep_previous: bool = False, configure_proxy: bool = True) -> None:
        if (self.config_dir / 'stopped').exists():
            raise McpOpsError('Installation intentionally stopped; MCP was not restarted')
        token, created = self.ensure_token()
        app_changed = self.ensure_env(token)
        if app_changed: self.compose('up', '-d', 'app', timeout=180)
        self.ensure_network(); self.build(); self.run_container(token)
        if configure_proxy: self.caddy()
        if not keep_previous: self.finalize()
        if created: print('Created MCP bearer token at ' + str(self.token_file))
        print('MCP endpoint: ' + self.endpoint())

    def endpoint(self) -> str:
        domain = str(self.install.get('domain', '')).strip()
        return f'https://{domain}/mcp' if domain else 'http://127.0.0.1:3006/mcp'

    def status(self) -> None:
        info = self.inspect_container(self.container) or {}
        print(json.dumps({'endpoint': self.endpoint(), 'container': self.container,
            'running': info.get('State', {}).get('Running') is True,
            'release': info.get('Config', {}).get('Labels', {}).get('odm.mcp.sha'),
            'expectedRelease': self.sha, 'image': info.get('Image'),
            'expectedImage': self.active.get('mcpImage'), 'tokenFile': str(self.token_file),
            'stdioCommand': stdio_command(self.container)}, indent=2))

    def token(self, show: bool = False) -> None:
        if not self.token_file.is_file(): raise McpOpsError('Token is not provisioned; run odm-mcpctl sync')
        if not show:
            print(str(self.token_file)); return
        if os.name != 'nt' and self.token_file.stat().st_mode & 0o077:
            raise McpOpsError('Token file must be private (chmod 600) before displaying it')
        print(self.token_file.read_text(encoding='utf-8').strip())

    def stop(self) -> None:
        if self.inspect_container(self.container): self.docker('stop', '--time', '30', self.container, timeout=45)

def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', required=True)
    sub = p.add_subparsers(dest='action', required=True)
    for action in ('sync', 'status', 'stop'): sub.add_parser(action)
    token = sub.add_parser('token')
    token.add_argument('--show', action='store_true', help='Explicitly print the secret; default prints only its private file path')
    return p

def main() -> int:
    from odmctl import locked, OpsError
    args = parser().parse_args()
    try:
        if args.action in ('status', 'token'):
            controller = McpController(args.root)
            if args.action == 'token': controller.token(args.show)
            else: controller.status()
        else:
            # Instantiate only AFTER acquiring the same lock used by update,
            # restore, backup and the watchdog: active.json may change while waiting.
            with locked(Path(args.root).expanduser().absolute()):
                controller = McpController(args.root)
                if args.action == 'sync' and (controller.config_dir / 'transaction.json').exists():
                    raise McpOpsError('An interrupted release needs odmctl start recovery before MCP sync')
                getattr(controller, args.action)()
        return 0
    except (McpOpsError, OpsError, OSError, ValueError) as exc:
        print('mcpctl: ' + str(exc), file=sys.stderr); return 1

if __name__ == '__main__': raise SystemExit(main())
