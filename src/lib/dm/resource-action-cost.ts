// SRD 2014 features with an unambiguous activation. Variant-dependent
// resources (Ki, Channel Divinity, Wild Shape, etc.) stay DM-adjudicated.
export const RESOURCE_ACTIONS: Record<string, { name: string; cost: "action" | "bonus"; target: "self" | "ally" | "other" }> = {
  second_wind: { name: "Second Wind", cost: "bonus", target: "self" },
  rage: { name: "Rage", cost: "bonus", target: "self" },
  bardic_inspiration: { name: "Bardic Inspiration", cost: "bonus", target: "other" },
  lay_on_hands: { name: "Lay on Hands", cost: "action", target: "ally" },
};
