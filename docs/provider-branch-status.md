# Подключения LLM: реализация и запуск

Ветка теперь содержит рабочие маршруты, вкладку **Admin → Подключения LLM**,
CLI и подключение к игровому клиенту ODM. Предыдущее описание про три
несвязанных модуля больше не относится к текущему коду.

## Запуск

Node.js 24 рекомендуется для полного набора TypeScript-тестов.

```bash
npm ci
npm run build
npm run start:lan
```

Для ChatGPT установите официальный Codex CLI отдельно от проекта:

```bash
npm install -g @openai/codex@0.154.0
npm run auth -- login chatgpt --device
npm run auth -- models chatgpt
npm run auth -- connect chatgpt --model EXACT_MODEL_ID --apply
```

`--device` открывает процесс входа по коду: CLI печатает официальную ссылку
и код, ждёт подтверждения и умеет отменять вход через Ctrl+C. В админке есть
те же действия, а также обычный браузерный режим для сервера на том же ПК.
Фактическое подтверждение входа выполняет владелец аккаунта, не автотест.

`--apply` устанавливает модель по умолчанию **после** проверки chat → native
function call → настоящий результат инструмента → final answer. Уже созданная
кампания с собственным override сохраняет выбранный backend; примените новый
сохранённый профиль в её настройках модели. Подключение не меняет графический
backend ComfyUI и не предоставляет автоматически подписочную генерацию картинок.

## Gemini и Qwen

Gemini подключается официальным Developer API-ключом, а не токенами OAuth
Google AI Pro/Gemini CLI. Qwen подключается ключом DashScope/Token Plan или
локальным runtime. Неработающие обещания старого Qwen OAuth не используются.

```bash
npm run auth -- models qwen-local --base-url http://127.0.0.1:11434/v1
npm run auth -- connect qwen-local --model INSTALLED_MODEL --apply
# Облачный ключ передаётся через stdin, не через аргумент и историю команд.
npm run auth -- connect gemini --model EXACT_MODEL_ID --key-stdin --apply
npm run auth -- connect qwen --model EXACT_MODEL_ID --region international --key-stdin --apply
```

`--key-stdin` читает ввод до EOF. В обычной терминальной сессии удобнее ввести
ключ в password-поле админки. Для Qwen доступны international, china и token-plan;
регион должен соответствовать выданному ключу. Визард умеет получать список
моделей, но ручной ID остаётся доступен при отсутствии models endpoint.

Gemini/DashScope используют отдельный строгий транспорт в игровом DM-path:
он не посылает локальные llama.cpp-параметры и хранит opaque thought signatures /
reasoning metadata в зашифрованной БД. Числа и результаты игровых инструментов
по-прежнему вычисляет ODM; модель не получает прямого доступа к БД.

## Развёртывание и секреты

- По умолчанию CLI ищет локальный ODM на портах 3005 и 3000. Нестандартный
  порт задаётся `ODM_LOCAL_ORIGIN=http://127.0.0.1:PORT` и серверу, и CLI.
- При reverse proxy задайте `ODM_PUBLIC_ORIGIN=https://your-table.example`
  для проверки Origin админки и `ODM_LOCAL_ORIGIN` для внутреннего маршрута.
- Codex запускается под пользователем сервера с отдельными HOME/CODEX_HOME.
  Не копируются browser cookies, OpenCode auth.json или рабочий профиль Codex.
- `ODM_PROVIDER_AUTH_HOME` позволяет явно выбрать постоянный каталог вне
  репозитория. По умолчанию используется пользовательский ~/.local/state.
  Этот каталог нужно сохранять отдельно от backup игровой БД.
- `ODM_CODEX_BINARY` задаёт путь к официальному executable или JS entrypoint.
  На Windows при проблемах с codex.cmd укажите полный путь к bin/codex.js;
  его запускает Node без shell. Путь задаётся только конфигурацией сервера.
- Docker: официальный Codex должен быть установлен **в контейнере ODM**,
  каталог provider-auth должен быть постоянным volume. Установка на хосте
  не делает бинарник автоматически доступным в контейнере.
- Админка защищена requireAdmin + same-origin JSON/custom header. CLI и
  inference имеют разные случайные ключи. Они не возвращаются браузеру.
- Logout прерывает текущие ходы этого ChatGPT-подключения. Неполученные
  результаты нельзя повторно применять после перезапуска bridge.

Codex dynamicTools — экспериментальный официальный интерфейс. Ветка проверяет
совместимость с 0.154.0; обновление CLI требует повторного smoke-теста.
ChatGPT-ответы и строгий cloud-путь сейчас приходят целиком, без искусственного
streaming. Лимиты и доступность моделей определяет провайдер/аккаунт.

## Автотесты и границы проверки

```bash
npm run test:providers  # быстрые offline protocol/security tests, без npm ci
npm test               # полный существующий набор + проверки новой БД
npm run lint
npm run build
```

GitHub Actions отдельно запускает:
1. Быстрые тесты на Linux и Windows, без аккаунтов, GPU и загрузки моделей.
2. Настоящий официальный Codex app-server: initialize, account/read и создание
   thread с native tools, в пустом HOME, без входа и без модельного запроса.
3. Собранный production Next.js + Chromium: вкладка админки, оба входа,
   список моделей, probe, применение, CLI, ошибки доступа, local runtime,
   отклонение непригодной модели и сохранение состояния после перезапуска.

Полный браузерный сценарий использует явно выбранный тестовый app-server,
а не выдаёт тестовый результат за успешный вход в реальный личный аккаунт.
Артефакт CI содержит screenshot, summary и лог тестового сервера.

Источники протоколов:
- https://developers.openai.com/codex/app-server/
- https://developers.openai.com/codex/auth/
- https://ai.google.dev/gemini-api/docs/openai
- https://geminicli.com/docs/resources/tos-privacy/
- https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/
