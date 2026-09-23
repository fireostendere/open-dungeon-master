// Structural checks; browser behavior lives in scripts/e2e/i18n-locale.e2e.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const translations = read("src/lib/i18n/translations.ts");
const context = read("src/lib/i18n/context.tsx");
const switcher = read("src/components/LanguageSwitcher.tsx");
const account = read("src/components/AccountMenu.tsx");
const narrator = read("src/app/campaigns/[campaignId]/NarrationLanguageSetting.tsx");
const layout = read("src/app/layout.tsx");
const campaignsRoute = read("src/app/api/campaigns/route.ts");

assert.match(translations, /LOCALES = \["ru", "en"\]/);
assert.doesNotMatch(translations, /\bpl:\s*\{|polish:/);
assert.match(context, /isLocale\(savedLocale\)/);
assert.match(context, /nextLocale\(locale\)/);
assert.match(context, /initialLocale = "ru"/);
assert.match(context, /document\.cookie = `\$\{STORAGE_LOCALE_KEY\}=\$\{locale\}/);
assert.doesNotMatch(context, /persistCampaignLanguage|\/api\/campaigns\//);
assert.match(switcher, /nextLocale\(locale\)/);
assert.match(switcher, /t\("language\.switchTo"/);
assert.match(account, /t\("language\.current"/);
assert.doesNotMatch(switcher + account + narrator, /language\.polish|value="pl"/);
assert.match(narrator, /method: "PATCH"/);
assert.match(narrator, /JSON\.stringify\(\{ language: value \}\)/);
assert.match(layout, /isLocale\(cookieLocale\) \? cookieLocale : "ru"/);
assert.match(layout, /<I18nProvider initialLocale=\{locale\}>/);
assert.match(campaignsRoute, /type CampaignLocale = "ru" \| "en"/);
assert.match(campaignsRoute, /odm_locale=\(ru\|en\)/);
assert.doesNotMatch(campaignsRoute, /currentSettings\.language === "pl"/);
assert.match(campaignsRoute, /gameSettings: \{ \.\.\.currentSettings, language, unitSystem \}/);
console.log("RU/EN language controls and catalog passed.");
