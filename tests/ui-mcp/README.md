# ODM UI test MCP

Изолированный **test-only** stdio MCP: обёртка над официальным `@playwright/mcp`.
Он не меняет `mcp/`, deploy, Docker Compose или Next UI.

## Установка и запуск

```sh
cd tests/ui-mcp
npm ci
npm test
npm start
```

Нужен Node 22+ и Chrome для запуска сервера. По умолчанию используется `chrome`;
при необходимости задайте `ODM_UI_TEST_BROWSER`. Опциональный настоящий браузерный
проверочный прогон с локальной HTTP-страницей: `npm run smoke` (не входит в `npm test`).

Переменные:

- `ODM_UI_TEST_BASE_URL` — origin тестируемого ODM, по умолчанию `http://127.0.0.1:3005`;
- `ODM_UI_TEST_BROWSER` — канал браузера Playwright MCP, по умолчанию `chrome`.

## OpenCode

Добавьте отдельный локальный MCP в конфигурацию OpenCode (путь намеренно относительный
к workspace):

```json
{
  "mcp": {
    "servers": {
      "odm-ui-test": {
        "type": "local",
        "command": ["node", "tests/ui-mcp/server.mjs"],
        "cwd": ".",
        "environment": {
          "ODM_UI_TEST_BASE_URL": "http://127.0.0.1:3005"
        }
      }
    }
  }
}
```

Доступны только `ui_open`, `ui_find`, `ui_action`, `ui_assert`. Типичный вызов — два
шага: `ui_find({ role: "button", name: "Save" })`, затем
`ui_action({ handle: "ui_1", action: "click" })`. Ссылки Playwright и snapshots
остаются внутри процесса; handles очищаются после навигации и действия.

| Инструмент | Назначение |
| --- | --- |
| `ui_open` | Открыть относительный `path` на настроенном origin; ответ не возвращает query/fragment. |
| `ui_find` | Найти до пяти элементов по accessibility `role`/`name`; `exact` включён по умолчанию. |
| `ui_action` | Выполнить `click`, `fill`, `select` или `press` по непрозрачному `handle`; `press` разрешён только для полей формы. |
| `ui_assert` | Дождаться `visible` или `hidden` для семантической цели, максимум 10 секунд. |

Не подключайте модели одновременно этот сервер и сырой Playwright MCP: иначе
`browser_snapshot` и большой набор низкоуровневых схем снова попадут в контекст.

Same-origin проверка и Playwright `allowed-origins` — защитные ограничители, а не
security sandbox: HTTP redirect успевает начаться до проверки итогового URL.
Используйте только локальный экземпляр ODM с тестовыми данными, не production.
