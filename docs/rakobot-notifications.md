# RakoBot action notifications

Opt-in, same-server integration with `fireostendere/rakobot`. The bot sends the
campaign title, player name, character name and a quoted accepted Do message
to exactly one configured Telegram forum topic. It does not wait for narration,
call an LLM, invoke MCP, or open the encrypted game database.

## Enable

Update and restart both applications. A GitHub push alone does not configure or
deploy either running service. Add, without replacing the existing environment:

```dotenv
# ODM app process (managed install: /opt/odm/config/app.env)
RAKOBOT_FEED_TOKEN=<new_random_secret>
RAKOBOT_CAMPAIGN_IDS=<campaign_uuid[,another_campaign_uuid]>
```

Generate a separate secret with `openssl rand -hex 32`. Do not reuse the bot,
MCP control, narrator, or database encryption credentials. Campaign UUIDs come
from their URLs, not invitation codes; `*` is not accepted. An absent or invalid
configuration disables enqueueing rather than breaking ordinary gameplay.

```dotenv
# RakoBot .env; replace the chat ID with the intended group's real ID
DND_FEED_TOKEN=<same_new_random_secret>
DND_CHAT_ID=-1001234567890
DND_FEED_URL=http://127.0.0.1:3005/api/internal/rakobot/actions
DND_POLL_SECONDS=2
```

After restart, the group administrator sends `/setdndtopic` **inside the chosen
non-General topic**. `/dndstatus` reports state; `/dndoff` disables only D&D.
The server-pinned group and explicit topic prevent another group's administrator
from subscribing. Ordinary `/settopic all` settings never change the D&D target.
Binding starts at the current feed head, without flooding historical messages.
The interval is polling cadence, not an end-to-end delivery guarantee.

For the root Compose deployment, `docker-compose.rakobot.yml` forwards the two
variables into the app container:

```bash
docker compose -f docker-compose.yml -f docker-compose.rakobot.yml up -d --build
```

A managed/container installation must forward these into its actual app process.
A file near the checkout is not sufficient unless that process reads it. On
Linux, RakoBot's optional `docker-compose.dnd.yml` uses host networking to reach
the host loopback; consider its existing LiveKit listener when enabling it.
Block `/api/internal/rakobot/*` at the public reverse proxy and prevent direct
public access to the app's internal port. Existing web/MCP addresses are unchanged.

## Acceptance and privacy

`events.ts::publishWithSeq` queues legacy player messages after saving their
immutable audience and before that same transaction commits. This includes MCP
autopilot publication. Do/OOC classification uses the existing transcript
parser; the quoted stored text itself is not rewritten. The ordinary actions
route now commits the message and event together. `runSpatialCommand` queues
room Do after acceptance inside its transaction, not on a request replay.

Only messages visible to the whole party are exported. Spatial messages require
stored receipts for every current player; DM seats already have role-based access
and do not need a room receipt. Stealth, partial audiences, OOC, DM/system text,
Ask and whispers are not sent. Denied write-time visibility is immutable: a
private action cannot become public merely because the excluded player leaves.
Canonical content, membership, visibility and a content/author fingerprint are
checked again when reading. Deleted or changed messages are skipped. Changes
after a page is read cannot recall an already delivered Telegram notification.

The administrator must ensure that **every reader of the Telegram topic is
allowed to read every allowlisted campaign's public actions**. This integration
does not map Telegram identities to game accounts.

## Feed and persistence

`GET /api/internal/rakobot/actions` requires the dedicated Bearer token and sends
`Cache-Control: private, no-store`. Without query parameters it returns
`{stream,cursor:{id,anchor}}`; with `stream`, `after`, `anchor` it returns at most
25 ordered `{id,anchor,event}` entries. `event:null` advances past a denied or
removed action without sending any text. Malformed/changed cursors fail closed.

`rakobot_action_outbox` stores unique references and hashes, not another plaintext
copy of the transcript. It commits/rolls back with acceptance. Lazy schema setup
is not cached because DDL can roll back too. The stream UUID and per-row anchor
also detect restoration followed by reused integer IDs. Campaign deletion
cascades queue entries; deletion of the current cursor requires explicit rebind.
Automatic pruning within a live campaign is intentionally not enabled because
the bot may be offline with an old cursor.

The bot stores its target, cursor and pending receipt in its persistent DATA_DIR,
serializes changes against sends, and rejects General even on errors. An uncertain
Telegram result pauses automatic retries rather than pretending exactly-once:
`/dndrecover skip` acknowledges a message already present, while `retry` explicitly
allows a repeat. Full bot setup, reconciliation and restart instructions are in
`fireostendere/rakobot` → `DND_NOTIFICATIONS.md`.

## Verification

```bash
node --experimental-vm-modules scripts/test-rakobot-notifications.mjs
```

This suite is automatically included by `scripts/test-all.mjs`. Locally: 34 checks
passed on Node 22, using real SQLite transactions and the real new feed,
projection and event-publisher modules; existing game-domain dependencies use
controlled fixtures. RakoBot separately passed 60 filesystem/async/loopback HTTP
checks with mocked Telegram sends. Full existing npm/pytest suites, production
Next build, Ruff, Docker build and real-server Telegram delivery were not verified
in this environment. No production secrets, server settings or services were
changed as part of these commits.
