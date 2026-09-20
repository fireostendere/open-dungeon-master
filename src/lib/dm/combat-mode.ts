// Positional combat is the default for legacy campaigns. This narrow policy
// boundary keeps JRPG's same-encounter targeting exception out of validation.
export function isJrpgCombat(campaign: { gameSettings?: unknown }): boolean {
  const settings = campaign.gameSettings;
  return typeof settings === "object" && settings !== null && (settings as { combatMode?: unknown }).combatMode === "jrpg";
}

export function combatModeInstructions(campaign: { gameSettings?: unknown }): string {
  return isJrpgCombat(campaign)
    ? "Combat mode: JRPG (explicit campaign house rule). Within the current encounter attacks ignore distance, line of sight, cover and movement opportunity attacks. Do not require movement before attacking or infer positional Sneak Attack, Pack Tactics or flanking. Eligible party auras cover encounter participants. Preserve initiative, action costs, server dice, resources, conditions and room privacy; never target another encounter."
    : "Combat mode: classical. Apply the encounter engine's normal positioning, range, line of sight, cover and opportunity attacks.";
}
