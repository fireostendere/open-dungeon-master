"""Offline MCP wire check: one guarded write, compact receipt, no blind retry."""
import base64
import hashlib
import io
import json
import runpy
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

upload = runpy.run_path(str(Path(__file__).with_name("set-image.py")))
DATA = b"\x89PNG\r\n\x1a\n" + b"test image bytes"
TARGET = {"type": "campaign", "id": "11111111-1111-4111-8111-111111111111"}


class Wire:
    def __init__(self, sse=False, old_url=None, fail_write=False, bad_receipt=False):
        self.calls = []
        self.sse, self.old_url, self.fail_write = sse, old_url, fail_write
        self.bad_receipt = bad_receipt

    def open(self, request, timeout):
        body = json.loads(request.data)
        self.calls.append(body)
        assert request.full_url == "https://odm.example/mcp"
        assert request.get_header("Authorization") == "Bearer test-credential"
        if len(self.calls) > 1:
            assert request.get_header("Mcp-session-id") == "test-session"
        if body["method"] == "notifications/initialized":
            raw = b""
        else:
            result = {"protocolVersion": "2024-11-05"}
            if body["method"] == "tools/call":
                name, args = body["params"]["name"], body["params"]["arguments"]
                if name == "odm_server":
                    data = {"actions": ["images.get", "images.set"]}
                elif args["operation"] == "get_image":
                    data = {"target": TARGET, "image": {"url": self.old_url} if self.old_url else None}
                else:
                    assert args["expected_url"] == self.old_url
                    assert base64.b64decode(args["data_base64"]) == DATA
                    if self.fail_write:
                        raise TimeoutError("test-credential private-body response lost after commit")
                    data = {"target": TARGET, "image": {"url": "/uploads/new.png", "data_base64": "do not echo"},
                            "sha256": hashlib.sha256(DATA).hexdigest(), "byteSize": len(DATA)}
                    if self.bad_receipt:
                        data["sha256"] = "wrong hash"
                result = {"content": [{"type": "text", "text": json.dumps(data)}]}
            message = json.dumps({"jsonrpc": "2.0", "id": body["id"], "result": result})
            raw = ("event: message\r\ndata: " + message + "\r\n\r\n" if self.sse else message).encode()
        response = io.BytesIO(raw)
        response.headers = {"Mcp-Session-Id": "test-session"}
        return response


class ImageUploadTest(unittest.TestCase):
    def run_upload(self, wire, expected_url=None):
        with patch("urllib.request.build_opener", return_value=wire):
            client = upload["McpClient"]("https://odm.example/mcp", "test-credential")
            return upload["set_image"](client, TARGET, DATA, "image/png", "cover.png", expected_url)

    def test_json_sse_and_explicit_replacement(self):
        for sse, old in [(False, None), (True, None), (True, "/uploads/old.png")]:
            with self.subTest(sse=sse, old=old):
                wire = Wire(sse=sse, old_url=old)
                result = self.run_upload(wire, expected_url=old)
                self.assertEqual(result["image"]["url"], "/uploads/new.png")
                self.assertNotIn("data_base64", result)
                self.assertNotIn("data_base64", result["image"])
                self.assertEqual(len(wire.calls), 5)  # initialize, initialized, capabilities, read, write

    def test_conflict_has_no_write_and_ambiguous_write_is_not_retried(self):
        wire = Wire(old_url="/uploads/other.png")
        with self.assertRaises(ValueError):
            self.run_upload(wire)
        self.assertEqual(len(wire.calls), 4)
        wire = Wire(fail_write=True)
        with self.assertRaises(TimeoutError):
            self.run_upload(wire)
        self.assertEqual(len(wire.calls), 5)

    def test_incomplete_write_receipt_is_not_reported_as_success(self):
        wire = Wire(bad_receipt=True)
        with self.assertRaises(RuntimeError):
            self.run_upload(wire)
        self.assertEqual(len(wire.calls), 5)

    def test_cli_rejects_local_invalid_bytes_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "cover.png"
            for data in [b"", b"not an image", b"x" * (8 * 1024 * 1024 + 1)]:
                image.write_bytes(data)
                argv = ["set-image.py", "--url", "https://odm.example/mcp", "--token-file", "unused",
                        "--type", TARGET["type"], "--id", TARGET["id"], "--file", str(image)]
                with patch("sys.argv", argv), patch("urllib.request.build_opener") as opener:
                    with redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
                        self.assertEqual(upload["main"](), 1)
                    opener.assert_not_called()

    def test_cli_failure_does_not_print_token_or_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            image, token = Path(directory) / "cover.png", Path(directory) / "token"
            image.write_bytes(DATA)
            token.write_text("test-credential")
            wire, out, err = Wire(fail_write=True), io.StringIO(), io.StringIO()
            argv = ["set-image.py", "--url", "https://odm.example/mcp", "--token-file", str(token),
                    "--type", TARGET["type"], "--id", TARGET["id"], "--file", str(image)]
            with patch("sys.argv", argv), patch("urllib.request.build_opener", return_value=wire):
                with redirect_stdout(out), redirect_stderr(err):
                    self.assertEqual(upload["main"](), 1)
            self.assertEqual(out.getvalue(), "")
            for private in ["test-credential", "private-body", base64.b64encode(DATA).decode()]:
                self.assertNotIn(private, err.getvalue())
            self.assertEqual(len(wire.calls), 5)

    def test_insecure_or_internal_endpoint_is_rejected(self):
        for url in ["http://odm.example/mcp", "https://odm.example/api/internal/mcp", "https://user:pass@odm.example/mcp"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                upload["McpClient"](url, "test-credential")
        self.assertIsNone(upload["NoRedirect"]().redirect_request(None, None, 307, "redirect", {}, "https://other.example/mcp"))


if __name__ == "__main__":
    unittest.main()
