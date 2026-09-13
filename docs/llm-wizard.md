# Подключение LLM

В браузере: **Admin → Подключения LLM**. На управляемой установке CLI вызывается
через `sudo odmctl auth …` (Windows: `odmctl.cmd auth …`). На ручной установке
из корня исходников остаётся `npm run auth -- …`.

## ChatGPT

Управляемый Docker image уже содержит официальный Codex CLI 0.154.0 в отдельном
каталоге. Никакие cookies/токены из браузера или OpenCode не копируются.

```bash
sudo odmctl auth login chatgpt --device
sudo odmctl auth models chatgpt
sudo odmctl auth connect chatgpt --model EXACT_MODEL_ID --apply
```

Откройте выданную официальную ссылку и подтвердите вход своим аккаунтом. Для
удалённого сервера и Docker выбирайте код устройства. Обычный браузерный callback
требует доступного localhost Codex и не пробрасывается контейнером автоматически.

Выбирается точный ID из аккаунта. ChatGPT login не превращается в безлимитный API
и не предоставляет автоматически подписочную генерацию изображений. Используется
официальный experimental dynamicTools интерфейс; код проверяется с закреплённой
версией CLI, но персональная подписка требует реального входа владельца.

## Gemini и Qwen

Gemini Developer API — официальный API-ключ, **не** подписочный OAuth Google AI Pro.
Qwen — DashScope/Token Plan API-ключ, либо локальный сервер без облачного ключа.
Старый браузерный Qwen OAuth не заявлен как рабочая функция.

```bash
sudo odmctl auth connect gemini --model EXACT_MODEL_ID --key-stdin --apply
sudo odmctl auth connect qwen --model EXACT_MODEL_ID --region international --key-stdin --apply
sudo odmctl auth connect qwen-local --model INSTALLED_MODEL \
  --base-url http://ollama:11434/v1 --apply
```

Для ввода ключа используйте password-поле админки или stdin до EOF. Не помещайте
ключ в командную строку. Для Qwen регион ключа должен совпадать: international,
china или token-plan. Для LM Studio, llama.cpp, vLLM и других совместимых серверов
можно использовать `qwen-local` как подключение OpenAI-compatible runtime; модель
не обязана называться Qwen.

## Проверка перед применением

Успешное соединение само по себе недостаточно. Визард проверяет chat → native
function call → реальный результат инструмента → итоговый ответ. Модель, которая
только пишет «я вызываю инструмент», не проходит. Неудачная проверка не меняет DM.
Смена адреса/модели/ключа сбрасывает старый результат проверки.

Глобальный default и overrides конкретных кампаний различаются. У существующей
кампании выберите сохранённый профиль в её настройках, если она использует свой
backend. Настройка DM не меняет ComfyUI и другие image-провайдеры.

Для тонких upstream-параметров см. [text-backends-reference.md](text-backends-reference.md).
Наличие поля contextLimit не следует принимать за доказательство реального окна
модели: проверяйте runtime context и бюджет промпта отдельно.
