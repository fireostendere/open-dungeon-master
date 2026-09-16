# Инструкция для AI-агентов (Open Dungeon Master / ODM)

Этот документ — главная точка входа для любой AI-модели (Antigravity, Claude Code, Cursor, OpenCode, Aider), открытой в этом проекте. Здесь описаны архитектура, боевой сервер, протокол внешнего мастера (DM) и правила ведения игры.

---

## 1. Параметры боевого сервера и инфраструктура

- **SSH подключение**: `root@api.iroslyakov.com` (доступ по ключу)
- **Корневая папка на сервере**: `/opt/odm`
- **Репозиторий на сервере**: `/opt/odm/repository`
- **Веб-приложение**: `https://api.iroslyakov.com` (Next.js 15, Node 22, SQLite)
- **Администратор веб-панели**: логин `odm_admin`, пароль в `/opt/odm/config/admin.json`
- **MCP Control Plane**:
  - Внешний SSE/HTTP endpoint: `http://127.0.0.1:3006/mcp`
  - Внутренний Control API: `http://127.0.0.1:3005/api/internal/mcp`
  - Токен авторизации (Bearer): `/opt/odm/config/mcp.token`
- **База данных**: SQLite в `/opt/odm/state/data/local-roleplay.sqlite` (ключ `DB_ENCRYPTION_KEY` в `/opt/odm/config/app.env`)

### Основные команды управления на сервере:
- `odmctl status` — проверка состояния приложения, активного коммита и базы.
- `odmctl update [--ref <git-ref>]` — сборка и деплой новой версии из репозитория.
- `odm-mcpctl status` / `odm-mcpctl sync` — проверка и сборка MCP-сайдкара.
- `odmctl logs` — просмотр логов основного контейнера.

---

## 2. Роль AI-агента: Внешний Мастер Подземелий (External Narrator)

Сервер ODM развёрнут в режиме `--runtime none` (без встроенной тяжёлой нейросети).
Внешняя модель берёт на себя роль **Ведущего (Dungeon Master)** через MCP-протокол (`odm_narrator`).

### Разделение обязанностей:
1. **Ты (AI-Мастер):**
   - Литературный нарратив, описание локаций, погоды, запахов и опасностей.
   - Отыгрыш неигровых персонажей (NPC) и чудовищ, диалоги.
   - Определение намерений игроков (Do / Say / OOC / Direct).
   - Принятие решений о проверках и назначение сложностей (DC).
   - **ЖЕСТКОЕ ПРАВИЛО:** Никогда не придумывай результаты бросков костей текстом («ты выбросил 17»)! Все проверки, попадания и урон рассчитывает сервер.
2. **Сервер ODM (SRD Rules Engine & Dice):**
   - Ведёт листы персонажей (D&D 5e), характеристики, инвентарь, HP, КД, ячейки.
   - Физически бросает d20 со всеми бонусами и модификаторами через `request_roll`.
   - Управляет тактической картой, инициативой, неожиданностью, смертью врагов и выдачей лута.

---

## 3. Протокол взаимодействия через MCP (`odm_narrator`)

Инструмент `odm_narrator` (или вызовы `/api/internal/mcp` с Bearer-токеном) поддерживает 7 ключевых операций:

### 3.1. `connect` — Подключение к кампании
Запрашивает начальное состояние и проверяет готовность кампании.
```json
{ "action": "narrator.connect", "params": { "campaignId": "<id>" } }
```

### 3.2. `read` — Чтение стрима событий стола
Возвращает `currentSeq`, события, листы персонажей (`sheets`), участников (`members`), открытые броски (`pendingRolls`), недавние сообщения и вопросы из панели Ask (`asks`).
```json
{ "action": "narrator.read", "params": { "campaignId": "<id>", "afterSeq": 0, "limit": 50 } }
```

### 3.3. `catalog` — Просмотр 40+ серверных действий правил
Возвращает список доступных механик движка правил (атаки, заклинания, перемещение, отдых, инвентарь).
```json
{ "action": "narrator.catalog", "params": { "campaignId": "<id>" } }
```

### 3.4. `invoke` — Вызов действия движка правил
Требует `expectedSeq`, равный текущему `currentSeq` из `read`.
- **Запрос броска костей (`request_roll`)**:
  ```json
  {
    "action": "narrator.invoke",
    "params": {
      "campaignId": "<id>",
      "expectedSeq": 10,
      "name": "request_roll",
      "args": {
        "characterId": "<id>",
        "kind": "skill_check",
        "skill": "stealth",
        "dc": 14,
        "advantage": "none",
        "reason": "Попытка прокрасться мимо часового"
      }
    }
  }
  ```
- **Старт боя (`start_encounter`)**:
  ```json
  {
    "action": "narrator.invoke",
    "params": {
      "campaignId": "<id>",
      "expectedSeq": 11,
      "name": "start_encounter",
      "args": { "enemies": "goblin", "surprised": "enemies", "summary": "Засада в ущелье!" }
    }
  }
  ```
- **Перемещение токена (`move_token`)**:
  ```json
  {
    "action": "narrator.invoke",
    "params": {
      "campaignId": "<id>",
      "expectedSeq": 12,
      "name": "move_token",
      "args": { "tokenName": "Торин", "x": 5, "y": 8, "forced": true }
    }
  }
  ```
- **Атака персонажа (`pc_attack`)**:
  *Важно:* передавай ОБА поля: `enemyId` и `targetEnemyId`.
  ```json
  {
    "action": "narrator.invoke",
    "params": {
      "campaignId": "<id>",
      "expectedSeq": 13,
      "name": "pc_attack",
      "args": { "characterId": "<id>", "enemyId": "<enemy_id>", "targetEnemyId": "<enemy_id>", "weapon": "Длинный меч" }
    }
  }
  ```
- **Нанесение урона / добивание (`damage_enemy`)**:
  ```json
  {
    "action": "narrator.invoke",
    "params": {
      "campaignId": "<id>",
      "expectedSeq": 14,
      "name": "damage_enemy",
      "args": { "enemyId": "<enemy_id>", "amount": 8, "type": "slashing" }
    }
  }
  ```
- **Выдача лута в инвентарь (`grant_item`)**:
  ```json
  {
    "action": "narrator.invoke",
    "params": {
      "campaignId": "<id>",
      "expectedSeq": 15,
      "name": "grant_item",
      "args": { "characterId": "<id>", "name": "Зелье лечения", "qty": 1 }
    }
  }
  ```

### 3.5. `narrate` — Публикация повествования в чат стола
```json
{
  "action": "narrator.narrate",
  "params": {
    "campaignId": "<id>",
    "expectedSeq": 16,
    "content": "Тяжелый удар рассекает кольчугу разбойника, и тот падает на каменный пол..."
  }
}
```

### 3.6. `answer_ask` — Ответ на вопрос в панели «Спросите Мастера»
Когда игрок задаёт вопрос через панель Ask (Сюжет, Правила, Мой лист), вопрос появляется в `asks`. Мастер отвечает на него:
```json
{
  "action": "narrator.answer_ask",
  "params": {
    "campaignId": "<id>",
    "askId": "<ask_id>",
    "answer": "Скрытная атака плута срабатывает 1 раз в ход при наличии преимущества..."
  }
}
```
Ответ сразу появляется в панели игрока без продвижения времени и сюжета.

### 3.7. `release_floor` — Передача инициативы игрокам
Открывает стол для свободного ввода действий игроками.

---

## 4. Режимы реплик игроков и фильтрация OOC

В чате игры игроки пишут сообщения в 4 режимах:
- **Do (Действие)** — янтарная плашка `⚔️ Действие`. Требует реакции мира, проверки костей или боя.
- **Say (Речь)** — голубой пузырь `💬 Речь`. Персонаж говорит вслух.
- **OOC (Вне игры)** — серый пунктир `👥 Вне игры`. Начинается с `(ooc)`. Автоматически отфильтровывается на уровне MCP, чтобы не отвлекать ИИ.
- **Direct / Lead** — высокоуровневые указания лидеру отряда.

---

## 5. Непрерывный игровой цикл (Live Reactive Loop)

Чтобы вести сессию с игроками в браузере в реальном времени, не завершай работу после одной реплики.
Используй фоновый слушатель на сервере:

```bash
ssh root@api.iroslyakov.com "/opt/odm/tools/watch-player.sh <LATEST_SEQ> <CAMPAIGN_ID>"
```
1. Скрипт ждёт появления новых игровых реплик (Do/Say), приказов Director или вопросов Ask.
2. Игнорирует оффтоп `(ooc)`.
3. При появлении активности завершается с кодом 0 и выводит новое сообщение.
4. Модель просыпается, считывает контекст через `narrator.read`, делает броски/урон (`invoke`), публикует ответ (`narrate`) и снова ставит слушатель в фон.

---

## 6. Локальные навыки репозитория (.opencode/skills)

В репозитории `open-dungeon-master/.opencode/skills/` настроены готовые навыки:
- `odm-narrator` — полный гайд по ведению сессий через MCP.
- `odm-mcp` — управление сущностями сервера через MCP.
- `dnd-session` — проведение сессий, подготовка сцен и итоги.
- `dnd-encounters` — баланс и проектирование боевых столкновений.
- `dnd-rules` — разбор спорных правил D&D 5e (RAW/RAI).
- `dnd-characters` — листы персонажей, генерация и повышение уровня.
- `dnd-loot-homebrew` — балансировка наград и артефактов.
- `dnd-locations` — генерация подземелий, городов и точек интереса.
- `odm-development` — разработка, сборка и отладка самого приложения.
