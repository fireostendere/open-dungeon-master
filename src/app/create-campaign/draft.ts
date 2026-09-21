import type { CampaignDifficulty } from "@/lib/campaign-types";
import type { LoreDraft } from "@/app/WorldSetupFields";
import { EMPTY_SELECTION, type ImportSelection } from "@/app/workshop/ContentImportPicker";
import type { WorldPackSummary } from "@/lib/worlds/types";
import type {
  CampaignLengthSetting,
  CombatModeSetting,
  DicePolicy,
  DmDifficulty,
  GameSettings,
  Genre,
  UnitSystemSetting,
} from "@/lib/schemas/game-settings";

// Everything the new-campaign wizard collects, as one object. The wizard is
// six screens sharing one form, so the fields live together and each step
// reads the slice it draws and patches the slice it edits. The payload that
// leaves for POST /api/campaigns is assembled in CreateCampaignDialog, not
// here, so scripts/test-create-campaign-options.mjs keeps one file to audit.
export type CampaignDraft = {
  title: string;
  description: string;
  theme: string;
  maxPlayers: number;
  startingLevel: number;
  difficulty: CampaignDifficulty;
  campaignLength: CampaignLengthSetting;
  genre: Genre;
  customGenreText: string;
  worldPack: string;
  // A theme or premise the person typed is never clobbered by a later pack
  // choice; one the pack filled in is fair game to replace.
  themeTouched: boolean;
  descriptionTouched: boolean;
  dicePolicy: DicePolicy;
  dmDifficulty: DmDifficulty;
  ambienceEnabled: boolean;
  // Scene-following is only meaningful once ambience is on, and is shown as
  // a second toggle beside it rather than buried.
  ambienceAuto: boolean;
  multiclassingEnabled: boolean;
  worldSimulation: boolean;
  inventoryApprovals: boolean;
  midGameJoinOpen: boolean;
  holdSubmissions: boolean;
  relationships: GameSettings["relationships"];
  romance: GameSettings["romance"];
  variantRules: GameSettings["variantRules"];
  houseRules: string;
  loreDrafts: LoreDraft[];
  // Prep built in a workshop, brought in right after the row exists.
  contentImport: ImportSelection;
  companions: GameSettings["companions"];
  maxCompanions: number;
  maxGuests: number;
  voiceChat: GameSettings["voice"];
  unitSystem: UnitSystemSetting;
  combatMode: CombatModeSetting;
};

export const DEFAULT_DRAFT: CampaignDraft = {
  title: "",
  description: "",
  theme: "",
  maxPlayers: 5,
  startingLevel: 1,
  difficulty: "normal",
  campaignLength: "standard",
  genre: "high_fantasy",
  customGenreText: "",
  worldPack: "",
  themeTouched: false,
  descriptionTouched: false,
  dicePolicy: "digital_only",
  unitSystem: "metric",
  combatMode: "classical",
  dmDifficulty: 5,
  ambienceEnabled: true,
  ambienceAuto: true,
  multiclassingEnabled: true,
  worldSimulation: true,
  inventoryApprovals: false,
  midGameJoinOpen: false,
  holdSubmissions: false,
  relationships: "on",
  romance: "on",
  variantRules: {
    flanking: false,
    criticalFumbles: false,
    encumbrance: false,
    lingeringInjuries: false,
    powerfulCritical: false,
    criticalDamageMods: false,
    ammunition: false,
    restVariant: "standard",
  },
  houseRules: "",
  loreDrafts: [],
  contentImport: EMPTY_SELECTION,
  companions: "auto",
  maxCompanions: 2,
  maxGuests: 2,
  voiceChat: {
    enabled: true,
    turnEnforcement: "soft",
    rules: {
      proximity: false,
      hearingRangeFeet: 30,
      sayRange: false,
      wallsAttenuate: false,
      downedGoDeaf: false,
    },
  },
};

export type Patch = (changes: Partial<CampaignDraft>) => void;

// What the server can do, as the wizard gates on it. null from the
// capabilities endpoint collapses to "offer everything" before it gets here.
export type WizardGates = {
  // Solo only changes table/player-count presentation. Narration is supplied
  // by a human or the external MCP narrator, never by a server-hosted model.
  solo: boolean;
};

export type StepProps = {
  draft: CampaignDraft;
  patch: Patch;
  gates: WizardGates;
};

// A pack always also sets the genre, which is what keeps every existing
// genre consumer working. The Setting row visibly follows along, which is
// the honest explanation of what a pack actually is.
export function applyPack(draft: CampaignDraft, pack: WorldPackSummary): CampaignDraft {
  return {
    ...draft,
    worldPack: pack.id,
    genre: pack.baseGenre,
    theme: draft.themeTouched ? draft.theme : pack.theme,
    description: draft.descriptionTouched ? draft.description : pack.premise,
  };
}

export function clearPack(
  draft: CampaignDraft,
  selectedPack: WorldPackSummary | null,
): CampaignDraft {
  const packTheme =
    !draft.themeTouched && selectedPack !== null && draft.theme === selectedPack.theme;
  const packPremise =
    !draft.descriptionTouched &&
    selectedPack !== null &&
    draft.description === selectedPack.premise;
  return {
    ...draft,
    worldPack: "",
    theme: packTheme ? "" : draft.theme,
    description: packPremise ? "" : draft.description,
  };
}
