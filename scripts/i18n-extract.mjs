import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const scanRoots = [path.join(root, "src", "app"), path.join(root, "src", "components")];
const catalogPath = path.join(root, "src", "lib", "i18n", "generated", "en.json");
const markerImport = 'import { i18nText } from "@/lib/i18n/marker";';
const skipFiles = new Set([
  "src/components/LanguageSwitcher.tsx",
  "src/lib/i18n/MarkerBoundary.tsx",
]);

const UI_ATTRS = new Set([
  "alt", "aria-label", "aria-description", "placeholder", "title",
  "label", "description", "content", "help", "helperText", "emptyText",
  "emptyLabel", "confirmLabel", "cancelLabel", "submitLabel", "loadingLabel",
]);
const NON_UI_ATTRS = new Set([
  "className", "href", "src", "type", "value", "name", "id", "role", "method",
  "action", "target", "rel", "accept", "autoComplete", "inputMode", "pattern",
  "key", "side", "align", "variant", "size", "asChild", "htmlFor", "style",
  "width", "height", "viewBox", "fill", "stroke", "d", "xmlns", "download",
]);
const UI_PROPERTIES = new Set([
  "label", "title", "description", "summary", "help", "placeholder", "text", "message",
  "emptyText", "emptyLabel", "confirmLabel", "cancelLabel", "submitLabel", "loadingLabel",
  "tooltip", "caption", "heading", "subtitle", "ariaLabel",
]);
const NON_UI_PROPERTIES = new Set([
  "method", "mode", "credentials", "cache", "status", "statusCode", "code", "id", "key",
  "value", "type", "kind", "role", "path", "href", "url", "src", "slug", "model",
  "provider", "format", "mimeType", "encoding", "command", "event", "scope", "field",
  "name", "token", "locale", "unitSystem", "className", "variant", "side", "align",
]);
const UI_CALLS = /^(set(Error|Message|Notice|Outcome|Warning|Success|StatusText|CopyMessage|FormError|ProbeMessage|Feedback|Alert)|alert|confirm|prompt|toast|notify)$/;
const USER_TEXT_FUNCTION = /(describe|display|label|message|notice|error|outcome|summary|caption|heading|title|humanize|pretty)/i;
const TECH_CALLS = new Set([
  "fetch", "t", "i18nText", "cn", "clsx", "String", "Number", "Boolean", "JSON.stringify",
  "JSON.parse", "encodeURIComponent", "decodeURIComponent", "localStorage.getItem",
  "localStorage.setItem", "sessionStorage.getItem", "sessionStorage.setItem",
]);

const RU_TO_EN = new Map([
  ["Переключить на русский (Switch to Russian)", "Switch to Russian"],
  ["Switch to English (Переключить на английский)", "Switch to English"],
  ["Метрическая система: метры (м) и килограммы (кг). Нажмите для футов/фунтов.", "Metric system: meters and kilograms. Click for imperial units."],
  ["Английская система: футы (ft) и фунты (lb). Нажмите для метров/кг.", "Imperial system: feet and pounds. Click for metric units."],
  ["м/кг", "m/kg"],
  ["фт/фнт", "ft/lb"],
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function propName(node) {
  if (!node) return "";
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText();
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return `${calleeName(expr.expression)}.${expr.name.text}`;
  return expr.getText();
}

function nearest(node, predicate) {
  let current = node.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function nearestFunctionName(node) {
  const fn = nearest(node, (candidate) =>
    ts.isFunctionDeclaration(candidate) || ts.isFunctionExpression(candidate) ||
    ts.isArrowFunction(candidate) || ts.isMethodDeclaration(candidate),
  );
  if (!fn) return "";
  if ("name" in fn && fn.name) return propName(fn.name);
  if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
    const parent = fn.parent;
    if (ts.isVariableDeclaration(parent)) return propName(parent.name);
    if (ts.isPropertyAssignment(parent)) return propName(parent.name);
  }
  return "";
}

function jsxAttrAncestor(node) {
  return nearest(node, ts.isJsxAttribute);
}

function hasUiCallAncestor(node) {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const name = calleeName(current.expression);
      const short = name.split(".").at(-1) ?? name;
      if (UI_CALLS.test(short)) return true;
      if (TECH_CALLS.has(name) || TECH_CALLS.has(short)) return false;
    }
    if (ts.isStatement(current) || ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) break;
    current = current.parent;
  }
  return false;
}

function isTechnicalBySyntax(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isExpressionStatement(parent) && parent.expression === node && node.text === "use client") return true;
  if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    if ([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.InKeyword].includes(op)) return true;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  return false;
}

function isHumanText(text) {
  const value = text.trim();
  if (value.length < 2) return false;
  if (!/[\p{L}]/u.test(value)) return false;
  if (/^(https?:|\/api\/|\/|#[0-9a-f]{3,8}$|[a-z][\w.-]*\/[\w./-]+)$/i.test(value)) return false;
  if (/^[A-Z0-9_:-]+$/.test(value) && !/\s/.test(value)) return false;
  if (/^[a-z][a-z0-9_.:-]*$/.test(value) && !/\s/.test(value)) return false;
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(value)) return false;
  if (/^(application|text|audio|video|image)\//i.test(value)) return false;
  return true;
}

function normalizeEnglish(source) {
  const compact = source.replace(/\s+/g, " ").trim();
  if (!/[А-Яа-яЁё]/.test(compact)) return compact;
  const translated = RU_TO_EN.get(compact);
  if (translated) return translated;
  throw new Error(`Missing English translation for Cyrillic UI text: ${JSON.stringify(compact)}`);
}

function keyFor(file, english) {
  const base = rel(file)
    .replace(/^src\/(app|components)\//, "$1.")
    .replace(/\.(tsx|ts)$/, "")
    .replace(/\[(.*?)\]/g, "$1")
    .replace(/[^a-zA-Z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .toLowerCase();
  const slug = english
    .toLowerCase()
    .replace(/\{p\d+\}/g, " ")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .split(".")
    .filter(Boolean)
    .slice(0, 5)
    .join(".") || "text";
  const hash = crypto.createHash("sha1").update(`${rel(file)}\0${english}`).digest("hex").slice(0, 8);
  return `generated.${base}.${slug}.${hash}`;
}

function literalPayload(node, sf) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { source: node.text, expression: null };
  }
  if (ts.isTemplateExpression(node)) {
    let source = node.head.text;
    const params = [];
    node.templateSpans.forEach((span, index) => {
      const name = `p${index}`;
      source += `{${name}}${span.literal.text}`;
      params.push(`${name}: ${span.expression.getText(sf)}`);
    });
    return { source, expression: `{ ${params.join(", ")} }` };
  }
  return null;
}

function shouldTranslateLiteral(node) {
  if (isTechnicalBySyntax(node)) return false;
  const text = ts.isTemplateExpression(node) ? node.getText() : node.text;
  if (!isHumanText(text.replace(/^`|`$/g, ""))) return false;

  if (hasUiCallAncestor(node)) return true;

  const attr = jsxAttrAncestor(node);
  if (attr) {
    const name = propName(attr.name);
    if (UI_ATTRS.has(name) || name.startsWith("aria-")) return true;
    if (NON_UI_ATTRS.has(name) || name.startsWith("data-") || name.startsWith("on")) return false;
  }

  const property = nearest(node, ts.isPropertyAssignment);
  if (property && property.initializer === node) {
    const name = propName(property.name);
    if (UI_PROPERTIES.has(name)) return true;
    if (NON_UI_PROPERTIES.has(name)) return false;
  }

  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const name = calleeName(current.expression);
      const short = name.split(".").at(-1) ?? name;
      if (TECH_CALLS.has(name) || TECH_CALLS.has(short)) return false;
      if (/^(push|replace|includes|startsWith|endsWith|split|join|match|test|setAttribute|getAttribute)$/i.test(short)) return false;
    }
    if (ts.isJsxExpression(current)) return true;
    if (ts.isStatement(current) || ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current) || ts.isMethodDeclaration(current)) break;
    current = current.parent;
  }

  const fnName = nearestFunctionName(node);
  if (fnName && USER_TEXT_FUNCTION.test(fnName)) return true;
  return false;
}

function replacementForLiteral(node, sf, file, catalog) {
  const payload = literalPayload(node, sf);
  if (!payload) return null;
  const english = normalizeEnglish(payload.source);
  if (!isHumanText(english)) return null;
  const key = keyFor(file, english);
  const existing = catalog[key];
  if (existing && existing !== english) throw new Error(`Key collision for ${key}`);
  catalog[key] = english;
  return payload.expression ? `i18nText(${JSON.stringify(key)}, ${payload.expression})` : `i18nText(${JSON.stringify(key)})`;
}

function processFile(file, catalog) {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

  function add(start, end, text) {
    edits.push({ start, end, text });
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      const raw = source.slice(node.getStart(sf), node.end);
      const match = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const body = match?.[2] ?? raw;
      if (isHumanText(body)) {
        const english = normalizeEnglish(body);
        const key = keyFor(file, english);
        const existing = catalog[key];
        if (existing && existing !== english) throw new Error(`Key collision for ${key}`);
        catalog[key] = english;
        add(node.getStart(sf), node.end, `${match?.[1] ?? ""}{i18nText(${JSON.stringify(key)})}${match?.[3] ?? ""}`);
      }
      return;
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && shouldTranslateLiteral(node)) {
      const replacement = replacementForLiteral(node, sf, file, catalog);
      if (replacement) {
        add(node.getStart(sf), node.end, replacement);
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (edits.length === 0) return { changed: false, count: 0, source };
  edits.sort((a, b) => b.start - a.start);
  let output = source;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);

  if (!output.includes(markerImport)) {
    const imports = sf.statements.filter(ts.isImportDeclaration);
    const directives = sf.statements.filter((statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression));
    const insertion = imports.length ? imports.at(-1).end : directives.length ? directives.at(-1).end : 0;
    output = output.slice(0, insertion) + `\n${markerImport}` + output.slice(insertion);
  }
  return { changed: output !== source, count: edits.length, source: output };
}

let catalog = {};
if (fs.existsSync(catalogPath)) {
  try { catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")); } catch { catalog = {}; }
}

const files = scanRoots.flatMap((dir) => walk(dir)).filter((file) => !skipFiles.has(rel(file))).sort();
let changedFiles = 0;
let replacements = 0;
const pending = [];
for (const file of files) {
  const result = processFile(file, catalog);
  if (result.changed) {
    changedFiles += 1;
    replacements += result.count;
    pending.push({ file, content: result.source });
  }
}

if (checkOnly) {
  if (pending.length > 0) {
    console.error(`i18n audit failed: ${replacements} user-facing literal(s) remain in ${changedFiles} file(s).`);
    for (const item of pending.slice(0, 50)) console.error(` - ${rel(item.file)}`);
    process.exit(1);
  }
  console.log(`i18n audit passed: ${files.length} TSX files contain no unkeyed user-facing literals covered by the audit.`);
  process.exit(0);
}

for (const item of pending) fs.writeFileSync(item.file, item.content);
fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
fs.writeFileSync(catalogPath, `${JSON.stringify(Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
console.log(`i18n extraction: ${replacements} literal(s) keyed across ${changedFiles} file(s); English catalog has ${Object.keys(catalog).length} entries.`);
