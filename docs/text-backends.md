# Текстовые backend

Актуальная инструкция для этого форка: [LLM wizard](llm-wizard.md).
Для установки и обслуживания контейнеров: [installation](installation.md) и
[operations](operations.md). Глобальные и кампанийные профили сохраняются в одной
шифрованной БД, не в отдельном config-файле установщика.

Поддержанные пути: ChatGPT через официальный Codex app-server; Gemini/Qwen API
через ключ; локальный Ollama и другие OpenAI-compatible runtime. Возможность
работать AI-DM подтверждается настоящим tool-call probe, не только HTTP 200.

Подробная техническая upstream справка сохранена без потери в
[text-backends-reference.md](text-backends-reference.md). Списки моделей в ней могут
отставать: используйте model discovery вашего аккаунта или установленного runtime.
