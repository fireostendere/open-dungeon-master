---
name: odm-providers
description: "Подключение LLM-провайдеров ODM через официальный визард и проверка tool roundtrip; не для кражи токенов, неявного облака или настройки игрового сюжета."
---

# Провайдеры ODM

Прочитайте [общий контракт](../../../docs/agent-skills.md#общий-контракт-и-границы),
[LLM wizard](../../../docs/llm-wizard.md) и `src/lib/provider-auth/`.

## Вход

Провайдер, exact model ID, managed/manual среда, владелец credential и разрешённый бюджет.
Ключ вводит владелец в password field или stdin; никогда не просите browser/OpenCode tokens.

## Порядок

1. Уточните, глобальный профиль или campaign override нужен; не меняйте image backend.
2. Используйте Admin → Подключения LLM либо `odmctl auth`; следуйте точной официальной
   flow для ChatGPT, Gemini, Qwen или qwen-local.
3. Не выдавайте ChatGPT/Codex login за API-конвертацию; Qwen OAuth не обещайте рабочим.
4. Не переключайте local на cloud как fallback; платное использование — только с явным
   credential и ограниченным бюджетом.
5. Проверка — реальный isolated chat → native tool call → tool result → русский ответ.
   Наличие `/models` или текст «вызвал tool» не доказывает работоспособность.
6. Отдельно, с согласием, выполните маленький game smoke; MCP не исполняет DM turn.
7. Редактируйте URL и auth headers осторожно: это граница SSRF и секретов.

## Результат

```text
Профиль/model: … | проверка tool: pass/fail
Изменено: global/campaign override/ничего
Бюджет и следующий smoke: …
```

Готово, когда проверка прошла и выбранный профиль применён только с согласия владельца.
