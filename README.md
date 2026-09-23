# Dungeon Master — приватный AI D&D сервер

> Сервер не запускает собственную LLM. Игру ведёт доверенный внешний MCP-клиент
> (например, OpenCode); сервер остаётся авторитетом для состояния, правил и костей.

Приватный форк Open Dungeon Master: браузерные кампании D&D 5e, текстовый AI-ведущий, карты, боевой трекер, библиотека персонажей, постоянное хранилище и отдельный MCP-контур для внешних агентов.

## Результат ревью R01–R26

Исправления собраны в `fix/review-2026-09-16` / PR #10. Реестр изменений, выполненных проверок и ограничений приёмки: [review-2026-09-16-status.md](docs/review-2026-09-16-status.md).

В продолжениях работы подтверждены 192 различных локальных проверки. Это не утверждение о полном CI или готовности production-сборки: часть зависимостей заменена тестовыми реализациями, а полный TypeScript-check, Next build, браузерная приёмка и установленный Docker/MCP не выполнены в среде ревью. Слияние кода и развёртывание — отдельные действия.

## Справочная конфигурация сервера

В проекте ранее был настроен хост `api.iroslyakov.com` и каталог `/opt/odm`. Эти сведения описывают конфигурацию, а не подтверждают текущую доступность сервера. Проверяйте установленную версию и состояние командами `odmctl status` и `odm-mcpctl status`.

| Компонент | Адрес или каталог |
| --- | --- |
| Веб-приложение | `http://api.iroslyakov.com:3005` |
| MCP на самом сервере | `http://127.0.0.1:3006/mcp`, Bearer-аутентификация |
| Git-зеркало | `/opt/odm/repository` |
| База игры | `/opt/odm/state/data/local-roleplay.sqlite` |
| Медиа | `/opt/odm/state/uploads`, `/opt/odm/state/generated`, `/opt/odm/state/audio` |
| Локальные шифрованные снимки | `/opt/odm/backups` |
| Реквизиты первоначального администратора | `/opt/odm/config/admin.json` |

На хосте могут работать независимые Caddy, LiveKit, PostgreSQL и Redis. Установщик ODM не должен подменять их конфигурацию. Перед использованием `--domain` убедитесь, что порты 80/443 свободны либо интегрируйте маршрут в существующий прокси вручную. Дополнительный swap не гарантирует успешную сборку при нехватке памяти.

## Первый вход и внешний ведущий

Войдите с первоначальными реквизитами из приватного `config/admin.json`, смените
пароль и создайте human-DM кампанию. Модель и её credentials настраиваются во
внешнем MCP-клиенте, не в ODM. Подключение и границы доступа описаны в
[external-narrator.md](docs/external-narrator.md).

## Управление экземпляром

```sh
sudo odmctl status
sudo odmctl logs -f --tail 200
sudo odm-mcpctl status

# Показать путь к файлу токена, не его содержимое.
sudo odm-mcpctl token

# Только в приватном терминале: явно показать сам секрет.
sudo odm-mcpctl token --show

# Проверить и восстановить соответствие MCP активному релизу.
sudo odm-mcpctl sync

sudo odmctl backup
sudo odmctl snapshots
sudo odmctl restore-check latest

# Изменяют установленный экземпляр; не запускать для проверки документации.
sudo odmctl update
sudo odmctl rollback --yes
```

`rollback --yes` восстанавливает прежний снимок игры, а не только исполняемый код: изменения после снимка не переносятся автоматически. `restore-check` проверяет восстановленную копию без замены живого состояния. Следование логам не держит блокировку операций записи.

Обновление, резервное копирование, восстановление и MCP используют общую `.ops.lock`. Образы приложения и MCP подготавливаются до остановки; текущая версия фиксируется после проверок обоих сервисов. При сбое используется журнал восстановления. Не удаляйте `config/transaction.json`, чтобы скрыть ошибку.

Имена systemd-служб выводятся из каталога установки: `odm-<hash>.service` и таймеры `odm-<hash>-watchdog`, `-backup`, `-check`, `-restore-check`, `-update`. Независимый старый `odm-mcp-sync.timer` заменён согласованным управлением внутри `odmctl`; текущий установщик отключает принадлежащий этому экземпляру старый таймер. Подробнее: [operations-review.md](docs/operations-review.md).

## MCP, арты и прогресс

MCP предоставляет 11 инструментов для кампаний, листов, внешнего ведущего,
ассетов и прогресса. Удалённый server-side model control через MCP не
поддерживается. Процесс не получает Docker socket или прямой доступ к БД;
изменения проходят через внутренний API приложения.

Внешний агент получает работу через `odm_assets`, загружает результат по ограниченному гранту и связывает арт с объектом мира. `odm_progress` синхронизирует долговременный прогресс с библиотекой. Конфликтующие копии не перезаписываются молча; завершение всей партии с `requireAllSynced:true` атомарно. См. [восстановление прогресса](docs/progress-synchronization.md), [протокол ассетов](docs/external-assets-mcp.md) и [MCP](docs/mcp.md).

Для stdio нужен preload, регистрирующий `odm_assets` и `odm_progress`:

```sh
npm ci --prefix mcp
node --import ./mcp/external-tools-preload.mjs ./mcp/server.mjs --stdio
```

Задайте `ODM_MCP_TOKEN` и `ODM_MCP_CONTROL_URL` в окружении. Для внешнего
ведущего предпочтителен HTTPS `/mcp` или `/api/narrator` с отдельным
`ODM_MCP_NARRATOR_TOKEN`; `/api/internal/mcp` намеренно остаётся приватным.
Для управляемого контейнера используйте массив команды из `odm-mcpctl status`,
включая `--import /app/external-tools-preload.mjs`. SSH допустим только как
один постоянный туннельный процесс; он не является протоколом narrator. См.
[transport architecture](docs/odm-transport.md).

## Локальный портал и язык

Доверенный локальный launcher привязывает сервер к `127.0.0.1` и фиксирует адрес/токен независимо от cookies:

```sh
npm run start:portal -- --origin https://game.example.org --token-file /private/portal.token --port 3007
```

Production-режим требует предварительного `npm run build`; для разработки добавьте `--dev`. Native-клиент должен установить свои обычные portal cookies с теми же реквизитами. Публичные серверы оставляют portal mode выключенным. См. [portal-local-launcher.md](docs/portal-local-launcher.md).

Язык интерфейса — личная настройка. Язык повествования общий для кампании и сохраняется отдельным действием ведущего. Авторский текст, имена и сохранённые маркеры бросков не переводятся автоматически.

## Установка и проверка изменений

| Среда | Команда |
| --- | --- |
| Ubuntu / Debian | `sudo bash install-server.sh` |
| Локальный Linux с Ollama | `sudo bash install-server.sh --mode local` |
| Windows / Docker Desktop | `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-local.ps1` |

Для нового экземпляра выбирайте отдельный каталог. `--plan` показывает действия Linux-установщика без их выполнения. Локальная доступность зависит от включённого компьютера и Docker Desktop. Не считайте локальные бэкапы заменой off-site-копии и сохранённого вне сервера пароля restic.

В полноценном checkout с установленными зависимостями выполняйте:

```sh
npm ci
npm ci --prefix mcp
npx tsc --noEmit
npm test
npm run build
python3 scripts/test-review-ops.py
```

Наличие теста, зелёная структурная проверка или слияние PR не заменяют его выполнение. Браузерные, SDK HTTP/stdio и Linux/Windows deployment-сценарии проверяются отдельно; актуальные границы подтверждения перечислены в реестре ревью.

## Документация

[Индекс](docs/README.md) · [Эксплуатация](docs/operations.md) · [Бэкапы](docs/backups.md) · [Конфигурация](docs/configuration.md) · [Внешний ведущий](docs/external-narrator.md) · [Изображения](docs/image-generation.md) · [Приёмочные проверки](docs/deployment-testing.md) · [Upstream](docs/upstream-readme.md)
