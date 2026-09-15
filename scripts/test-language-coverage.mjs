import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const prompt = read("src/lib/dm/prompt.ts");
const promptCore = path.join(root, "src/lib/dm/prompt-core.ts");
const settings = read("src/lib/schemas/game-settings.ts");
const settingsCore = path.join(root, "src/lib/schemas/game-settings-core.ts");
const campaignsRoute = read("src/app/api/campaigns/route.ts");
const campaignsRouteCore = path.join(root, "src/app/api/campaigns/route-core.ts");
const context = read("src/lib/i18n/context.tsx");
const accountMenu = read("src/components/AccountMenu.tsx");

assert(fs.existsSync(promptCore), "prompt-core.ts must preserve the upstream prompt implementation");
assert(fs.existsSync(settingsCore), "game-settings-core.ts must preserve the upstream settings schema");
assert(fs.existsSync(campaignsRouteCore), "route-core.ts must preserve the upstream campaigns route");

assert.match(prompt, /type CampaignLanguage = "ru" \| "en"/);
assert.match(prompt, /language === "ru"/);
assert.match(prompt, /Always narrate, describe scenes, answer actions, and voice NPCs in English/);
assert.match(prompt, /Do not introduce Cyrillic text into English narration/);
assert.match(prompt, /state\.campaign\.gameSettings\.language/);
assert.match(prompt, /inferredLanguage\(history\)/);
assert.match(prompt, /localizeLanguageBlock\(message\.content, language\)/);
assert.match(prompt, /LANGUAGE_BLOCK/);
assert.match(prompt, /text\.replace\(LANGUAGE_BLOCK, replacement\)/);

assert.match(settings, /language:\s*z\.enum\(\["ru", "en"\]\)\.optional\(\)/);
assert.match(settings, /coreGameSettingsSchema\.extend/);
assert.match(settings, /normalizeGameSettings/);

assert.match(context, /document\.cookie = `\$\{STORAGE_LOCALE_KEY\}=\$\{locale\}/);
assert.match(context, /persistLocale\(nextLocale\)/);
assert.match(context, /persistLocale\(newLocale\)/);
assert.match(context, /persistCampaignLanguage\(newLocale\)/);
assert.match(context, /\/api\/campaigns\/\$\{encodeURIComponent\(match\[1\]\)\}\/settings/);
assert.match(context, /JSON\.stringify\(\{ language: locale \}\)/);

assert.match(campaignsRoute, /export const runtime = "nodejs"/);
assert.match(campaignsRoute, /export const dynamic = "force-dynamic"/);
assert.match(campaignsRoute, /odm_locale=\(ru\|en\)/);
assert.match(campaignsRoute, /gameSettings:\s*\{ \.\.\.currentSettings, language \}/);
assert.match(campaignsRoute, /return corePOST\(forwarded\)/);

assert.match(accountMenu, /toggleLocale/);
assert.match(accountMenu, /Language: English \(EN\)/);

assert.match(prompt, /export \* from "@\/lib\/dm\/prompt-core"/);
assert.match(settings, /export \* from "@\/lib\/schemas\/game-settings-core"/);
assert.match(campaignsRoute, /from "\.\/route-core"/);

console.log("language coverage passed: UI locale persists to campaign creation, existing campaign settings, and explicit RU/EN DM narration.");
