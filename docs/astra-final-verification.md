# Astra final integration verification

Date: 2026-09-19. Integration merge: `a03b7fe03e55d02e156c38bda8c31792a9e0403c`.

## Commit-history preservation

GitHub compare checks were executed with the integration merge as base and each of the nine source tips recorded in [astra-consolidation.md](astra-consolidation.md) as head. Every result returned `status: behind`, `ahead_by: 0`, and the source tip as `merge_base_commit`. Thus all commits reachable from the inventoried branch tips are ancestors of the integration merge, including the concurrent main update at `3c91b8e2dc4d5f333e9333a81a77616a361335c8`. The integration did not squash or rewrite source commits.

## Compatibility follow-up

A final regression covers old `audience_json` events. Their original metadata/presence redactions are applied before the new wire-view filter, so preserved audience membership cannot expose a hidden scene/floor or removed-member IDs. Blind-roll totals remain redacted. The follow-up changes only this compatibility projection and adds its test; it does not move other branch refs.

## Final targeted test run

The seven files below ran together on Node 22.16.0 with built-in SQLite/VM modules: **44 passed, 0 failed, 0 skipped**.

```sh
node --experimental-vm-modules --test \
  scripts/test-narrator-memory-privacy.mjs \
  scripts/test-narrator-reader-recovery.mjs \
  scripts/test-spatial-event-wiring.mjs \
  scripts/test-astra-web-tools-merge.mjs \
  scripts/test-location-client-boundary.mjs \
  scripts/test-narrator-compaction.mjs \
  scripts/test-astra-event-compat.mjs
```

This supersedes the earlier 43-test count, not the validation limitations. The partial workspace uses narrow session/campaign/schema/transport doubles. Full repository tests, typecheck, lint, production build, real browsers, deployed migrations and live model play were not run. Original integration and release caveats remain in [astra-consolidation.md](astra-consolidation.md).
