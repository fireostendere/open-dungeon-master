import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById } from "@/lib/db/sheets";
import type { Encounter, EncounterEnemy } from "@/lib/db/encounters";
import { effectiveAcFor } from "@/lib/srd";
import { applyField } from "@/lib/dm/effects-logic";
import { effectOutcome } from "@/lib/dm/effect-tools";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { spatialEnabled, spatialStore } from "@/lib/spatial/service";
import type { CharacterSheet, ConditionMetaMap } from "@/lib/schemas/sheet";

export type CombatTarget = {
  id: string;
  displayName: string;
  ac: number;
  conditions: string[];
  conditionMeta: ConditionMetaMap;
  enemy: EncounterEnemy | null;
  sheet: CharacterSheet | null;
};

export function resolveCombatTarget(campaign: Campaign, encounter: Encounter,
  args: { targetEnemyId?: string; targetCharacterId?: string }): CombatTarget | { error: string } {
  if (Boolean(args.targetEnemyId) === Boolean(args.targetCharacterId)) {
    return { error: "Choose exactly one targetEnemyId or targetCharacterId." };
  }
  if (args.targetCharacterId) {
    if (!campaign.gameSettings.friendlyFire) return { error: "Friendly fire is disabled for this campaign." };
    const sheet = getSheetById(args.targetCharacterId);
    if (!sheet || sheet.campaignId !== campaign.id || sheet.deathSaves?.dead ||
      !encounter.order.some(entry => entry.kind === "pc" && entry.characterId === sheet.id)) {
      return { error: "Choose a living character participating in this encounter." };
    }
    if (spatialEnabled(campaign.id) && spatialStore().getUserRoom(campaign.id, sheet.userId) !== encounter.roomId) {
      return { error: "The target is in another location." };
    }
    return { id: sheet.id, displayName: sheet.name, ac: applyField(effectiveAcFor(sheet), effectOutcome(campaign.id, { kind: "character", id: sheet.id }, "ac")),
      conditions: sheet.conditions, conditionMeta: sheet.conditionMeta, enemy: null, sheet };
  }
  const enemy = resolveEnemyRef(encounter.id, args.targetEnemyId!);
  if (!enemy || enemy.status !== "alive") return { error: "Choose a living enemy from this encounter." };
  return { id: enemy.id, displayName: enemy.displayName, ac: applyField(enemy.ac, effectOutcome(campaign.id, { kind: "enemy", id: enemy.id }, "ac")),
    conditions: enemy.conditions, conditionMeta: enemy.conditionMeta, enemy, sheet: null };
}
