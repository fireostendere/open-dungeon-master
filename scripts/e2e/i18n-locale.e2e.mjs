import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

function resolvePlaywrightModule() {
  if (process.env.ODM_PLAYWRIGHT_MODULE) {
    return pathToFileURL(path.resolve(process.env.ODM_PLAYWRIGHT_MODULE)).href;
  }
  const fallback = "/tmp/odm-browser/node_modules/playwright/index.mjs";
  return fs.existsSync(fallback) ? pathToFileURL(fallback).href : "playwright";
}

const { chromium } = await import(resolvePlaywrightModule());
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "odm-i18n-e2e-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  COOKIE_SECURE: "0",
  SQLITE_DB_PATH: path.join(temp, "game.sqlite"),
  DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  ODM_MEDIA_ROOT: path.join(temp, "media"),
  ODM_LOCAL_ORIGIN: origin,
  ODM_PUBLIC_URL: origin,
  NEXT_TELEMETRY_DISABLED: "1",
  VOICE_ENABLED: "0",
};
fs.mkdirSync(env.ODM_MEDIA_ROOT, { recursive: true });
for (const key of Object.keys(env)) {
  if (/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN/.test(key)) delete env[key];
}

let app;
let browser;
const logs = [];

async function start() {
  app = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: root, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [app.stdout, app.stderr]) {
    stream.on("data", (chunk) => logs.push(chunk.toString()));
  }
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (app.exitCode !== null) throw new Error(`Next server exited (${app.exitCode}):\n${logs.join("")}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Next server startup timed out:\n${logs.join("")}`);
}

async function stop() {
  if (!app) return;
  try {
    if (process.platform === "win32") app.kill();
    else process.kill(-app.pid, "SIGTERM");
  } catch {}
  await Promise.race([new Promise((resolve) => app.once("exit", resolve)), sleep(3000)]);
}

function assertNoRawKeys(text, surface) {
  assert.ok(!/generated\.[a-z0-9_.-]+/i.test(text), `${surface} leaked a raw generated i18n key`);
}

function assertEnglishOnly(text, surface) {
  assert.ok(!/[А-Яа-яЁё]/.test(text), `${surface} leaked Cyrillic while English locale was active: ${text}`);
  assertNoRawKeys(text, surface);
}

async function assertStoredLocale(page, context, locale) {
  await page.waitForFunction((expected) => document.documentElement.lang === expected, locale);
  assert.equal(await page.evaluate(() => localStorage.getItem("odm_locale")), locale);
  assert.equal((await context.cookies()).find((cookie) => cookie.name === "odm_locale")?.value, locale);
}

async function selectAccountLocale(page, campaignId, accountName, menuLanguageLabel, optionLabel, locale) {
  await page.getByRole("button", { name: accountName }).click();
  await page.getByText(menuLanguageLabel, { exact: true }).click();
  const patch = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/campaigns/${campaignId}/settings`) &&
      response.request().method() === "PATCH",
  );
  await page.getByText(optionLabel, { exact: true }).click();
  const response = await patch;
  assert.ok(response.ok(), `campaign language PATCH failed: ${response.status()}`);
  assert.deepEqual(response.request().postDataJSON(), { language: locale });
}

try {
  await start();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();

  // Fresh installs default to Russian. Exercise the compact header switcher
  // through Russian -> Polish -> English before authentication.
  await page.goto("/");
  await page.getByRole("button", { name: "Переключить язык на польский" }).click();
  await assertStoredLocale(page, context, "pl");
  await page.getByRole("button", { name: "Przełącz język na angielski" }).click();
  await assertStoredLocale(page, context, "en");
  assertEnglishOnly(await page.locator("body").innerText(), "auth screen");

  const register = await context.request.post("/api/auth/register", {
    data: { username: "i18n_languages", password: "LanguageCoverage2026!" },
  });
  assert.ok(register.ok(), `registration failed: ${register.status()} ${await register.text()}`);
  await page.goto("/");
  assertEnglishOnly(await page.locator("body").innerText(), "dashboard");

  const create = await context.request.post("/api/campaigns", {
    data: {
      title: "Locale Coverage Campaign",
      description: "EN RU PL localization smoke test",
      maxPlayers: 1,
      gameSettings: { dmMode: "human", aiStorySetup: false },
    },
  });
  assert.ok(create.ok(), `campaign creation failed: ${create.status()} ${await create.text()}`);
  const created = await create.json();
  assert.equal(created.campaign?.gameSettings?.language, "en", "campaign must inherit the English UI locale");
  const campaignId = created.campaign.id;

  await page.goto(`/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "Account" }).waitFor();
  assertEnglishOnly(await page.locator("body").innerText(), "campaign lobby");

  await selectAccountLocale(page, campaignId, "Account", "Language", "Русский (RU)", "ru");
  await assertStoredLocale(page, context, "ru");
  assertNoRawKeys(await page.locator("body").innerText(), "Russian campaign lobby");

  await selectAccountLocale(page, campaignId, "Аккаунт", "Язык", "Polski (PL)", "pl");
  await assertStoredLocale(page, context, "pl");
  assertNoRawKeys(await page.locator("body").innerText(), "Polish campaign lobby");
  await page.getByRole("button", { name: "Przełącz język na angielski" }).waitFor();

  await selectAccountLocale(page, campaignId, "Konto", "Język", "English (EN)", "en");
  await assertStoredLocale(page, context, "en");
  assertEnglishOnly(await page.locator("body").innerText(), "campaign lobby after EN/RU/PL round trip");

  console.log("PASS i18n locale E2E: EN/RU/PL auth, dashboard, lobby and campaign-language persistence");
} finally {
  await browser?.close().catch(() => undefined);
  await stop();
  fs.rmSync(temp, { recursive: true, force: true });
}
