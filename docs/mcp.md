# MCP control plane

Open Dungeon Master can expose the game to an MCP-capable model without giving that model shell, Docker, or direct SQLite access. The MCP server is a separate unprivileged process that calls a token-protected internal application route, so the existing ODM domain code remains the only writer of campaign state.

## Architecture

```text
MCP client / agent
       |
       | Streamable HTTP + Bearer token
       |   or local stdio
       v
+----------------------+       private Docker network       +-----------------------+
| ODM MCP sidecar      | ---------------------------------> | Open Dungeon Master   |
| :3006 /mcp           |    POST /api/internal/mcp          | :3005                 |
| no DB / no socket    |    same random bearer token        | domain services + DB  |
+----------------------+                                     +-----------------------+
                                                                    |
                                                                    v
                                                             encrypted SQLite +
                                                             uploads/generated art
```

The public application never exposes `/api/internal/*`: the managed Caddy configuration returns 404 for that path. Only the MCP sidecar reaches it over the private Docker network. The MCP endpoint itself requires `Authorization: Bearer <token>`.

The MCP process has no Docker socket mount, no game volume, no database file, no host shell, `CAP_DROP=ALL`, `no-new-privileges`, and a read-only root filesystem. Host lifecycle operations such as backup/restore and application upgrades stay in `odmctl`; they are deliberately not model-callable MCP tools.

## What the model can do

The public MCP surface is deliberately compact and verified: eleven tools cover the control actions, model switching, asset pipeline, and progression sync so an agent does not have to load dozens of nearly identical tool definitions.

| MCP tool | Main operations |
| --- | --- |
| `odm_server` | server health, capabilities |
| `odm_users` | list ODM users / resolve UUIDs |
| `odm_campaigns` | list/get/create/update/delete campaigns and workshops, status, invite rotation |
| `odm_campaign_settings` | game rules, AI/text/image providers, DM mode |
| `odm_story` | scene, quest log, secret outline, structured story arc, events, notices |
| `odm_members` | roster, add an existing user, transfer party lead |
| `odm_characters` | library characters, create/update/delete, instantiate into a campaign |
| `odm_sheets` | live campaign sheets, including HP, conditions, XP, inventory and DM-managed fields |
| `odm_models` | inspect/list text models, test & connect with tool probe, switch between local runtime and remote servers |
| `odm_assets` | external asset pipeline: campaign art planning, packs, jobs, leases, upload/download grants, variants and links |
| `odm_progress` | character and party progression sync, versioned sync to library, finish and sync policy |

Two MCP resources are also available: `odm://server/status` and `odm://server/capabilities`.

### Party entity model

In Open Dungeon Master, the **party** is not a separate database entity or table. A campaign's party is represented directly by its active campaign members (`campaign_members`) and their attached live character sheets (`character_sheets`, plus any AI companions). All party-oriented operations (such as `sync_party` and `finish_and_sync_party` in `odm_progress`, and member roster management in `odm_members`) operate directly on this campaign roster.

Campaign and character deletion require `confirm=true`. Stored text/image provider keys can be written through settings, but reads return only `has...ApiKey` flags; the secret value is never sent back to an MCP client.

## Managed Linux server

The normal server installer installs MCP automatically:

```bash
sudo bash install-server.sh \
  --repo fireostendere/dungeon_master \
  --branch main \
  --domain dnd.example.com \
  --runtime none
```

During installation it:

1. installs and starts ODM normally;
2. generates a 256-bit MCP bearer token in `/opt/odm/config/mcp.token`;
3. adds the same token to the private ODM application environment;
4. builds an MCP image from the **same active commit** as the game;
5. runs the hardened MCP sidecar on the ODM Docker network;
6. publishes only loopback `127.0.0.1:3006` directly;
7. when a managed HTTPS domain exists, exposes `https://dnd.example.com/mcp` through Caddy;
8. installs a 15-minute synchronization timer so an ODM update also rolls MCP forward to that active release.

Inspect it with:

```bash
odm-mcpctl status
```

The command reports the endpoint, running state, active/expected release, token file, and a local stdio command. `odm-mcpctl sync` is idempotent and repairs a stopped/stale sidecar. `odm-mcpctl stop` stops only MCP, not the game.

With no public domain, keep the HTTP listener on loopback and use an SSH tunnel from the client machine:

```bash
ssh -L 3006:127.0.0.1:3006 user@your-server
```

Then point the MCP client at `http://127.0.0.1:3006/mcp` and use the token from the server's `config/mcp.token` as its bearer credential.

## Managed Windows/local install

`install-local.ps1` installs exactly the same sidecar into Docker Desktop. It creates:

- `%LOCALAPPDATA%\OpenDungeonMaster\mcpctl.cmd`;
- `%LOCALAPPDATA%\OpenDungeonMaster\config\mcp.token`;
- local MCP endpoint `http://127.0.0.1:3006/mcp`;
- a Scheduled Task that synchronizes MCP with the active ODM release every 15 minutes.

Status:

```powershell
& "$env:LOCALAPPDATA\OpenDungeonMaster\mcpctl.cmd" status
```

Local availability naturally depends on Windows and Docker Desktop being awake. The Linux installation remains the intended unattended 24/7 deployment.

## Docker Compose from a checkout

For a development or manually managed checkout, copy `.env.docker.example` to `.env`, generate a token, and build both services from the checkout:

```bash
cp .env.docker.example .env
printf 'ODM_MCP_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env
docker compose up -d --build
```

The application is on the configured ODM port (default 3005). MCP is loopback-only on `http://127.0.0.1:3006/mcp`.

Do not publish `3006` directly to the Internet. Terminate TLS in a reverse proxy and forward only `/mcp`, or use a private overlay network/SSH tunnel.

## Native development and stdio

The sidecar can also run outside Docker. Start ODM with a shared token:

```bash
export ODM_MCP_TOKEN="$(openssl rand -hex 32)"
npm run dev
```

In another terminal:

```bash
cd mcp
npm install
ODM_MCP_TOKEN="$ODM_MCP_TOKEN" \
ODM_MCP_CONTROL_URL=http://127.0.0.1:3005/api/internal/mcp \
npm run stdio
```

For HTTP instead, run `npm start`. Defaults are `127.0.0.1:3006` and `/mcp`. In a container `ODM_MCP_HOST=0.0.0.0` is set explicitly.

The managed Docker status output also includes a `docker exec -i ... --stdio` command for clients that require a local command transport instead of HTTP.

## Client configuration

Use one of these connection forms:

**Remote HTTP**

- URL: `https://your-dnd-domain.example/mcp`
- transport: Streamable HTTP
- header: `Authorization: Bearer <contents of config/mcp.token>`

**Local HTTP**

- URL: `http://127.0.0.1:3006/mcp`
- same bearer header

**stdio**

- command/arguments reported by `odm-mcpctl status`, or run `node mcp/server.mjs --stdio` with `ODM_MCP_TOKEN` and `ODM_MCP_CONTROL_URL` in the process environment.

If an MCP client sends a browser-style `Origin` header, it is denied by default. Add exact origins to the comma-separated `ODM_MCP_ALLOWED_ORIGINS` only when that browser client genuinely needs them. Native MCP clients normally send no Origin header.

## Example agent requests

Once connected, a model can be asked directly:

- "Create a four-player high-fantasy campaign called Ashes of Vhalor, level 3, AI DM, hard difficulty."
- "Switch this campaign to my OpenAI-compatible model at `http://.../v1`, enable automatic landscape art, and keep the utility model separate."
- "Show all players and their live sheets, then give the wounded cleric 8 HP and add the Poisoned condition to the rogue."
- "Set the next scene to the ruined observatory and replace the quest log with these three objectives."
- "Create a level-5 dwarf artificer in my character library and instantiate it into this campaign."
- "Read campaign events after sequence 420 and tell me what changed."

Creating a *new* ODM login account is intentionally not exposed. MCP can list existing users and add them to campaigns; account creation and credential recovery remain authenticated user/admin flows in the application.

## Token rotation

Edit `ODM_MCP_TOKEN` in the managed `config/app.env` to a new random value and run:

```bash
odm-mcpctl sync
```

`mcpctl` synchronizes `config/mcp.token`, recreates the MCP container when the token fingerprint changes, and recreates the application container when its environment changed. Existing game data is untouched.

## Backups and upgrades

MCP introduces no new game-state store. Campaigns, characters, plots, generated art and other durable state remain in the same ODM database/state directories already covered by the existing restic backup and rollback system. Replacing the MCP image or changing its model client does not migrate or reset a campaign.

The MCP sidecar is version-coupled to the active ODM commit. Managed installations periodically compare the sidecar release label with `active.json`; after `odmctl update` changes the active release, the synchronizer builds/starts the matching MCP image.
