// SRD 2014 features with an unambiguous activation. Variant-dependent
// resources stay DM-adjudicated except the explicit Ki variants below.
export const RESOURCE_ACTIONS: Record<string, { name: string; cost: "action" | "bonus"; target: "self" | "ally" | "other" }> = {
  second_wind: { name: "Second Wind", cost: "bonus", target: "self" },
  rage: { name: "Rage", cost: "bonus", target: "self" },
  bardic_inspiration: { name: "Bardic Inspiration", cost: "bonus", target: "other" },
  lay_on_hands: { name: "Lay on Hands", cost: "action", target: "ally" },
  homebrew_speak_with_dead: { name: "Speak with Dead (homebrew)", cost: "action", target: "self" },
};

// 2014 monk / Way of Mercy: one replacement heal, with the other strike
// available only through pc_attack(flurry:true). Never add these by inference.
export const KI_ACTIONS: Record<string, { name: string; cost: "action" | "bonus"; healing: boolean; strikes: number }> = {
  hand_of_healing: { name: "Hand of Healing", cost: "action", healing: true, strikes: 0 },
  flurry_of_blows: { name: "Flurry of Blows", cost: "bonus", healing: false, strikes: 2 },
  flurry_of_healing: { name: "Flurry of Blows / Hand of Healing", cost: "bonus", healing: true, strikes: 1 },
};
