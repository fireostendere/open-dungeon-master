# bugfix2: review fixes and validation

Base: `a4f3149843569a3dfc2a22aceff5ec984ce0eeac` (remote main observed at branch creation).
The remote main did not yet contain the earlier `astra-bugfix` commit; its spatial changes were ported explicitly without dropping main's new RakoBot action feed. No main ref or live campaign was modified.

## Coverage

| Issue | Implementation included in bugfix2 |
| --- | --- |
| #32 | Message, quota, receipt, room floor and RakoBot feed entry share the first-apply transaction. Replays do not execute callbacks or wakeups. |
| #33 | Player character ID is resolved and checked server-side before any spatial mutation. |
| #34 | Autopilot-style sends omitting both position assertions resolve room and revision inside the transaction. Partial/stale explicit assertions remain conflicts. Existing MCP opt-in guards are preserved. |
| #35 | Room-scoped hold/spotlight/initiative and pending-roll checks; combat response holds the floor until narration. |
| #36 | Per-observer hidden-occupant filtering, without changing publication-time room-message audiences. |
| #37 | Main already supplied deletion event payloads, queue/history removal and a pause after committed effects. This branch additionally applies memory revisions after overlapping rows, persists deletion tombstones, rejects stale same-epoch reads and redacts compacted/legacy summaries. |
| #38 | Both death-save counters reset on stabilization; old stable states normalize before receiving new damage. |
| #39 | Concentration conditions track caster kind, caster ID and application ID inside existing audited JSON. Shared targets retain other sources; duration/save expiry is per source. PC/enemy casts, manual sourced conditions and Polymorph cleanup use ownership. |
| #40 | Full incoming damage produces one concentration save across surviving/exhausted Wild Shape and successful Relentless Endurance; beast CON is retained for the hit that breaks the form. |
| #41 | Massive damage is checked before ordinary failures when already at 0 HP. |
| #42 | Relentless Endurance does not bypass instant death. |

## Executed checks

```sh
node scripts/test-bugfix2-spatial.mjs
node scripts/test-bugfix2-combat.mjs
node scripts/test-bugfix2-narrator.mjs
```

- Spatial: **15 groups passed**. Real SQLite/store/service; campaign, round, auth, schema parsing and feed dependencies are controlled fixtures.
- Combat: **26 groups passed**. Actual mutation, casting, death, concentration, source-expiry and enemy-damage modules; persistence, content, dice, derived stats and argument parser are fixtures.
- Narrator: **19 groups passed**. Actual memory class and production ingestion/checkpoint method bodies; no model or MCP writes. The disconnected review run used a fetched method excerpt through `ODM_ORCHESTRATION_SOURCE`; normal repository execution reads `narrator/orchestration.mjs` directly.
- The overlapping-row deletion test fails on unchanged main memory and passes after the fix (red/green reproduced).
- TypeScript transpilation syntax checks and JavaScript syntax checks passed. These are **not** a complete semantic TypeScript check.
- The existing `scripts/test-all.mjs` discovers all three new `test-*.mjs` suites automatically.

## Deployment and compatibility notes

- **No full application build, whole-repository test run, browser/multi-device E2E, live-server smoke test or LLM party session was executed in this environment.** These remain release checks before merging/deploying.
- Do not reset live campaigns to apply this branch. New concentration provenance stays in optional fields of existing sheet/enemy JSON; old rows still parse.
- Existing active concentration effects without recorded ownership cannot be safely attributed retrospectively. They are preserved, not mass-deleted by name. The DM should explicitly clear/recast those legacy effects; manual/homebrew sourced conditions can pass both `casterId` and `spell`.
- If a deletion affects a legacy untraceable free-text summary, that summary is conservatively invalidated instead of retaining potentially withdrawn text. Attributed unrelated records remain.
- Deleting an input after mechanics committed or while a write is ambiguous retains main's `input_changed_after_effects` pause for operator reconciliation. It does not roll back HP/resources or blindly repeat a write. Do not treat an unconditional resume as reconciliation.
- Tombstones reset on a real timeline-epoch change and survive normal checkpoint restore. Their ledger is bounded by `maxSeenMessages`; overflow fails closed instead of silently forgetting a deletion.
- Issues remain open pending merge/release validation; branch implementation is not a claim that production is already fixed.
