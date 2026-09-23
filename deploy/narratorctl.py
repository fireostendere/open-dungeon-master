#!/usr/bin/env python3
"""Manage the unprivileged External Narrator host for Open Dungeon Master (ODM).

Controls the autonomous narrator runner, probes health endpoints, manages
resilient checkpoints across crashes, and inspects token/cost budgets.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import urllib.error

class NarratorOpsError(RuntimeError):
    pass

def read_json_safe(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None

def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists(): return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values

class NarratorController:
    def __init__(self, root: str | Path | None = None, campaign_id: str | None = None, port: int = 3007, yolo: bool = False):
        default_root = Path("/opt/odm") if Path("/opt/odm").is_dir() else Path.cwd()
        self.root = Path(root or os.environ.get("ODM_ROOT") or default_root).expanduser().resolve()
        self.repository_dir = self.root / "repository" if (self.root / "repository" / "narrator" / "run.mjs").is_file() else self.root
        self.config_dir = self.root / "config"
        self.state_dir = self.root / "state" / "narrator"
        self.campaign_id = campaign_id or os.environ.get("ODM_CAMPAIGN_ID") or ""
        self.port = port
        requested_mode = (os.environ.get("ODM_DND_MODE") or "").strip().lower()
        legacy_yolo = (os.environ.get("YOLO_DND") or "").strip().lower() in {"1", "true", "yes", "on", "yolo", "fast", "field"}
        self.yolo = yolo or requested_mode == "yolo" or legacy_yolo

        self.project = "odm-" + hashlib.sha256(str(self.root).encode()).hexdigest()[:10]
        self.network = self.project + "_default"
        self.container = self.project + "-narrator" + (f"-{self.campaign_id[:8]}" if self.campaign_id else "")
        self.image_tag = "odm-narrator:latest"

        self.checkpoint_file = self.state_dir / (
            f"narrator-checkpoint-{self.campaign_id}.json" if self.campaign_id else "narrator-checkpoint-default.json"
        )
        self.legacy_checkpoint_file = self.root / "state" / self.checkpoint_file.name

    def run_cmd(self, args: list[str], *, capture: bool = True, timeout: int = 60, env: dict[str, str] | None = None) -> str:
        try:
            res = subprocess.run(args, text=True, encoding="utf-8", errors="replace",
                                 stdout=subprocess.PIPE if capture else None,
                                 stderr=subprocess.PIPE if capture else None,
                                 timeout=timeout, check=False, env=env)
            if res.returncode != 0:
                raise NarratorOpsError(f"{args[0]} failed with code {res.returncode}: {res.stderr.strip() if res.stderr else ''}")
            return res.stdout or ""
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise NarratorOpsError(f"Command {' '.join(args)} failed: {exc}") from exc

    def docker(self, *args: str, **kwargs) -> str:
        return self.run_cmd(["docker", *args], **kwargs)

    def probe_http(self, path: str = "/healthz", timeout: float = 3.0) -> dict | None:
        url = f"http://127.0.0.1:{self.port}{path}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
        except Exception:
            return None
        return None

    def status(self) -> dict:
        info: dict = {
            "root": str(self.root),
            "campaign_id": self.campaign_id,
            "port": self.port,
            "checkpoint_file": str(self.checkpoint_file),
            "checkpoint_exists": self.checkpoint_file.is_file(),
            "container": self.container,
            "container_running": False,
            "health": "unreachable",
            "checkpoint": None,
        }

        # Check docker container
        try:
            out = self.docker("inspect", "--format", "{{.State.Running}}", self.container, timeout=10).strip()
            info["container_running"] = out.lower() == "true"
        except NarratorOpsError:
            pass

        # Check HTTP health
        probe = self.probe_http("/status")
        if probe:
            info["health"] = "healthy" if probe.get("ok") else "degraded"
            info["status_details"] = probe
        else:
            simple = self.probe_http("/healthz")
            if simple:
                info["health"] = "healthy"

        # Read checkpoint
        if self.checkpoint_file.is_file():
            info["checkpoint"] = read_json_safe(self.checkpoint_file)

        return info

    def start(self, detach: bool = True) -> bool:
        print(f"Starting narrator host for campaign '{self.campaign_id}' on port {self.port} (requested mode: {'yolo' if self.yolo else 'auto'})...", flush=True)

        if not self.campaign_id:
            raise NarratorOpsError("Set the campaign ID before starting the narrator.")
        if self.legacy_checkpoint_file.is_file() and not self.checkpoint_file.is_file():
            raise NarratorOpsError(f"Move the existing checkpoint to {self.checkpoint_file} before starting; never reset its processed cursor implicitly.")
        adapter = os.environ.get("ODM_NARRATOR_ADAPTER_MODULE", "").strip()
        if not adapter:
            raise NarratorOpsError("Set ODM_NARRATOR_ADAPTER_MODULE; a collector cannot run the game.")
        token = os.environ.get("ODM_MCP_NARRATOR_TOKEN")
        if not token:
            token = parse_env(self.config_dir / "app.env").get("ODM_MCP_NARRATOR_TOKEN")

        if not token:
            raise NarratorOpsError("A campaign-scoped ODM_MCP_NARRATOR_TOKEN is required; the operator token is not a narrator credential.")
        if adapter.endswith("/local-role-adapter.mjs"):
            required = ["ODM_NARRATOR_START_AFTER_SEQ", "ODM_OPENCODE_URL", "ODM_OPENCODE_WORKSPACE", "ODM_OPENCODE_PROVIDER", "ODM_OPENCODE_MODEL"]
            missing = [name for name in required if not os.environ.get(name)]
            if missing:
                raise NarratorOpsError("Missing narrator configuration: " + ", ".join(missing))

        # Check if docker is available and running
        has_docker = False
        try:
            self.docker("info", timeout=10)
            has_docker = True
        except NarratorOpsError:
            has_docker = False

        if has_docker:
            if not adapter.endswith("/local-role-adapter.mjs"):
                raise NarratorOpsError("The managed Docker image includes only the built-in local-role adapter; run a custom adapter under an external supervisor.")
            try:
                self.docker("image", "inspect", self.image_tag, timeout=10)
            except NarratorOpsError as exc:
                raise NarratorOpsError("Build the local narrator image first: docker build -f narrator/Dockerfile -t odm-narrator:latest .") from exc
            container_env = {**os.environ, "ODM_MCP_NARRATOR_TOKEN": token}
            if adapter.endswith("/local-role-adapter.mjs"):
                container_env["ODM_NARRATOR_ADAPTER_MODULE"] = "file:///app/narrator/local-role-adapter.mjs"
            workspace = os.environ.get("ODM_OPENCODE_WORKSPACE", "")
            if workspace and not Path(workspace).is_dir():
                raise NarratorOpsError("ODM_OPENCODE_WORKSPACE must be an existing directory on the Docker host.")
            if adapter.endswith("/local-role-adapter.mjs") and not os.environ["ODM_OPENCODE_URL"].startswith("https://"):
                raise NarratorOpsError("A Docker narrator requires a reachable HTTPS OpenCode URL; loopback and plain HTTP are rejected by the adapter.")
            self.state_dir.mkdir(parents=True, exist_ok=True)
            if os.geteuid() == 0:
                os.chown(self.state_dir, 1000, 1000)  # node user in narrator/Dockerfile
            self.state_dir.chmod(0o700)
            # Clean up old container if present
            try:
                self.docker("rm", "-f", self.container, timeout=15)
            except NarratorOpsError:
                pass

            docker_args = [
                "run", "-d" if detach else "",
                "--name", self.container,
                "--restart", "unless-stopped",
                "--network", self.network,
                "-p", f"127.0.0.1:{self.port}:3007",
                "-v", f"{self.state_dir}:/app/state",
                "-e", f"ODM_CAMPAIGN_ID={self.campaign_id}",
                "-e", "ODM_MCP_NARRATOR_TOKEN",
                "-e", "ODM_MCP_URL=http://app:3005/api/internal/mcp",
                "-e", "ODM_NARRATOR_PORT=3007",
                *[item for name in ("ODM_NARRATOR_ADAPTER_MODULE", "ODM_NARRATOR_START_AFTER_SEQ", "ODM_OPENCODE_URL", "ODM_OPENCODE_WORKSPACE", "ODM_OPENCODE_PROVIDER", "ODM_OPENCODE_MODEL", "ODM_OPENCODE_VARIANT", "ODM_OPENCODE_TOKEN", "ODM_OPENCODE_ACTOR_PROVIDER", "ODM_OPENCODE_ACTOR_MODEL", "ODM_OPENCODE_ACTOR_VARIANT") if name in container_env for item in ("-e", name)],
                *(["-v", f"{workspace}:{workspace}:ro"] if workspace else []),
                *(["-e", "ODM_DND_MODE=yolo"] if self.yolo else []),
                "--security-opt", "no-new-privileges:true",
                "--cap-drop", "ALL",
                "--read-only",
                "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
                self.image_tag,
            ]
            docker_args = [a for a in docker_args if a]
            self.docker(*docker_args, timeout=60, env=container_env)
        else:
            # Fallback: run node process locally
            self.state_dir.mkdir(parents=True, exist_ok=True)
            self.state_dir.chmod(0o700)
            run_script = self.repository_dir / "narrator" / "run.mjs"
            if not run_script.is_file():
                raise NarratorOpsError(f"Narrator script not found at {run_script}")

            env = os.environ.copy()
            env.pop("ODM_AUTH_TOKEN", None)
            env.pop("ODM_MCP_TOKEN", None)
            env["ODM_CAMPAIGN_ID"] = self.campaign_id
            env["ODM_MCP_NARRATOR_TOKEN"] = token
            env["ODM_NARRATOR_PORT"] = str(self.port)
            env["ODM_NARRATOR_CHECKPOINT_PATH"] = str(self.checkpoint_file)
            if self.yolo:
                env["ODM_DND_MODE"] = "yolo"

            subprocess.Popen([sys.executable if sys.executable.endswith("node") else "node", str(run_script)],
                             cwd=str(self.repository_dir), env=env)

        # Wait for health endpoint
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.probe_http("/healthz"):
                print(f"Narrator host is healthy and listening on port {self.port}.")
                return True
            time.sleep(1)

        print("Warning: Narrator started but health check timed out.")
        return False

    def stop(self) -> bool:
        print(f"Stopping narrator host '{self.container}'...", flush=True)
        try:
            self.docker("stop", "-t", "10", self.container, timeout=20)
            self.docker("rm", "-f", self.container, timeout=10)
            print("Narrator host stopped.")
            return True
        except NarratorOpsError as exc:
            print(f"Stop notice: {exc}")
            return False

    def restart(self) -> bool:
        self.stop()
        time.sleep(1)
        return self.start()

    def logs(self, lines: int = 50) -> str:
        try:
            return self.docker("logs", "--tail", str(lines), self.container, timeout=15)
        except NarratorOpsError as exc:
            return f"Could not retrieve logs: {exc}"

    def checkpoint(self) -> dict | None:
        if self.checkpoint_file.is_file():
            return read_json_safe(self.checkpoint_file)
        return None

def main() -> None:
    parser = argparse.ArgumentParser(description="Manage Open Dungeon Master (ODM) Narrator host")
    parser.add_argument("command", choices=["status", "start", "stop", "restart", "health", "logs", "checkpoint"])
    parser.add_argument("--root", help="Root directory of ODM installation", default=None)
    parser.add_argument("--campaign", help="Target campaign ID", default=None)
    parser.add_argument("--port", help="Health/status port (default 3007)", type=int, default=3007)
    parser.add_argument("--lines", help="Lines of logs to fetch", type=int, default=50)
    parser.add_argument("--yolo", help="Explicitly request lightweight YOLO narration mode", action="store_true")

    args = parser.parse_args()
    ctl = NarratorController(root=args.root, campaign_id=args.campaign, port=args.port, yolo=args.yolo)

    if args.command == "status":
        info = ctl.status()
        print(json.dumps(info, indent=2, ensure_ascii=False))
    elif args.command == "start":
        ok = ctl.start()
        sys.exit(0 if ok else 1)
    elif args.command == "stop":
        ok = ctl.stop()
        sys.exit(0 if ok else 1)
    elif args.command == "restart":
        ok = ctl.restart()
        sys.exit(0 if ok else 1)
    elif args.command == "health":
        res = ctl.probe_http("/status") or ctl.probe_http("/healthz")
        if res:
            print(json.dumps(res, indent=2, ensure_ascii=False))
            sys.exit(0)
        else:
            print(json.dumps({"ok": False, "error": "Health check unreachable"}, indent=2))
            sys.exit(1)
    elif args.command == "logs":
        print(ctl.logs(lines=args.lines))
    elif args.command == "checkpoint":
        cp = ctl.checkpoint()
        if cp:
            print(json.dumps(cp, indent=2, ensure_ascii=False))
        else:
            print(json.dumps({"error": "No checkpoint file found"}, indent=2))

if __name__ == "__main__":
    main()
