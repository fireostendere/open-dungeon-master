"""Upload an operator-approved local image through public MCP, without retries."""
import argparse
import base64
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from uuid import UUID


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class McpClient:
    def __init__(self, url, token):
        parsed = urllib.parse.urlsplit(url)
        secure = parsed.scheme == "https" or (
            parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        )
        if not secure or not parsed.hostname or parsed.username or parsed.password or parsed.path != "/mcp" or parsed.query or parsed.fragment:
            raise ValueError("Use the configured HTTPS /mcp endpoint (HTTP is allowed only on loopback).")
        if not token or any(c.isspace() for c in token):
            raise ValueError("Invalid token file.")
        self.url, self.seq = url, 0
        self.headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json",
                        "Accept": "application/json, text/event-stream"}
        self.opener = urllib.request.build_opener(NoRedirect())
        initialized = self.rpc("initialize", {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "odm-skill-image-upload", "version": "1.0"},
        })
        self.headers["MCP-Protocol-Version"] = initialized["protocolVersion"]
        self.rpc("notifications/initialized", {}, notification=True)

    def rpc(self, method, params, notification=False):
        self.seq += 1
        payload = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notification:
            payload["id"] = self.seq
        request = urllib.request.Request(self.url, data=json.dumps(payload).encode(), headers=self.headers)
        with self.opener.open(request, timeout=135) as response:
            session = response.headers.get("Mcp-Session-Id")
            if session:
                self.headers["Mcp-Session-Id"] = session
            raw = response.read(262145)
        if notification:
            return {}
        if len(raw) > 262144:
            raise RuntimeError("MCP metadata response exceeded the budget.")
        text = raw.decode().replace("\r\n", "\n")
        if text.lstrip().startswith("{"):
            message = json.loads(text)
        else:
            messages = [json.loads("\n".join(line[5:].lstrip() for line in event.splitlines() if line.startswith("data:")))
                        for event in text.split("\n\n") if any(line.startswith("data:") for line in event.splitlines())]
            message = next((m for m in messages if m.get("id") == self.seq), {})
        if message.get("id") != self.seq or "result" not in message or "error" in message:
            raise RuntimeError("MCP response is missing or failed; inspect the target before retrying a write.")
        return message["result"]

    def call(self, name, arguments):
        result = self.rpc("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            raise RuntimeError("MCP tool refused the operation; inspect the target and credential scope.")
        data = result.get("structuredContent")
        if data is None:
            data = json.loads("".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"))
        if not isinstance(data, dict) or data.get("error"):
            raise RuntimeError("Invalid MCP tool result.")
        return data


def set_image(client, target, data, mime, name, expected_url=None):
    actions = client.call("odm_server", {"operation": "capabilities"}).get("actions", [])
    if not {"images.get", "images.set"}.issubset(actions):
        raise ValueError("Current credential cannot read/write target images.")
    old = client.call("odm_assets", {"operation": "get_image", "target": target})
    if old.get("target") != target or "image" not in old or (old["image"] is not None and not isinstance(old["image"], dict)):
        raise RuntimeError("Target metadata is incomplete.")
    if (old["image"] or {}).get("url") != expected_url:
        raise ValueError("Target changed or already has an image; read get_image before an approved replacement.")
    result = client.call("odm_assets", {
        "operation": "set_image", "target": target, "data_base64": base64.b64encode(data).decode(),
        "mime_type": mime, "name": name, "expected_url": expected_url,
    })
    image = result.get("image") or {}
    if (result.get("target") != target or not image.get("url", "").startswith("/uploads/")
            or result.get("sha256") != hashlib.sha256(data).hexdigest() or result.get("byteSize") != len(data)):
        raise RuntimeError("Write receipt is incomplete; read get_image, do not repeat the upload blindly.")
    return {"target": target, "image": {"id": image.get("id"), "url": image["url"]},
            "sha256": result["sha256"], "byteSize": result["byteSize"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--token-file", required=True, type=Path)
    parser.add_argument("--type", required=True, choices=["campaign", "library_character", "sheet", "npc"])
    parser.add_argument("--id", required=True, type=UUID)
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--expected-url", default=None)
    args = parser.parse_args()
    try:
        with args.file.expanduser().open("rb") as image:
            data = image.read(8 * 1024 * 1024 + 1)
        if not data or len(data) > 8 * 1024 * 1024:
            raise ValueError("Image must be nonempty and at most 8 MiB.")
        mime = ("image/png" if data.startswith(b"\x89PNG\r\n\x1a\n") else
                "image/jpeg" if data.startswith(b"\xff\xd8\xff") else
                "image/webp" if data[:4] == b"RIFF" and data[8:12] == b"WEBP" else None)
        if not mime:
            raise ValueError("Expected PNG, JPEG or WebP bytes.")
        if args.expected_url is not None and (not args.expected_url.startswith("/uploads/") or len(args.expected_url) > 300):
            raise ValueError("expected-url must be the stored /uploads/ URL.")
        client = McpClient(args.url, args.token_file.expanduser().read_text().strip())
        result = set_image(client, {"type": args.type, "id": str(args.id)}, data, mime, args.file.name, args.expected_url)
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Do not print a remote body/exception: it may contain credentials or private text.
        print("Upload stopped. Check file, endpoint and credential scope; if a write was sent, read get_image before retrying.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
