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
  // Onboarding may switch to the party tab after the combat auto-focus.
  const tour = page.getByRole('button', { name: 'Завершить тур', exact: true });
  if (await tour.waitFor({ timeout: 5000 }).then(() => true, () => false)) await tour.click();
  await page.getByRole('button', { name: 'Вкладка «Бой» ↗', exact: true }).click();
  await page.getByRole('button', { name: 'Закончить ход', exact: true }).waitFor({ timeout: 60000 }).catch(async error => {
    await page.screenshot({ path: '/tmp/opencode/odm-combat-hud-failure.png', fullPage: true });
    console.error('Combat page:', await page.locator('body').innerText());
    throw error;
  });
  const sidePanelWidth = await page.locator('#side-panel-content').evaluate(element => element.parentElement.getBoundingClientRect().width);
  assert.ok(sidePanelWidth < 1440 * 0.8, `Desktop battle panel should not fill the viewport (${sidePanelWidth}px).`);
  assert.equal(await page.getByRole('button', { name: 'Речь', exact: true }).count(), 0);
  assert.equal(await page.locator('summary').filter({ hasText: 'Действие' }).first().isVisible(), true);
  assert.equal(await page.locator('summary').filter({ hasText: 'Заклинания' }).count(), 0, 'non-casters do not get an empty spell branch');
  await page.getByText('Атака', { exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Оружие', exact: true }).inputValue(), 'Longsword', 'carried weapon is the default, not an unarmed strike');
  const bonusSummary = page.locator('summary').filter({ hasText: 'Бонусное действие' });
  await bonusSummary.click();
  const bonusBranch = bonusSummary.locator('xpath=..');
  await bonusBranch.locator('summary').filter({ hasText: 'Способности' }).click();
  // Inspect two real browser submissions without committing either fixture turn.
  // Rejected submissions retain the draft; the final scenario below uses the API.
  const captured = [];
  const actionsRoute = `**/api/campaigns/${campaignId}/actions`;
  await page.route(actionsRoute, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    captured.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Local draft inspection' }) });
  });
  const plan = page.getByRole('region', { name: 'Порядок действий', exact: true });
  const prose = page.getByRole('textbox', { name: 'Действия и реплики персонажа', exact: true });
  const sendDraft = async expectedAction => {
    await page.getByRole('button', { name: 'Отправить действие', exact: true }).click();
    const confirmation = page.getByRole('dialog');
    await confirmation.waitFor();
    if (expectedAction) assert.match(await confirmation.innerText(), new RegExp(expectedAction));
    const response = page.waitForResponse(r => r.url().endsWith('/actions') && r.request().method() === 'POST');
    await confirmation.getByRole('button', { name: 'Отправить', exact: true }).click();
    await response;
    await page.getByRole('button', { name: 'Отправить действие', exact: true }).waitFor();
  };
  await page.getByRole('combobox', { name: 'Способность (Бонусное действие)', exact: true }).selectOption('second_wind');
  assert.equal(await plan.getByRole('listitem').count(), 1, 'selecting a self-targeted ability queues it automatically');
  assert.match(await plan.innerText(), /Второе дыхание/);
  await plan.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await prose.fill('Рублю мечом эту рогатую сволочь!');
  await sendDraft();
  assert.deepEqual(captured[0].combatTurn.choices, []);
  assert.equal(captured[0].combatTurn.prose, 'Рублю мечом эту рогатую сволочь!');
  await prose.fill('');
  await page.getByRole('combobox', { name: 'Цель атаки', exact: true }).selectOption({ index: 1 });
  await sendDraft('Атака: Longsword → Dummy');
  assert.equal(captured[1].combatTurn.choices.length, 1);
  assert.equal(captured[1].combatTurn.choices[0].type, 'attack');
  assert.equal(captured[1].combatTurn.prose, undefined, 'explicit action needs no prose');
  assert.match(await plan.innerText(), /Атака: Longsword → Dummy/);
  await plan.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  assert.equal(JSON.stringify(captured[1]).includes('second_wind'), false, 'inspected ability is not silently attached to an attack');
  await page.unroute(actionsRoute);
  await page.getByRole('combobox', { name: 'Оружие', exact: true }).selectOption('Longsword');
  await page.getByText('Тактика и манёвры', { exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: /Цель манёвра|Союзник для помощи/ }).count(), 0, 'maneuver targets stay hidden until a target-requiring action is selected');
  assert.equal(await page.getByRole('button', { name: 'Рывок', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'Рывок', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Отход', exact: true }).count(), 0, 'unavailable maneuvers are hidden after spending the action');
  await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await page.getByRole('button', { name: 'Захватить', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: /Цель манёвра/ }).count(), 1, 'grapple asks only for an enemy');
  assert.equal(await page.getByRole('combobox', { name: 'Союзник для помощи', exact: true }).count(), 0);
  await page.getByRole('combobox', { name: /Цель манёвра/ }).selectOption({ index: 1 });
  assert.equal(await page.getByRole('region', { name: 'Порядок действий', exact: true }).getByRole('listitem').count(), 1);
  await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  const helpManeuver = page.getByRole('button', { name: 'Помочь союзнику', exact: true });
  if (await helpManeuver.count()) {
    await helpManeuver.click();
    assert.equal(await page.getByRole('combobox', { name: 'Союзник для помощи', exact: true }).count(), 1, 'Help asks only for an ally');
    assert.equal(await page.getByRole('combobox', { name: /Цель манёвра/ }).count(), 0);
    await page.getByRole('combobox', { name: 'Союзник для помощи', exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  }
  if (process.env.ODM_E2E_PET_NAME) {
    const hud = page.getByRole('region', { name: 'Ваш боевой ход', exact: true });
    await hud.locator('summary').filter({ hasText: 'Питомцы' }).click();
    const pets = hud.getByRole('region', { name: 'Питомцы в бою', exact: true });
    await pets.waitFor({ timeout: 10000 });
    assert.equal(await pets.count(), 1, 'pet commands are nested in the hero action tree');
    const petTarget = pets.getByRole('combobox', { name: `Цель питомца: ${process.env.ODM_E2E_PET_NAME}`, exact: true });
    assert.equal(await petTarget.inputValue(), '', 'pet target is independent of the hero attack target');
    const bite = pets.getByRole('button', { name: `Приказать ${process.env.ODM_E2E_PET_NAME}: Bite`, exact: true });
    assert.equal(await bite.isDisabled(), true);
    await petTarget.selectOption({ index: 1 });
    await bite.click();
    assert.equal(await bite.isDisabled(), true, 'a pet cannot be queued twice');
    assert.equal(await pets.getByText('Команда в плане хода', { exact: true }).isVisible(), true);
    assert.equal(await page.getByText('Бонусное действие: использовано', { exact: true }).isVisible(), true, 'pet and hero panels share one budget');
    await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
    assert.equal(await bite.isEnabled(), true);
  }
  if (process.env.ODM_E2E_OTHER_USERNAME) {
    const other = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await other.addCookies([{ name: 'odm_locale', value: 'ru', url: base }]);
    assert.equal((await other.request.post(`${base}/api/auth/login`, { data: { username: process.env.ODM_E2E_OTHER_USERNAME, password: process.env.ODM_E2E_PASSWORD } })).status(), 200);
    const observer = await other.newPage();
    await observer.goto(`${base}/campaigns/${campaignId}`);
    const otherTour = observer.getByRole('button', { name: 'Завершить тур', exact: true });
    if (await otherTour.waitFor({ timeout: 5000 }).then(() => true, () => false)) await otherTour.click();
    await observer.locator('[data-tour="tab-battle"]').filter({ visible: true }).click();
    await observer.locator('summary').filter({ hasText: 'Питомцы в бою' }).click();
    const pets = observer.getByRole('region', { name: 'Питомцы в бою', exact: true });
    await pets.waitFor();
    assert.equal(await observer.getByRole('region', { name: 'Ваш боевой ход', exact: true }).count(), 0);
    assert.equal(await pets.getByRole('button', { name: `Приказать ${process.env.ODM_E2E_PET_NAME}: Bite`, exact: true }).count(), 0, 'no commands for another player pet');
    assert.equal(await pets.getByRole('button', { name: 'Приказать Buddy: Bite', exact: true }).isDisabled(), true, 'own pet waits for the owner turn');
    await other.close();
  }
  await page.getByRole('combobox', { name: 'Цель атаки', exact: true }).selectOption({ index: 1 });
  await page.getByRole('combobox', { name: 'Способность (Бонусное действие)', exact: true }).selectOption('second_wind');
  assert.equal(await page.getByText('Бонусное действие: использовано', { exact: true }).isVisible(), true);
  await page.getByRole('textbox', { name: 'Действия и реплики персонажа', exact: true }).fill('Держитесь! Прикрываю отряд.');
  await page.screenshot({ path: '/tmp/opencode/odm-combat-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Вне игры', exact: true }).click();
  assert.equal(await page.locator('[data-tour="composer-input"] textarea').isEditable(), true);
  await page.getByRole('button', { name: 'Действие', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Убрать действие 2', exact: true }).isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/opencode/odm-combat-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: 'Стол', exact: true }).click();
  const chatInput = page.locator('[data-tour="composer-input"] textarea');
  assert.equal(await chatInput.isVisible(), true);
  await chatInput.focus();
  await page.setViewportSize({ width: 390, height: 460 });
  const inputBottom = await chatInput.evaluate(element => element.getBoundingClientRect().bottom);
  assert.ok(inputBottom <= 460, `chat input should stay above a resized mobile keyboard viewport (${inputBottom}px)`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-tour="composer-input"] button[type="submit"]').click();
  const chatConfirmation = page.getByRole('dialog');
  await chatConfirmation.waitFor();
  const chatConfirmationText = await chatConfirmation.innerText();
  assert.match(chatConfirmationText, /Атака: Longsword → Dummy/);
  assert.match(chatConfirmationText, /Второе дыхание/);
  assert.match(chatConfirmationText, /Держитесь! Прикрываю отряд\./);
  const response = page.waitForResponse(result => result.url().endsWith('/actions') && result.request().method() === 'POST');
  await chatConfirmation.getByRole('button', { name: 'Отправить', exact: true }).click();
  const submitted = await response;
  assert.equal(submitted.status(), 202, await submitted.text());
  const sentPlan = submitted.request().postDataJSON().combatTurn;
  assert.deepEqual(sentPlan.choices.map(choice => choice.type), ['attack', 'resource']);
  assert.equal(sentPlan.choices[1].resource, 'second_wind', 'selecting the ability adds it automatically');
  assert.equal(sentPlan.prose, 'Держитесь! Прикрываю отряд.');
  await page.getByRole('button', { name: 'Стол', exact: true }).click();
  await page.getByText('Мастер разрешает ход и готовит повествование. Пока доступны вопросы Мастеру и режим «Вне игры».', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Вне игры', exact: true }).click();
  assert.equal(await page.locator('[data-tour="composer-input"] textarea').isEditable(), true);
  assert.deepEqual(errors, []);
  console.log('PASS combat HUD: action tree; automatic queued choices; confirmation details; nested pet commands, shared budget, desktop/mobile, draft, OOC and processing lock.');
} finally {
  await browser.close();
}
