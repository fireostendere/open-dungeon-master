# P2: Реализация и подтверждение готовности (M08–M14)

Ветка: `fix/mcp-readiness-p2-2026-09-17`.
Основа: P1-коммит `8145e66eb665298f3ec9f8d5a4335b0d3c1d21cc`.
Дата проверки: 17 сентября 2026 года. Main и рабочая установка не изменялись.

## Что реализовано в этой ветке (M08–M14)

- **M08:** отдельная сохраняемая очередь Ask, pending/answered/failed, страницы
  ожидающих вопросов, версия ответа, идемпотентная квитанция. Приватность и
  отсутствие сюжетных изменений сохранены. Новые human-mode Ask возвращают 202.
- **M09:** общий runner передаёт `--experimental-vm-modules` дочерним процессам;
  ошибка либо сигнал дочернего процесса остаётся ошибкой, не skip.
- **M10:** автономный narrator host (`narrator/run.mjs`, `NarratorRunner`),
  изолированный Dockerfile (`narrator/Dockerfile`), надёжный I/O чекпоинтов
  (`narrator/checkpoint-io.mjs`), crash-resilience с возобновлением курсоров без
  повторного выполнения команд, HTTP healthcheck (`/healthz`, `/status`),
  и CLI-контроллер управления жизненным циклом (`deploy/narratorctl.py`).
- **M11:** семантический входной гейт (`narrator/semantic-gate.mjs`) с проверкой
  инъекций промптов, кражи токенов, попыток несанкционированных действий и фильтрацией
  оффтопика (программирование, домашка, шопинг) с поддержкой локализаций (RU/EN/PL);
  трекер суточных и часовых затрат и токенов (`narrator/cost-tracker.mjs`);
  сохраняемые минутные квоты Ask/действий/whispers.
- **M12:** все три входных канала проверяют `requireVoice`. Заглушённый участник
  не может послать whisper/ask/action, но сохраняет чтение собственной истории.
- **M13:** бюджет данных read, страницы одного hash-consistent снимка;
  менеджер памяти хоста и компактификация контекста (`narrator/compaction.mjs`),
  сохраняющий ключевые вехи (смерти, левелапы, квестовые предметы) при ограничении
  буфера сообщений в длительных сессиях.
- **M14:** обновлён narrator skill, технический сценарий первого сеанса
  (`docs/external-narrator-first-session.md`), документация внешнего мастера
  (`docs/external-narrator.md`) и полный набор приёмочных тестов.

## Выполненные проверки

Node 24.18.0, TypeScript 5.8.3, Python 3.12.3:

1. **TypeScript Typecheck:**
   ```sh
   npx --no-install tsc --noEmit
   ```
   **0 errors (Clean exit 0).**

2. **P2 Приёмочный тестовый набор (32 теста):**
   ```sh
   node --test scripts/test-mcp-readiness-p2.mjs scripts/test-p2-wiring.mjs scripts/test-narrator-host.mjs scripts/test-narrator-semantic-gate.mjs scripts/test-narrator-compaction.mjs
   ```
   **32 passed; 0 failed, 0 cancelled, 0 skipped.**

3. **Специализированные интеграционные тесты:**
   - `scripts/test-mcp-narrator-control.mjs` — PASS (жизненный цикл без AI, приватность, конкурентные записи, повтор бросков).
   - `scripts/test-narrator-command.mjs` — 8/8 passed (транзакции, откат при ошибках, идемпотентные повторы).
   - `scripts/test-narrator-semantic-gate.mjs` — 28/28 benchmark-кейсов из `dm-player-policy-cases.json` пройдены.
   - `scripts/test-narrator-compaction.mjs` — PASS (ограничение буфера, роллинг-саммари, сохранение вех).
   - `scripts/test-review-probe-long.mjs` — PASS (45-секундный HTTP-хоп провайдера через контрольный слой).
   - `deploy/narratorctl.py` — status, checkpoint, start/stop/health CLI команды проверены.
   - `npm run i18n:check` — 196 ключей каталогов EN/RU/PL синхронизированы, утечки локалей предотвращены.
