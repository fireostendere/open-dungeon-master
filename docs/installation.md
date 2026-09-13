# Установка

## Поддерживаемые варианты

Сервер: Ubuntu 22.04/24.04/26.04 или Debian 12/13, root/sudo, Docker Engine с
Compose v2. На чистом сервере установщик добавляет официальный подписанный apt
репозиторий Docker и устанавливает Git, Python 3 и restic. Рабочий Docker не
заменяется, конфликтующие старые пакеты не удаляются автоматически.

Компьютер: Windows 10/11 с WinGet, Docker Desktop в режиме Linux containers и
Python 3.10+. Недостающие Git/Python/restic/Docker устанавливаются через WinGet.
Аппаратная виртуализация и WSL2 должны быть доступны. На Linux-компьютере используется
серверный файл с `--mode local`. macOS и другие Linux-дистрибутивы этими двумя
bootstrap-файлами не заявлены.

Практический ориентир для облачного DM: 4–8 ГБ RAM и 30 ГБ свободного места;
сборка требует больше памяти, чем запущенная игра. Это ориентир, не измеренная
минимальная конфигурация. Локальная модель требует дополнительных RAM/VRAM и диска
согласно выбранной модели. Проверяется реальный вызов игровых инструментов.

## Приватный репозиторий

Скачайте `install-server.sh` или `install-local.ps1` через свой GitHub-сеанс.
Достаточно перенести **один этот файл**. Он клонирует `fireostendere/dungeon_master`.
Для автоматического получения кода нужен read-only fine-grained token с Contents
для этого репозитория. Не передавайте токен в URL или аргументе команды.

```bash
sudo bash install-server.sh --token-file /root/secrets/odm-github.token --yes
```

```powershell
.\install-local.ps1 -TokenFile C:\Secrets\odm-github.token -Yes
```

Без `--yes` / `-Yes` приватный токен можно ввести скрыто при запросе установщика.
Он сохраняется только в защищённой `config/github.token` для последующего updater.
Git remote не содержит токена. В образ, обычный бэкап и recovery kit этот токен
не включается. Его разрешение можно отозвать отдельно от LLM-аккаунтов.

## Сервер с HTTPS

```bash
sudo bash install-server.sh --domain dnd.example.com --runtime none
```

Замените домен своим. Caddy получает и продлевает сертификат. Существующие
firewall/SSH-порты не изменяются. Разрешите TCP 80/443 у провайдера и в firewall,
настройте DNS заранее. Проверка снаружи сети остаётся необходимой: localhost
healthcheck не доказывает доступность через ваш NAT или DNS.

Без домена безопасный default — `127.0.0.1:3005`. Для администрирования удалённой
машины используйте SSH-туннель:

```bash
ssh -L 3005:127.0.0.1:3005 user@server
```

Для доверенной LAN доступен явный `--listen 0.0.0.0`. Это HTTP, не защищённая
публичная конфигурация. Docker-порты могут обходить обычные правила UFW: не
открывайте такой порт в интернет.

## Локальная модель

```bash
sudo bash install-server.sh --mode local --runtime ollama --model qwen3:8b
```

```powershell
.\install-local.ps1 -Runtime ollama -Model qwen3:8b
```

Ollama находится в отдельном контейнере и не публикует порт в LAN/интернет.
По умолчанию используется CPU. NVIDIA: `--accelerator nvidia` / `-Accelerator nvidia`
при уже настроенном GPU passthrough/container toolkit. AMD: `--accelerator amd`
только на Linux с `/dev/kfd` и `/dev/dri`. Драйверы и системный Docker runtime не
перенастраиваются молча. Для AMD на Windows используйте существующий нативный
Ollama/LM Studio через режим `external`; совместимость проверяется фактическим probe.

```bash
sudo bash install-server.sh --runtime external --model EXACT_MODEL_ID \
  --llm-url http://host.docker.internal:11434/v1
```

```powershell
.\install-local.ps1 -Runtime external -Model EXACT_MODEL_ID -LlmUrl http://host.docker.internal:11434/v1
```

В контейнере `127.0.0.1` — сам контейнер. Адрес сервиса на хосте —
`host.docker.internal`, но сервис должен принимать соединения с сети контейнера.
На Linux loopback-only backend может быть недоступен через host-gateway: настройте
привязку/ограниченный firewall либо используйте управляемый Ollama. Для llama.cpp
можно выбрать external OpenAI-compatible endpoint; это не установка llama.cpp с
неизвестным GGUF. Название и формат модели всегда должны соответствовать runtime.

Облачный DM без локальных весов: `--runtime none` / `-Runtime none`, затем
[подключение моделей](llm-wizard.md). Официальный Codex уже включён в образ ODM.

## Windows: первый запуск и повторение

Запускайте из PowerShell. WinGet/Docker могут запросить UAC и согласие пользователя.
При необходимости reboot устанавливается RunOnce-продолжение; аппаратную
виртуализацию в BIOS установщик включить не может. Не включается автологин Windows,
не сохраняется пароль Windows и не отключается сон компьютера.

Task Scheduler работает в вашей интерактивной сессии и запускает Docker Desktop
после входа. Полностью автономный сервер до входа пользователя — Linux-вариант.

## Повторный запуск, ошибки и сохранение данных

Установка идёт в отдельную папку `/opt/odm` или `%LOCALAPPDATA%\OpenDungeonMaster`.
Непустая чужая папка отвергается. Повторный запуск сохраняет существующую конфигурацию,
ключ БД, пароль backup и аккаунты. Для новой версии используйте `odmctl update`.
Параметры повторного installer не переписывают вручную изменённый `install.json`.

Если модель или контент недоступны, веб-сервер, базовый backup и расписания сохраняются.
Ошибка не маскируется под полную готовность выбранного DM. Повторите тот же installer
либо `odmctl assets` / `odmctl model` после устранения причины.

Первоначальные реквизиты: `config/admin.json`; пароль требуется сменить в UI.
Папка `config` — секретная. Самостоятельно копировать существующую игровую БД в новую
установку без её ключа нельзя: см. [перенос и восстановление](backups.md).

Справка: https://docs.docker.com/engine/install/ubuntu/
https://docs.ollama.com/docker
https://learn.microsoft.com/windows/wsl/install
