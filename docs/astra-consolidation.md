# Astra branch consolidation — 2026-09-19

This is a history-preserving integration branch for the repository owner's review. It is not a production deployment or a declaration that the entire spatial-privacy roadmap is complete. Only `astra` is updated. `main`, `alotfeatures`, the feature branches and the review/localization branches are not moved or deleted by this operation.

## Source inventory

| Branch | Included source tip |
| --- | --- |
| main | `3c91b8e2dc4d5f333e9333a81a77616a361335c8` |
| alotfeatures | `4d8cf71c0386a3437e343e68a7e81ca14ff5fb0e` |
| feat/location-privacy-playwright | `86a12ab7b73f5804de5b3bf1abe6f3dc7b08f680` |
| feat/location-scoped-chat | `38ad780aabe922bf623bee9ed75b38e925ba8e97` |
| codex/i18n-source-merge | `10fbcc9cc2dde6d89df12d44bf2ee61cc51ee394` |
| codex/review-fixes-r01-r26 | `9d78a6b887702a6582c91cd7c38f458026261c55` |
| fix/i18n-en-complete | `4f2c71a470016b6fe070e4aaa667cdad231c88d2` |
| fix/mcp-readiness-p2-2026-09-17 | `ba6400c84080cb3496e49175b62bc3d66e468932` |
| fix/review-2026-09-16 | `b5af0a361975a354ba77ecf37cb157ecc36f1789` |

The initial main tip was `a64b2115e2501277b0555ef5d3976eb1122e26fa`. A concurrent update advanced it during integration. The later tip above is included too. The integration commit has `alotfeatures`, the scoped-chat tip, and this updated main tip as parents. Older branch tips are retained through those parents; there is no squash or history rewrite.

## Conflict resolutions

- Retain the character/backstory editor, global-turn/dice/finale work and the exact main finale implementation in `LegacySessionChatColumn` from the integration base.
- Retain the broader privacy branch's battle-map binding, fact/chapter/domain APIs, legacy projection guards, export handling and timeline-epoch assertions.
- Add the scoped-chat location-notes UI, prepared browser smoke and standalone client-intent/event-view modules. Preserve both sets of independently named tests; the conflicting event-view test is retained as `test-spatial-wire-views.mjs` alongside `test-spatial-event-privacy.mjs`.
- Use one canonical `domain:note` ledger for the note API, generic entity search and exports. The scoped-chat note behavior is integrated into that ledger rather than running two competing note stores. Existing scoped-chat `note` versions and exact receipts are migrated without reconstructing past audiences from current occupants. Original rows remain available for recovery.
- Shared local-note authorship is not a remote subscription. Departed authors cannot expose a new version through an empty PATCH or DELETE. Private journals, pending suggestions and explicit global party publication retain distinct access rules.
- Persist immutable recipient-specific event views and preserve the older `audience_json` records. Freeze payloads and defer notifications until commit. Replay and buffered live delivery recheck current membership and role. Internal raw frames are projected at the authenticated HTTP boundary.
- Narrator memory accepts both historical v2 checkpoint formats and emits v3. It retains audience provenance across compaction, checks the intersection for multi-player audiences, excludes OOC, rejects cross-campaign checkpoints and preserves sequence/epoch recovery. Completed story pages are durably checkpointed individually; a later failure resumes at the first unacknowledged page.
- The CLI remains a context collector unless an operator explicitly supplies an Ask adapter. It does not fabricate model answers or usage. Ambiguous adapter-write retries preserve the exact command UUID and payload.
- Keep the privacy branch's identity-bound `LocationIntentSession` hook. Accept both `X-ODM-Actor` and `X-ODM-Expected-User` assertions conjunctively. WebMCP accepts `requestId` and the legacy `intentId` alias, rejects conflicting IDs and preserves lifecycle/per-call cancellation. Its registration status is observable.
- Include the newer main MCP compact-policy/serialization options, delta reads, filtered/summary catalogs and narration with floor release. The catalog uses name+label, not the nonexistent intent field. Keep the spatial room and timeline guards while adding these options. An incomplete delta-change window falls back to full static sections rather than claiming they were unchanged.

## Validation actually executed

Environment: Node 22.16.0, built-in SQLite and VM modules, partial source workspace. The following six files produced **43 tests passed, 0 failed, 0 skipped**:

```sh
node --experimental-vm-modules --test \
  scripts/test-narrator-memory-privacy.mjs \
  scripts/test-narrator-reader-recovery.mjs \
  scripts/test-spatial-event-wiring.mjs \
  scripts/test-astra-web-tools-merge.mjs \
  scripts/test-location-client-boundary.mjs \
  scripts/test-narrator-compaction.mjs
```

These execute merged source modules, real in-memory SQL transactions and narrow transport/session/campaign/schema/embedding doubles. They are not full application authentication or browser tests. Additional JS syntax checks and TS/TSX transpilation examined 34 local source/test files with zero syntax errors. Transpilation is not a TypeScript typecheck.

Not executed: the repository-wide `npm test`, full `tsc --noEmit`, ESLint, production build, browser E2E, production-data migration or live model gameplay. The newest main MCP functionality was reconciled and syntax-checked; its full existing application integration suite is retained but was not run in this partial workspace. Older source-specific test harnesses may need further adaptation to the merged dependency graph. Do not treat this targeted pass as a green full repository suite.

## Review and release status

The owner requested the combined branch and will perform the final merge. Do not delete source refs or deploy from this document. Before release, run the full application suite and build, then the independent-session privacy fixture and a real external-narrator round trip. Existing independent-encounter/media/full-browser acceptance gaps are not closed merely by merging their branches. Consult the source milestone documents as historical records and this document for the integration validation scope.
