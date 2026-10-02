import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const translationPath = path.join(root, "src", "lib", "i18n", "translations.ts");
const inlineCopyPath = path.join(root, "src", "lib", "i18n", "inline-copy.ts");
const auditedRoots = [
  path.join(root, "src", "app"),
  path.join(root, "src", "components"),
  path.join(root, "src", "lib", "i18n"),
];
const CYRILLIC = /[А-Яа-яЁё]/;
const VISIBLE_JSX_ATTRIBUTES = /^(title|placeholder|aria-label|alt|label|description|helperText|tooltip|data-tooltip|heading|intro|hint|help|subtitle|caption|emptyText|text)$/;
const leakage = [];
const missingInline = [];
const SELF_NAMED_LANGUAGE_KEYS = new Set(["common.languageRussian"]);
const SHARED_LANGUAGE_LABELS = new Set([
  "common.appName",
  "nav.discord",
  "auth.inviteCodePlaceholder",
]);

function unwrap(node) {
  let current = node;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(node) {
  if (!node) return "";
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText();
}

function propertyInitializer(object, name) {
  const literal = unwrap(object);
  if (!literal || !ts.isObjectLiteralExpression(literal)) return undefined;
  for (const property of literal.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === name) {
      return unwrap(property.initializer);
    }
    if (ts.isShorthandPropertyAssignment(property) && propertyName(property.name) === name) {
      return property.name;
    }
  }
  return undefined;
}

function flattenStatic(node, prefix = "", out = new Map()) {
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    assert(prefix, "translation leaf must have a key");
    out.set(prefix, value.text);
    return out;
  }
  assert(
    ts.isObjectLiteralExpression(value),
    `translation value at ${prefix || "<root>"} must be a static object/string`,
  );
  for (const property of value.properties) {
    assert(
      ts.isPropertyAssignment(property),
      `translation object at ${prefix || "<root>"} must use plain properties`,
    );
    const name = propertyName(property.name);
    assert(name, `translation object at ${prefix || "<root>"} has an unnamed property`);
    flattenStatic(property.initializer, prefix ? `${prefix}.${name}` : name, out);
  }
  return out;
}

function placeholders(text) {
  return [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

function loadCatalogs() {
  const source = fs.readFileSync(translationPath, "utf8");
  const sf = ts.createSourceFile(translationPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let initializer;
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "translations") {
        initializer = unwrap(declaration.initializer);
      }
    }
  }
  assert(initializer && ts.isObjectLiteralExpression(initializer), "translations must be a static object literal");
  const enNode = propertyInitializer(initializer, "en");
  const ruNode = propertyInitializer(initializer, "ru");
  assert(enNode && ruNode && !propertyInitializer(initializer, "pl"), "translations must contain only en and ru catalogs");
  return {
    en: flattenStatic(enNode),
    ru: flattenStatic(ruNode),
  };
}

function loadInlineCopy() {
  const source = fs.readFileSync(inlineCopyPath, "utf8");
  const sf = ts.createSourceFile(inlineCopyPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = new Map();
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, unwrap(declaration.initializer));
    }
  }
  const copyNode = declarations.get("UI_COPY");
  const allowNode = declarations.get("INLINE_COPY_ALLOWLIST");
  assert(copyNode && ts.isObjectLiteralExpression(copyNode), "UI_COPY must be a static object");
  assert(allowNode && ts.isNewExpression(allowNode) && ts.isArrayLiteralExpression(allowNode.arguments[0]), "INLINE_COPY_ALLOWLIST must be a static Set");
  const copy = new Map();
  for (const property of copyNode.properties) {
    assert(ts.isPropertyAssignment(property), "inline Russian copy must use plain properties");
    const key = propertyName(property.name);
    const english = stringValue(propertyInitializer(property.initializer, "en"));
    const value = stringValue(propertyInitializer(property.initializer, "ru"));
    assert(english?.trim(), `UI key ${key} has no English translation`);
    assert.deepEqual(placeholders(value), placeholders(english), `UI placeholder mismatch: ${key}`);
    assert(key && value?.trim(), `inline Russian copy ${key || "<unnamed>"} must be a nonempty string`);
    assert(!CYRILLIC.test(key), `inline Russian copy key contains Cyrillic: ${key}`);
    assert(!copy.has(key), `duplicate inline Russian copy key: ${key}`);
    if (!declarations.get("INLINE_COPY_ALLOWLIST").arguments[0].elements.map(stringValue).includes(english)) assert.notEqual(value, english, `UI key ${key} is identical in both languages`);
    copy.set(key, value);
  }
  const allow = new Set(allowNode.arguments[0].elements.map(stringValue));
  return { copy, allow };
}

function compareCatalogs(en, ru) {
  const enKeys = [...en.keys()].sort();
  const ruKeys = [...ru.keys()].sort();
  assert.deepEqual(ruKeys, enKeys, "English and Russian catalogs must contain exactly the same keys");

  for (const key of enKeys) {
    const english = en.get(key);
    const russian = ru.get(key);
    assert(english?.trim(), `English translation ${key} is empty`);
    assert(russian?.trim(), `Russian translation ${key} is empty`);
    if (!SHARED_LANGUAGE_LABELS.has(key)) {
      assert.notEqual(russian, english, `Russian translation ${key} is identical to English`);
    }
    if (!SELF_NAMED_LANGUAGE_KEYS.has(key)) {
      assert(
        !CYRILLIC.test(english),
        `English translation ${key} contains Cyrillic: ${JSON.stringify(english)}`,
      );
    }
    assert.deepEqual(placeholders(russian), placeholders(english), `Russian placeholder mismatch for ${key}`);
  }
}

function walk(dir, output = [], extension = /\.(ts|tsx)$/) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, output, extension);
    else if (entry.isFile() && extension.test(entry.name)) output.push(full);
  }
  return output;
}

function isLocaleExpression(node) {
  const value = unwrap(node);
  return (
    (ts.isIdentifier(value) && value.text === "locale") ||
    (ts.isPropertyAccessExpression(value) && value.name.text === "locale")
  );
}

function stringValue(node) {
  const value = unwrap(node);
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : null;
}

// Returns whether the true branch is guaranteed to be Russian.
function russianBranch(condition) {
  const value = unwrap(condition);
  if (!ts.isBinaryExpression(value)) return null;
  const operator = value.operatorToken.kind;
  const equality =
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.EqualsEqualsToken;
  const inequality =
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsToken;
  if (!equality && !inequality) return null;

  let literal = null;
  if (isLocaleExpression(value.left)) literal = stringValue(value.right);
  else if (isLocaleExpression(value.right)) literal = stringValue(value.left);
  if (literal === "ru") return { ruWhenTrue: equality };
  if (literal === "en") return { ruWhenTrue: inequality };
  return null;
}

function contains(ancestor, node) {
  return node.pos >= ancestor.pos && node.end <= ancestor.end;
}

function isSelfNamedRussianLabel(node) {
  let current = node.parent;
  while (current) {
    if (ts.isPropertyAssignment(current) && propertyName(current.name) === "languageRussian") {
      return contains(current.initializer, node);
    }
    current = current.parent;
  }
  return false;
}

function isRussianScoped(node) {
  if (isSelfNamedRussianLabel(node)) return true;
  let current = node.parent;
  while (current) {
    if (
      ts.isPropertyAssignment(current) &&
      propertyName(current.name) === "ru" &&
      contains(current.initializer, node)
    ) {
      return true;
    }
    if (ts.isConditionalExpression(current)) {
      const branch = russianBranch(current.condition);
      if (branch) {
        if (contains(current.whenTrue, node)) return branch.ruWhenTrue;
        if (contains(current.whenFalse, node)) return !branch.ruWhenTrue;
      }
    }
    if (ts.isIfStatement(current)) {
      const branch = russianBranch(current.expression);
      if (branch) {
        if (contains(current.thenStatement, node)) return branch.ruWhenTrue;
        if (current.elseStatement && contains(current.elseStatement, node)) return !branch.ruWhenTrue;
      }
    }
    current = current.parent;
  }
  return false;
}

function isLocaleScoped(node) {
  if (isRussianScoped(node)) return true;
  let current = node.parent;
  while (current) {
    if (ts.isPropertyAssignment(current) && ["en", "ru"].includes(propertyName(current.name))) {
      const object = unwrap(current.parent);
      if (object && ts.isObjectLiteralExpression(object)) {
        const names = object.properties.filter(ts.isPropertyAssignment).map(property => propertyName(property.name));
        if (names.includes("en") && names.includes("ru")) return true;
      }
    }
    if (ts.isConditionalExpression(current)) {
      const branch = russianBranch(current.condition);
      if (branch && (contains(current.whenTrue, node) || contains(current.whenFalse, node))) return true;
    }
    current = current.parent;
  }
  return false;
}

function flattenObjectStrings(node, prefix = "", out = new Map()) {
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    if (prefix) out.set(prefix, value.text);
    return out;
  }
  if (!ts.isObjectLiteralExpression(value)) return out;
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    const key = prefix ? `${prefix}.${name}` : name;
    const initializer = unwrap(property.initializer);
    if (ts.isObjectLiteralExpression(initializer)) flattenObjectStrings(initializer, key, out);
    else out.set(key, "");
  }
  return out;
}

function auditLocalizedObject(node, file) {
  if (!ts.isObjectLiteralExpression(node)) return;
  const enNode = propertyInitializer(node, "en");
  const ruNode = propertyInitializer(node, "ru");
  const plNode = propertyInitializer(node, "pl");
  if (!enNode && !ruNode && !plNode) return;
  // Only treat an object as a locale dictionary if at least two locale
  // branches are present; ordinary objects can legitimately have an `en` key.
  if ([enNode, ruNode, plNode].filter(Boolean).length < 2) return;
  assert(enNode && ruNode && !plNode, `${path.relative(root, file)}: inline locale object must contain only en and ru`);
  if (
    !ts.isObjectLiteralExpression(enNode) ||
    !ts.isObjectLiteralExpression(ruNode)
  ) {
    return;
  }
  const en = flattenObjectStrings(enNode);
  const ru = flattenObjectStrings(ruNode);
  if (!en.size && !ru.size) return;
  const enKeys = [...en.keys()].sort();
  assert.deepEqual([...ru.keys()].sort(), enKeys, `${path.relative(root, file)}: inline EN/RU object keys differ`);
  for (const [key, text] of en) {
    if (!SELF_NAMED_LANGUAGE_KEYS.has(key)) {
      assert(!CYRILLIC.test(text), `${path.relative(root, file)}: English inline value ${key} contains Cyrillic`);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function translationKeyPattern(node) {
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return { exact: value.text, pattern: null };
  }
  if (!ts.isTemplateExpression(value)) return null;
  let source = `^${escapeRegExp(value.head.text)}`;
  for (const span of value.templateSpans) source += `.+${escapeRegExp(span.literal.text)}`;
  return { exact: null, pattern: new RegExp(`${source}$`) };
}

function visibleJsxContext(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isJsxAttribute(parent)) {
      return VISIBLE_JSX_ATTRIBUTES.test(parent.name.getText()) ||
        (ts.isPropertyAssignment(node.parent) && VISIBLE_JSX_ATTRIBUTES.test(propertyName(node.parent.name)));
    }
    if (
      ts.isCallExpression(parent) &&
      ts.isIdentifier(parent.expression) &&
      ["uiText", "uiCopy", "t", "localeText", "sessionText", "messageText", "characterDisplay", "localizedContentName", "localizedFeatureName", "helpText", "optionCopy", "localizeReason", "displayName", "suggest", "deviceList", "cueOptions"].includes(parent.expression.text)
    ) return false;
    if (ts.isTypeNode(parent)) return false;
    if (ts.isElementAccessExpression(parent) && contains(parent.argumentExpression, node)) return false;
    if (ts.isStringLiteral(node) && /^\{[A-Za-z0-9_]+\}$/.test(node.text)) return false;
    if (ts.isBinaryExpression(parent) && (contains(parent.left, node) || contains(parent.right, node))) {
      const op = parent.operatorToken.kind;
      if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(op)) return false;
    }
    if (ts.isConditionalExpression(parent) && contains(parent.condition, node)) return false;
    if (ts.isArrayLiteralExpression(parent)) {
      let arrayOwner = parent;
      while (
        arrayOwner.parent &&
        (ts.isAsExpression(arrayOwner.parent) || ts.isParenthesizedExpression(arrayOwner.parent))
      ) arrayOwner = arrayOwner.parent;
      const mapAccess = arrayOwner.parent;
      if (
        ts.isPropertyAccessExpression(mapAccess) &&
        mapAccess.name.text === "map" &&
        ts.isCallExpression(mapAccess.parent) &&
        mapAccess.parent.expression === mapAccess
      ) return false;
    }
    if (ts.isArrowFunction(parent)) {
      if (ts.isBlock(parent.body)) {
        let returned = false;
        function findReturn(child) {
          if (ts.isReturnStatement(child) && child.expression && contains(child.expression, node)) returned = true;
          else if (!returned) ts.forEachChild(child, findReturn);
        }
        findReturn(parent.body);
        if (!returned) return false;
      }
    }
    if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) return false;
    if (ts.isJsxExpression(parent)) {
      const host = parent.parent;
      if (ts.isJsxAttribute(host)) {
        return VISIBLE_JSX_ATTRIBUTES.test(host.name.getText());
      }
      if (ts.isJsxElement(host) || ts.isJsxSelfClosingElement(host)) return true;
    }
    current = parent;
  }
  return false;
}

function auditUiFile(file, englishCatalog, usedKeys, inlineCopy, inlineUsed) {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const usesI18n = source.includes("useI18n");

  assert(!source.includes("i18nText"), `${relative}: obsolete i18nText marker usage is forbidden`);

  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) auditLocalizedObject(node, file);

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "uiText") {
      const sourceText = node.arguments[0] ? stringValue(node.arguments[0]) : null;
      assert(sourceText, `${relative}: uiText() source must be a string literal`);
      const key = sourceText;
      if (!inlineCopy.copy.has(key) && !inlineCopy.allow.has(key)) {
        missingInline.push(`${relative}: missing Russian inline copy ${JSON.stringify(key)}`);
      }
      inlineUsed.add(key);
    }

    if (usesI18n && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
      const keySpec = node.arguments[0] ? translationKeyPattern(node.arguments[0]) : null;
      assert(
        keySpec,
        `${relative}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: t() keys must be string literals or bounded template literals`,
      );
      if (keySpec.exact !== null) {
        usedKeys.add(keySpec.exact);
        assert(englishCatalog.has(keySpec.exact), `${relative}: English catalog is missing t(${JSON.stringify(keySpec.exact)})`);
      } else {
        const matches = [...englishCatalog.keys()].filter((key) => keySpec.pattern.test(key));
        assert(
          matches.length > 0,
          `${relative}: no English catalog keys match dynamic t() pattern ${keySpec.pattern}`,
        );
        for (const key of matches) usedKeys.add(key);
      }
    }

    let text = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.getText(sf);
    else if (ts.isTemplateExpression(node)) text = node.getText(sf);

    if (relative !== "src/lib/i18n/inline-copy.ts" && text && CYRILLIC.test(text)) {
      if (!isRussianScoped(node)) leakage.push(`${relative}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${JSON.stringify(text.slice(0, 80))}`);
    }

    if (relative !== "src/lib/i18n/inline-copy.ts" && !isLocaleScoped(node)) {
      let visibleEnglish = null;
      if (ts.isJsxText(node)) visibleEnglish = node.getText(sf).replace(/\s+/g, " ").trim();
      else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && VISIBLE_JSX_ATTRIBUTES.test(node.name.text) && node.initializer) {
        const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        visibleEnglish = stringValue(value);
      } else if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxSelfClosingElement(node.parent))) {
        visibleEnglish = stringValue(node.expression);
      } else if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
        visibleJsxContext(node)
      ) {
        visibleEnglish = ts.isTemplateExpression(node)
          ? node.head.text + node.templateSpans.map((span) => span.literal.text).join("")
          : node.text;
      }
      const candidate = visibleEnglish?.replace(/\s+/g, " ").trim();
      if (candidate && /[A-Za-z]{3}/.test(candidate) && !CYRILLIC.test(candidate) && !inlineCopy.allow.has(candidate)) {
        leakage.push(`${relative}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: English UI text ${JSON.stringify(candidate.slice(0, 80))}`);
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);
}

const { en, ru } = loadCatalogs();
compareCatalogs(en, ru);
const inlineCopy = loadInlineCopy();

for (const stale of [
  "src/lib/i18n/MarkerBoundary.tsx",
  "src/lib/i18n/marker.ts",
  "src/lib/i18n/generated/en.json",
  "src/lib/i18n/generated/ru.json",
  "src/lib/i18n/generated/pl.json",
  "scripts/i18n-extract.mjs",
]) {
  assert(!fs.existsSync(path.join(root, stale)), `${stale} is obsolete and must not be restored`);
}

const stagedCatalogDir = path.join(root, "public", "i18n");
const stagedCatalogs = walk(stagedCatalogDir, [], /\.b64$/);
assert.equal(stagedCatalogs.length, 0, "unused public/i18n/*.b64 staging catalogs must not be committed");

const files = [...new Set(auditedRoots.flatMap((dir) => walk(dir)))].sort();
const usedKeys = new Set();
const inlineUsed = new Set();
for (const file of files) auditUiFile(file, en, usedKeys, inlineCopy, inlineUsed);
assert.deepEqual(missingInline, [], `Russian inline copy is missing:\n${missingInline.join("\n")}`);
assert.deepEqual(leakage, [], `Cyrillic text is reachable outside Russian locale branches:\n${leakage.join("\n")}`);

console.log(
  `i18n coverage passed: ${en.size} synchronized EN/RU catalog keys, ${usedKeys.size} referenced keys, ${files.length} audited source files; placeholders match and locale leakage is guarded.`,
);
