"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Loader2, RotateCcw, ScrollText, Star } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useI18n, type Locale } from "@/lib/i18n";
import type { CharacterEvent } from "@/lib/db/character-events";
import type { AuditEntry } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const copy = {
  en: {
    someone: "Someone", undoAnyway: "Undo anyway?", overwrite: "Newer changes touched the same fields; undoing will overwrite them.", cancel: "Cancel", empty: "No stat changes yet. Damage, loot, XP, conditions, and milestones the DM applies will show here.", revert: "Revert this turn", revertTip: "Undo every sheet change from this DM turn (stats only)", undone: "undone", undoTip: "Undo this change (restores the sheet fields it touched)",
  },
  ru: {
    someone: "Кто-то", undoAnyway: "Всё равно отменить?", overwrite: "Те же поля уже менялись позже; отмена перезапишет новые изменения.", cancel: "Отмена", empty: "Изменений характеристик пока нет. Здесь появятся урон, добыча, XP, состояния и вехи, которые применяет ведущий.", revert: "Откатить этот ход", revertTip: "Отменить все изменения листов из этого хода ведущего (только характеристики)", undone: "отменено", undoTip: "Отменить это изменение и восстановить затронутые поля листа",
  },
  pl: {
    someone: "Ktoś", undoAnyway: "Cofnąć mimo to?", overwrite: "Te same pola zostały później zmienione; cofnięcie nadpisze nowsze zmiany.", cancel: "Anuluj", empty: "Nie ma jeszcze zmian statystyk. Tutaj pojawią się obrażenia, łupy, XP, stany i kamienie milowe zastosowane przez Mistrza Gry.", revert: "Cofnij tę turę", revertTip: "Cofnij wszystkie zmiany kart z tej tury MG (tylko statystyki)", undone: "cofnięto", undoTip: "Cofnij tę zmianę i przywróć zmienione pola karty",
  },
} satisfies Record<Locale, Record<string, string>>;

function describeEntry(entry: AuditEntry, name: string, locale: Locale): string {
  const d = entry.delta;
  const n = Number;
  if (locale === "ru") {
    switch (entry.kind) {
      case "apply_damage": return d.form ? (d.reverted ? `Форма ${d.form} персонажа ${name} рассеивается${n(d.carryover) > 0 ? `, ${d.carryover} урона переносится` : ""}` : `Форма ${d.form} персонажа ${name} получает ${d.amount} урона (${d.beastHp} HP формы)`) : d.relentlessEndurance ? `${name} удерживается на 1 HP (Неукротимая стойкость)` : `${name} получает ${d.amount} урона${d.type ? ` (${d.type})` : ""} (${d.currentHp} HP)`;
      case "heal": return `${name} восстанавливает ${d.amount} HP (${d.newHp} HP)`;
      case "award_xp": return `${name} получает ${d.amount} XP (всего ${d.newXp})`;
      case "modify_gold": return `${name} ${n(d.delta) >= 0 ? "получает" : "теряет"} ${Math.abs(n(d.delta))} золота (всего ${d.gold})`;
      case "grant_item": return `${name} получает ${d.name}${n(d.qty) > 1 ? ` ×${d.qty}` : ""}`;
      case "remove_item": return `${name} теряет ${d.name}${n(d.removed) > 1 ? ` ×${d.removed}` : ""}`;
      case "set_condition": return `${name}: состояние ${d.condition}`;
      case "clear_condition": return `${name}: состояние ${d.condition} снято`;
      case "use_spell_slot": return `${name} расходует ячейку заклинания ${d.level}-го уровня`;
      case "use_item": return `${name} использует ${d.item}`;
      case "purchase": return d.action === "sell" ? `${name} продаёт ${d.item}${n(d.qty) > 1 ? ` ×${d.qty}` : ""} за ${n(d.price) * n(d.qty ?? 1)} золота` : `${name} покупает ${d.item}${n(d.qty) > 1 ? ` ×${d.qty}` : ""} за ${n(d.price) * n(d.qty ?? 1)} золота`;
      case "use_resource": return d.from ? `${name} получает ${d.resource} от ${d.from}` : `${name} расходует ${n(d.spent) > 1 ? `${d.spent} ед. ресурса ` : ""}${d.resource}`;
      case "grant_temp_hp": return `${name} получает ${d.tempHp} временных HP`;
      case "learn_spell": return d.action === "remove" ? `${name} забывает заклинание ${d.spell}` : `${name} изучает заклинание ${d.spell}`;
      case "update_sheet": { const changed = Object.keys(d); return `Ведущий изменяет лист ${name}${changed.length ? ` (${changed.join(", ")})` : ""}`; }
      case "undo": return `Лидер группы отменил изменение ${name}`;
      case "lead_edit": { const changed = Object.keys(d).filter((key) => key !== "reason"); return `Лидер группы исправил ${name}${changed.length ? ` (${changed.join(", ")})` : ""}`; }
      case "player_adjust": { const changed = Object.keys(d); return `Игрок ${name} изменил свои счётчики${changed.length ? ` (${changed.join(", ")})` : ""}`; }
      default: return `${name}: ${entry.kind}`;
    }
  }
  if (locale === "pl") {
    switch (entry.kind) {
      case "apply_damage": return d.form ? (d.reverted ? `Forma ${d.form} postaci ${name} znika${n(d.carryover) > 0 ? `, ${d.carryover} obrażeń przechodzi dalej` : ""}` : `Forma ${d.form} postaci ${name} otrzymuje ${d.amount} obrażeń (${d.beastHp} HP formy)`) : d.relentlessEndurance ? `${name} utrzymuje się na 1 HP (Nieustępliwa wytrzymałość)` : `${name} otrzymuje ${d.amount} obrażeń${d.type ? ` (${d.type})` : ""} (${d.currentHp} HP)`;
      case "heal": return `${name} odzyskuje ${d.amount} HP (${d.newHp} HP)`;
      case "award_xp": return `${name} otrzymuje ${d.amount} XP (łącznie ${d.newXp})`;
      case "modify_gold": return `${name} ${n(d.delta) >= 0 ? "zyskuje" : "traci"} ${Math.abs(n(d.delta))} szt. złota (${d.gold} łącznie)`;
      case "grant_item": return `${name} otrzymuje ${d.name}${n(d.qty) > 1 ? ` ×${d.qty}` : ""}`;
      case "remove_item": return `${name} traci ${d.name}${n(d.removed) > 1 ? ` ×${d.removed}` : ""}`;
      case "set_condition": return `${name}: stan ${d.condition}`;
      case "clear_condition": return `${name}: stan ${d.condition} usunięty`;
      case "use_spell_slot": return `${name} zużywa komórkę czaru poziomu ${d.level}`;
      case "use_item": return `${name} używa ${d.item}`;
      case "purchase": return d.action === "sell" ? `${name} sprzedaje ${d.item}${n(d.qty) > 1 ? ` ×${d.qty}` : ""} za ${n(d.price) * n(d.qty ?? 1)} szt. złota` : `${name} kupuje ${d.item}${n(d.qty) > 1 ? ` ×${d.qty}` : ""} za ${n(d.price) * n(d.qty ?? 1)} szt. złota`;
      case "use_resource": return d.from ? `${name} otrzymuje ${d.resource} od ${d.from}` : `${name} zużywa ${n(d.spent) > 1 ? `${d.spent} użycia zasobu ` : ""}${d.resource}`;
      case "grant_temp_hp": return `${name} otrzymuje ${d.tempHp} tymczasowych HP`;
      case "learn_spell": return d.action === "remove" ? `${name} traci czar ${d.spell}` : `${name} uczy się czaru ${d.spell}`;
      case "update_sheet": { const changed = Object.keys(d); return `MG zmienia kartę ${name}${changed.length ? ` (${changed.join(", ")})` : ""}`; }
      case "undo": return `Lider drużyny cofnął zmianę ${name}`;
      case "lead_edit": { const changed = Object.keys(d).filter((key) => key !== "reason"); return `Lider drużyny poprawił ${name}${changed.length ? ` (${changed.join(", ")})` : ""}`; }
      case "player_adjust": { const changed = Object.keys(d); return `Gracz ${name} zmienił swoje liczniki${changed.length ? ` (${changed.join(", ")})` : ""}`; }
      default: return `${name}: ${entry.kind}`;
    }
  }
  switch (entry.kind) {
    case "apply_damage": return d.form ? (d.reverted ? `${name}'s ${d.form} form breaks${n(d.carryover) > 0 ? `, ${d.carryover} damage carrying through` : ""}` : `${name}'s ${d.form} form takes ${d.amount} damage (${d.beastHp} beast HP)`) : d.relentlessEndurance ? `${name} holds on at 1 HP (Relentless Endurance)` : `${name} takes ${d.amount} damage${d.type ? ` (${d.type})` : ""} (${d.currentHp} HP)`;
    case "heal": return `${name} heals ${d.amount} (${d.newHp} HP)`;
    case "award_xp": return `${name} gains ${d.amount} XP (${d.newXp} total)`;
    case "modify_gold": return `${name} ${n(d.delta) >= 0 ? "gains" : "loses"} ${Math.abs(n(d.delta))} gold (${d.gold} gp)`;
    case "grant_item": return `${name} receives ${d.name}${n(d.qty) > 1 ? ` x${d.qty}` : ""}`;
    case "remove_item": return `${name} loses ${d.name}${n(d.removed) > 1 ? ` x${d.removed}` : ""}`;
    case "set_condition": return `${name} is ${d.condition}`;
    case "clear_condition": return `${name} is no longer ${d.condition}`;
    case "use_spell_slot": return `${name} expends a level ${d.level} spell slot`;
    case "use_item": return `${name} uses ${d.item}`;
    case "purchase": return d.action === "sell" ? `${name} sells ${d.item}${n(d.qty) > 1 ? ` x${d.qty}` : ""} for ${n(d.price) * n(d.qty ?? 1)} gold` : `${name} buys ${d.item}${n(d.qty) > 1 ? ` x${d.qty}` : ""} for ${n(d.price) * n(d.qty ?? 1)} gold`;
    case "use_resource": return d.from ? `${name} receives ${d.resource} from ${d.from}` : `${name} spends ${n(d.spent) > 1 ? `${d.spent} uses of ` : ""}${d.resource}`;
    case "grant_temp_hp": return `${name} gains ${d.tempHp} temporary HP`;
    case "learn_spell": return d.action === "remove" ? `${name} loses the spell ${d.spell}` : `${name} learns the spell ${d.spell}`;
    case "update_sheet": { const changed = Object.keys(d); return `The DM rewrites ${name}'s sheet${changed.length ? ` (${changed.join(", ")})` : ""}`; }
    case "undo": return `Party lead undid a change to ${name}`;
    case "lead_edit": { const changed = Object.keys(d).filter((key) => key !== "reason"); return `Party lead corrected ${name}${changed.length ? ` (${changed.join(", ")})` : ""}`; }
    case "player_adjust": { const changed = Object.keys(d); return `${name}'s player adjusted their counters${changed.length ? ` (${changed.join(", ")})` : ""}`; }
    default: return `${name}: ${entry.kind}`;
  }
}

function ConfirmUndoDialog({ warnings, busy, onConfirm, onCancel, locale }: { warnings: string[]; busy: boolean; onConfirm: () => void; onCancel: () => void; locale: Locale }) {
  const c = copy[locale];
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <AlertDialog.Content className={cn(ui.dialog, "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,22rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto")}>
          <AlertDialog.Title className="font-display text-lg tracking-wide text-amber-50">{c.undoAnyway}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-xs text-stone-400">{c.overwrite}</AlertDialog.Description>
          <ul className="mt-2 space-y-1">{warnings.slice(0, 5).map((warning, index) => <li key={index} className="text-[11px] leading-4 text-amber-300/80">{warning}</li>)}</ul>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel className={ui.btnSmall}>{c.cancel}</AlertDialog.Cancel>
            <button type="button" onClick={onConfirm} disabled={busy} className={ui.btnPrimary}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} {c.undoAnyway}</button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type FeedItem = { type: "audit"; seq: number; entry: AuditEntry } | { type: "milestone"; seq: number; event: CharacterEvent };

export function EventLog({ campaignId, auditLog, sheets, characterEvents = [], steersStory = false }: { campaignId: string; auditLog: AuditEntry[]; sheets: CharacterSheet[]; characterEvents?: CharacterEvent[]; steersStory?: boolean }) {
  const { locale } = useI18n();
  const c = copy[locale];
  const [busyId, setBusyId] = useState("");
  const [confirming, setConfirming] = useState<{ warnings: string[]; run: () => Promise<void> } | null>(null);
  const nameForCharacter = (characterId: string) => sheets.find((sheet) => sheet.id === characterId)?.name ?? c.someone;
  const nameFor = (entry: AuditEntry) => entry.characterName ?? nameForCharacter(entry.characterId);

  async function post(url: string, body: Record<string, unknown>, busyKey: string) {
    setBusyId(busyKey);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 409) {
        const data = await response.json().catch(() => ({}));
        setConfirming({ warnings: Array.isArray(data.warnings) ? data.warnings : [], run: async () => { await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, confirm: true }) }); setConfirming(null); } });
      }
    } finally { setBusyId(""); }
  }

  const undoEntry = (entry: AuditEntry) => post(`/api/campaigns/${campaignId}/audit/${entry.id}/undo`, {}, entry.id);
  const revertTurn = (turnId: string) => post(`/api/campaigns/${campaignId}/audit/revert-turn`, { turnId }, `turn:${turnId}`);
  const feed: FeedItem[] = [
    ...auditLog.map((entry) => ({ type: "audit" as const, seq: entry.seq, entry })),
    ...characterEvents.map((event) => ({ type: "milestone" as const, seq: event.seq, event })),
  ].sort((a, b) => b.seq - a.seq);
  if (!feed.length) return <p className="px-1 py-6 text-center text-xs text-stone-600">{c.empty}</p>;

  const liveByTurn = new Map<string, number>();
  for (const entry of auditLog) if (entry.turnId && entry.undoable && !entry.revertedAt && entry.kind !== "undo") liveByTurn.set(entry.turnId, (liveByTurn.get(entry.turnId) ?? 0) + 1);
  const revertShownForTurn = new Set<string>();

  return (
    <>
      <ol className="space-y-1.5">
        {feed.map((item) => {
          if (item.type === "milestone") return <li key={`m-${item.event.id}`} className="rounded-md border border-amber-900/40 bg-amber-950/15 px-2.5 py-1.5 text-xs text-stone-300"><Star className="mr-1.5 inline size-3 text-amber-400" />{nameForCharacter(item.event.campaignCharacterId)}: {item.event.summary}</li>;
          const entry = item.entry;
          const reverted = Boolean(entry.revertedAt);
          const canUndo = steersStory && entry.undoable && !reverted;
          const turnId = entry.turnId ?? "";
          const showRevertTurn = steersStory && Boolean(turnId) && (liveByTurn.get(turnId) ?? 0) >= 2 && !revertShownForTurn.has(turnId);
          if (showRevertTurn) revertShownForTurn.add(turnId);
          return (
            <li key={entry.id} className="space-y-1">
              {showRevertTurn ? <button type="button" disabled={busyId === `turn:${turnId}`} onClick={() => revertTurn(turnId)} title={c.revertTip} className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-stone-700 py-0.5 text-[10px] text-stone-500 hover:bg-stone-900 hover:text-amber-300">{busyId === `turn:${turnId}` ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} {c.revert} ({liveByTurn.get(turnId)})</button> : null}
              <div className={cn("rounded-md border border-stone-800 bg-stone-950/40 px-2.5 py-1.5 text-xs text-stone-300", reverted && "opacity-60")}>
                <div className="flex items-start gap-1.5">
                  <span className={cn("min-w-0 flex-1", reverted && "line-through text-stone-500")}><ScrollText className="mr-1.5 inline size-3 text-amber-600" />{describeEntry(entry, nameFor(entry), locale)}</span>
                  {reverted ? <span className="shrink-0 rounded-full border border-stone-800 px-1.5 text-[9px] uppercase tracking-wide text-stone-600">{c.undone}</span> : null}
                  {canUndo ? <button type="button" disabled={busyId === entry.id} onClick={() => undoEntry(entry)} title={c.undoTip} className="shrink-0 text-stone-600 hover:text-amber-300">{busyId === entry.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}</button> : null}
                </div>
                {entry.reason ? <span className="block pl-4.5 text-[11px] text-stone-500">{entry.reason}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {confirming ? <ConfirmUndoDialog warnings={confirming.warnings} busy={false} onConfirm={() => void confirming.run()} onCancel={() => setConfirming(null)} locale={locale} /> : null}
    </>
  );
}
