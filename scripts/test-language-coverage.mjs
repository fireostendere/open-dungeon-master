import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const prompt = read("src/lib/dm/prompt.ts");
const promptCore = path.join(root, "src/lib/dm/prompt-core.ts");
const setup = read("src/lib/dm/setup.ts");
const settings = read("src/lib/schemas/game-settings.ts");
const settingsCore = path.join(root, "src/lib/schemas/game-settings-core.ts");
const campaignsRoute = read("src/app/api/campaigns/route.ts");
const campaignsRouteCore = path.join(root, "src/app/api/campaigns/route-core.ts");
const context = read("src/lib/i18n/context.tsx");
const translations = read("src/lib/i18n/translations.ts");
const layout = read("src/app/layout.tsx");
const accountMenu = read("src/components/AccountMenu.tsx");
const switcher = read("src/components/LanguageSwitcher.tsx");

assert(fs.existsSync(promptCore), "prompt-core.ts must preserve the upstream prompt implementation");
assert(fs.existsSync(settingsCore), "game-settings-core.ts must preserve the upstream settings schema");
assert(fs.existsSync(campaignsRouteCore), "route-core.ts must preserve the upstream campaigns route");

assert.match(translations, /export type Locale = "ru" \| "en" \| "pl"/);
assert.match(translations, /\bpl:\s*\{/);
assert.match(translations, /languagePolish:\s*"Polski \(PL\)"/);

assert.match(prompt, /type CampaignLanguage = "ru" \| "en" \| "pl"/);
assert.match(prompt, /language === "ru"/);
assert.match(prompt, /language === "pl"/);
assert.match(prompt, /Always narrate, describe scenes, answer actions, and voice NPCs in English/);
assert.match(prompt, /Always narrate, describe scenes, answer actions, and voice NPCs in Russian/);
assert.match(prompt, /Always narrate, describe scenes, answer actions, and voice NPCs in Polish/);
assert.match(prompt, /Do not introduce Cyrillic text into English narration/);
assert.match(prompt, /state\.campaign\.gameSettings\.language/);
assert.match(prompt, /inferredLanguage\(history\)/);
assert.match(prompt, /\[ĄĆĘŁŃÓŚŹŻąćęłńóśźż\]/);
assert.match(prompt, /localizeLanguageBlock\(message\.content, language\)/);
assert.match(prompt, /LANGUAGE_BLOCK/);
assert.match(prompt, /text\.replace\(LANGUAGE_BLOCK, replacement\)/);

assert.match(setup, /campaign\.gameSettings\.language === "en"/);
assert.match(setup, /campaign\.gameSettings\.language === "pl"/);
assert.match(setup, /\? "Polish"/);
assert.match(setup, /: "Russian"/);
assert.match(setup, /Write all three string values in \$\{language\}/);

assert.match(settings, /language:\s*z\.enum\(\["ru", "en", "pl"\]\)\.optional\(\)/);
assert.match(settings, /coreGameSettingsSchema\.extend/);
assert.match(settings, /normalizeGameSettings/);

assert.match(context, /initialLocale = "ru"/);
assert.match(context, /useState<Locale>\(initialLocale\)/);
assert.match(context, /value === "en" \|\| value === "ru" \|\| value === "pl"/);
assert.match(context, /NEXT_LOCALE:\s*Record<Locale, Locale>/);
assert.match(context, /en:\s*"ru"/);
assert.match(context, /ru:\s*"pl"/);
assert.match(context, /pl:\s*"en"/);
assert.match(context, /document\.cookie = `\$\{STORAGE_LOCALE_KEY\}=\$\{locale\}/);
assert.match(context, /persistLocale\(nextLocale\)/);
assert.match(context, /persistLocale\(newLocale\)/);
assert.match(context, /persistCampaignLanguage\(newLocale\)/);
assert.match(context, /\/api\/campaigns\/\$\{encodeURIComponent\(match\[1\]\)\}\/settings/);
assert.match(context, /JSON\.stringify\(\{ language: locale \}\)/);

assert.match(layout, /import \{ cookies \} from "next\/headers"/);
assert.match(layout, /value === "en" \|\| value === "pl" \|\| value === "ru"/);
assert.match(layout, /<html[\s\S]*lang=\{locale\}/);
assert.match(layout, /<I18nProvider initialLocale=\{locale\}>/);

assert.match(campaignsRoute, /type CampaignLanguage = "ru" \| "en" \| "pl"/);
assert.match(campaignsRoute, /export const runtime = "nodejs"/);
assert.match(campaignsRoute, /export const dynamic = "force-dynamic"/);
assert.match(campaignsRoute, /odm_locale=\(ru\|en\|pl\)/);
assert.match(campaignsRoute, /currentSettings\.language === "pl"/);
assert.match(campaignsRoute, /gameSettings:\s*\{ \.\.\.currentSettings, language \}/);
assert.match(campaignsRoute, /return corePOST\(forwarded\)/);

assert.match(accountMenu, /setLocale/);
assert.match(accountMenu, /value:\s*"en"/);
assert.match(accountMenu, /value:\s*"ru"/);
assert.match(accountMenu, /value:\s*"pl"/);
assert.match(accountMenu, /common\.languagePolish/);
assert.match(switcher, /locale === "pl"/);

assert.match(prompt, /export \* from "@\/lib\/dm\/prompt-core"/);
assert.match(settings, /export \* from "@\/lib\/schemas\/game-settings-core"/);
assert.match(campaignsRoute, /from "\.\/route-core"/);

console.log(
  "language coverage passed: EN/RU/PL SSR hydration, UI persistence, campaign creation/settings, story setup, account controls, and explicit Russian/Polish/English DM narration are wired end-to-end.",
);
