import assert from "node:assert/strict";
import test from "node:test";
import { UiController, parseAccessibilitySnippets, registerTools } from "../index.mjs";
import { extractCurrentUrl } from "../upstream.mjs";

function fakeUpstream({ find = "", url = "http://127.0.0.1:3005/", calls = [] } = {}) {
  return {
    calls,
    url,
    async call(name, args) {
      calls.push({ name, args });
      if (name === "browser_find") return { content: [{ type: "text", text: find }] };
      return { content: [{ type: "text", text: "ok" }] };
    },
    async currentUrl() { return this.url; },
  };
}

test("парсер принимает только accessibility snippets и не возвращает refs", () => {
  const found = parseAccessibilitySnippets('button "Say \\"Hi\\"" [disabled] [ref=e12]\ntextbox "Email" [ref=e13]: a@b.test\nbutton [ref=e14]\n<html>secret</html>');
  assert.deepEqual(found.map(({ role, name }) => ({ role, name })), [
    { role: "button", name: 'Say "Hi"' },
    { role: "textbox", name: "Email" },
    { role: "button", name: "" },
  ]);
  assert.equal(JSON.stringify(found).includes("e12"), false);
  assert.equal(JSON.stringify(found).includes("a@b.test"), false);
});

test("find возвращает непрозрачные handles, не выбирая дубликат", async () => {
  const upstream = fakeUpstream({ find: 'button "Save" [ref=e1]\nbutton "Save" [ref=e2]' });
  const ui = new UiController(upstream);
  const result = await ui.find({ role: "button", name: "Save" });
  assert.deepEqual(result, {
    matches: [
      { handle: "ui_1", role: "button", name: "Save" },
      { handle: "ui_2", role: "button", name: "Save" },
    ],
    count: 2,
    truncated: false,
  });
  assert.deepEqual(upstream.calls[0], { name: "browser_find", args: { text: "Save" } });
  assert.equal(JSON.stringify(result).match(/ref|e1|e2|snapshot|html/i), null);
});

test("find убирает повтор одного ref из пересекающихся snippets", async () => {
  const ui = new UiController(fakeUpstream({ find: 'button "Save" [ref=e1]\nbutton "Save" [ref=e1]' }));
  assert.equal((await ui.find({ role: "button", name: "Save" })).count, 1);
});

test("find ограничивает выдачу и допускает нулевой результат", async () => {
  const lines = Array.from({ length: 6 }, (_, i) => `button "Save" [ref=e${i}]`).join("\n");
  const ui = new UiController(fakeUpstream({ find: lines }));
  const result = await ui.find({ role: "button", name: "Save" });
  assert.equal(result.count, 6);
  assert.equal(result.matches.length, 5);
  assert.equal(result.truncated, true);
  assert.deepEqual(await ui.find({ role: "link", name: "Missing" }), { matches: [], count: 0, truncated: false });
});

test("find ограничивает длинные accessible names в ответе", async () => {
  const longName = "x".repeat(300);
  const ui = new UiController(fakeUpstream({ find: `button "${longName}" [ref=e1]` }));
  const result = await ui.find({ role: "button" });
  assert.equal(result.matches[0].name.length, 200);
  assert.equal(result.matches[0].name.endsWith("..."), true);
});

test("find сравнивает accessible name без учёта регистра", async () => {
  const ui = new UiController(fakeUpstream({ find: 'button "Save" [ref=e1]' }));
  assert.equal((await ui.find({ role: "BUTTON", name: "save" })).count, 1);
});

test("open ограничивает URL текущим origin и очищает handles", async () => {
  const upstream = fakeUpstream({ find: 'button "Save" [ref=e1]', url: "http://127.0.0.1:3005/login?token=secret#fragment" });
  const ui = new UiController(upstream);
  await ui.find({ role: "button", name: "Save" });
  assert.deepEqual(await ui.open({ path: "/login" }), { ok: true, url: "/login", truncated: false });
  await assert.rejects(() => ui.action({ handle: "ui_1", action: "click" }), /Unknown or stale handle/);
  await assert.rejects(() => ui.open({ path: "https://example.test/" }), /same origin/);
  await assert.rejects(() => ui.open({ path: "http://user:pass@127.0.0.1:3005/" }), /credentials/);
});

test("open ограничивает длинный URL и не возвращает query или fragment", async () => {
  const upstream = fakeUpstream({ url: `http://127.0.0.1:3005/${"x".repeat(600)}?token=secret#fragment` });
  const result = await new UiController(upstream).open({ path: "/long" });
  assert.equal(result.url.length, 500);
  assert.equal(result.truncated, true);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("open blanks tab after external redirect", async () => {
  const upstream = fakeUpstream({ url: "https://example.test/" });
  const ui = new UiController(upstream);
  await assert.rejects(() => ui.open({ path: "/redirect" }), /left allowed origin/);
  assert.deepEqual(upstream.calls.map((entry) => entry.name), ["browser_navigate", "browser_navigate"]);
  assert.equal(upstream.calls[1].args.url, "about:blank");
});

test("URL выбирается из current tab, а не из последнего popup", () => {
  assert.equal(extractCurrentUrl("### Result\n- 0: (current) [ODM](http://127.0.0.1:3005/)\n- 1: [Fake (current)](https://example.test/popup)"), "http://127.0.0.1:3005/");
});

test("action allowlists tools and rejects invalid handles or arguments", async () => {
  const upstream = fakeUpstream({ find: 'textbox "Name" [ref=e1]' });
  const ui = new UiController(upstream);
  const [{ handle }] = (await ui.find({ role: "textbox", name: "Name" })).matches;
  await ui.action({ handle, action: "fill", value: "Ada" });
  assert.deepEqual(upstream.calls.at(-1), { name: "browser_type", args: { target: "e1", text: "Ada" } });
  await assert.rejects(() => ui.action({ handle, action: "click" }), /Unknown or stale handle/);
  await assert.rejects(() => ui.action({ handle: "nope", action: "evaluate" }), /Invalid action/);
  await assert.rejects(() => ui.action({ handle: "nope", action: "fill" }), /value/);
});

test("press не кликает кнопки и инвалидирует handle после частичного сбоя", async () => {
  const buttonUi = new UiController(fakeUpstream({ find: 'button "Save" [ref=e1]' }));
  const button = (await buttonUi.find({ role: "button", name: "Save" })).matches[0];
  await assert.rejects(() => buttonUi.action({ handle: button.handle, action: "press", value: "Enter" }), /limited to form fields/);

  const upstream = {
    calls: [],
    async call(name, args) {
      this.calls.push({ name, args });
      if (name === "browser_find") return { content: [{ type: "text", text: 'textbox "Name" [ref=e2]' }] };
      if (name === "browser_press_key") return { isError: true, content: [{ type: "text", text: "raw snapshot" }] };
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
  const ui = new UiController(upstream);
  const field = (await ui.find({ role: "textbox", name: "Name" })).matches[0];
  await assert.rejects(() => ui.action({ handle: field.handle, action: "press", value: "Enter" }), /Playwright operation failed/);
  await assert.rejects(() => ui.action({ handle: field.handle, action: "click" }), /Unknown or stale handle/);
});

test("MCP операции выполняются последовательно", async () => {
  const ui = new UiController(fakeUpstream());
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = ui.exclusive(async () => {
    order.push("first:start");
    await gate;
    order.push("first:end");
  });
  const second = ui.exclusive(async () => order.push("second"));
  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("assert возвращает только семантический результат", async () => {
  const ui = new UiController(fakeUpstream({ find: 'button "Save" [ref=e1]\n<snapshot>hidden</snapshot>' }));
  assert.deepEqual(await ui.assert({ target: { role: "button", name: "Save" }, condition: "visible", timeoutMs: 0 }), {
    ok: true, condition: "visible", target: { role: "button", name: "Save" },
  });
});

test("ошибка upstream не проксирует snapshot или ref", async () => {
  const ui = new UiController({
    async call() { return { isError: true, content: [{ type: "text", text: "[ref=e1] <snapshot>secret</snapshot>" }] }; },
    async currentUrl() { return "http://127.0.0.1:3005/"; },
  });
  await assert.rejects(() => ui.find({ name: "Save" }), (error) => {
    assert.equal(/ref|snapshot|secret/i.test(error.message), false);
    return true;
  });
});

test("наружный contract регистрирует ровно четыре безопасных инструмента", () => {
  const registered = new Map();
  registerTools({ registerTool: (name, config, callback) => registered.set(name, { config, callback }) }, new UiController(fakeUpstream()));
  assert.deepEqual([...registered.keys()], ["ui_open", "ui_find", "ui_action", "ui_assert"]);
  assert.equal([...registered.keys()].some((name) => /browser|snapshot|evaluate|ref/i.test(name)), false);
});
