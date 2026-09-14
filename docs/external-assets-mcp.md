# External art pipeline over MCP

Open Dungeon Master supports image generation in two independent ways:

1. the existing in-app image providers can still render images on the ODM host;
2. an external AI agent can act as the image worker through MCP and return finished files to ODM.

The second mode is provider-neutral. The generator does **not** have to run on the ODM machine. Qwen Image, another cloud model, a local ComfyUI host, or any other client that can save PNG/JPEG/WebP can use the same protocol.

## Architecture

The MCP sidecar remains a control surface. It does not receive large image bodies and it never receives a Docker socket, arbitrary filesystem access, a shell, or arbitrary SQL.

The external flow is:

```text
ODM database/state
  -> /mcp
  -> external AI agent
  -> any image generator
  -> scoped binary HTTP upload
  -> ODM validation/storage/indexing/linking
```

Large binaries are uploaded directly to the application endpoint returned by `odm_assets.create_upload`. The normal MCP bearer token is never placed in an upload URL or asset metadata. Each upload/download grant receives a separate random, short-lived, one-time bearer capability whose hash is the only token material stored in SQLite.

## Persistent model

All records use the existing encrypted ODM SQLite database.

- `asset_packs`: campaign bootstrap packs, chapter/NPC/location packs and custom packs.
- `asset_jobs`: provider-neutral generation briefs, target entity, references, priority, status and claim lease.
- `asset_files`: actual accepted variants with MIME, size, SHA-256, dimensions and generation metadata.
- `asset_links`: polymorphic links from an asset to campaign/character/NPC/scene/location/map/chapter/item/etc.
- `asset_access_grants`: hashed, scoped upload/download capabilities.

Default filesystem storage is under:

```text
data/media/campaigns/<campaign-id>/<pack-id>/<asset-id>/<asset-id>.<ext>
```

`ODM_MEDIA_ROOT` can override the root. The filesystem backend sits behind a small storage interface so a future S3/MinIO/R2 backend does not require changing MCP or the asset domain.

`data/media` is inside the normal backed-up `data` tree and the managed Linux deployment binds `/app/data` to persistent state. Production assets therefore do not live in an ephemeral container layer.

## Art kinds

The protocol currently accepts:

`campaign_cover`, `party_group`, `character_portrait`, `npc_portrait`, `character_fullbody`, `npc_fullbody`, `location_art`, `scene_art`, `world_map`, `regional_map`, `dungeon_map`, `battlemap`, `item_art`, `item_card`, `handout`, `token`, `chapter_cover`, `session_recap`, `generic`.

Map/battlemap-specific values such as `gridType`, `gridColumns`, `gridRows`, `pixelsPerCell`, `feetPerCell`, `orientation` and `notes` are ordinary extensible job/asset metadata.

## MCP connection

### Remote HTTPS

Connect the MCP client to:

```text
https://your-domain.example/mcp
```

Authenticate with the existing MCP bearer token. The managed Caddy configuration rejects `/api/internal/*`, but proxies public application routes, including the scoped `/api/assets/ingest/...` and `/api/assets/download/...` endpoints.

### Local HTTP

The sidecar normally listens on loopback:

```text
http://127.0.0.1:3006/mcp
```

### Local stdio

From the repository MCP package:

```bash
cd mcp
npm install
npm run stdio
```

Set `ODM_MCP_TOKEN` and `ODM_MCP_CONTROL_URL` so the stdio process can call the application control plane.

## `odm_assets` operations

One compact MCP tool exposes the asset workflow:

- `plan_campaign`
- `create_pack`
- `get_pack`
- `list_packs`
- `list_jobs`
- `get_job`
- `claim_job`
- `release_job`
- `fail_job`
- `create_upload`
- `submit_result`
- `list_assets`
- `get_asset`
- `attach`
- `detach`
- `set_primary`
- `delete_asset`
- `delete_pack`
- `create_download`
- `health`

`server.capabilities` reports protocol version, MIME types, maximum upload size, supported art kinds, binary-upload support, variants, claims and reference downloads.

### Deterministic campaign planning

`plan_campaign` does not require an LLM. It examines current ODM campaign state and builds/reuses a `campaign_bootstrap` pack from known data such as:

- campaign cover and current scene;
- player characters and companions;
- NPCs;
- locations;
- chapters;
- prepared tactical maps and overworld map;
- quest log;
- already-linked assets.

Every planner brief has a stable dedupe key. Re-running planning updates/reuses the same jobs instead of creating an unbounded duplicate backlog.

## Complete provider-neutral workflow

Conceptual MCP calls below use field names shown by the MCP tool schema; the concrete SDK is irrelevant.

### 1. Plan the missing art

```json
{
  "operation": "plan_campaign",
  "campaign_id": "CAMPAIGN_ID"
}
```

Inspect `pack.jobs` or call `list_jobs` with `status: "available"`.

### 2. Claim one job

```json
{
  "operation": "claim_job",
  "job_id": "JOB_ID",
  "worker_id": "my-qwen-agent",
  "lease_seconds": 900
}
```

The claim is an atomic SQLite update. A second worker cannot successfully claim the same active job. Expired leases become available again.

### 3. Generate outside ODM

Call Qwen Image, ComfyUI, OpenAI-compatible image generation or any other provider using the returned brief, `suggestedPrompt`, target context and references. ODM does not need the provider API key.

For visual continuity, a job can contain `referenceAssetIds`. For an asset reference, ask ODM for `create_download`; the response contains a short-lived one-time URL and a separate bearer token.

### 4. Request a binary upload grant

```json
{
  "operation": "create_upload",
  "job_id": "JOB_ID",
  "worker_id": "my-qwen-agent",
  "expected_mime_type": "image/png",
  "expected_max_bytes": 16777216
}
```

Example response shape:

```json
{
  "uploadId": "...",
  "uploadUrl": "https://your-domain.example/api/assets/ingest/...",
  "expiresAt": "...",
  "maxBytes": 16777216,
  "acceptedMimeTypes": ["image/png", "image/jpeg", "image/webp"],
  "authorization": {
    "scheme": "Bearer",
    "token": "ONE_TIME_SCOPED_TOKEN"
  },
  "method": "PUT"
}
```

### 5. Upload the bytes

Generic HTTP example:

```bash
curl --fail-with-body \
  -X PUT \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary @villain.png \
  "$UPLOAD_URL"
```

ODM does not trust the client filename or `Content-Type`. The server checks the scoped size, sniffs the actual format, validates structure, extracts dimensions, hashes the bytes and atomically stages the accepted image under the persistent media root.

### 6. Submit the generation metadata

```json
{
  "operation": "submit_result",
  "job_id": "JOB_ID",
  "upload_id": "UPLOAD_ID",
  "worker_id": "my-qwen-agent",
  "provider": "qwen",
  "model": "YOUR_EXACT_MODEL_ID",
  "prompt_used": "...",
  "revised_prompt": "...",
  "seed": "12345",
  "variant_label": "A",
  "set_primary": true,
  "metadata": {
    "generatorRun": "external-2026-09-14"
  }
}
```

The staged object is atomically moved into its canonical asset path, generation metadata is persisted, the target entity is linked and the job becomes `ready`.

## Variants

A job can keep multiple variants. Request another upload grant while the worker still owns a valid claim, upload another image and call `submit_result` again with a different `variant_label`.

`set_primary` selects the preferred variant without deleting alternatives. Identical bytes for the same job are deduplicated by SHA-256.

## Character progression over MCP

The progression tool is built on the existing `syncProgressToLibrary` domain logic rather than a second character state.

`odm_progress` operations:

- `sync_character`: `sheet_id`, or `campaign_id` plus `user_id`/`username`; optional `expected_version`.
- `sync_party`: campaign-wide sync with `include_companions` and `skip_unlinked`.
- `finish_and_sync_party`: requires `confirm: true`; optional `require_all_synced` defaults to true.
- `status`
- `events`

`finish_and_sync_party` synchronizes first. With `require_all_synced=true`, failed or skipped selected party members block the `ended` transition and a persisted audit event records the reason. Individual party failures are returned independently instead of erasing successful results.

The reusable library copy receives durable progression. Current HP, temporary HP, conditions, death saves, exhaustion, spent spell slots and spent hit dice remain campaign/runtime state; reusable spell slots and hit dice are reset for a future campaign.

### Party representation note

Open Dungeon Master has no standalone `Party` database table or entity. The party is represented directly by the active campaign participants (`campaign_members`) and their assigned character sheets (`character_sheets`, plus any AI companions). All party operations (`sync_party`, `finish_and_sync_party`, party art packs) iterate directly over these campaign members and their sheets.

## Upload security model

- normal MCP bearer token is never an upload/download URL parameter;
- grant tokens are random and only SHA-256 hashes are stored;
- upload/download grants are scoped to one operation and one job/asset;
- expiry is bounded;
- upload grants are one-time and atomically consumed;
- job claim leases bind result submission to the worker that owns the job;
- server-enforced maximum byte count;
- PNG/JPEG/WebP allowlist;
- actual binary sniffing rather than trusting `Content-Type`;
- PNG chunk CRC validation, JPEG structural markers and WebP container/dimension validation;
- width/height safety limits;
- generated storage keys only; no client-controlled filesystem paths;
- path traversal is rejected by the storage backend;
- temporary write plus atomic rename;
- no URL-import feature, therefore no server-side arbitrary fetch/SSRF surface;
- no Docker socket, shell or arbitrary SQL is exposed to MCP.

## Backup and restore

The regular backup already archives the entire `data` tree, therefore default asset files under `data/media` travel with the encrypted SQLite database.

The restore verification script also inspects `asset_files` when the table exists. A restore fails verification if a non-deleted asset row points to a missing or escaping media path.

`odm_assets.health` and `scripts/odm-doctor.mjs` report missing asset files, broken asset links and stale upload state.

## Troubleshooting

### `Upload grant has expired`

Request a new `create_upload` grant. Do not reuse the old token.

### `Upload grant has already been used`

Grants are intentionally one-time. Request another grant for a second attempt or variant.

### Invalid MIME / corrupted image

Re-encode the file as a real PNG, JPEG or WebP. Renaming an extension or lying in `Content-Type` does not bypass validation.

### Asset too large

Use the `maxBytes` value returned by `create_upload`; it cannot exceed the server's `ODM_ASSET_MAX_BYTES` ceiling.

### Job already claimed

Another worker owns the active lease. Wait for explicit release/expiry or process a different `available` job.

### Claim expired

Claim the job again. A result cannot be submitted with an expired worker lease.

### Duplicate file

For the same job, identical bytes are recognized by SHA-256 and the existing asset is returned instead of creating another variant.

### Reference unavailable

The asset may have been deleted or its file is missing. Run `odm_assets.health`; request a fresh download grant after repairing/restoring the asset.

### After restore

Run the normal restore check and `odm_assets.health`. Missing media makes restore verification fail instead of silently accepting an inconsistent campaign.
