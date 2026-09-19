# R04 domain revision milestone

Base: dbb4a4464a7ac1ca94b13d4836db222d811ad664. Branch: feat/location-privacy-playwright.

The existing spatial object ledger now stores versioned note/fact/chapter envelopes. Canonical SQL mutations and envelope publication run in one transaction. A viewer reads their witnessed version, not a filtered current canonical row. Room re-entry observes the current version only. Remote deletion preserves remembered content until the deletion is observed. Searches and ordering use projected versions. A stale direct-ID edit is rejected without returning newer text. Personal private notes remain hidden from other players and the DM.

The original notes, facts, chapters and snapshot SQL implementations are retained byte-for-byte in *-store.ts files. Public facades capture revisions and project reads. New entity HTTP routes provide version-aware read/search and deliberate DM publication. Existing note/fact mutation routes keep their original validation and permissions, adding the observed-version guard and optional explicit publication scope. The story exporter now requires a viewer for spatial campaigns and exports authorized room transcripts and published chapter versions.

Enabling spatial mode captures an immutable baseline under the original visibility rules, in the same transaction, once. An already-enabled campaign's unversioned rows are not granted globally merely because their creation/source sequence is old: newer text may have been edited onto them. The operator can explicitly publish these rows. Rewind restores canonical edited/deleted notes and chapters from the restored version ledger.

Executed: 19 tests, 19 passed, zero failures/skips, Node 22.16.0. Suites: test-spatial-domain-store.mjs, test-spatial-domain-notes.mjs, test-spatial-legacy-projection.mjs. They run real SQLite, the actual new ledger/facades/projectors/restore code, and the exact original notes SQL blob (SHA checked). Authorization/campaign/sheet/embedding services are fixture adapters. These are not full Next.js/browser acceptance. The route wiring guard is updated but has not yet been executed in a complete checkout.

This is an implementation checkpoint, not whole-feature acceptance. R04 still needs the narrator command/UI integration and broader domain-path acceptance; R05 independent encounters and R07 model-driven runtime are not implemented by this commit. R02/R03's earlier fail-closed guards alone did not close those requirements. Main and production are unchanged.
