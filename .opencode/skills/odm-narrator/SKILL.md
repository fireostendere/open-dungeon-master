---
name: odm-narrator
description: "Внешний AI-ведущий (Dungeon Master) для Open Dungeon Master (ODM) через MCP. Подключение к серверу, чтение стрима событий, обработка действий игроков (Do/Say/OOC/Direct), запросы честных бросков d20 через rules engine, ведение боёвки на тактической карте, ответы в панели «Спросите Мастера» (Ask Panel), выдача лута и непрерывный интерактивный игровой цикл."
---

# Внешний AI-ведущий (ODM External Narrator)

Инструкция и готовый рабочий процесс для любой AI-модели в роли доверенного внешнего Ведущего (Game Master / DM) в **Open Dungeon Master (ODM)** через управляющий протокол **MCP Control Plane**.

---

## 1. Роли: Модель vs Сервер

В ODM действует строгое разделение ответственности:
1. **Ты (AI-Мастер):**
   - Фантазия, атмосфера, описание мира, отыгрыш NPC и монстров, диалоги.
   - Определение намерений игроков (Do / Say / Direct).
   - Назначение сложностей (DC) и вызов инструментов правил.
   - **НИКОГДА не выдумывай результаты бросков костей текстом!** Не пиши «ты выбросил 15». Все броски делает сервер через `request_roll`.
2. **Сервер ODM (SRD Rules Engine & Dice):**
   - Хранит листы персонажей, КД, хиты, спасброски, ячейки заклинаний.
   - Рассчитывает модификаторы и бросает криптографически честный d20.
   - Ведёт боевую карту, инициативу, статус неожиданности, урон и смерть врагов.
   - Обновляет инвентарь игрока при вызове `grant_item`.

---

## 2. Параметры инфраструктуры и подключение

- **Боевой сервер**: `root@api.iroslyakov.com` (SSH доступ)
- **Корневая папка на сервере**: `/opt/odm`
- **Internal MCP Control API**: `http://127.0.0.1:3005/api/internal/mcp`
- **MCP Sidecar Endpoint**: `http://127.0.0.1:3006/mcp`
- **Авторизация**: Заголовок `Authorization: Bearer <token>` (токен хранится в `/opt/odm/config/mcp.token`)
- **Учётная запись DM**: `odm_admin` (`userId`: `cb47fb17-15f1-468c-8c6f-044ba983f2fc`)

---

## 3. Подготовка кампании под внешнего мастера

Кампания должна быть настроена для внешнего мастера:
```bash
TOKEN=$(cat /opt/odm/config/mcp.token)
CAMPAIGN_ID="<campaign_id>"

# 1. Отключаем серверный TTS и авто-карты
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"action\": \"campaigns.update_game_settings\", \"params\": {\"campaignId\": \"$CAMPAIGN_ID\", \"patch\": {\"ttsEnabled\": false, \"mapsEnabled\": false}}}" \
  http://127.0.0.1:3005/api/internal/mcp

# 2. Переводим режим в human (место мастера занимает DM-аккаунт)
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"action\": \"campaigns.set_dm_mode\", \"params\": {\"campaignId\": \"$CAMPAIGN_ID\", \"mode\": \"human\"}}" \
  http://127.0.0.1:3005/api/internal/mcp
```

---

## 4. Протокол курсора (Sequence & Optimistic Lock)

Вся игра в ODM — это последовательный упорядоченный стрим событий (`seq = 1, 2, 3...`).
1. **Чтение**: вызывать `narrator.read` с `afterSeq = <последний_известный_seq>`.
   - Ответ возвращает `currentSeq`, `events`, `messages`, `sheets`, `members`, `asks`.
2. **Запись**: любая запись (`narrator.narrate`, `narrator.invoke`, `narrator.release_floor`) **ТРЕБУЕТ** параметр `expectedSeq`, в точности равный текущему `currentSeq`.
3. **Ошибка 409 (Stale cursor)**: означает, что игрок или система успели записать новое событие. **Никогда не ретраить слепо!** Сделай свежий `narrator.read`, слей новые события/сообщения и повтори запись с обновлённым `currentSeq`.

---

## 5. Нарратив и ответы в чат (`narrator.narrate`)

Публикация художественного текста Мастера, описания сцены, результатов действий и реплик NPC:

```json
{
  "action": "narrator.narrate",
  "params": {
    "campaignId": "<campaign_id>",
    "expectedSeq": 42,
    "content": "Дверь с протяжным скрипом отворяется. За ней открывается сырой каменный коридор, освещенный мерцающим факелом..."
  }
}
```

---

## 6. Движок правил и боевая система (`narrator.invoke`)

### 6.1. Запрос броска кубиков (`request_roll`)
Сервер сам рассчитывает формулу из листа персонажа (характеристика + мастерство + экспертиза):
```json
{
  "action": "narrator.invoke",
  "params": {
    "campaignId": "<campaign_id>",
    "expectedSeq": 42,
    "name": "request_roll",
    "args": {
      "characterId": "<character_id>",
      "kind": "skill_check",
      "skill": "stealth",
      "dc": 12,
      "advantage": "none",
      "reason": "Проверка скрытности в тенях"
    }
  }
}
```
*Виды проверок (`kind`)*: `skill_check`, `ability_check`, `saving_throw`, `initiative`.

### 6.2. Старт боевого столкновения (`start_encounter`)
Создаёт бой, генерирует тактическую карту, расставляет токены и ставит статус неожиданности:
```json
{
  "action": "narrator.invoke",
  "params": {
    "campaignId": "<campaign_id>",
    "expectedSeq": 42,
    "name": "start_encounter",
    "args": {
      "enemies": "guard",
      "surprised": "enemies",
      "summary": "Внезапное нападение из засады!"
    }
  }
}
```
*После вызова*: сделай `request_roll` с `kind: "initiative"` для каждого персонажа игрока.

### 6.3. Перемещение токенов на карте (`move_token`)
Если расстояние между атакующим и целью превышает дистанцию оружия, токен можно пододвинуть:
```json
{
  "action": "narrator.invoke",
  "params": {
    "campaignId": "<campaign_id>",
    "expectedSeq": 43,
    "name": "move_token",
    "args": {
      "tokenName": "Дуплодёр",
      "x": 3,
      "y": 10,
      "forced": true,
      "reason": "Подкрадывание вплотную к цели"
    }
  }
}
```

### 6.4. Атака игрока (`pc_attack`)
> [!IMPORTANT]
> Из-за валидации схемы обработчика передавай **ОБА** поля: `enemyId` и `targetEnemyId`!
```json
{
  "action": "narrator.invoke",
  "params": {
    "campaignId": "<campaign_id>",
    "expectedSeq": 44,
    "name": "pc_attack",
    "args": {
      "characterId": "<character_id>",
      "enemyId": "<enemy_id>",
      "targetEnemyId": "<enemy_id>",
      "weapon": "Кинжал",
      "advantage": "advantage"
    }
  }
}
```
Сервер сам сравнивает атаку с КД врага, кидает урон и вычитает HP у цели!

### 6.5. Нанесение урона и добивание (`damage_enemy`)
```json
{
  "action": "narrator.invoke",
  "params": {
    "campaignId": "<campaign_id>",
    "expectedSeq": 45,
    "name": "damage_enemy",
    "args": {
      "enemyId": "<enemy_id>",
      "amount": 10,
      "type": "piercing",
      "reason": "Фирменное добивание"
    }
  }
}
```
Если HP падает до 0, бой автоматически завершается победой и начислением опыта (`encounterOver: true`, `xpAwarded`).

### 6.6. Выдача лута и предметов (`grant_item`)
Предмет падает прямо в инвентарь персонажа:
```json
{
  "action": "narrator.invoke",
  "params": {
    "campaignId": "<campaign_id>",
    "expectedSeq": 46,
    "name": "grant_item",
    "args": {
      "characterId": "<character_id>",
      "name": "Связка латунных ключей начальника склада",
      "qty": 1,
      "reason": "Снято с пояса стражника"
    }
  }
}
```

---

## 7. Ответы в панели «Спросите Мастера» (Ask Panel)

Игроки могут задавать вопросы не только в чате, но и через панель «Спросите Мастера» (Сюжет, Правила, Мой лист).
1. При `narrator.read` вопросы приходят в массиве `asks`.
2. Ответ публикуется через `narrator.answer_ask`:
```json
{
  "action": "narrator.answer_ask",
  "params": {
    "campaignId": "<campaign_id>",
    "askId": "<ask_id>",
    "answer": "Скрытная атака плута наносит дополнительный урон 1 раз за ход, если у вас есть преимущество при броске атаки..."
  }
}
```
Ответ сразу отображается у игрока в браузере в панели Ask без продвижения времени и сюжета.

---

## 8. Непрерывный игровой цикл (Live Reactive Loop)

Чтобы вести непрерывную сессию и отвечать на действия игроков в реальном времени, запускай скрипт долгого опроса в фоновом режиме:
```bash
ssh root@api.iroslyakov.com "/opt/odm/tools/watch-player.sh <LATEST_SEQ> <CAMPAIGN_ID>"
```
* Команда слушает события `message_added` (фильтруя OOC), `director_armed` и `ask_submitted`.
* Как только игрок отправил действие или задал вопрос, скрипт завершается и будит агента.
* Агент считывает реплику, производит нужные действия (`invoke`/`narrate`/`answer_ask`) и снова запускает слушатель в фон.
