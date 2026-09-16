import type { Locale } from "./translations";

const en = {
  someone: "Someone", dm: "the Dungeon Master", player: "this player",
  undoTitle: "Undo anyway?", undoConfirm: "Undo anyway", cancel: "Cancel",
  overwrite: "Newer changes touched the same fields; undoing will overwrite them.",
  empty: "No stat changes yet. Damage, loot, XP, conditions, and milestones the DM applies will show here.",
  revert: "Revert this turn ({count})", revertTip: "Undo every sheet change from this DM turn (stats only)",
  undone: "undone", undoTip: "Undo this change (restores the sheet fields it touched)",
  undoFailed: "Could not undo the change.", audioFailed: "Could not read that passage aloud.",
  continueFailed: "Could not continue the scene.", variantFailed: "Could not switch takes.",
  editFailed: "Could not save that edit.", pinFailed: "Could not pin that.",
  canonFailed: "Could not save the fact.", networkFailed: "The server could not be reached.",
  unauthorized: "Sign in again to continue.", forbidden: "You do not have permission for this action.",
  missing: "The requested record no longer exists.", conflict: "The state changed. Refresh and try again.",
  damage: "{name} takes {amount} damage{type} ({hp} HP)",
  formDamage: "{name}'s {form} form takes {amount} damage ({hp} beast HP)",
  formBreak: "{name}'s {form} form breaks", carryover: ", {amount} damage carrying through",
  endurance: "{name} holds on at 1 HP (Relentless Endurance)",
  heal: "{name} heals {amount} ({hp} HP)", xp: "{name} gains {amount} XP ({total} total)",
  goldGain: "{name} gains {amount} gold ({total} gp)", goldLoss: "{name} loses {amount} gold ({total} gp)",
  grant: "{name} receives {item}{qty}", remove: "{name} loses {item}{qty}",
  condition: "{name}: {condition}", clearCondition: "{name} is no longer {condition}",
  slot: "{name} expends a level {level} spell slot", item: "{name} uses {item}",
  sell: "{name} sells {item}{qty} for {price} gold", buy: "{name} buys {item}{qty} for {price} gold",
  receiveResource: "{name} receives {resource} from {from}",
  spendResource: "{name} spends {resource}{qty}", tempHp: "{name} gains {hp} temporary HP",
  forgetSpell: "{name} loses the spell {spell}", learnSpell: "{name} learns the spell {spell}",
  sheet: "The DM rewrites {name}'s sheet ({count} fields)",
  undo: "Party lead undid a change to {name}",
  leadEdit: "Party lead corrected {name} ({count} fields)",
  playerAdjust: "{name}'s player adjusted their counters ({count} fields)",
  other: "{name}: another sheet change",
  narrationLanguage: "Campaign narration language", narrationHelp: "Shared by the entire group. Your interface language is separate.",
  narrationFailed: "Could not save the narration language.", save: "Save", saved: "Saved",
  english: "English", russian: "Russian", polish: "Polish",
} as const;
export type SessionTextKey = keyof typeof en;
export const SESSION_TEXT: Record<Locale, Record<SessionTextKey, string>> = {
  en,
  ru: {
    someone: "Кто-то", dm: "ведущий", player: "этот игрок",
    undoTitle: "Всё равно отменить?", undoConfirm: "Всё равно отменить", cancel: "Отмена",
    overwrite: "Эти поля уже изменились. Отмена перезапишет более поздние изменения.",
    empty: "Изменений характеристик пока нет. Здесь появятся урон, добыча, опыт, состояния и достижения, которые применяет ведущий.",
    revert: "Откатить этот ход ({count})", revertTip: "Отменить все изменения листов за этот ход ведущего (только характеристики)",
    undone: "отменено", undoTip: "Отменить изменение и восстановить затронутые поля листа",
    undoFailed: "Не удалось отменить изменение.", audioFailed: "Не удалось озвучить этот фрагмент.",
    continueFailed: "Не удалось продолжить сцену.", variantFailed: "Не удалось переключить вариант рассказа.",
    editFailed: "Не удалось сохранить правку.", pinFailed: "Не удалось закрепить воспоминание.",
    canonFailed: "Не удалось сохранить факт.", networkFailed: "Не удалось связаться с сервером.",
    unauthorized: "Войдите в учётную запись повторно.", forbidden: "У вас нет прав на это действие.",
    missing: "Запрошенная запись больше не существует.", conflict: "Состояние изменилось. Обновите данные и повторите попытку.",
    damage: "{name} получает {amount} урона{type} ({hp} ОЗ)",
    formDamage: "Форма «{form}» персонажа {name} получает {amount} урона ({hp} ОЗ формы)",
    formBreak: "Форма «{form}» персонажа {name} рассеивается", carryover: ", переносится {amount} урона",
    endurance: "{name} остаётся с 1 ОЗ благодаря неукротимой стойкости",
    heal: "{name} восстанавливает {amount} ОЗ (теперь {hp})", xp: "{name} получает {amount} опыта (всего {total})",
    goldGain: "{name} получает {amount} золота (всего {total})", goldLoss: "{name} теряет {amount} золота (осталось {total})",
    grant: "{name} получает {item}{qty}", remove: "{name} теряет {item}{qty}",
    condition: "{name}: состояние «{condition}»", clearCondition: "{name}: состояние «{condition}» снято",
    slot: "{name} расходует ячейку заклинания {level}-го уровня", item: "{name} использует {item}",
    sell: "{name} продаёт {item}{qty} за {price} золота", buy: "{name} покупает {item}{qty} за {price} золота",
    receiveResource: "{name} получает ресурс «{resource}» от {from}",
    spendResource: "{name} расходует ресурс «{resource}»{qty}", tempHp: "{name} получает {hp} временных ОЗ",
    forgetSpell: "{name} забывает заклинание «{spell}»", learnSpell: "{name} изучает заклинание «{spell}»",
    sheet: "Ведущий изменяет лист персонажа {name} (полей: {count})",
    undo: "Лидер группы отменил изменение персонажа {name}",
    leadEdit: "Лидер группы исправил лист персонажа {name} (полей: {count})",
    playerAdjust: "Игрок персонажа {name} изменил свои счётчики (полей: {count})",
    other: "{name}: другое изменение листа",
    narrationLanguage: "Язык повествования кампании", narrationHelp: "Общий для всей группы. Язык вашего интерфейса выбирается отдельно.",
    narrationFailed: "Не удалось сохранить язык повествования.", save: "Сохранить", saved: "Сохранено",
    english: "Английский", russian: "Русский", polish: "Польский",
  },
  pl: {
    someone: "Ktoś", dm: "Mistrz Gry", player: "ten gracz",
    undoTitle: "Cofnąć mimo to?", undoConfirm: "Cofnij mimo to", cancel: "Anuluj",
    overwrite: "Te pola zostały już zmienione. Cofnięcie nadpisze późniejsze zmiany.",
    empty: "Nie ma jeszcze zmian statystyk. Tutaj pojawią się obrażenia, łupy, doświadczenie, stany i osiągnięcia wprowadzone przez Mistrza Gry.",
    revert: "Cofnij tę turę ({count})", revertTip: "Cofnij wszystkie zmiany kart z tej tury Mistrza Gry (tylko statystyki)",
    undone: "cofnięto", undoTip: "Cofnij zmianę i przywróć odpowiednie pola karty",
    undoFailed: "Nie udało się cofnąć zmiany.", audioFailed: "Nie udało się odczytać tego fragmentu na głos.",
    continueFailed: "Nie udało się kontynuować sceny.", variantFailed: "Nie udało się zmienić wariantu opowieści.",
    editFailed: "Nie udało się zapisać poprawki.", pinFailed: "Nie udało się przypiąć wspomnienia.",
    canonFailed: "Nie udało się zapisać faktu.", networkFailed: "Nie udało się połączyć z serwerem.",
    unauthorized: "Zaloguj się ponownie, aby kontynuować.", forbidden: "Nie masz uprawnień do tej czynności.",
    missing: "Żądany wpis już nie istnieje.", conflict: "Stan się zmienił. Odśwież dane i spróbuj ponownie.",
    damage: "{name} otrzymuje {amount} obrażeń{type} ({hp} PŻ)",
    formDamage: "Postać {name} w formie „{form}” otrzymuje {amount} obrażeń ({hp} PŻ formy)",
    formBreak: "Postać {name} traci formę „{form}”", carryover: ", przechodzi {amount} obrażeń",
    endurance: "{name} zachowuje 1 PŻ dzięki nieustępliwej wytrzymałości",
    heal: "{name} odzyskuje {amount} PŻ (teraz {hp})", xp: "{name} otrzymuje {amount} PD (łącznie {total})",
    goldGain: "{name} zyskuje {amount} szt. złota (łącznie {total})", goldLoss: "{name} traci {amount} szt. złota (pozostało {total})",
    grant: "{name} otrzymuje {item}{qty}", remove: "{name} traci {item}{qty}",
    condition: "{name}: stan „{condition}”", clearCondition: "{name}: stan „{condition}” usunięty",
    slot: "{name} zużywa komórkę czaru poziomu {level}", item: "{name} używa {item}",
    sell: "{name} sprzedaje {item}{qty} za {price} szt. złota", buy: "{name} kupuje {item}{qty} za {price} szt. złota",
    receiveResource: "{name} otrzymuje zasób „{resource}” od {from}",
    spendResource: "{name} zużywa zasób „{resource}”{qty}", tempHp: "{name} otrzymuje {hp} tymczasowych PŻ",
    forgetSpell: "{name} traci czar „{spell}”", learnSpell: "{name} uczy się czaru „{spell}”",
    sheet: "Mistrz Gry zmienia kartę postaci {name} (pola: {count})",
    undo: "Lider drużyny cofnął zmianę postaci {name}",
    leadEdit: "Lider drużyny poprawił kartę postaci {name} (pola: {count})",
    playerAdjust: "Gracz postaci {name} zmienił swoje liczniki (pola: {count})",
    other: "{name}: inna zmiana karty",
    narrationLanguage: "Język narracji kampanii", narrationHelp: "Wspólny dla całej drużyny. Język twojego interfejsu wybierasz osobno.",
    narrationFailed: "Nie udało się zapisać języka narracji.", save: "Zapisz", saved: "Zapisano",
    english: "Angielski", russian: "Rosyjski", polish: "Polski",
  },
};

export function sessionText(locale: Locale, key: SessionTextKey, params: Record<string, unknown> = {}): string {
  // One pass: a character's name containing {amount} is never interpolated again.
  return SESSION_TEXT[locale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name] ?? "") : placeholder);
}

export function sessionRequestError(locale: Locale, fallback: SessionTextKey, status?: number): string {
  const key = status === 401 ? "unauthorized" : status === 403 ? "forbidden" :
    status === 404 ? "missing" : status === 409 ? "conflict" : fallback;
  return sessionText(locale, key);
}

const conditions: Record<string, [string, string]> = {
  blinded: ["ослеплён", "oślepiony"], charmed: ["очарован", "zauroczony"],
  deafened: ["оглохший", "ogłuszony"], frightened: ["испуган", "przerażony"],
  grappled: ["схвачен", "pochwycony"], incapacitated: ["недееспособен", "obezwładniony"],
  invisible: ["невидим", "niewidzialny"], paralyzed: ["парализован", "sparaliżowany"],
  petrified: ["окаменел", "skamieniały"], poisoned: ["отравлен", "zatruty"],
  prone: ["сбит с ног", "powalony"], restrained: ["опутан", "unieruchomiony"],
  stunned: ["ошеломлён", "oszołomiony"], unconscious: ["без сознания", "nieprzytomny"],
  exhaustion: ["истощение", "wyczerpanie"],
};

export function describeAuditEntry(entry: {kind: string; delta: Record<string, unknown>}, name: string, locale: Locale): string {
  const d = entry.delta;
  const quantity = (raw: unknown) => Number(raw) > 1 ? ` ×${raw}` : "";
  const render = (key: SessionTextKey, params: Record<string, unknown> = {}) => sessionText(locale, key, {name, ...params});
  const condition = String(d.condition ?? "");
  const localizedCondition = locale === "en" ? condition : conditions[condition.toLowerCase()]?.[locale === "ru" ? 0 : 1] ?? condition;
  switch (entry.kind) {
    case "apply_damage":
      if (d.form) return d.reverted
        ? render("formBreak", {form: d.form}) + (Number(d.carryover) > 0 ? render("carryover", {amount: d.carryover}) : "")
        : render("formDamage", {form: d.form, amount: d.amount, hp: d.beastHp});
      if (d.relentlessEndurance) return render("endurance");
      return render("damage", {amount: d.amount, type: d.type ? ` (${d.type})` : "", hp: d.currentHp});
    case "heal": return render("heal", {amount: d.amount, hp: d.newHp});
    case "award_xp": return render("xp", {amount: d.amount, total: d.newXp});
    case "modify_gold": return render(Number(d.delta) >= 0 ? "goldGain" : "goldLoss", {amount: Math.abs(Number(d.delta)), total: d.gold});
    case "grant_item": return render("grant", {item: d.name, qty: quantity(d.qty)});
    case "remove_item": return render("remove", {item: d.name, qty: quantity(d.removed)});
    case "set_condition": return render("condition", {condition: localizedCondition});
    case "clear_condition": return render("clearCondition", {condition: localizedCondition});
    case "use_spell_slot": return render("slot", {level: d.level});
    case "use_item": return render("item", {item: d.item});
    case "purchase": return render(d.action === "sell" ? "sell" : "buy", {item: d.item, qty: quantity(d.qty), price: Number(d.price) * Number(d.qty ?? 1)});
    case "use_resource": return d.from ? render("receiveResource", {resource: d.resource, from: d.from}) : render("spendResource", {resource: d.resource, qty: quantity(d.spent)});
    case "grant_temp_hp": return render("tempHp", {hp: d.tempHp});
    case "learn_spell": return render(d.action === "remove" ? "forgetSpell" : "learnSpell", {spell: d.spell});
    case "update_sheet": return render("sheet", {count: Object.keys(d).length});
    case "undo": return render("undo");
    case "lead_edit": return render("leadEdit", {count: Object.keys(d).filter(key => key !== "reason").length});
    case "player_adjust": return render("playerAdjust", {count: Object.keys(d).length});
    default: return render("other");
  }
}
