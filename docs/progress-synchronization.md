# Character progression and conflict recovery

## Continuing versus scaling a character

A library character entering a campaign **at the same level** keeps its accumulated XP. A new, unlinked character still starts with 0 XP.

Choosing a **different campaign level** intentionally creates a scaled, campaign-only copy. That copy follows the existing fresh-campaign XP policy (0 XP). Automatic synchronization back to the library is refused, even after a level-up: scaling must not silently lower the library character's level or XP. Reconcile such a copy explicitly before carrying its progression back.

## Concurrent campaigns

Each new linked sheet stores the library revision it was copied from. A database trigger advances that revision when durable library progression changes, including direct library edits. Every campaign-to-library write checks the source baseline inside the same transaction as the write. Changing the old campaign's notes or timestamps does not refresh that baseline.

Successful synchronization advances only the synchronizing sheet's baseline. Other campaign copies report a conflict; no reward, inventory or XP is silently replaced. Audit event revisions and these mandatory library-copy revisions are separate counters.

A pre-upgrade sheet with no trustworthy baseline is not assigned the current revision automatically. Its first synchronization reports a conflict instead of guessing which copy is newer.

## Explicit operator reconciliation

Back up the database first. Run the tool in the application's normal environment, including its database encryption configuration. `SQLITE_DB_PATH` must point to an existing database. Do not run these commands against production merely to test the feature.

Preview both versions without applying progression:

```sh
node --experimental-strip-types scripts/reconcile-progress.mjs --sheet SHEET_ID
```

After inspecting the preview and choosing the campaign copy as authoritative, explicitly authorize replacement of the inspected library version:

```sh
node --experimental-strip-types scripts/reconcile-progress.mjs \
  --sheet SHEET_ID --apply --confirm-overwrite-library \
  --library-revision REVISION_FROM_PREVIEW \
  --sheet-updated-at TIMESTAMP_FROM_PREVIEW
```

This is **an overwrite, not an automatic merge**. To keep the library version or merge individual rewards, reconcile the campaign sheet first instead. A version change after the preview refuses the operation. Baseline adoption and the audited synchronization commit together; a failure does not leave an adopted baseline behind.

## Finishing a party

`finish_and_sync_party` with `requireAllSynced: true` commits all selected members, their audit revisions, and the campaign's ended status in one transaction. One failed or skipped member rolls the entire operation back. The response lists rolled-back sheet IDs separately and reports zero committed synchronizations.

`requireAllSynced: false` explicitly permits partial synchronization and returns each failure/skip. Repeating a successfully completed finish returns its stored receipt without new progression revisions. A legacy campaign already ended before finish receipts existed requires an explicit sync instead of replaying a finish implicitly.
