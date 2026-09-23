# Документация Dungeon Master

## Установка и эксплуатация — актуальные инструкции форка

Основная реализация — `main`: два корневых установщика и общий контроллер
`deploy/odmctl.py`. Исторические ветки `astra/managed-installation`,
`astra/managed-installers` и `astra/deployment-installers` содержат альтернативные
варианты, а не дополнительные компоненты. Не смешивайте их установщики, команды,
каталоги данных и форматы резервных копий с основной установкой. Автоматическая
миграция из этих экспериментальных вариантов не предусмотрена.

- [Установка одним файлом: Linux и Windows](installation.md)
- [Конфигурация и размещение данных](configuration.md)
- [Запуск, обновление, откат, мониторинг и расписания](operations.md)
- [Бэкапы, off-site и восстановление на новой машине](backups.md)
- [Подключение ChatGPT, Gemini, Qwen и локальных runtime](llm-wizard.md)
- [Изображения, ComfyUI, карты и портреты](image-generation.md)
- [Внешняя генерация артов через MCP: packs, jobs, binary upload, references](external-assets-mcp.md)
- [Автотесты и точные границы проверки](deployment-testing.md)

## Игра, контент и разработка

[Покрытие правил](rules-coverage.md), [контент](content.md), [миры](worlds.md),
[лицензии](LICENSES.md), [roadmap](ROADMAP.md). Документы с `plan` или `audit`
описывают проектирование/аудит, а не автоматически доказанную готовность функций.

[Навыки OpenCode для ODM и D&D](agent-skills.md): локальная навигация по разработке,
эксплуатации и подготовке игры; они не меняют runtime DM автоматически.

## Справочные и исторические материалы

[Полная upstream конфигурация](configuration-reference.md),
[upstream текстовые backend](text-backends-reference.md),
[upstream image workflow](image-generation-reference.md),
[исходное описание проекта](upstream-readme.md).
Они сохранены, чтобы не потерять технические подробности. Для установки и путей
этого форка приоритет имеют инструкции первой секции.

[Заметки старой локальной установки](local/README.md) не являются инструкцией
чистого сервера.
