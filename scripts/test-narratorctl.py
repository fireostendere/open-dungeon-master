#!/usr/bin/env python3
"""The managed listener must not start as a collector or leak an operator token."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from narratorctl import NarratorController, NarratorOpsError


class FakeNarrator(NarratorController):
    def __init__(self, root):
        super().__init__(root=root, campaign_id="11111111-1111-4111-8111-111111111111")
        self.calls = []

    def docker(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return ""

    def probe_http(self, path="/healthz", timeout=3.0):
        return {"ok": True}


class NarratorStartTest(unittest.TestCase):
    def test_requires_scoped_token_and_real_adapter(self):
        with tempfile.TemporaryDirectory() as root:
            host = FakeNarrator(root)
            with patch.dict(os.environ, {"ODM_MCP_TOKEN": "operator-secret"}, clear=True):
                with self.assertRaises(NarratorOpsError):
                    host.start()
                self.assertEqual(host.calls, [])
                os.environ["ODM_NARRATOR_ADAPTER_MODULE"] = "file:///app/narrator/local-role-adapter.mjs"
                with self.assertRaises(NarratorOpsError):
                    host.start()
                self.assertEqual(host.calls, [])

    def test_docker_receives_scoped_token_only_through_environment(self):
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root) / "workspace"
            workspace.mkdir()
            host = FakeNarrator(root)
            values = {
                "ODM_MCP_TOKEN": "operator-secret",
                "ODM_MCP_NARRATOR_TOKEN": "scoped-secret",
                "ODM_NARRATOR_ADAPTER_MODULE": "file:///host/narrator/local-role-adapter.mjs",
                "ODM_NARRATOR_START_AFTER_SEQ": "0",
                "ODM_OPENCODE_URL": "https://opencode.internal",
                "ODM_OPENCODE_WORKSPACE": str(workspace),
                "ODM_OPENCODE_PROVIDER": "test-provider",
                "ODM_OPENCODE_MODEL": "test-model",
            }
            with patch.dict(os.environ, values, clear=True):
                self.assertTrue(host.start())
            run_args, run_kwargs = next(call for call in host.calls if call[0][:2] == ("run", "-d"))
            self.assertNotIn("scoped-secret", " ".join(run_args))
            self.assertNotIn("operator-secret", " ".join(run_args))
            self.assertEqual(run_kwargs["env"]["ODM_MCP_NARRATOR_TOKEN"], "scoped-secret")
            self.assertEqual(run_kwargs["env"]["ODM_NARRATOR_ADAPTER_MODULE"], "file:///app/narrator/local-role-adapter.mjs")
            self.assertIn(f"{Path(root) / 'state' / 'narrator'}:/app/state", run_args)
            self.assertNotIn(f"{Path(root) / 'state'}:/app/state", run_args)

    def test_legacy_checkpoint_requires_explicit_migration(self):
        with tempfile.TemporaryDirectory() as root:
            host = FakeNarrator(root)
            old = Path(root) / "state" / host.checkpoint_file.name
            old.parent.mkdir()
            old.write_text('{"lastSeq":42}')
            with patch.dict(os.environ, {"ODM_MCP_NARRATOR_TOKEN": "scoped-secret", "ODM_NARRATOR_ADAPTER_MODULE": "adapter.mjs"}, clear=True):
                with self.assertRaisesRegex(NarratorOpsError, "Move the existing checkpoint"):
                    host.start()
            self.assertEqual(host.calls, [])

    def test_local_fallback_uses_managed_repository(self):
        with tempfile.TemporaryDirectory() as root:
            script = Path(root) / "repository" / "narrator" / "run.mjs"
            script.parent.mkdir(parents=True)
            script.touch()
            host = FakeNarrator(root)
            host.docker = lambda *args, **kwargs: (_ for _ in ()).throw(NarratorOpsError("no Docker"))
            with patch.dict(os.environ, {"ODM_MCP_NARRATOR_TOKEN": "scoped-secret", "ODM_NARRATOR_ADAPTER_MODULE": "adapter.mjs"}, clear=True), \
                 patch("narratorctl.subprocess.Popen") as launched:
                self.assertTrue(host.start())
            self.assertEqual(launched.call_args.kwargs["cwd"], str(script.parent.parent))
            self.assertEqual(launched.call_args.args[0][-1], str(script))


if __name__ == "__main__":
    unittest.main()
