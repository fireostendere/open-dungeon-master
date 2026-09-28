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
  const actionPicker = page.getByRole('combobox', { name: 'Выберите действие', exact: true });
  const description = page.getByRole('textbox', { name: 'Описание хода (необязательно)', exact: true });
  assert.equal(await description.count(), 0, 'description appears only after choosing an action');
  const availableActions = await actionPicker.locator('option').allTextContents();
  assert.ok(availableActions.some(option => option.includes('Атака: Longsword')));
  assert.equal(availableActions.some(option => option.includes('Cunning Action')), false, 'unowned actions are not offered');
  // Inspect a real browser submission without committing the fixture turn.
  // Rejected submissions retain the draft; the final scenario below uses the API.
  const captured = [];
  const actionsRoute = `**/api/campaigns/${campaignId}/actions`;
  await page.route(actionsRoute, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    captured.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Local draft inspection' }) });
  });
  const plan = page.getByRole('region', { name: 'Выбрано', exact: true });
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
  await actionPicker.selectOption('resource:second_wind');
  assert.equal(await page.getByRole('button', { name: 'Добавить в план', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'Добавить в план', exact: true }).click();
  assert.equal(await plan.getByRole('listitem').count(), 1, 'a completed ability is added only after confirmation');
  await plan.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await actionPicker.selectOption('attack:Longsword');
  assert.equal(await page.getByRole('button', { name: 'Добавить в план', exact: true }).isDisabled(), true, 'an attack cannot be added before a target is chosen');
  assert.equal(await page.getByRole('button', { name: 'Отправить ход', exact: true }).count(), 0, 'an incomplete selection blocks turn submission');
  assert.equal(await hud.getByRole('button', { name: 'Пропустить ход', exact: true }).count(), 0, 'an incomplete selection cannot be bypassed by skipping the turn');
  await page.getByRole('combobox', { name: 'Выберите цель', exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Добавить в план', exact: true }).click();
  assert.equal(await description.count(), 1, 'description is available after choosing an action');
  await sendDraft('Атака: Longsword → Dummy');
  assert.equal(captured[0].combatTurn.choices.length, 1);
  assert.equal(captured[0].combatTurn.choices[0].type, 'attack');
  assert.equal(Object.hasOwn(captured[0].combatTurn, 'prose'), false, 'combat turns carry no free-form action text');
  assert.equal(Object.hasOwn(captured[0].combatTurn, 'description'), false, 'description is optional');
  assert.match(await plan.innerText(), /Атака: Longsword/);
  await plan.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  assert.equal(JSON.stringify(captured[0]).includes('second_wind'), false, 'inspected ability is not silently attached to an attack');
  await page.unroute(actionsRoute);
  await actionPicker.selectOption('maneuver:dash');
  await page.getByRole('button', { name: 'Добавить в план', exact: true }).click();
  assert.equal((await actionPicker.locator('option').allTextContents()).some(option => option.includes('Отход')), false, 'unavailable maneuvers are hidden after spending the action');
  await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  await actionPicker.selectOption('maneuver:grapple');
  assert.equal(await page.getByRole('combobox', { name: 'Выберите цель', exact: true }).count(), 1, 'grapple asks only for an enemy');
  await page.getByRole('combobox', { name: 'Выберите цель', exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Добавить в план', exact: true }).click();
  assert.equal(await plan.getByRole('listitem').count(), 1);
  await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  const helpOption = actionPicker.locator('option[value="maneuver:help"]');
  if (await helpOption.count()) {
    await actionPicker.selectOption('maneuver:help');
    assert.equal(await page.getByRole('combobox', { name: 'Выберите цель', exact: true }).count(), 1, 'Help asks only for an ally');
    await page.getByRole('combobox', { name: 'Выберите цель', exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Добавить в план', exact: true }).click();
    await page.getByRole('button', { name: 'Убрать действие 1', exact: true }).click();
  }
  await hud.getByRole('button', { name: 'Пропустить ход', exact: true }).click();
  const skipConfirmation = page.getByRole('dialog');
  await skipConfirmation.waitFor();
  assert.match(await skipConfirmation.innerText(), /Я пропускаю боевой ход\./);
  await skipConfirmation.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await skipConfirmation.waitFor({ state: 'hidden' });
  if (process.env.ODM_E2E_PET_NAME) {
    await actionPicker.selectOption(`pet:${process.env.ODM_E2E_PET_NAME}`);
    const pets = hud.getByRole('region', { name: 'Питомцы в бою', exact: true });
    await pets.waitFor({ timeout: 10000 });
    assert.equal(await pets.count(), 1, 'pet commands are nested in the hero action tree');
    const petTarget = pets.getByRole('combobox', { name: `Цель питомца: ${process.env.ODM_E2E_PET_NAME}`, exact: true });
    assert.equal(await petTarget.inputValue(), '', 'pet target is independent of the hero attack target');
    const bite = pets.getByRole('button', { name: `Приказать ${process.env.ODM_E2E_PET_NAME}: Bite`, exact: true });
    assert.equal(await bite.isDisabled(), true);
    await petTarget.selectOption({ index: 1 });
    await bite.click();
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
  await actionPicker.selectOption('attack:Longsword');
  await page.getByRole('combobox', { name: 'Выберите цель', exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Добавить в план', exact: true }).click();
  await actionPicker.selectOption('resource:second_wind');
  await page.getByRole('button', { name: 'Добавить в план', exact: true }).click();
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
  assert.match(chatConfirmationText, /Атака: Longsword → Dummy/);
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
  console.log('PASS combat HUD: available-action wizard, required targets, incomplete-submit blocking, pet commands, desktop/mobile, OOC and processing lock.');
} finally {
  await browser.close();
}
