# Локальная оркестрация narrator

По умолчанию `narrator/run.mjs` остаётся collector: модель не вызывается. Для одного
campaign host оператор явно включает изолированный OpenCode V2 adapter. Один host
должен обслуживать одну кампанию; распределённой lease здесь нет.

```sh
node narrator/export-opencode-workspace.mjs /srv/odm-narrator-workspace
export ODM_NARRATOR_ADAPTER_MODULE='file:///opt/odm/repository/narrator/local-role-adapter.mjs'
export ODM_OPENCODE_URL='http://127.0.0.1:4096'
export ODM_OPENCODE_WORKSPACE='/srv/odm-narrator-workspace'
export ODM_OPENCODE_PROVIDER='operator-selected-provider'
export ODM_OPENCODE_MODEL='operator-selected-model'
# optionally: ODM_OPENCODE_VARIANT and ODM_OPENCODE_TOKEN
node narrator/run.mjs --campaign "$ODM_CAMPAIGN_ID"
```

Экспорт откажется перезаписать непустой workspace и не меняет глобальную конфигурацию.
Адаптер создаёт свежую role session на генерацию, задаёт выбранные provider/model/variant,
ставит deny-all permissions и до player payload устанавливает каноническую политику из
`mcp/dm-policy.mjs`. Ключи провайдера не читаются и не передаются модели. У generate API
нет usage: host учитывает только число вызовов/байты, а не выдуманные token/cost.

Referee возвращает только JSON `invoke`, `narrate`, `wait` или `done`; host валидирует
allowlist и единолично выполняет записи. Точный commandId/payload сохраняется до записи;
после timeout он перечитывается и повторяется не более одного раза. Бросок не завершает
вход: ожидается подтверждённый roll result, затем требуется narration/done. Cursor чтения
и `handledSeq` входа различны, поэтому пришедшие во время записи сообщения остаются в очереди.
Private Ask, whispers, сырые листы и DM secrets программно не попадают writer/actor; actor
только черновик и никогда не имперсонирует игрока. Серверный autopilot остаётся единственным
автоматическим отправителем player messages.

Поддерживается только не-пространственная публичная сцена. При `spatial` или room-scoped map
автоматизация ставится на паузу, а не публикует потенциально чужие сведения. Нет production
activation и нет cloud/paid calls в этой поставке.
