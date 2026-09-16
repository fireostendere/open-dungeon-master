# MCP control plane

The MCP sidecar is a separate unprivileged process. Agents call its Streamable
HTTP endpoint or stdio tools; the sidecar calls the bearer-protected application
route `/api/internal/mcp`. The application domain services remain the writers of
campaign state. Agents do not receive a host shell, Docker socket or SQLite file.

```text
MCP agent -- Streamable HTTP/stdio --> MCP sidecar :3006
                                      |
                                      | private POST /api/internal/mcp
                                      v
                                   ODM :3005 --> game DB and media
```

Managed Caddy configurations return 404 for `/api/internal` and descendants and
route `/mcp` to the sidecar. A directly published application port is not protected
by that Caddy rule; the internal route must still validate its bearer. Configure
public exposure intentionally rather than assuming a proxy protects every port.

## Tools and resources

| Tool | Operations |
| --- | --- |
| `odm_server` | health and capabilities |
| `odm_users` | existing users and UUIDs |
| `odm_campaigns` | campaigns/workshops, status, invitations |
| `odm_campaign_settings` | rules, providers and DM mode |
| `odm_story` | scene, quests, outline, arc, events, notices |
| `odm_members` | roster, join an existing user, party lead |
| `odm_characters` | library characters and campaign instantiation |
| `odm_sheets` | live campaign sheets |
| `odm_models` | list/test/apply models and switch endpoints |
| `odm_narrator` | trusted external narrator lifecycle |
| `odm_assets` | packs, jobs, leases, scoped upload/download, asset links |
| `odm_progress` | revision-checked progress, party sync, finish receipts |

Resources: `odm://server/status`, `odm://server/capabilities`,
`odm://narrator/instructions`. The latter describes the read/cursor/write protocol;
see [external-narrator.md](external-narrator.md).

A party is the campaign roster and its live sheets, including companions; there
is no separate party-account database. Deletion requires explicit confirmation.
Provider-key reads are masked. The bearer is operator-wide, not player-scoped:
never give it to an untrusted player or put it in a prompt visible to the table.
Creating login accounts and recovering their credentials remain authenticated
application/admin workflows, not MCP tools.

## Managed installation and release lifecycle

```sh
sudo bash install-server.sh --repo fireostendere/dungeon_master --branch main --domain dnd.example.com --runtime none
odm-mcpctl status
```

Installation generates a private token, configures the internal API, prepares the
application and sidecar from the same source revision, and publishes MCP only at
`127.0.0.1:3006`. An optional managed domain exposes its TLS `/mcp` route. Avoid
`--domain` when an unrelated service already owns ports 80/443.

The sidecar has no game-volume or Docker-socket mounts, drops capabilities, uses
`no-new-privileges`, and has a read-only filesystem plus bounded temporary storage.
Lifecycle operations remain in `odmctl`, not remotely callable tools.

Updates are coordinated, not an eventual 15-minute MCP rollout: both images are
prepared before downtime, the current game is backed up, a transition is journaled,
and web/MCP health must succeed before commitment. The previous sidecar is retained
for rollback. Both controllers share `.ops.lock`, including backup and restore.
The standalone legacy MCP timer is retired by the current installer. On Windows,
MCP is handled by the same controller and maintenance tasks rather than a separate
script that overwrites controller files outside the lock.

`odm-mcpctl status` reports release/digest metadata and the exact stdio argument
array. `sync` repairs a stale sidecar under the common lock; it refuses an
intentionally stopped installation or an interrupted transaction requiring recovery.
`stop` stops only MCP, but the application's watchdog may subsequently repair it;
use `odmctl stop` to intentionally stop the whole installation.

## Token handling and private access

```sh
odm-mcpctl token        # private file path only
odm-mcpctl token --show # explicit secret output; private terminal only
ssh -L 3006:127.0.0.1:3006 user@your-server
```

With the tunnel, configure the client for `http://127.0.0.1:3006/mcp` and the token
from the server's `config/mcp.token`. Without a tunnel, use a managed HTTPS endpoint
or trusted private network. Do not expose plain HTTP with a bearer over the public
Internet. Native clients usually omit `Origin`; browser-style origins are denied
unless explicitly allowed by `ODM_MCP_ALLOWED_ORIGINS`.

On Windows the management wrapper is
`%LOCALAPPDATA%\OpenDungeonMaster\mcpctl.cmd`. The user session and Docker Desktop
must be running. Its token is stored under that installation's `config` directory.

## Source checkout, HTTP and stdio

Install dependencies reproducibly using the committed lockfile:

```sh
npm ci --prefix mcp
```

Start the application on the internal target port with a securely supplied
`ODM_MCP_TOKEN`, then start the sidecar with that **same** environment value and
`ODM_MCP_CONTROL_URL=http://127.0.0.1:3005/api/internal/mcp`. Separate terminals do
not inherit one another's environment automatically. Do not create a fresh random
token independently in each terminal.

From the repository root:

```sh
# HTTP on 127.0.0.1:3006/mcp
node --import ./mcp/external-tools-preload.mjs ./mcp/server.mjs

# Local stdio
node --import ./mcp/external-tools-preload.mjs ./mcp/server.mjs --stdio
```

The preload is mandatory: it registers `odm_assets` and `odm_progress`. Do not
replace these commands with a bare `node mcp/server.mjs --stdio`. The managed
container equivalent is:

```sh
docker exec -i CONTAINER node --import /app/external-tools-preload.mjs /app/server.mjs --stdio
```

Use the actual container name/argument array from `odm-mcpctl status`, not the
placeholder above. Tokens belong in the environment/private files, not argv.
Manually managed Docker Compose checkouts use `.env.docker.example` and their own
`.env`; those are separate from the managed install's `config/app.env`.

## Provider requests and cancellation

Model probes share one total application deadline. The sidecar's control timeout
is longer, allowing the application to return its result. SDK cancellation and
HTTP disconnects propagate to provider probes; persistence is deferred until the
probe finishes. `apply:false` preserves active settings. Local/custom endpoints
are intentionally supported, but metadata/link-local destinations, forbidden DNS
answers and endpoint redirects are blocked by the guarded transport.

## Assets, progress and recovery

See [external-assets-mcp.md](external-assets-mcp.md) for the asset worker protocol.
The sidecar stores no independent game state. Media, plots, sheets and progression
remain covered by the application's backup system. Replacing a sidecar does not
reset a campaign. Progress synchronization validates the copied library revision;
conflicts require explicit reconciliation. Finishing with `requireAllSynced:true`
rolls back the whole operation if any selected member cannot synchronize.

Host backup/restore, provider-secret rotation and rollout are operator actions.
After editing a token privately, verify both application and sidecar environments
and perform the coordinated restart/sync; never publish the new secret in an issue.
Do not delete the release journal to bypass a failed rollback.

## Verification limits

The review executed real local HTTP/TCP and controlled-provider regressions,
including a 45-second response, plus operations tests with Docker/restic doubles.
These do not constitute an actual installed SDK initialize/tools/list, real TLS
provider, browser or Docker build test. Run those checks in a complete environment;
see [review-2026-09-16-status.md](review-2026-09-16-status.md) for exact evidence.
