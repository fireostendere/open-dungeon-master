# Внешний ведущий: расширенный протокол

Дополнение к навыку [odm-narrator](../.opencode/skills/odm-narrator/SKILL.md)
для режимов, которые обычный стол не использует. Навык намеренно не содержит
этих разделов, чтобы не занимать контекст модели на каждом ходе; host
подгружает их только когда `gameSettings` или события кампании их требуют.

## Чтение и запись: детали cursor protocol

Для bounded read с `paged:true` собирайте все страницы одного snapshot `hash`
через `pageCursor`/`nextPage`; при смене hash начните snapshot заново и не
двигайте story cursor. `projection:live` намеренно убирает только перечисленные
`omittedSections`, не текущие результаты и новые rolls. После полного чтения
сохраняйте `stateDelta.revision`; передавайте его как `knownStateRevision` при
следующем read и в `readAfter`. Применяйте patch только к совпадающим
timeline/projection; `full:true` заменяет baseline. Legacy `sectionVersions`
остаётся допустимым. `connect(stateDelta:true)` возвращает cursor metadata, а
baseline и последующие изменения приходят через `read`; аргументы механики
остаются в `args`. Публичная схема `odm_narrator` сохраняет `commandId`,
`expectedVersion` и `timelineEpoch`; mandatory preload добавляет внешние tools
и policy resource, но не владеет narrator-схемой.

Формат `readAfter` для host без автоматической подстановки:
`{afterSeq: <последний дочитанный cursor>, projection: "live", delta: true,
paged: true, stateDelta: true, knownStateRevision: <revision>}`. Явная revision
сокращает ответ до patch. Если `hasMore`, страницы или ошибка readback —
дочитайте перед следующей записью; не повторяйте подтверждённую мутацию.

## `delete_message`

Отдельная сериализованная story-write операция для удаления сообщения из
основного transcript по точному `messageId`. Она может удалить сообщение
игрока, DM или system; используйте только ID из актуального разрешённого read
(либо явно переданный оператором) вместе с текущими `expectedSeq`,
`timelineEpoch` и сохранённым `commandId`. Удаление убирает transcript-derived
pins/beats, но не является откатом игры: броски, HP, ресурсы и уже применённые
механические эффекты сохраняются, как и moderation audit. Для изменения
механики используйте авторитетные engine actions или явный rewind. Если
удалена именно текущая удерживаемая боевая заявка, поле `inputReopened`
подтверждает возврат ввода тому же игроку; перед приглашением действовать
проверьте `floor` через read. Если `floor` всё ещё удерживается, используйте
`request_player_input` для того же бойца только при выполнении его боевых
проверок. Уже потраченные действия и броски не восстанавливаются.

## Общий ход (global-turn)

При включённом `gameSettings.globalTurn.enabled` сервер, а не модель, владеет
`roundNumber` и фазой раунда. Фаза `waiting` — жёсткий lock: игроки ещё не
могут вводить действия. На старте/повторном включении дождитесь
`global_turn_narrator_trigger`, опишите открывающую сцену и завершите запись
`narrate` с `startGlobalRound=<roundNumber>`. Только подтверждённая запись
открывает `active` и разблокирует ввод.

Во время `active/quorum_delay` не отвечайте на отдельные player messages.
Дождитесь `global_turn_ready`: все player messages до seq этого события
образуют один атомарный `global_round`. Разрешите весь пакет через серверные
действия и закончите публичной narration с `completeGlobalRound=<roundNumber>`.
Сервер сам увеличивает счётчик и открывает следующий раунд только после commit
этой narration. `wait`, `release_floor` и `request_player_input` не закрывают
общий раунд; `done` в обычном общем чате тоже не закрывает его: нужен
финальный `narrate`. В spatial-режиме каждую комнату из `input.roomIds` сначала
завершите отдельным `location_narrate`; только после этого `done` разрешает
host выполнить `finish_global_round` как no-prose finalizer. Он допустим только
для spatial global-turn и требует тех же cursor/idempotency полей. При
ошибке/остановке модели раунд остаётся locked; не подменяйте это ручным
«завершить ход».

`turnCollectionMinutes=0` означает отсутствие timeout, а
`quorumDelayMinutes=0` — немедленное закрытие ввода при достижении кворума.

## Автопилот игрока

`autopilot_action` доступен только в активной фазе global-turn без боевой
инициативы. Требует точные `characterId`, `roundNumber`, `expectedSeq`,
`timelineEpoch` и сохранённый `commandId`; сервер повторно проверяет opt-in,
skip/mute/floor и отсутствие хода. Подробности — навык `dnd-doppelganger`.

## Режим `jrpg`

Из `connect`/`read` определите `gameSettings.combatMode`. В `jrpg` это явное
campaign house rule: внутри текущей встречи дальность, LOS, укрытие и
opportunity attacks не блокируют законную цель. Всё остальное — инициатива,
действия, кости, ячейки, боеприпасы, HP, состояния и privacy — остаётся за
движком. Не объединяйте комнаты или встречи и не объявляйте Sneak Attack, Pack
Tactics либо flanking автоматически. Ведущий не меняет этот режим по story/Ask:
только аутентифицированный оператор через settings.

## Монах 2014: ки и лечение

`use_resource(resource:"ki", variant:"hand_of_healing", targetCharacterId)`
платит действие и ки, бросает лечение и меняет HP одной командой.
`flurry_of_healing` после Attack тратит бонусное действие и 1 ки, заменяет
один удар лечением; оставшийся заявленный удар —
`pc_attack(weapon:"Unarmed strike", flurry:true)`. Проверяйте касание цели.
Эти шаги помещаются в один `combat_turn`; отдельные `request_roll`/`heal` не
нужны.

## Единицы измерения

Сервер переводит поддержанные числовые меры в новом тексте ГМ; это страховка,
не разрешение писать имперские меры словами. Исправление единиц не даёт права
перебрасывать кости или повторно применять уже подтверждённую механику.

## Пробуждение вне OpenCode

`watch-player.sh` — лишь ускоритель пробуждения. После него всё равно сделайте
authoritative read; передавайте только seq последней фактически обработанной
реплики игрока, а не `currentSeq` после записей мастера.
`GET /mcp/events?campaignId=…&afterSeq=…` (тот же bearer, что у `/mcp`) — такой
же SSE-звонок без содержимого: только `{type, seq}` и `authorType`/`kind` у
сообщений. После сигнала всё равно делайте read. В OpenCode ожидание
автоматическое (плагин `dnd-watch`).
