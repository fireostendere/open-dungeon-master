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
  const hud = page.getByRole('region', { name: 'Конструктор боевого хода', exact: true });
  await hud.getByRole('button', { name: 'Пропустить ход', exact: true }).waitFor({ timeout: 60000 }).catch(async error => {
    await page.screenshot({ path: '/tmp/opencode/odm-combat-hud-failure.png', fullPage: true });
    console.error('Combat page:', await page.locator('body').innerText());
    throw error;
  });
  const sidePanelWidth = await page.locator('#side-panel-content').evaluate(element => element.parentElement.getBoundingClientRect().width);
  assert.ok(sidePanelWidth < 1440 * 0.8, `Desktop battle panel should not fill the viewport (${sidePanelWidth}px).`);
  assert.equal(await page.getByRole('button', { name: 'Речь', exact: true }).count(), 0);
  const tab = name => hud.getByRole('group', { name: 'Что делать', exact: true }).getByRole('button', { name, exact: true });
  const tile = name => hud.getByRole('button', { name, exact: true });
  const longsword = hud.getByRole('button', { name: /^(Длинный меч|Longsword)$/ });
  const targets = hud.getByRole('button', { name: /^Цель: / });
  const description = page.getByRole('textbox', { name: 'Описание хода (необязательно)', exact: true });
  assert.equal(await description.count(), 0, 'description appears only after choosing an action');
  await tab('Атака').click();
  assert.equal(await longsword.count(), 1, 'the sheet weapon is offered as an attack');
  await tab('Действия').click();
  assert.equal(await hud.getByRole('button', { name: /хитрое/ }).count(), 0, 'unowned actions are not offered');
  // Inspect a real browser submission without committing the fixture turn.
  // Rejected submissions retain the draft; the final scenario below uses the API.
  const captured = [];
  const actionsRoute = `**/api/campaigns/${campaignId}/actions`;
  await page.route(actionsRoute, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    captured.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Local draft inspection' }) });
  });
  const plan = page.getByRole('region', { name: 'План хода', exact: true });
  const sendDraft = async expectedAction => {
    await page.getByRole('button', { name: 'Отправить ход', exact: true }).click();
    const confirmation = page.getByRole('dialog');
    await confirmation.waitFor();
    if (expectedAction) assert.match(await confirmation.innerText(), new RegExp(expectedAction));
    const response = page.waitForResponse(r => r.url().endsWith('/actions') && r.request().method() === 'POST');
    await confirmation.getByRole('button', { name: 'Отправить', exact: true }).click();
    await response;
    await page.getByRole('button', { name: 'Отправить ход', exact: true }).waitFor();
  };
  await hud.getByRole('button', { name: /^Второе дыхание/ }).click();
  assert.equal(await plan.getByRole('listitem').count(), 1, 'a self-only ability joins the plan in one tap');
  await plan.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await tab('Атака').click();
  await longsword.click();
  assert.equal(await plan.getByRole('listitem').count(), 0, 'an attack waits for its target');
  assert.equal(await page.getByRole('button', { name: 'Отправить ход', exact: true }).count(), 0, 'an incomplete selection blocks turn submission');
  assert.equal(await hud.getByRole('button', { name: 'Пропустить ход', exact: true }).count(), 0, 'an incomplete selection cannot be bypassed by skipping the turn');
  await targets.first().click();
  assert.equal(await description.count(), 1, 'description is available after choosing an action');
  await sendDraft('Атака: (Longsword|Длинный меч) → Dummy');
  assert.equal(captured[0].combatTurn.choices.length, 1);
  assert.equal(captured[0].combatTurn.choices[0].type, 'attack');
  assert.equal(Object.hasOwn(captured[0].combatTurn, 'prose'), false, 'combat turns carry no free-form action text');
  assert.equal(Object.hasOwn(captured[0].combatTurn, 'description'), false, 'description is optional');
  assert.match(await plan.innerText(), /Атака: (Longsword|Длинный меч)/);
  await plan.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  assert.equal(JSON.stringify(captured[0]).includes('second_wind'), false, 'inspected ability is not silently attached to an attack');
  await page.unroute(actionsRoute);
  await tab('Действия').click();
  await tile('Рывок').click();
  assert.equal(await tile('Отход').isDisabled(), true, 'actions needing the spent action are disabled');
  assert.equal(await tile('Сбежать').isDisabled(), true, 'fleeing needs the action too');
  await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await tile('Захватить').click();
  assert.ok(await targets.count() > 0, 'grapple asks for an enemy');
  await targets.first().click();
  assert.equal(await plan.getByRole('listitem').count(), 1);
  await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  if (await tile('Помочь союзнику').count()) {
    await tile('Помочь союзнику').click();
    assert.ok(await targets.count() > 0, 'Help asks for an ally');
    await targets.first().click();
    await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  }
  // Talking, running and anything improvised: requests for the DM, each paid with the action.
  await tile('Договориться').click();
  await tile('Запугать').click();
  await tile('С кем: Со всеми').click();
  assert.match(await plan.innerText(), /Переговоры \(запугать\) → все враги/);
  await tab('Атака').click();
  assert.equal(await longsword.isDisabled(), true, 'a parley spends the action an attack needs');
  await tab('Действия').click();
  await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await tile('Сбежать').click();
  assert.match(await plan.innerText(), /Бегство с поля боя/);
  await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await tile('Своё действие').click();
  await hud.getByRole('textbox', { name: 'Что делает персонаж?', exact: true }).fill('Рублю верёвку люстры над врагом');
  await tile('Добавить в план').click();
  assert.match(await plan.innerText(), /Своё действие: Рублю верёвку люстры над врагом/);
  await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await hud.getByRole('button', { name: 'Пропустить ход', exact: true }).click();
  const skipConfirmation = page.getByRole('dialog');
  await skipConfirmation.waitFor();
  assert.match(await skipConfirmation.innerText(), /Я пропускаю боевой ход\./);
  await skipConfirmation.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await skipConfirmation.waitFor({ state: 'hidden' });
  if (process.env.ODM_E2E_PET_NAME) {
    await tab('Питомцы').click();
    const pets = hud.getByRole('region', { name: 'Питомцы в бою', exact: true });
    await pets.waitFor({ timeout: 10000 });
    assert.equal(await pets.count(), 1, 'pet commands are nested in the hero action tree');
    const petTargets = pets.getByRole('button', { name: new RegExp(`^Цель питомца: ${process.env.ODM_E2E_PET_NAME}: `) });
    assert.equal(await petTargets.count(), 0, 'pet target is independent of the hero attack target');
    await pets.getByRole('button', { name: `Приказать ${process.env.ODM_E2E_PET_NAME}: Bite`, exact: true }).click();
    assert.equal(await plan.getByRole('listitem').count(), 0, 'a pet attack waits for its target');
    await petTargets.first().click();
    assert.equal(await plan.getByRole('listitem').count(), 1, 'a complete pet attack enters the shared plan');
    await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
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
    assert.equal(await observer.getByRole('region', { name: 'Конструктор боевого хода', exact: true }).count(), 0);
    assert.equal(await pets.getByRole('button', { name: `Приказать ${process.env.ODM_E2E_PET_NAME}: Bite`, exact: true }).count(), 0, 'no commands for another player pet');
    assert.equal(await pets.getByRole('button', { name: 'Приказать Buddy: Bite', exact: true }).isDisabled(), true, 'own pet waits for the owner turn');
    await other.close();
  }
  await tab('Атака').click();
  await longsword.click();
  await targets.first().click();
  await tab('Действия').click();
  await hud.getByRole('button', { name: /^Второе дыхание/ }).click();
  await description.fill('Держитесь! Прикрываю отряд.');
  await page.screenshot({ path: '/tmp/opencode/odm-combat-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Вне игры', exact: true }).click();
  assert.equal(await page.locator('[data-tour="composer-input"] textarea').isEditable(), true);
  await page.getByRole('button', { name: 'Действие', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Убрать действие 2', exact: true }).isVisible(), true);
  assert.equal(await description.inputValue(), 'Держитесь! Прикрываю отряд.', 'description stays with the draft when switching composer modes');
  assert.equal(await page.locator('[data-tour="composer-input"] textarea').count(), 0, 'combat Do has no free-form text input');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/opencode/odm-combat-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: 'Отправить ход', exact: true }).click();
  const chatConfirmation = page.getByRole('dialog');
  await chatConfirmation.waitFor();
  const [editRect, sendRect] = await chatConfirmation.getByRole('button', { name: 'Редактировать', exact: true }).evaluate(element => [element.getBoundingClientRect().toJSON(), element.nextElementSibling.getBoundingClientRect().toJSON()]);
  assert.ok(Math.abs(editRect.y - sendRect.y) < 1 && sendRect.x > editRect.x, `mobile confirmation actions stay side by side: edit=${JSON.stringify(editRect)}, send=${JSON.stringify(sendRect)}`);
  const chatConfirmationText = await chatConfirmation.innerText();
  assert.match(chatConfirmationText, /Атака: (Longsword|Длинный меч) → Dummy/);
  assert.match(chatConfirmationText, /Второе дыхание/);
  assert.match(chatConfirmationText, /Держитесь! Прикрываю отряд\./);
  const response = page.waitForResponse(result => result.url().endsWith('/actions') && result.request().method() === 'POST');
  await chatConfirmation.getByRole('button', { name: 'Отправить', exact: true }).click();
  const submitted = await response;
  assert.equal(submitted.status(), 202, await submitted.text());
  const sentPlan = submitted.request().postDataJSON().combatTurn;
  assert.deepEqual(sentPlan.choices.map(choice => choice.type), ['attack', 'resource']);
  assert.equal(sentPlan.choices[1].resource, 'second_wind');
  assert.equal(Object.hasOwn(sentPlan, 'prose'), false);
  assert.equal(sentPlan.description, 'Держитесь! Прикрываю отряд.');
  await page.getByRole('button', { name: 'Стол', exact: true }).click();
  await page.getByText('Мастер разрешает ход и готовит повествование. Пока доступны вопросы Мастеру и режим «Вне игры».', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Вне игры', exact: true }).click();
  assert.equal(await page.locator('[data-tour="composer-input"] textarea').isEditable(), true);
  assert.deepEqual(errors, []);
  console.log('PASS combat HUD: action tabs, target chips, parley/flee/own action, incomplete-submit blocking, pet commands, desktop/mobile, OOC and processing lock.');
} finally {
  await browser.close();
}
