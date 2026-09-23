# Конфигурация этого форка

Основной способ установки — [два bootstrap-файла](installation.md), не запуск
upstream образа `lebbi/open-dungeon-master:latest`. Управляемый образ собирается
из выбранного коммита вашего форка через корневой multi-stage `Dockerfile`.

## Размещение

Linux по умолчанию `/opt/odm`; Windows `%LOCALAPPDATA%\OpenDungeonMaster`.

```text
config/       параметры установки, app.env, пароль restic, отдельный GitHub token
state/data/   игровая SQLite, справочник и пользовательские world packs
state/uploads/, generated/, audio/   постоянные файлы
state/provider-auth/                изолированный Codex login
cache/ollama/, embeddings/           воспроизводимые веса, не backup
repository/                         приватный Git clone без токена в remote URL
releases/COMMIT/source/              отдельные исходники релиза
releases/COMMIT/compose-DIGEST.json   манифест с immutable image ID
tools/odmctl.py                     единый controller
backups/                           encrypted restic repository
proxy/                             Caddy certificate state
logs/                              readiness, alerts, protected errors
```

На Linux runtime-каталоги принадлежат UID 1000 контейнера, секретные config-файлы
доступны root. На Windows установщик ограничивает NTFS ACL установки текущим
пользователем, SYSTEM и локальными администраторами. В Git и Docker build context
не должны попадать state, `.env`, keys, backup или recovery kit.

## Основные параметры

`config/install.json` хранит runtime, model, port, listen, domain, branch и выбранное
автообновление. `config/app.env` передаётся Compose через env_file и содержит
DB_ENCRYPTION_KEY, SQLITE_DB_PATH, CONTENT_DB_PATH, ODM_PROVIDER_AUTH_HOME,
ODM_LOCAL_ORIGIN, COOKIE_SECURE и public-origin при HTTPS. Секреты не подставляются
в shell-команду и не печатаются.

Провайдеры текста и изображений настраиваются в существующей админке и сохраняются
в шифрованной БД. Установщик не создаёт второе независимое хранилище профилей LLM.
Явные настройки админки могут иметь приоритет над environment; смена env не
обязательно перезаписывает выбранный ранее профиль или настройки кампании.

`127.0.0.1` внутри контейнера — контейнер. `host.docker.internal` — Docker host,
`ollama:11434` — управляемый Ollama-контейнер. Правило относится и к ComfyUI.
Голос отключён, лишние RTC-порты не открываются.

Нельзя масштабировать приложение в несколько writer-реплик. SQLite, in-process
очереди и игровой event bus требуют одного активного процесса.

Полная upstream справка по остальным переменным и внутренним настройкам сохранена
в [configuration-reference.md](configuration-reference.md). Её ручные пути запуска
не заменяют управляемую схему выше. Эксплуатация: [operations.md](operations.md).
