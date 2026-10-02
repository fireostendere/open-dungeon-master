import { z } from "zod";
import { gameSettingsSchema as coreGameSettingsSchema } from "@/lib/schemas/game-settings-core";

export * from "@/lib/schemas/game-settings-core";

// Narration language is campaign-level: every player sees their own UI locale,
// while the table has one stable language for AI-authored story content.
// It stays optional so campaigns created before localization can infer a
// language from player input until a table owner explicitly selects one.
//
// Measurement units (metric vs imperial) default to metric (meters, kilograms)
// across all campaigns unless explicitly chosen otherwise.
export const gameSettingsSchema = coreGameSettingsSchema.extend({
  language: z.enum(["ru", "en", "pl"]).optional(),
  unitSystem: z.enum(["metric", "imperial"]).default("metric"),
});

export type GameSettings = z.infer<typeof gameSettingsSchema>;

// Zod applies inner defaults even in partial schemas. A PATCH must omit
// untouched fields rather than resetting them to creation defaults.
export const gameSettingsPatchSchema: z.ZodType<Partial<GameSettings>> = z.object(Object.fromEntries(
  Object.entries(gameSettingsSchema.shape).map(([key, field]) =>
    [key, field instanceof z.ZodDefault ? field.removeDefault() : field]),
)).partial();

export function normalizeGameSettings(raw: unknown): GameSettings {
  const parsed = gameSettingsSchema.safeParse(raw ?? {});
  const normalized = parsed.success ? parsed.data : gameSettingsSchema.parse({});
  return {
    ...normalized,
    dmMode: "human",
    dmAssist: { monsters: false, narration: false, cover: false },
    aiStorySetup: false,
    narrationGuard: false,
    stages: { ...normalized.stages, compaction: false, recall: false, retrieval: false, chapterSummary: false },
  };
}
