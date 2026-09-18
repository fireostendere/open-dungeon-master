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
    def __init__(self, root: str | Path | None = None, campaign_id: str | None = None, port: int = 3007):
        default_root = Path("/opt/odm") if Path("/opt/odm").is_dir() else Path.cwd()
        self.root = Path(root or os.environ.get("ODM_ROOT") or default_root).expanduser().resolve()
        self.config_dir = self.root / "config"
        self.state_dir = self.root / "state"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.campaign_id = campaign_id or os.environ.get("ODM_CAMPAIGN_ID") or ""
        self.port = port

        self.project = "odm-" + hashlib.sha256(str(self.root).encode()).hexdigest()[:10]
        self.network = self.project + "_default"
        self.container = self.project + "-narrator" + (f"-{self.campaign_id[:8]}" if self.campaign_id else "")
        self.image_tag = "odm-narrator:latest"

        self.checkpoint_file = self.state_dir / (
            f"narrator-checkpoint-{self.campaign_id}.json" if self.campaign_id else "narrator-checkpoint-default.json"
        )

    def run_cmd(self, args: list[str], *, capture: bool = True, timeout: int = 60) -> str:
        try:
            res = subprocess.run(args, text=True, encoding="utf-8", errors="replace",
                                 stdout=subprocess.PIPE if capture else None,
                                 stderr=subprocess.PIPE if capture else None,
                                 timeout=timeout, check=False)
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
        print(f"Starting narrator host for campaign '{self.campaign_id}' on port {self.port}...", flush=True)

        token = os.environ.get("ODM_MCP_NARRATOR_TOKEN") or os.environ.get("ODM_MCP_TOKEN")
        if not token:
            token_file = self.config_dir / "mcp.token"
            if token_file.is_file():
                token = token_file.read_text(encoding="utf-8").strip()
            else:
                app_env = parse_env(self.config_dir / "app.env")
                token = app_env.get("ODM_MCP_NARRATOR_TOKEN") or app_env.get("ODM_MCP_TOKEN")

        if not token:
            raise NarratorOpsError("Narrator authentication token not found in env or config.")

        # Check if docker is available and running
        has_docker = False
        try:
            self.docker("info", timeout=10)
            has_docker = True
        except NarratorOpsError:
            has_docker = False

        if has_docker:
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
                "-e", f"ODM_MCP_TOKEN={token}",
                "-e", "ODM_MCP_URL=http://app:3005/api/internal/mcp",
                "-e", "ODM_NARRATOR_PORT=3007",
                "--security-opt", "no-new-privileges:true",
                "--cap-drop", "ALL",
                "--read-only",
                "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
                self.image_tag,
            ]
            docker_args = [a for a in docker_args if a]
            self.docker(*docker_args, timeout=60)
        else:
            # Fallback: run node process locally
            run_script = self.root / "narrator" / "run.mjs"
            if not run_script.is_file():
                raise NarratorOpsError(f"Narrator script not found at {run_script}")

            env = os.environ.copy()
            env["ODM_CAMPAIGN_ID"] = self.campaign_id
            env["ODM_MCP_TOKEN"] = token
            env["ODM_NARRATOR_PORT"] = str(self.port)
            env["ODM_NARRATOR_CHECKPOINT_PATH"] = str(self.checkpoint_file)

            subprocess.Popen([sys.executable if sys.executable.endswith("node") else "node", str(run_script)],
                             cwd=str(self.root), env=env)

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

    args = parser.parse_args()
    ctl = NarratorController(root=args.root, campaign_id=args.campaign, port=args.port)

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
