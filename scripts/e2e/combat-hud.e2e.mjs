// Prepared local fixture: current-turn fighter, a Longsword, Second Wind,
// and at least one visible enemy. This submits one intent, not a live game.
import assert from 'node:assert/strict';
import { assertLocalTarget, loadPlaywright } from './location-privacy.e2e.mjs';

const base = assertLocalTarget(process.env.ODM_E2E_BASE_URL || 'http://127.0.0.1:3017');
const campaignId = process.env.ODM_E2E_CAMPAIGN_ID;
assert.ok(campaignId && process.env.ODM_E2E_USERNAME && process.env.ODM_E2E_PASSWORD, 'Provide a local combat fixture and test-only credentials.');
const playwright = await loadPlaywright();
const { chromium } = playwright.default ?? playwright;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addCookies([{ name: 'odm_locale', value: 'ru', url: base }]);
  const login = await context.request.post(`${base}/api/auth/login`, {
    data: { username: process.env.ODM_E2E_USERNAME, password: process.env.ODM_E2E_PASSWORD },
  });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/campaigns/${campaignId}`, { timeout: 120000 });
  await page.getByRole('button', { name: 'Закончить ход', exact: true }).waitFor({ timeout: 60000 });
  const sidePanelWidth = await page.locator('#side-panel-content').evaluate(element => element.parentElement.getBoundingClientRect().width);
  assert.ok(sidePanelWidth < 1440 * 0.8, `Desktop battle panel should not fill the viewport (${sidePanelWidth}px).`);
  // First-time onboarding appears asynchronously, after the table loads.
  const tour = page.getByRole('button', { name: 'Завершить тур', exact: true });
  if (await tour.waitFor({ timeout: 5000 }).then(() => true, () => false)) await tour.click();
  assert.equal(await page.getByRole('button', { name: 'Речь', exact: true }).count(), 0);
  await page.getByRole('combobox', { name: 'Оружие', exact: true }).selectOption('Longsword');
  await page.getByRole('combobox', { name: 'Цель атаки', exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Добавить', exact: true }).nth(0).click();
  await page.getByRole('combobox', { name: 'Способность', exact: true }).selectOption('second_wind');
  await page.getByRole('button', { name: 'Добавить', exact: true }).nth(1).click();
  assert.equal(await page.getByText('Доп. действие: использовано', { exact: true }).isVisible(), true);
  await page.getByRole('textbox', { name: 'Действия и реплики персонажа', exact: true }).fill('Держитесь! Прикрываю отряд.');
  await page.screenshot({ path: '/tmp/opencode/odm-combat-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'OOC', exact: true }).click();
  assert.equal(await page.locator('[data-tour="composer-input"] textarea').isEditable(), true);
  await page.getByRole('button', { name: 'Действие', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Убрать действие 2', exact: true }).isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/opencode/odm-combat-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const response = page.waitForResponse(result => result.url().endsWith('/actions') && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Отправить действие', exact: true }).click();
  const submitted = await response;
  assert.equal(submitted.status(), 202, await submitted.text());
  await page.getByText('Мастер разрешает ход и готовит повествование. Пока доступен только OOC.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'OOC', exact: true }).click();
  assert.equal(await page.locator('[data-tour="composer-input"] textarea').isEditable(), true);
  assert.deepEqual(errors, []);
  console.log('PASS combat HUD: desktop/mobile, action + bonus draft, no Say, OOC, counters, preserved draft, submit, processing lock.');
} finally {
  await browser.close();
}
