# Подключение текстовой модели

Server-side model control удалён: ODM не хранит и не переключает текстовые LLM,
а MCP не предоставляет `odm_models`. Настройте модель и credentials во внешнем
narrator-host и подключите его по [актуальному протоколу](external-narrator.md).

Сохранённая [upstream-справка](text-backends-reference.md) описывает прежнюю
архитектуру и не является инструкцией для этого форка.
