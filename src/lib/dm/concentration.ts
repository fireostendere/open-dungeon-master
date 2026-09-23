import { randomUUID } from "node:crypto";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getDatabase } from "@/lib/db/core";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { getEnemy, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { findSpellByName } from "@/lib/content";
import { allySaveAura } from "@/lib/dm/aura";
import { computeSheetDerived } from "@/lib/srd";
import { conditionConcentrationFloor } from "@/lib/srd/condition-effects";
import { removeConcentrationSources, sameConcentrationOwner } from "@/lib/dm/condition-sources";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet, ConcentrationSource } from "@/lib/schemas/sheet";

// Server-tracked concentration: casting a concentration spell sets it (and
// breaks the previous one), taking damage forces the CON save server-side,
// and dropping to 0 HP always ends it. This module must not import
// mutations.ts (which imports it). Source-scoped cleanup is shared with
// enemy concentration; spell names alone never authorize removing effects.

// Whether a spell requires concentration: exact-name match against the
// Open5e content pack plus the caster's homebrew. Null when unknown.
export function spellRequiresConcentration(spellName: string, userId: string): boolean | null {
  const exact = findSpellByName(spellName, userId);
  return exact ? exact.concentration : null;
}

function writeConcentration(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  concentratingOn: string | null,
  reason: string,
) {
  const patch = { concentratingOn };
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind: "concentration",
    delta: patch,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Sets concentration on a newly cast spell; returns the spell it displaced,
// if any. Caller has already verified the spell requires concentration.
export function setConcentration(
  campaign: Campaign,
  turnId: string,
  sheetId: string,
  spell: string,
): { displaced: string | null } {
  const sheet = getSheetById(sheetId);
  if (!sheet || sheet.campaignId !== campaign.id) {
    return { displaced: null };
  }
  const displaced = sheet.concentratingOn;
  // Recasting the same spell is a new application too. Clear the previous
  // owner's instances BEFORE applying new targets, not all same-name buffs.
  if (displaced) clearSpellConditionsByName(campaign, displaced, sheet.userId, { casterId: sheet.id, casterKind: "pc" }, turnId);
  writeConcentration(campaign, turnId, getSheetById(sheet.id) ?? sheet, spell, `casting ${spell}`);
  return { displaced };
}

export function breakConcentration(
  campaign: Campaign,
  turnId: string | null,
  sheetId: string,
  cause: string,
): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet?.concentratingOn || sheet.campaignId !== campaign.id) {
    return null;
  }
  const spell = sheet.concentratingOn;
  writeConcentration(campaign, turnId, sheet, null, cause);
  // The spell's lingering effect conditions end with the concentration:
  // Bless's dice, Haste's action, Hold Person's paralysis all stop here
  // instead of waiting for their duration to expire.
  clearSpellConditionsByName(campaign, spell, sheet.userId, { casterId: sheet.id, casterKind: "pc" }, turnId);
  return spell;
}

// A source is minted only for a real caster in this campaign who currently
// maintains this spell. Internal casting tools share one ID across targets.
export function concentrationSourceFor(
  campaign: Campaign, casterId: string, casterKind: "pc" | "enemy", spell: string,
  instanceId: string = randomUUID(),
): ConcentrationSource | undefined {
  const caster = casterKind === "pc" ? getSheetById(casterId) : getEnemy(casterId);
  if (!caster || caster.campaignId !== campaign.id) return undefined;
  const held = "concentratingOn" in caster ? caster.concentratingOn : caster.concentration;
  if (!held || held.trim().toLowerCase() !== spell.trim().toLowerCase()) return undefined;
  return { casterId, casterKind, spell: held, instanceId };
}

// Keep the exported name for existing callers, but an absent owner is a
// deliberate no-op. Legacy unowned conditions need explicit DM clearing;
// guessing from a spell name can destroy another caster's independent state.
export function clearSpellConditionsByName(
  campaign: Campaign,
  spell: string,
  _userId?: string,
  owner?: Pick<ConcentrationSource, "casterId" | "casterKind">,
  turnId: string | null = null,
) {
  if (!owner) return;
  const identity = { ...owner, spell };
  for (const target of listSheets(campaign.id)) {
    const cleared = removeConcentrationSources(target.conditions, target.conditionMeta, identity);
    const revertsForm = target.wildShape?.kind === "polymorph" &&
      target.wildShape.concentrationSource && sameConcentrationOwner(target.wildShape.concentrationSource, identity);
    if (cleared.meta === target.conditionMeta && !revertsForm) continue;
    const patch = { conditions: cleared.conditions, conditionMeta: cleared.meta, ...(revertsForm ? { wildShape: null } : {}) };
    const updated = patchSheet(target.id, patch);
    const entry = insertSheetAudit({
      campaignId: campaign.id, characterId: target.id, turnId,
      kind: "concentration_effects", delta: { casterId: owner.casterId, spell },
      reason: `source concentration ended: ${spell}`, seq: allocateSeq(campaign.id), before: target, patch,
    });
    publishPersisted(campaign.id, "sheet_audit", { entry, characterName: target.name });
    if (updated) publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  // Read every encounter in this campaign, not an arbitrary active room.
  // Only matching source IDs change; other rooms/casters remain untouched.
  const encounters = getDatabase().prepare("SELECT id FROM encounters WHERE campaign_id = ?").all(campaign.id) as { id: string }[];
  let enemiesChanged = false;
  for (const encounter of encounters) for (const enemy of listEnemies(encounter.id)) {
    const cleared = removeConcentrationSources(enemy.conditions, enemy.conditionMeta, identity);
    if (cleared.meta === enemy.conditionMeta) continue;
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    enemiesChanged = true;
  }
  if (enemiesChanged) publishPersisted(campaign.id, "encounter_updated", { encounter: activePublicEncounter(campaign.id) });
}

// Called from apply_damage after HP lands. Rolls the CON save (DC 10 or
// half the damage, whichever is higher) with a visible dice card; dropping
// to 0 HP breaks concentration without a save.
export function concentrationDamageHook(
  campaign: Campaign,
  turnId: string,
  preSheet: CharacterSheet,
  damage: number,
): Record<string, unknown> {
  if (!preSheet.concentratingOn || damage < 1) {
    return {};
  }
  const fresh = getSheetById(preSheet.id);
  if (!fresh?.concentratingOn) {
    return {};
  }
  const spell = fresh.concentratingOn;
  if (fresh.deathSaves?.dead || (fresh.wildShape?.beastHp ?? fresh.currentHp) <= 0) {
    breakConcentration(campaign, turnId, fresh.id, "dropped to 0 HP");
    return { concentrationBroken: spell };
  }
  const dc = Math.max(10, Math.floor(damage / 2));
  // A nearby paladin's aura protects concentration checks too (map-scoped).
  const aura = allySaveAura(campaign.id, fresh);
  // A hit that destroys a form still used that form's CON when it landed.
  // Read post-hit HP/concentration above, but preserve the incoming form stats.
  const saveSheet = preSheet.wildShape ? { ...fresh, wildShape: preSheet.wildShape } : fresh;
  const saveMod = computeSheetDerived(saveSheet).saves.con + (aura?.bonus ?? 0);
  const outcome = rollExpression(d20Expression(saveMod));
  // Starry Form (Dragon) and its kin floor a low concentration d20 at 10.
  const floor = conditionConcentrationFloor(fresh.conditions);
  if (floor && outcome.natural !== undefined && outcome.natural < floor) {
    const floored = outcome.total - outcome.natural + floor;
    outcome.total = Math.max(outcome.total, floored);
  }
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: fresh.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: `CON save to keep concentration (${spell})`,
    dc,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  const held = outcome.total >= dc;
  if (!held) {
    breakConcentration(campaign, turnId, fresh.id, `failed the DC ${dc} CON save`);
  }
  return { concentration: { spell, dc, rolled: outcome.total, held } };
}
