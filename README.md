# Dungeon Master — приватный AI D&D сервер (api.iroslyakov.com)

Приватный production-форк **Open Dungeon Master**, адаптированный, сконфигурированный и развёрнутый на выделенном боевом сервере **`api.iroslyakov.com`** (`176.12.76.19`).

Проект объединяет мультиплеерные сессии настольных ролевых игр (D&D 5e) в браузере, автономного текстового AI-ведущего (Dungeon Master), интерактивные карты с токенами, трекинг боя, шифрованное локальное хранилище и выделенный MCP-контур для внешней генерации артов.

---

## 🌐 Боевой сервер (`api.iroslyakov.com`)

Приложение развёрнуто в production-окружении на базе Ubuntu 24.04 LTS и функционирует в режиме высокой надёжности.

| Компонент | Адрес / Точка входа | Доступ | Назначение |
|---|---|---|---|
| **Веб-интерфейс (App)** | [`http://api.iroslyakov.com:3005`](http://api.iroslyakov.com:3005) | Публичный (TCP 3005) | Игровые сессии, листы персонажей, боевой трекер, веб-админка |
| **MCP Sidecar (Control Plane)** | `http://127.0.0.1:3006/mcp` | Внутренний (Loopback + Bearer) | Управление сессиями, external art pipeline, party progression sync |
| **Репозиторий проекта** | `/opt/odm/repository` | Локальное git-зеркало | Синхронизируется с веткой `main` через SSH |
| **База данных** | `/opt/odm/state/data/local-roleplay.sqlite` | Изолированная SQLite | Постоянная база данных с шифрованием SQLCipher |
| **Хранилище медиа** | `/opt/odm/state/uploads`, `/opt/odm/state/generated` | Persistent volumes | Токены, карты, пользовательские и сгенерированные арты |
| **Шифрованные бэкапы** | `/opt/odm/backups` | Restic репозиторий | Автоматические регулярные снимки состояния с проверкой целостности |

### Сосуществование сервисов на сервере

Развёртывание ODM полностью изолировано и работает параллельно с существующей инфраструктурой сервера `api.iroslyakov.com`:
- **Caddy** (`:80`, `:443`) — обеспечивает SSL и маршрутизацию внешних веб-сервисов хоста.
- **LiveKit Meet** (`:3000`) и **LiveKit Server WebRTC** (`:7880`) — не затрагиваются.
- **PostgreSQL** (`:5432`) и **Redis** (`:6379`) — работают независимо.
- **Dungeon Master** занимает выделенный внешний порт `:3005` и внутренний порт `:3006` для MCP.
- Дополнительный swap-файл на 2 ГБ (`/swapfile2`, суммарно 5.0 ГБ виртуальной памяти) гарантирует надёжность сборки Docker-образов без риска Out-Of-Memory.

---

## 🚀 Быстрый старт и первый вход

1. Откройте в браузере: **[`http://api.iroslyakov.com:3005`](http://api.iroslyakov.com:3005)**
2. Первоначальные реквизиты администратора генерируются автоматически при первой установке и сохранены в файле:
   ```bash
   /opt/odm/config/admin.json
   ```
   *(Логин по умолчанию: `odm_admin`, пароль сформирован криптостойким генератором)*.
3. При первом входе смените пароль администратора.
4. В панели **Admin → Подключения LLM** выберите рабочий бэкенд:
   - **ChatGPT / OpenAI** (с поддержкой официального Codex CLI через `odmctl auth login chatgpt --device`);
   - **Ollama** (локальные или удалённые модели);
   - **Пользовательские OpenAI-совместимые API** (OpenRouter, DeepSeek, vLLM и др.).
5. Создайте кампанию и отправьте ссылки-приглашения игрокам.

---

## 🎨 MCP, удалённые модели и внешний арт-пайплайн

В форк интегрирован полнофункциональный MCP-сайдкар (`odm-mcp-managed`), работающий как управляющий контур (control-plane) для AI-агентов, внешних воркеров генерации и моделей:

- **Переключение локальной модели на удалённый сервер (`odm_models`)**:
  - Поддержка подключения к удалённым серверам инференса (Ollama, vLLM, llama.cpp, LM Studio, OpenAI-compatible) напрямую через MCP, CLI или веб-админку.
  - Операции `odm_models`: `status` (текущая модель и профили), `list_models` (опрос удалённого сервера), `test_and_connect` (проверка 3-этапным probe с настоящим function calling), `switch_remote` (мгновенное переключение на удалённый сервер) и `apply_profile` (применение к глобальному DM или конкретной кампании).
  - Безопасная валидация: SSRF-защита от опасных адресов/метаданных, строгое тестирование tool-calling до активации.
- **Внешняя генерация артов (`odm_assets`)**: тяжелые модели генерации (ComfyUI, Qwen-VL, Stable Diffusion) выносятся на внешние GPU-машины. Воркер опрашивает очередь (`claim_job`), рисует, получает одноразовый HTTP-грант (`grant_upload`) и загружает арт прямо в `/opt/odm/state/generated`.
- **Привязка к объектам мира**: каждый сгенерированный арт связывается с конкретной сущностью D&D — персонажем, NPC, сценой, локацией, картой, предметом или главой кампании.
- **Синхронизация прогресса группы (`odm_progress`)**: инструмент `finish_and_sync_party` переносит долговременный прогресс (XP, инвентарь, постоянные параметры) обратно в библиотеку персонажей, очищая временные боевые эффекты.

Подробная спецификация протокола: [External art pipeline over MCP](docs/external-assets-mcp.md) и [MCP documentation](docs/mcp.md).

---

## 🛠️ Управление сервером (`odmctl` и `odm-mcpctl`)

Для администрирования инстанса на сервере доступны специализированные CLI-утилиты:

### Управление приложением (`odmctl`)

```bash
# Проверка текущего статуса контейнеров, здоровья БД и бэкапов
sudo odmctl status

# Просмотр последних 200 строк логов веб-сервиса
sudo odmctl logs

# Авторизация ChatGPT Codex CLI через Device Code Flow
sudo odmctl auth login chatgpt --device
sudo odmctl auth models chatgpt
sudo odmctl auth connect chatgpt --model gpt-4o --apply

# Подключение локальной или удалённой модели (Ollama, vLLM, llama.cpp)
sudo odmctl auth models qwen-local --base-url http://remote-gpu:11434/v1
sudo odmctl auth connect qwen-local --model qwen2.5:14b-instruct --base-url http://remote-gpu:11434/v1 --apply

# Просмотр сохранённых профилей и переключение активного DM
sudo odmctl auth profiles
sudo odmctl auth apply --profile-id PROFILE_ID

# Создание шифрованного снимка состояния (БД + медиа)
sudo odmctl backup

# Список существующих бэкапов restic
sudo odmctl snapshots

# Тестовое восстановление и верификация целостности БД
sudo odmctl restore-check latest

# Автоматическое обновление из ветки main с health check
sudo odmctl update

# Мгновенный откат на предыдущую стабильную версию (образ + БД)
sudo odmctl rollback --yes
```

### Управление MCP-сайдкаром (`odm-mcpctl`)

```bash
# Статус MCP-сервиса, endpoint и корректная stdio-команда с preload
sudo odm-mcpctl status

# Путь к Bearer-токену и его fingerprint (секрет по умолчанию не печатается)
sudo odm-mcpctl token

# Явно показать Bearer-токен, когда его нужно передать доверенному MCP-клиенту
sudo odm-mcpctl token --show

# Ручной запуск синхронизации sidecar
sudo odm-mcpctl sync
```

### Системные службы (systemd)

- `odm-managed.service` — служба основного веб-приложения в Docker.
- `odm-mcp-managed.service` — служба MCP-сайдкара.
- `odm-watchdog.timer` — ежеминутный мониторинг доступности БД и веб-порта.
- `odm-backup.timer` — планировщик регулярного создания бэкапов restic.
- `odm-mcp-sync.timer` — фоновый таймер периодической синхронизации MCP.

---

## 🔄 Процесс разработки и доставки (Release Flow)

1. Все доработки и исправления ведутся в репозитории [`fireostendere/dungeon_master`](https://github.com/fireostendere/dungeon_master).
2. Перед слиянием в `main` запускаются доступные static, unit, integration и deployment smoke-проверки. Текстовые/структурные проверки не считаются end-to-end доказательством; реальные install/update/restore, браузерный сценарий и внешний MCP должны проходить отдельные поведенческие проверки перед production-релизом.
3. После слияния в `main` обновление на боевом сервере выполняется одной командой:
   ```bash
   ssh root@api.iroslyakov.com "odmctl update"
   ```
   Процедура обновления собирает изолированный образ, проводит предпусковые тесты провайдеров (`test:providers`), выполняет замену контейнера и проверяет readiness probe. Для production-релиза дополнительно требуется согласованный health gate web + MCP и проверенная точка отката.

---

## 📦 Резервное развёртывание на других хостах

Хотя данный форк сфокусирован на целевом сервере `api.iroslyakov.com`, при необходимости развернуть независимый экземпляр (например, на локальной машине разработчика) можно воспользоваться скриптами установки:

| Окружение | Скрипт | Запуск |
|---|---|---|
| **Ubuntu / Debian** | [`install-server.sh`](install-server.sh) | `sudo bash install-server.sh` |
| **Windows 10/11 (WSL2/Docker)** | [`install-local.ps1`](install-local.ps1) | `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-local.ps1` |
| **Локальный режим (Ollama)** | `install-server.sh` | `sudo bash install-server.sh --mode local` |

---

## 📚 Документация

- [Индекс документации](docs/README.md)
- [Внешний арт-пайплайн через MCP](docs/external-assets-mcp.md)
- [Эксплуатация и мониторинг](docs/operations.md)
- [Резервное копирование и восстановление](docs/backups.md)
- [Конфигурация параметров](docs/configuration.md)
- [Подключение языковых моделей (LLM)](docs/llm-wizard.md)
- [Генерация изображений](docs/image-generation.md)
- [Тестирование и приёмочные испытания](docs/deployment-testing.md)
- [Архивная справка upstream](docs/upstream-readme.md)
