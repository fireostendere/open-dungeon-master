# Compact orchestration snapshot

The external narrator MCP exposes a read-only `snapshot` operation for a trusted
orchestration host. It is intentionally model-neutral: the D&D server does not
know about Qwen, Luna, Sol, reasoning effort, or provider routing.

The purpose is to avoid a chain of separate state reads before every turn. One
request can batch the compact sections needed to decide which detailed worker or
model should run next.

## MCP request

Use the existing `odm_narrator` tool:

```json
{
  "operation": "snapshot",
  "campaignId": "<uuid>",
  "sections": ["party", "combat", "location", "recent", "memory", "npcs"],
  "recentLimit": 8,
  "maxBytes": 8192
}
```

The operation uses the same campaign-bound narrator credential and the same
human-DM safety preconditions as `narrator.read`. It performs no write, model
call, dice roll, retrieval query, or provider request.

The result is `odm.orchestration.v1` and contains:

- a compact campaign/floor/clock projection;
- party identities and mechanical summaries, without private sheet notes;
- compact active-combat summaries;
- current legacy location/scene state;
- bounded recent public in-character messages, rolls and event *types*;
- bounded campaign summary, trusted-DM campaign facts, public notes and NPC summaries;
- pending-roll summaries and only boolean/count signals for private asks/whispers;
- coarse available action families;
- `timelineEpoch`, `currentSeq` and a content-addressed `revision`.

Secret story spine fields, provider credentials, raw event payloads, sheet notes and
private Ask/whisper text are deliberately absent. The snapshot is still a trusted
DM-private projection: room/stealth inputs and campaign facts may be present and
must never be forwarded directly to a player. Authoritative game mechanics
remain in their existing engines; the snapshot is routing context, not a second
rules engine.

## Delta polling

Pass the previous revision as `knownRevision`:

```json
{
  "operation": "snapshot",
  "campaignId": "<uuid>",
  "knownRevision": "<64-hex revision>"
}
```

If the selected compact state is unchanged, the server returns only the format,
campaign/timeline identifiers, sequence, revision and `unchanged: true`.
This lets an always-on local router poll without repeatedly moving the same
context.

## Section batching

`sections` is a batch selector. Requesting only `["combat", "recent"]` skips
the party/memory/NPC/location database reads entirely. The default includes all
six compact sections. Use the existing `narrator.read`/catalog/actions only
after the router decides that a detailed worker actually needs them.

`maxBytes` defaults to 8192. Optional detail is dropped in a deterministic
order when needed; the response reports dropped paths in `omitted`. If the
required compact state still cannot fit, the call fails instead of silently
truncating authoritative values.

## Boundary

This API must stay read-only. Do not add model selection, effort selection,
RAG decisions or game adjudication here. Those belong to the external
orchestrator; dice, combat, HP, inventory, visibility and persistence continue
to belong to ODM.
