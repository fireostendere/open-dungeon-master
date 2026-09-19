# Location privacy acceptance

Дата проверки: 2026-09-18. Git-записи намеренно не выполнялись.

## Результат

Серверная изоляция текстовых location-сцен реализована отдельным spatial ledger:

- аудитория сообщения фиксируется при записи receipt-строками;
- вход в комнату не выдаёт прошлую историю;
- выход не отбирает уже наблюдавшееся;
- возвращение не выдаёт промежуток отсутствия;
- OOC хранится глобально и не запускает сюжетный ход;
- observation, speech и scry создают только новые адресованные сообщения;
- изменяемые карты, заметки и другие объекты имеют версии и персональные receipts;
- обычный campaign snapshot больше не выдаёт игроку глобальные rolls, sheets, encounter, map/location, audit, proposals или narration audio.

Полная изоляция всех старых механик кампании ещё не завершена: legacy encounter/map/facts/notes/export/media paths не имеют единого room-scoped projection. В spatial mode игроку они fail-closed скрыты там, где это возможно, а не ошибочно показаны. Это конкретный блокер acceptance, не PASS.

## Acceptance matrix

| Требование | Реализация | Проверка | Статус |
| --- | --- | --- | --- |
| Изоляция текста по комнатам | spatial_messages, spatial_receipts, location-chat | spatial chat and integration tests | PASS для spatial text |
| Вход, выход, возврат и unseen gap | spatial_presence, spatial_visits, receipts | entry/exit/reentry tests | PASS |
| Версионная история объектов | spatial_object_versions, spatial_object_receipts, publishObject/observeObject | retained-version regression | PASS на store projection |
| Глобальный OOC без сюжетного хода | room NULL, отдельная ветка send, narrator filter | spatial and narrator integration | PASS |
| Sound, sight, scry | explicit one-hop perception and anchored expiring observers | spatial tests | PASS |
| Idempotent retries и stale revision | spatial_requests, request UUID, expected revision | spatial tests | PASS |
| Snapshot, rewind, restore | spatial tables in boundary snapshots | snapshot tests | PASS для spatial tables |
| Campaign snapshot privacy | route filters sheets, rolls, pending rolls, events, messages, map/location, encounter, proposals, audio | typecheck and integration | PASS для fail-closed projection |
| Direct audio URL | spatial receipt check in generated-audio route | typecheck; no live browser fixture | PASS для guarded route |
| Incremental narrator messages | authoritative messages merge/dedup, room-scoped compaction | compaction and integration | PASS |
| Compaction, checkpoint, restore boundaries | room/channel summaries, safe status serialization, full checkpoint restore | compaction tests; host partly blocked by bind | PARTIAL |
| Narrator status/health leakage | loopback health bind, optional status bearer, safe status error | source review; host 5/6 tests | PARTIAL: fixed-port sandbox blocker |
| Player action to narrator response | spatial command path and MCP integration | integration test | PASS для location text |
| Independent combat, initiative, maps, facts, notes, exports | no room-scoped legacy mechanical projection yet | source audit | BLOCKED |
| WebMCP page integration | WebMcpLocationTools, native document.modelContext, authenticated tools only | typecheck; browser unavailable | PARTIAL |
| Official Playwright MCP config | pinned @playwright/mcp 0.0.81, isolated Chromium/local origins | package/config inspection | PASS config |
| Four isolated browser contexts | location-privacy.e2e.mjs creates DM/A/B/outsider and checks HTTP snapshots/direct IDs | real auth states and URL required | NOT RUN |
| Live/replay/cache/direct URL checks | E2E checks snapshots, location API and guessed room IDs; cache is private, no-store | no deployment fixture | NOT RUN |

## Changed implementation

- src/lib/spatial/*: spatial ledger, audience receipts, object versions, snapshot and narrator projection.
- src/app/api/campaigns/[campaignId]/location-chat/route.ts and campaign UI files: authenticated API/UI and WebMCP surface.
- src/app/api/campaigns/[campaignId]/route.ts and generated-audio route: fail-closed campaign/audio projections.
- narrator/compaction.mjs and narrator/run.mjs: incremental ingestion, room-bound summaries, safe status output and loopback binding.
- src/lib/db/snapshots.ts, src/lib/dm/human-narration.ts, src/lib/mcp-narrator-control.ts: existing spatial/narrator integration.
- tests/ui-mcp/*: official MCP runner configuration and documentation.
- scripts/e2e/location-privacy.e2e.mjs and scripts/test-spatial-*.mjs: browser harness and regressions.
- scripts/lib/*.mjs and selected scripts/test-*.mjs: lint-only CommonJS loader local renames from module to localModule.

## Commands and factual results

Passed:

    npx --no-install tsc --noEmit                         PASS
    npm run lint                                           PASS (0 errors, 7 warnings)
    node --test scripts/test-spatial-chat.mjs scripts/test-spatial-snapshot.mjs scripts/test-narrator-compaction.mjs
                                                            PASS (3 test files)
    node --experimental-vm-modules scripts/test-spatial-integration.mjs
                                                            PASS
    npm test --prefix tests/ui-mcp                             PASS
    node scripts/test-narrator-host.mjs                    5 PASS, 1 environment failure

Not green, with concrete reasons:

- npm test stops at the pre-existing asset-claim race assertion in scripts/test-asset-claim-concurrency.mjs; the race gives an empty error string instead of the expected not-claimable/claimed text. It reproduces when run alone.
- npm run build: Next 16/Turbopack fails before application compilation because the sandbox forbids binding a worker port. next build --webpack also fails in this environment while parsing TypeScript --showConfig.
- test-narrator-host.mjs: the lifecycle test cannot bind fixed 127.0.0.1; the remaining five tests pass. The escalated retry was rejected by the execution environment.
- npm run smoke --prefix tests/ui-mcp: blocked by the same sandbox EPERM on 127.0.0.1 bind.
- test:e2e:location intentionally reports NOT RUN and exits 2 unless the base URL, campaign ID, secret marker and four Playwright storage-state paths are supplied. No credentials or deployment fixture were present.

## Browser execution

Run with four separate storage states:

    ODM_E2E_BASE_URL=http://127.0.0.1:3000 +    ODM_E2E_CAMPAIGN_ID=<campaign-id> +    ODM_E2E_SECRET_MARKER=<unique-secret> +    ODM_E2E_DM_STATE=<dm.json> +    ODM_E2E_A_STATE=<a.json> +    ODM_E2E_B_STATE=<b.json> +    ODM_E2E_OUTSIDER_STATE=<outsider.json> +    npm run test:e2e:location

The harness creates independent BrowserContexts, checks campaign snapshots and response bodies, tests a direct room URL/ID, and checks an outsider campaign response. Complete production acceptance still needs real combat/map/facts/notes/export fixtures after those legacy APIs are converted to the same room-scoped projection.

## MCP/WebMCP version record

The repository uses the official Playwright MCP package at 0.0.81; the configuration is isolated/headless and permits only local test origins. The page adapter uses the current optional WebMCP draft surface, document.modelContext.registerTool, and never exposes narrator/control-plane or DM mutation tools to the browser. Native WebMCP is still experimental, so DOM and HTTP assertions remain authoritative.

References: [Playwright MCP releases](https://github.com/microsoft/playwright-mcp/releases), [Playwright MCP getting started](https://playwright.dev/docs/getting-started-mcp), [WebMCP draft](https://webmachinelearning.github.io/webmcp/).
