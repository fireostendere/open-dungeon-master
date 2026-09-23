// Offline browser acceptance for locale-sensitive, responsive player surfaces.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function playwrightModule() {
  if (process.env.ODM_PLAYWRIGHT_MODULE) return pathToFileURL(path.resolve(process.env.ODM_PLAYWRIGHT_MODULE)).href;
  const fallback = "/tmp/odm-browser/node_modules/playwright/index.mjs";
  return fs.existsSync(fallback) ? pathToFileURL(fallback).href : "playwright";
}

const { chromium } = await import(playwrightModule());
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "odm-i18n-e2e-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let app;
let browser;
const logs = [];

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const development = process.env.ODM_E2E_DEV === "1";
const env = {
  ...process.env,
  NODE_ENV: development ? "development" : "production",
  PORT: String(port),
  COOKIE_SECURE: "0",
  SQLITE_DB_PATH: path.join(temp, "game.sqlite"),
  DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  ODM_MEDIA_ROOT: path.join(temp, "media"),
  ODM_LOCAL_ORIGIN: origin,
  ODM_PUBLIC_URL: origin,
  NEXT_TELEMETRY_DISABLED: "1",
  VOICE_ENABLED: "0",
  COMFYUI_URL: "",
  FLUX_WORKER_URL: "",
  OLLAMA_BASE_URL: "",
};
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_TOKEN|REFRESH_TOKEN/.test(key)) delete env[key];
fs.mkdirSync(env.ODM_MEDIA_ROOT, { recursive: true });

async function start() {
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", development ? "dev" : "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [app.stdout, app.stderr]) stream.on("data", (chunk) => logs.push(chunk.toString()));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (app.exitCode !== null) throw new Error(`Next server exited (${app.exitCode}):\n${logs.join("")}`);
    try {
      if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return;
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
  assert.ok(!/\b(?:generated|common|language|nav|auth|campaign|session|sheet)\.[a-z0-9_.-]+\b/i.test(text), `${surface} leaked a raw i18n key`);
}

function assertEnglishOnly(text, surface) {
  assert.ok(!/[А-Яа-яЁё]/.test(text), `${surface} leaked Cyrillic while English locale was active`);
  assertNoRawKeys(text, surface);
}

async function assertLayout(page, surface, labels) {
  for (const label of labels) {
    const target = page.getByText(label, { exact: true }).filter({ visible: true }).first();
    await target.waitFor({ state: "visible", timeout: 10_000 });
    const clipping = await target.evaluate((element) => {
      const owner = element.closest("button,a,[role=tab]") ?? element;
      const range = document.createRange();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const boxes = [];
      // The active rail's decorative glow extends beyond its button; its text must not.
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        range.selectNodeContents(node);
        boxes.push(...range.getClientRects());
      }
      const rect = owner.getBoundingClientRect();
      const clipped = (element !== owner && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)) || boxes.some((box) => box.left < rect.left - 1 || box.right > rect.right + 1 || box.top < rect.top - 1 || box.bottom > rect.bottom + 1);
      return { clipped, owner: `${Math.round(rect.width)}x${Math.round(rect.height)}`, scroll: `${owner.scrollWidth}x${owner.scrollHeight}` };
    });
    assert.equal(clipping.clipped, false, `${surface} clips ${label} (box ${clipping.owner}, scroll ${clipping.scroll})`);
  }
  assertNoRawKeys(await page.locator("body").innerText(), surface);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) {
    const boxes = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
    }).slice(0, 20).map((element) => ({ tag: element.tagName, class: element.getAttribute("class"), text: element.textContent?.trim().slice(0, 70), width: element.getBoundingClientRect().width })));
    assert.fail(`${surface} has horizontal page overflow: ${JSON.stringify(boxes)}`);
  }
}

async function switchTo(page, locale) {
  const nextButton = {
    ru: "Переключить язык на Английский",
    en: "Switch language to Russian",
  };
  for (let turns = 0; turns < 2 && await page.evaluate(() => document.documentElement.lang) !== locale; turns += 1) {
    const current = await page.evaluate(() => document.documentElement.lang);
    await page.getByRole("button", { name: nextButton[current] }).click();
    await page.waitForFunction((next) => document.documentElement.lang === next, { ru: "en", en: "ru" }[current]);
  }
  assert.equal(await page.evaluate(() => document.documentElement.lang), locale, `locale did not reach ${locale}`);
}

const sheet = {
  name: "Locale Test Hero", race: "human", class: "fighter", subclass: "champion", background: "soldier",
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 12, cha: 8 }, maxHp: 12, currentHp: 12,
  ac: 16, speed: 30, hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: { saves: ["str", "con"], skills: ["athletics", "perception"], languages: ["common"], tools: [], armor: ["all"], weapons: ["all"] },
  equipment: [{ name: "Test sword", qty: 1 }], gold: 15,
};

const surfaces = {
  ru: [
    ["/", ["Новая кампания", "Персонажи", "Мастерская"]],
    ["/characters", ["Ваши персонажи", "Новый персонаж"]],
    ["/characters/CHARACTER", ["Характеристики", "Снаряжение"]],
    ["/workshop", ["Мастерская", "Новая мастерская"]],
    ["/workshop/WORKSHOP", ["Все мастерские", "Разделы"]],
    ["/campaigns/CAMPAIGN", ["Чат", "Карта", "Отряд", "Заметки", "Контекст", "Настройки"]],
    ["/friends", ["Друзья"]],
    ["/reference", ["Справочник правил"]],
    ["/privacy", ["Политика конфиденциальности"]],
    ["/terms", ["Условия использования"]],
    ["/licenses", ["Лицензии и атрибуция"]],
  ],
  en: [
    ["/", ["New campaign", "Characters", "Workshop"]],
    ["/characters", ["Your characters", "New character"]],
    ["/characters/CHARACTER", ["Abilities", "Equipment"]],
    ["/workshop", ["Workshop", "New workshop"]],
    ["/workshop/WORKSHOP", ["All workshops", "Systems"]],
    ["/campaigns/CAMPAIGN", ["Chat", "Map", "Party", "Notes", "Context", "Setup"]],
    ["/friends", ["Friends"]],
    ["/reference", ["Rules reference"]],
    ["/privacy", ["Privacy policy"]],
    ["/terms", ["Terms of service"]],
    ["/licenses", ["Licenses and attribution"]],
  ],
};

try {
  await start();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  if (development) {
    page.setDefaultNavigationTimeout(120_000);
    page.setDefaultTimeout(120_000);
  }

  await page.goto("/");
  await page.getByRole("button", { name: "Переключить язык на Английский" }).click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  assert.equal(await page.evaluate(() => localStorage.getItem("odm_locale")), "en");
  assert.equal((await context.cookies()).find((cookie) => cookie.name === "odm_locale")?.value, "en");

  const register = await context.request.post("/api/auth/register", { data: { username: "i18n_acceptance", password: "LocaleCoverage2026!" } });
  assert.ok(register.ok(), `registration failed: ${register.status()} ${await register.text()}`);
  await page.goto("/");
  assertEnglishOnly(await page.locator("body").innerText(), "dashboard");
  const localeCampaignResponse = await context.request.post("/api/campaigns", { data: { title: "English Locale Cycle", maxPlayers: 1, gameSettings: { dmMode: "human", aiStorySetup: false } } });
  assert.ok(localeCampaignResponse.ok(), `locale campaign failed: ${localeCampaignResponse.status()} ${await localeCampaignResponse.text()}`);
  const localeCampaign = (await localeCampaignResponse.json()).campaign;
  assert.equal(localeCampaign.gameSettings.language, "en", "campaign must inherit the English UI locale");
  await page.goto(`/campaigns/${localeCampaign.id}`);
  await page.getByRole("button", { name: "Account" }).waitFor();
  assertEnglishOnly(await page.locator("body").innerText(), "English campaign lobby");
  for (const [button, menuText, next] of [["Account", "Language: English (EN)", "ru"], ["Аккаунт", "Язык: Русский (RU)", "en"]]) {
    await page.getByRole("button", { name: button }).click();
    const patch = page.waitForResponse((response) => response.url().endsWith(`/api/campaigns/${localeCampaign.id}/settings`) && response.request().method() === "PATCH");
    await page.getByText(menuText, { exact: true }).click();
    const response = await patch;
    assert.ok(response.ok(), `campaign language PATCH failed: ${response.status()}`);
    assert.deepEqual(response.request().postDataJSON(), { language: next });
    await page.waitForFunction((locale) => document.documentElement.lang === locale, next);
    if (next === "en") assertEnglishOnly(await page.locator("body").innerText(), "English campaign lobby after cycle");
  }
  const character = await context.request.post("/api/characters", { data: { level: 1, role: "pc", sheet } });
  assert.ok(character.ok(), `character fixture failed: ${character.status()} ${await character.text()}`);
  const characterId = (await character.json()).character.id;
  const workshop = await context.request.post("/api/workshops", { data: { title: "Locale Workshop", targetParty: { size: 4, level: 3 } } });
  assert.ok(workshop.ok(), `workshop fixture failed: ${workshop.status()} ${await workshop.text()}`);
  const workshopId = (await workshop.json()).workshop.id;
  const campaign = await context.request.post("/api/campaigns", { data: { title: "Locale Session", maxPlayers: 2, startingLevel: 1, gameSettings: { dmMode: "human", aiStorySetup: false } } });
  assert.ok(campaign.ok(), `campaign fixture failed: ${campaign.status()} ${await campaign.text()}`);
  const campaignFixture = await campaign.json();
  const campaignId = campaignFixture.campaign.id;
  const player = await browser.newContext({ baseURL: origin });
  const playerRegister = await player.request.post("/api/auth/register", { data: { username: "i18n_player", password: "LocaleCoverage2026!" } });
  assert.ok(playerRegister.ok(), `player registration failed: ${playerRegister.status()} ${await playerRegister.text()}`);
  const joined = await player.request.post("/api/campaigns/join", { data: { inviteCode: campaignFixture.campaign.inviteCode } });
  assert.ok(joined.ok(), `player join fixture failed: ${joined.status()} ${await joined.text()}`);
  const campaignSheet = await player.request.post(`/api/campaigns/${campaignId}/sheet`, { data: sheet });
  assert.ok(campaignSheet.ok(), `campaign sheet fixture failed: ${campaignSheet.status()} ${await campaignSheet.text()}`);
  const ready = await player.request.post(`/api/campaigns/${campaignId}/ready`, { data: { ready: true } });
  assert.ok(ready.ok(), `campaign ready fixture failed: ${ready.status()} ${await ready.text()}`);
  await player.close();
  const dmReady = await context.request.post(`/api/campaigns/${campaignId}/ready`, { data: { ready: true } });
  assert.ok(dmReady.ok(), `DM ready fixture failed: ${dmReady.status()} ${await dmReady.text()}`);
  const active = await context.request.patch(`/api/campaigns/${campaignId}`, { data: { status: "active" } });
  assert.ok(active.ok(), `active-session fixture failed: ${active.status()} ${await active.text()}`);

  await page.goto(`/campaigns/${campaignId}`);
  const chat = page.getByTestId("campaign-messages");
  await chat.waitFor();
  for (let index = 1; index <= 103; index += 1) {
    const response = await context.request.post(`/api/campaigns/${campaignId}/dm/narrate`, { data: { content: `Chat regression ${index}` } });
    assert.ok(response.ok(), `narration ${index} failed: ${response.status()}`);
  }
  await page.getByText("Chat regression 103", { exact: true }).waitFor();
  await chat.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const follow = await context.request.post(`/api/campaigns/${campaignId}/dm/narrate`, { data: { content: "Chat regression follow" } });
  assert.ok(follow.ok());
  await page.getByText("Chat regression follow", { exact: true }).waitFor();
  assert.ok(await chat.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight < 120), "chat should follow new messages while at bottom");
  await chat.evaluate(element => { element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - 300); });
  const beforeScroll = await chat.evaluate(element => element.scrollTop);
  assert.ok(beforeScroll > 0, "chat fixture must be scrollable");
  const held = await context.request.post(`/api/campaigns/${campaignId}/dm/narrate`, { data: { content: "Chat regression held" } });
  assert.ok(held.ok());
  await page.getByText("Chat regression held", { exact: true }).waitFor({ state: "attached" });
  const afterScroll = await chat.evaluate(element => element.scrollTop);
  assert.ok(Math.abs(afterScroll - beforeScroll) < 2, `chat moved away from the reader's position: ${beforeScroll} → ${afterScroll}`);
  await page.reload();
  await page.getByTestId("campaign-messages").waitFor();
  await page.getByRole("button", { name: "Load older messages" }).click();
  await page.getByText("Chat regression 1", { exact: true }).waitFor({ state: "attached" });

  // The authenticated dashboard must still expose an immediately reachable language control.
  await page.goto("/");
  await page.getByRole("button", { name: "Switch language to Russian" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Switch language to Russian" }).click();
  await page.waitForFunction(() => document.documentElement.lang === "ru");
  assert.equal(await page.evaluate(() => localStorage.getItem("odm_locale")), "ru");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === "ru");

  for (const width of [320, 360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const locale of ["ru", "en"]) {
      await switchTo(page, locale);
      for (const [route, labels] of surfaces[locale]) {
        await page.goto(route.replace("CHARACTER", characterId).replace("WORKSHOP", workshopId).replace("CAMPAIGN", campaignId));
        await assertLayout(page, `${locale} ${width}px ${route}`, labels);
      }
    }
  }
  console.log("PASS i18n locale E2E: EN/RU PATCH cycle and responsive acceptance");
} catch (error) {
  const failure = path.join("/tmp/opencode", "odm-i18n-locale-failure.png");
  const page = browser?.contexts()[0]?.pages()[0];
  await page?.screenshot({ path: failure, fullPage: true }).catch(() => undefined);
  console.error((await page?.locator("body").innerText().catch(() => ""))?.slice(0, 5000));
  console.error(logs.join("").slice(-8000));
  console.error(`i18n E2E failure screenshot: ${failure}`);
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  await stop();
  fs.rmSync(temp, { recursive: true, force: true });
}
