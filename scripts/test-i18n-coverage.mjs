import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const translationPath = path.join(root, "src", "lib", "i18n", "translations.ts");
const auditedRoots = [
  path.join(root, "src", "app"),
  path.join(root, "src", "components"),
  path.join(root, "src", "lib", "i18n"),
];
const CYRILLIC = /[А-Яа-яЁё]/;
const SELF_NAMED_LANGUAGE_KEYS = new Set(["common.languageRussian"]);

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
  const plNode = propertyInitializer(initializer, "pl");
  assert(enNode && ruNode && plNode, "translations must contain en, ru and pl catalogs");
  return {
    en: flattenStatic(enNode),
    ru: flattenStatic(ruNode),
    pl: flattenStatic(plNode),
  };
}

function compareCatalogs(en, ru, pl) {
  const enKeys = [...en.keys()].sort();
  const ruKeys = [...ru.keys()].sort();
  const plKeys = [...pl.keys()].sort();
  assert.deepEqual(ruKeys, enKeys, "English and Russian catalogs must contain exactly the same keys");
  assert.deepEqual(plKeys, enKeys, "English and Polish catalogs must contain exactly the same keys");

  for (const key of enKeys) {
    const english = en.get(key);
    const russian = ru.get(key);
    const polish = pl.get(key);
    assert(english?.trim(), `English translation ${key} is empty`);
    assert(russian?.trim(), `Russian translation ${key} is empty`);
    assert(polish?.trim(), `Polish translation ${key} is empty`);
    if (!SELF_NAMED_LANGUAGE_KEYS.has(key)) {
      assert(
        !CYRILLIC.test(english),
        `English translation ${key} contains Cyrillic: ${JSON.stringify(english)}`,
      );
      assert(
        !CYRILLIC.test(polish),
        `Polish translation ${key} contains Cyrillic outside a self-named language label: ${JSON.stringify(polish)}`,
      );
    }
    assert.deepEqual(placeholders(russian), placeholders(english), `Russian placeholder mismatch for ${key}`);
    assert.deepEqual(placeholders(polish), placeholders(english), `Polish placeholder mismatch for ${key}`);
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

// Returns whether the true branch is guaranteed to be Russian. With three
// locales, `locale !== "en"` is no longer enough: it also includes Polish.
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
  if (literal !== "ru") return null;
  return { ruWhenTrue: equality };
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
  assert(enNode && ruNode && plNode, `${path.relative(root, file)}: inline locale object must contain en, ru and pl`);
  if (
    !ts.isObjectLiteralExpression(enNode) ||
    !ts.isObjectLiteralExpression(ruNode) ||
    !ts.isObjectLiteralExpression(plNode)
  ) {
    return;
  }
  const en = flattenObjectStrings(enNode);
  const ru = flattenObjectStrings(ruNode);
  const pl = flattenObjectStrings(plNode);
  if (!en.size && !ru.size && !pl.size) return;
  const enKeys = [...en.keys()].sort();
  assert.deepEqual([...ru.keys()].sort(), enKeys, `${path.relative(root, file)}: inline EN/RU object keys differ`);
  assert.deepEqual([...pl.keys()].sort(), enKeys, `${path.relative(root, file)}: inline EN/PL object keys differ`);
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

function auditUiFile(file, englishCatalog, usedKeys) {
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

    if (text && CYRILLIC.test(text)) {
      assert(
        isRussianScoped(node),
        `${relative}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: Cyrillic text is reachable outside an explicit Russian locale branch: ${JSON.stringify(text.slice(0, 120))}`,
      );
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);
}

const { en, ru, pl } = loadCatalogs();
compareCatalogs(en, ru, pl);

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
for (const file of files) auditUiFile(file, en, usedKeys);

console.log(
  `i18n coverage passed: ${en.size} synchronized EN/RU/PL catalog keys, ${usedKeys.size} referenced keys, ${files.length} audited source files; placeholders match and locale leakage is guarded.`,
);
