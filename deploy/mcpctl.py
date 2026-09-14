#!/usr/bin/env python3
"""Manage the unprivileged Open Dungeon Master MCP sidecar.

This helper deliberately does not expose host operations to MCP. It only builds
and runs the MCP image next to the release selected by odmctl, provisions the
shared control token, and wires Caddy to /mcp when a managed HTTPS domain exists.
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
import urllib.error
import urllib.request

SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class McpOpsError(RuntimeError):
    pass


def atomic(path: Path, data: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.chmod(tmp, mode)
        except OSError:
            pass
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise McpOpsError(f"Could not read {path}") from exc


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def set_env(path: Path, updates: dict[str, str]) -> bool:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    pending = dict(updates)
    out: list[str] = []
    changed = False
    for raw in lines:
        if "=" not in raw or raw.lstrip().startswith("#"):
            out.append(raw)
            continue
        key = raw.split("=", 1)[0]
        if key in pending:
            new = f"{key}={pending.pop(key)}"
            out.append(new)
            changed = changed or new != raw
        else:
            out.append(raw)
    if pending:
        if out and out[-1] != "":
            out.append("")
        out.append("# MCP control plane")
        out.extend(f"{key}={value}" for key, value in pending.items())
        changed = True
    if changed:
        atomic(path, "\n".join(out).rstrip() + "\n")
    return changed


class McpController:
    def __init__(self, root: str):
        self.root = Path(root).expanduser().absolute()
        if self.root == Path(self.root.anchor) or self.root.is_symlink():
            raise McpOpsError("Unsafe ODM root")
        self.config_dir = self.root / "config"
        self.active = read_json(self.config_dir / "active.json")
        self.install = read_json(self.config_dir / "install.json")
        self.sha = str(self.active.get("sha", ""))
        if not SHA_RE.fullmatch(self.sha):
            raise McpOpsError("Active ODM release has no valid commit SHA")
        self.source = self.root / "releases" / self.sha / "source"
        if not (self.source / "mcp" / "Dockerfile").is_file():
            raise McpOpsError("Active release does not contain mcp/Dockerfile")
        self.project = "odm-" + hashlib.sha256(str(self.root).encode()).hexdigest()[:10]
        self.network = self.project + "_default"
        self.container = self.project + "-mcp"
        self.image = "odm-mcp-managed:" + self.sha
        self.app_env = self.config_dir / "app.env"
        self.mcp_env = self.config_dir / "mcp.env"
        self.token_file = self.config_dir / "mcp.token"
        self.compose_file = Path(str(self.active.get("compose", "")))
        if not self.compose_file.is_file():
            raise McpOpsError("Active ODM compose manifest is missing")

    def run(self, args: list[str], *, capture: bool = True, timeout: int = 1800) -> str:
        try:
            result = subprocess.run(
                args,
                text=True,
                encoding="utf-8",
                errors="replace",
                stdout=subprocess.PIPE if capture else None,
                stderr=subprocess.PIPE if capture else None,
                timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise McpOpsError(f"{Path(args[0]).name} unavailable or timed out") from exc
        if result.returncode:
            raise McpOpsError(f"{Path(args[0]).name} failed with exit {result.returncode}")
        return result.stdout or ""

    def docker(self, *args: str, **kwargs) -> str:
        return self.run(["docker", *args], **kwargs)

    def compose(self, *args: str, **kwargs) -> str:
        return self.docker(
            "compose",
            "--project-name",
            self.project,
            "-f",
            str(self.compose_file),
            *args,
            **kwargs,
        )

    def ensure_token(self) -> tuple[str, bool]:
        current = parse_env(self.app_env).get("ODM_MCP_TOKEN", "").strip()
        created = False
        if current:
            token = current
        elif self.token_file.exists():
            token = self.token_file.read_text(encoding="utf-8").strip()
        else:
            token = secrets.token_hex(32)
            created = True
        if len(token) < 32:
            raise McpOpsError("ODM_MCP_TOKEN is too short; use at least 32 random characters")
        stored = self.token_file.read_text(encoding="utf-8").strip() if self.token_file.exists() else ""
        if stored != token:
            atomic(self.token_file, token + "\n", 0o600)
        return token, created

    def ensure_env(self, token: str) -> bool:
        current = parse_env(self.app_env)
        domain = str(self.install.get("domain", "")).strip()
        configured_public = current.get("ODM_PUBLIC_URL", "").strip()
        if configured_public:
            public_url = configured_public
        elif domain:
            public_url = "https://" + domain
        else:
            public_url = f"http://127.0.0.1:{int(self.install.get('port', 3005))}"
        changed = set_env(
            self.app_env,
            {
                "ODM_MCP_TOKEN": token,
                "ODM_MCP_OWNER_USERNAME": current.get("ODM_MCP_OWNER_USERNAME", "odm_admin"),
                # The app creates scoped binary asset URLs, while the MCP
                # sidecar itself is normally on :3006. Preserve an operator
                # override; otherwise derive the actual managed app origin.
                "ODM_PUBLIC_URL": public_url,
            },
        )
        atomic(
            self.mcp_env,
            "".join(
                [
                    "ODM_MCP_CONTROL_URL=http://app:3005/api/internal/mcp\n",
                    f"ODM_MCP_TOKEN={token}\n",
                    "ODM_MCP_HOST=0.0.0.0\n",
                    "ODM_MCP_PORT=3006\n",
                ]
            ),
            0o600,
        )
        return changed

    def image_exists(self) -> bool:
        result = subprocess.run(
            ["docker", "image", "inspect", self.image],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return result.returncode == 0

    def build(self) -> None:
        if self.image_exists():
            return
        print("Building MCP sidecar for " + self.sha[:12], flush=True)
        self.docker(
            "build",
            "--pull",
            "-f",
            str(self.source / "mcp" / "Dockerfile"),
            "-t",
            self.image,
            str(self.source),
            capture=False,
            timeout=1800,
        )

    def container_label(self, name: str) -> str:
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{ index .Config.Labels \"" + name + "\" }}", self.container],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else ""

    def container_sha(self) -> str:
        return self.container_label("odm.mcp.sha")

    def ensure_network(self) -> None:
        result = subprocess.run(
            ["docker", "network", "inspect", self.network],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode:
            raise McpOpsError("ODM Docker network is not running; start the application first")

    def run_container(self, token: str) -> None:
        token_fingerprint = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
        if (
            self.container_sha() == self.sha
            and self.container_label("odm.mcp.token") == token_fingerprint
        ):
            self.docker("start", self.container, timeout=60)
            return
        subprocess.run(["docker", "rm", "-f", self.container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        self.docker(
            "run",
            "-d",
            "--name",
            self.container,
            "--restart",
            "unless-stopped",
            "--network",
            self.network,
            "--network-alias",
            "mcp",
            "--env-file",
            str(self.mcp_env),
            "--publish",
            "127.0.0.1:3006:3006",
            "--security-opt",
            "no-new-privileges:true",
            "--cap-drop",
            "ALL",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=16m",
            "--label",
            "odm.mcp.managed=1",
            "--label",
            "odm.mcp.sha=" + self.sha,
            "--label",
            "odm.mcp.token=" + token_fingerprint,
            self.image,
            timeout=120,
        )

    def caddy(self) -> None:
        domain = str(self.install.get("domain", "")).strip()
        if not domain:
            return
        caddyfile = self.config_dir / "Caddyfile"
        content = (
            f"{domain} {{\n"
            " encode zstd gzip\n"
            " @private path /api/internal/*\n"
            " respond @private 404\n"
            " @mcp path /mcp\n"
            " reverse_proxy @mcp mcp:3006\n"
            " reverse_proxy app:3005\n"
            "}\n"
        )
        old = caddyfile.read_text(encoding="utf-8") if caddyfile.exists() else ""
        if old != content:
            atomic(caddyfile, content, 0o600)
            self.compose("up", "-d", "proxy", timeout=120)
            self.compose("exec", "-T", "proxy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", timeout=60)

    def wait_ready(self) -> None:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen("http://127.0.0.1:3006/healthz", timeout=4) as response:
                    if response.status == 200:
                        return
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(2)
        raise McpOpsError("MCP sidecar did not become healthy")

    def sync(self) -> None:
        token, created = self.ensure_token()
        app_changed = self.ensure_env(token)
        if app_changed:
            self.compose("up", "-d", "app", timeout=180)
        self.ensure_network()
        self.build()
        self.run_container(token)
        self.wait_ready()
        self.caddy()
        if created:
            print("Created MCP bearer token at " + str(self.token_file))
        print("MCP endpoint: " + self.endpoint())

    def endpoint(self) -> str:
        domain = str(self.install.get("domain", "")).strip()
        return f"https://{domain}/mcp" if domain else "http://127.0.0.1:3006/mcp"

    def status(self) -> None:
        sha = self.container_sha()
        running = False
        if sha:
            value = self.docker("inspect", "--format", "{{.State.Running}}", self.container).strip()
            running = value == "true"
        print(
            json.dumps(
                {
                    "endpoint": self.endpoint(),
                    "container": self.container,
                    "running": running,
                    "release": sha or None,
                    "expectedRelease": self.sha,
                    "tokenFile": str(self.token_file),
                    "stdioCommand": ["docker", "exec", "-i", self.container, "node", "/app/server.mjs", "--stdio"],
                },
                indent=2,
            )
        )

    def stop(self) -> None:
        subprocess.run(["docker", "stop", self.container], check=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Open Dungeon Master MCP sidecar controller")
    parser.add_argument("--root", required=True)
    parser.add_argument("action", choices=("sync", "status", "stop"))
    args = parser.parse_args()
    try:
        controller = McpController(args.root)
        getattr(controller, args.action)()
        return 0
    except McpOpsError as exc:
        print("mcpctl: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
