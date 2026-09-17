import * as z from "zod/v4";

const MAX_MATCHES = 5;
const MAX_NAME_LENGTH = 200;
const MAX_URL_OUTPUT_LENGTH = 500;
const MAX_VALUE_LENGTH = 2_000;
const MAX_KEY_LENGTH = 80;
const MAX_ASSERT_TIMEOUT = 10_000;
const PRESS_ROLES = new Set(["combobox", "searchbox", "spinbutton", "textbox"]);

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function failure(error) {
  const message = error instanceof Error ? error.message : "UI test operation failed";
  return { content: [{ type: "text", text: message.slice(0, 240) }], isError: true };
}

function upstreamText(result) {
  if (result?.isError) throw new Error("Playwright operation failed");
  return (result?.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}

/** Parse only role/name/ref accessibility lines; the ref deliberately never leaves this module. */
function parseAccessibilityMatches(text) {
  const matches = [];
  const refs = new Set();
  const pattern = /^\s*(?:[-*]\s*)?([a-z][\w-]*)(?:\s+(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'))?([^\r\n]*)$/gim;
  for (const match of text.matchAll(pattern)) {
    const ref = match[4].match(/\[ref=([^\]\s]+)\]/)?.[1];
    if (ref && !refs.has(ref)) {
      refs.add(ref);
      matches.push({ role: match[1].toLowerCase(), name: decodeName(match[2], match[3]), ref });
    }
  }
  return matches;
}

function decodeName(doubleQuoted, singleQuoted) {
  if (doubleQuoted !== undefined) {
    try { return JSON.parse(`"${doubleQuoted}"`); } catch { return doubleQuoted; }
  }
  return singleQuoted?.replace(/\\'/g, "'").replace(/\\\\/g, "\\") ?? "";
}

function boundedName(name) {
  return name.length <= MAX_NAME_LENGTH ? name : `${name.slice(0, MAX_NAME_LENGTH - 3)}...`;
}

export function parseAccessibilitySnippets(text) {
  return parseAccessibilityMatches(text).map(({ role, name }) => ({ role, name }));
}

function allowedUrl(path, baseUrl) {
  let url;
  try { url = new URL(path, baseUrl); } catch { throw new Error("Invalid URL"); }
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  if (url.origin !== baseUrl.origin) throw new Error("URL must use the configured same origin");
  return url;
}

function findQuery({ role, name }) {
  return name || role;
}

function normalized(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export class UiController {
  constructor(upstream, { baseUrl = process.env.ODM_UI_TEST_BASE_URL || "http://127.0.0.1:3005" } = {}) {
    this.upstream = upstream;
    this.baseUrl = new URL(baseUrl);
    if (!/^https?:$/.test(this.baseUrl.protocol) || this.baseUrl.username || this.baseUrl.password) throw new Error("ODM_UI_TEST_BASE_URL must be an HTTP(S) origin without credentials");
    this.handles = new Map();
    this.nextHandle = 1;
    this.queue = Promise.resolve();
  }

  clearHandles() { this.handles.clear(); }
  async run(name, args) { return upstreamText(await this.upstream.call(name, args)); }
  exclusive(callback) {
    const operation = this.queue.then(callback, callback);
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async open({ path }) {
    if (typeof path !== "string" || path.length < 1 || path.length > MAX_VALUE_LENGTH) throw new Error("path must be a bounded URL or path");
    const url = allowedUrl(path, this.baseUrl);
    this.clearHandles();
    await this.run("browser_navigate", { url: url.href });
    let current;
    try { current = new URL(await this.upstream.currentUrl()); }
    catch {
      await this.run("browser_navigate", { url: "about:blank" });
      throw new Error("Could not verify navigation origin");
    }
    if (current.origin !== this.baseUrl.origin || current.username || current.password) {
      await this.run("browser_navigate", { url: "about:blank" });
      throw new Error("Navigation left allowed origin");
    }
    const truncated = current.pathname.length > MAX_URL_OUTPUT_LENGTH;
    return {
      ok: true,
      url: truncated ? `${current.pathname.slice(0, MAX_URL_OUTPUT_LENGTH - 3)}...` : current.pathname,
      truncated,
    };
  }

  async matching({ role, name, exact = true }) {
    if (role !== undefined && (typeof role !== "string" || !role || role.length > 80)) throw new Error("role must be a bounded string");
    if (name !== undefined && (typeof name !== "string" || !name || name.length > 200)) throw new Error("name must be a bounded string");
    if (!role && !name) throw new Error("role or name is required");
    const snippets = parseAccessibilityMatches(await this.run("browser_find", { text: findQuery({ role, name }) }));
    return snippets.filter((item) =>
      (!role || (exact ? item.role === normalized(role) : item.role.includes(normalized(role)))) &&
      (!name || (exact ? normalized(item.name) === normalized(name) : normalized(item.name).includes(normalized(name)))),
    );
  }

  async find(args) {
    const matches = await this.matching(args);
    return {
      matches: matches.slice(0, MAX_MATCHES).map(({ role, name, ref }) => {
        const handle = `ui_${this.nextHandle++}`;
        const displayName = boundedName(name);
        this.handles.set(handle, { ref, role, name: displayName });
        return { handle, role, name: displayName };
      }),
      count: matches.length,
      truncated: matches.length > MAX_MATCHES,
    };
  }

  async action({ handle, action, value, values }) {
    if (!["click", "fill", "select", "press"].includes(action)) throw new Error("Invalid action");
    if (typeof handle !== "string" || handle.length > 80) throw new Error("Invalid handle");
    if (action === "fill" && (typeof value !== "string" || value.length > MAX_VALUE_LENGTH)) throw new Error("value must be a bounded string");
    if (action === "press" && (typeof value !== "string" || !value || value.length > MAX_KEY_LENGTH)) throw new Error("press value must be a bounded key");
    if (action === "select" && (!Array.isArray(values) || !values.length || values.length > 20 || values.some((item) => typeof item !== "string" || item.length > 200))) throw new Error("values must be a bounded string array");
    const target = this.handles.get(handle);
    if (!target) throw new Error("Unknown or stale handle");
    if (action === "press" && !PRESS_ROLES.has(target.role)) throw new Error("press is limited to form fields; use click for buttons");
    try {
      if (action === "click") await this.run("browser_click", { target: target.ref });
      if (action === "fill") await this.run("browser_type", { target: target.ref, text: value });
      if (action === "select") await this.run("browser_select_option", { target: target.ref, values });
      if (action === "press") {
        await this.run("browser_click", { target: target.ref });
        await this.run("browser_press_key", { key: value });
      }
      return { ok: true, action };
    } finally {
      this.clearHandles();
    }
  }

  async assert({ target, condition, timeoutMs = 2_000 }) {
    if (!target || typeof target !== "object" || !["visible", "hidden"].includes(condition)) throw new Error("Invalid assertion");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_ASSERT_TIMEOUT) throw new Error("Invalid timeoutMs");
    const until = Date.now() + timeoutMs;
    do {
      const visible = (await this.matching(target)).length > 0;
      if ((condition === "visible") === visible) return { ok: true, condition, target: { role: target.role, name: target.name } };
      if (Date.now() >= until) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (true);
    return { ok: false, condition, target: { role: target.role, name: target.name } };
  }
}

const targetSchema = z.object({ role: z.string().min(1).max(80).optional(), name: z.string().min(1).max(MAX_NAME_LENGTH).optional() }).refine((target) => target.role || target.name, "role or name is required");

export function registerTools(server, controller) {
  const register = (name, config, callback) => server.registerTool(name, config, async (args) => {
    try { return textResult(await controller.exclusive(() => callback(args))); } catch (error) { return failure(error); }
  });
  register("ui_open", { title: "Open ODM UI page", description: "Open a relative path or same-origin URL on the configured test app.", inputSchema: z.object({ path: z.string().min(1).max(MAX_VALUE_LENGTH) }) }, (args) => controller.open(args));
  register("ui_find", { title: "Find accessible ODM UI elements", description: "Return compact handles for an accessibility role/name. Full-name matching is the default; set exact=false for substring matching.", inputSchema: targetSchema.extend({ exact: z.boolean().optional() }) }, (args) => controller.find(args));
  register("ui_action", { title: "Act on a found ODM UI element", description: "Act on a ui_find handle. fill/press use value; select uses values. press only focuses form fields; use click for buttons.", inputSchema: z.object({ handle: z.string().min(1).max(80), action: z.enum(["click", "fill", "select", "press"]), value: z.string().max(MAX_VALUE_LENGTH).optional(), values: z.array(z.string().max(200)).max(20).optional() }) }, (args) => controller.action(args));
  register("ui_assert", { title: "Assert accessible ODM UI state", description: "Wait for an accessibility target to become visible or hidden.", inputSchema: z.object({ target: targetSchema, condition: z.enum(["visible", "hidden"]), timeoutMs: z.number().int().min(0).max(MAX_ASSERT_TIMEOUT).optional() }) }, (args) => controller.assert(args));
}
