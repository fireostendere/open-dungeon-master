# R01–R26 implementation inventory and verification

Repository: `fireostendere/dungeon_master`. Review branch: `fix/review-2026-09-16`;
PR #10 targets `main`. Last implementation revision in this continuation:
`298db3b15cc90eaf3d231c320b9a9911ee382851`. The following commit changes documentation
only. The PR merge result, not this pre-merge file, is the authority on merge state.

The requested code corrections are represented on this branch, including the
previously unfinished local portal launcher and core RU/PL service text. This is
**not a claim that every original acceptance criterion or a production release has
passed**. Merge was explicitly requested separately from deployment. No production
access, deployment command or production database write was performed by this work.

## Executed evidence

Previous verified revision `e41b72229205f61fad0649feebbb0f59beb9ca00`:
124 tests in the combined review run plus one separately completed real 45-second
HTTP probe. Those 125 distinct tests cover turn/journal behavior, tool-ID handling,
per-tool rollback, localized game notices, UI handlers, applied model runtime,
network pinning, HTTP boundaries and probe cancellation. Explicit test doubles were
used for selected dependencies; the HTTP and temporary SQLite paths were real.

Current implementation revision `298db3b15cc90eaf3d231c320b9a9911ee382851`:

| Run | Passed | Actual scope |
| --- | ---: | --- |
| test-review-portal-launch.mjs | 9 | Private files, trusted pins, real child process with a CLI fixture; not Next |
| test-review-session-ui.mjs | 22 | Actual message/audit/retry components and event handlers via hooks/JSX adapter |
| test-review-ui.mjs | 17 | Earlier UI handler suite rerun against the changed audit import |
| test-review-ops.py | 36 | Actual controllers, real files/Git/process locks; Docker/restic doubles |

The three Node files also passed together: **48/48**, zero failures/cancellations/
skips. Python passed **36/36**, zero failures/errors/skips. The 17 rerun UI tests
were already in the earlier 125 and are **not counted twice**. Therefore the
cumulative distinct verified count is **192 = 125 + 9 + 22 + 36**, across the
identified revisions, not a single 192-test full-project run.

A current strict check passed for four actual i18n modules using an explicit Locale
type contract. Five selected TSX files transpiled without syntax errors; that is
not semantic React/Next checking. Python compile and Linux bootstrap syntax checks
passed. The earlier five-module strict runtime check likewise was not a complete
application TypeScript check.

Current environment: Node 22.16.0, TypeScript 5.8.3, Python 3.11.8. Only selected
source files are installed. npm/network access and Docker are unavailable. Actions
runs for the launcher revision reported failure without runnable step/log evidence;
no successful full CI result is claimed and no CI requirements were disabled.

## Finding inventory

| ID | Supplied correction | Verified scope / limitation |
| --- | --- | --- |
| R01 | Default-off server trust plus loopback-only local launcher supplying origin/token pins | Nine launcher tests, actual child. Native packaging/Next rewrite unexecuted. |
| R02 | Complete tool dispatch and unique guarded call IDs, final-call refusal | Turn harness/ID regressions; actual live provider/game-handler combinations not exhaustive. |
| R03 | Initiative owns the floor, including hold-wrapped initiative | Turn harness guards verified. Full browser/combat acceptance unexecuted. |
| R04 | Captured input watermark rather than last response timestamp | Concurrent incoming action gets one follow-up prompt in harness. |
| R05 | Same-level XP preserved; intentional scaled copies distinguished | Earlier implementation/tests retained; full live round trip not rerun here. |
| R06 | Library baseline revision/CAS and explicit reconciliation | Earlier implementation retained; no production reconciliation performed. |
| R07 | Transactional finish policy and durable repeat receipts | Earlier implementation retained; full installed party scenario not rerun here. |
| R08 | Durable reply/tool/finalization journal and media intents; refused-tool SQL/cache/notification rollback | Failure/replay and sibling isolation verified in SQLite harness. External effects are not magically transactional. |
| R09 | Keep uploaded staging copy until successful DB persistence | Earlier art-preservation implementation retained. Full upload browser acceptance unexecuted. |
| R10 | One pure Caddy renderer, directory bind, validated activation | Actual controller tested with fake Docker; real HTTPS lifecycle unexecuted. |
| R11 | Entire HTTP request boundary catches malformed target/Host and async failures | Real local HTTP/TCP tests passed. Installed SDK transport unexecuted. |
| R12 | Mandatory preload in reported/documented stdio commands | CLI array verified; actual installed initialize/tools/list unexecuted. |
| R13 | Probe-only apply:false does not switch campaign | Prior control-policy correction retained; full control route acceptance unexecuted. |
| R14 | Shared probe deadline and cancellation; defer profile writes | Cancellation tests and 45-second HTTP stage passed, not SDK → Next E2E. |
| R15 | Publish sheet/member domain events consumed by web state | Prior correction retained; open-browser no-reload scenario unexecuted. |
| R16 | Explicit per-campaign runtime snapshots used by request/context budgets | SQLite/profile/transport tests passed. Token estimate is heuristic, not provider-tokenizer proof. |
| R17 | Family-specific IPv4/IPv6 and mapped-address validation | Policy tests passed; real IPv6-provider connectivity unexecuted. |
| R18 | Validate all DNS answers and pin actual connection; refuse redirects | Real loopback/controlled-DNS tests passed; full outbound inventory/TLS providers not exhaustive. |
| R19 | Do not publish unverified model deltas; publish guarded narration | Turn harness verifies no premature deltas. Browser hit/miss acceptance unexecuted. |
| R20 | Personal interface locale separate from explicit common narration setting | Real TSX handlers tested using adapter; not two live browser users. |
| R21 | RU/PL audit/actions, error feedback, DM fallback/system projection, message/media/status controls | 39 UI-handler tests plus game-text tests. Authored reasons/names/prose and unknown diagnostics deliberately preserved. Not a universal translation audit of every screen. |
| R22 | Scoped retention, rolling all ODM snapshot tags and recovery pins | 36-test ops suite includes real Git and repeated-state cleanup. Real Docker/restic storage unexecuted. |
| R23 | Common operation lock, prepared sidecar candidate, coordinated release/rollback journal | Real process-lock and filesystem rollback tests, with service doubles. |
| R24 | MCP lockfile and npm ci | Source graph pinned; two clean actual MCP builds unexecuted. |
| R25 | Structural checks labelled as such; separate behavioral/failure regressions | Test evidence identifies mocks and scopes; no grep-as-E2E claim. Full default repository run unexecuted. |
| R26 | Logs follow, explicit token --show, documented preload and coordinated lifecycle | CLI parsing/process tests passed; all examples on fresh installed hosts unexecuted. |

## Reproduce and extend acceptance

```sh
node --test scripts/test-review-ui.mjs scripts/test-review-session-ui.mjs scripts/test-review-portal-launch.mjs
python3 scripts/test-review-ops.py
```

In a complete checkout, also run `npm ci`, `npm ci --prefix mcp`, `npx tsc --noEmit`,
`npm test` and `npm run build`, then the real browser, SDK HTTP/stdio, Linux HTTPS
install/update/rollback/restore and Windows scheduling scenarios. These remain
**unexecuted release-validation work**, not evidence of known passing behavior.
Do not weaken CAS, endpoint guards, preload assertions, confirmations or branch
checks to make them pass. The overlapping draft PR #9 is not automatically included.
