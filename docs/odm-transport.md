# ODM transport

SSH is infrastructure only. The game/orchestrator uses one `OdmClient`; it
never runs remote shell commands, reads a server token file, or parses shell
output.

## Production

Use the campaign-scoped HTTPS JSON gateway for `narrator/run.mjs` and other
control clients:

```sh
export ODM_TRANSPORT=https
export ODM_URL=https://dnd.example.com/api/narrator
export ODM_AUTH_TOKEN="$ODM_MCP_NARRATOR_TOKEN"
```

The gateway accepts only the narrator action allowlist and only the campaign
bound to `ODM_MCP_NARRATOR_TOKEN`. The broad operator token and
`/api/internal/mcp` remain private. For an MCP host such as OpenCode, use the
HTTPS sidecar endpoint instead:

```json
{"type":"remote","url":"https://dnd.example.com/mcp","headers":{"Authorization":"Bearer {env:ODM_MCP_NARRATOR_TOKEN}"}}
```

The sidecar still delegates every action to the same application authorization
and narrator domain handlers; it is not a second game engine.

## Local and tunnel modes

Local development keeps the existing application route behind the client:

```sh
export ODM_TRANSPORT=local
export ODM_URL=http://127.0.0.1:3005/api/internal/mcp
export ODM_AUTH_TOKEN=...
```

For a private deployment, the client starts and reuses one SSH session:

```sh
export ODM_TRANSPORT=ssh-tunnel
export ODM_URL=http://127.0.0.1:39005/api/internal/mcp
export ODM_AUTH_TOKEN=...
export ODM_SSH_TARGET=odm@server.example
export ODM_TUNNEL_LOCAL_PORT=39005
export ODM_SSH_REMOTE_PORT=3005
node narrator/run.mjs --campaign "$ODM_CAMPAIGN_ID"
```

An OpenCode MCP host can keep the same separation with one infrastructure
process, then connect to the forwarded sidecar port:

```sh
ODM_SSH_TARGET=odm@server.example \
ODM_TUNNEL_LOCAL_PORT=39006 ODM_SSH_REMOTE_PORT=3006 \
node mcp/tunnel.mjs
```

Point its remote MCP URL at `http://127.0.0.1:39006/mcp`. No game action starts
another SSH process. Reads may recover once after a tunnel reset; mutations are
never retried automatically because the request may already have committed.

## Request shape and efficiency

`OdmClient` exposes generic calls plus `connect`, `read`, `getSnapshot`,
`getDelta`, `catalog`, `invoke`, and `narrate`. One client owns one transport
for its whole process. Catalog summaries are cached by the narrator host.
Reads default to `projection: live` and `delta: true`; unchanged sections are
identified by the existing `sectionVersions` digests. `readAfter` is explicit:
the orchestration host asks for it when it needs authoritative post-write state,
while ordinary receipts do not force a second read.

## Zero-downtime cutover

For a host where Caddy also serves another application, use
`deploy/live-caddyfile.example` as the path-routing template. Stage a new MCP
sidecar on a second localhost port, pass its health check, then reload Caddy
gracefully. Keep the old sidecar until an authenticated public MCP probe passes;
the old port is the rollback target. Do not run the managed `odmctl update`
during an active measurement: its current app-release transaction stops the
proxy/app before replacement and is a maintenance-window operation.

## 404 and diagnostics

`https://dnd.example.com/api/internal/mcp` returning the proxy's HTML 404 is
expected: Caddy deliberately blocks `/api/internal` and its descendants. It is
not evidence that the application handler is missing. Use `/mcp` for an MCP
client or `/api/narrator` for the restricted JSON client. A `401` means the
bearer is wrong; a `403` means the token is valid but not campaign-scoped for
the requested action.

Set `ODM_LATENCY_LOG=1` for content-free JSONL timings. The client emits
`odm_transport`, `odm_server`, and the operation stage, for example:

```text
odm_narrator.invoke: 84 ms (transport 22 ms, server 62 ms)
```

Authorization headers, tokens, campaign text, and prompts are not logged.
