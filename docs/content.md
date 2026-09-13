# Игровой контент и память

Управляемая установка загружает Open5e content pack и embedding-модель штатными
скриптами приложения после первого успешного запуска. Они не заменяются случайной
LLM-генерацией. Для повторного скачивания выполните `sudo odmctl assets` или
`odmctl.cmd assets` на Windows.

Игровой справочник сохраняется в `state/data/content`, embedding cache — отдельно
в `cache/embeddings`. Ошибка загрузки не уничтожает кампанию: installer завершает
обязательную часть и сообщает о незавершённом provisioning. `--skip-assets` предназначен
для явно выбранной минимальной установки и воспроизводимых тестов, не для заявления
о готовой semantic memory.

Подробности лицензий, состава и исходных fetch-скриптов сохранены в
[content-reference.md](content-reference.md). Правила: [rules-coverage.md](rules-coverage.md).
Для мира кампании см. [worlds.md](worlds.md); резервное копирование — [backups.md](backups.md).
