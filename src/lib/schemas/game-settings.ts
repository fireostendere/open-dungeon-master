import { z } from "zod";
import { gameSettingsSchema as coreGameSettingsSchema } from "@/lib/schemas/game-settings-core";

export * from "@/lib/schemas/game-settings-core";

// Narration language is campaign-level: every player sees their own UI locale,
// while the table has one stable language for AI-authored story content.
// It stays optional so campaigns created before localization can infer a
// language from player input until a table owner explicitly selects one.
export const gameSettingsSchema = coreGameSettingsSchema.extend({
  language: z.enum(["ru", "en", "pl"]).optional(),
});

export type GameSettings = z.infer<typeof gameSettingsSchema>;

export function normalizeGameSettings(raw: unknown): GameSettings {
  const parsed = gameSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : gameSettingsSchema.parse({});
}
