import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(root, ".opencode", "skills");
const catalog = path.join(root, "docs", "agent-skills.md");
const expected = new Set([
  "odm-dm-policy", "odm-development", "odm-server", "odm-backup", "odm-mcp", "odm-narrator", "odm-content", "odm-assets",
  "dnd-session-zero", "dnd-campaign", "dnd-characters", "dnd-npcs-factions", "dnd-encounters", "dnd-locations", "dnd-session", "yolo-dm", "dnd-rules", "dnd-loot-homebrew", "dnd-doppelganger",
]);
const files = readdirSync(skillsRoot).map((id) => path.join(skillsRoot, id, "SKILL.md"));
assert.deepEqual(new Set(files.map((file) => path.basename(path.dirname(file)))), expected, "skill directories must match the catalog");
const catalogText = readFileSync(catalog, "utf8");
const link = /\[[^\]]+\]\(([^)]+)\)/g;
const catalogLinks = new Set([...catalogText.matchAll(link)].map((match) => match[1].split("#", 1)[0]));
for (const id of expected) assert(catalogLinks.has(`../.opencode/skills/${id}/SKILL.md`), `catalog must link ${id}`);
const names = new Set();
const markdownFiles = [...files, catalog, path.join(root, "AGENTS.md"), path.join(root, "docs", "README.md")];
for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const match = text.match(/^---\nname: ([a-z0-9-]+)\ndescription: "([^"\n]+)"\n---\n/);
  assert(match, `${file}: require name and quoted nonempty description frontmatter`);
  assert.equal(match[1], path.basename(path.dirname(file)), `${file}: name must match its directory`);
  assert(expected.has(match[1]) && !names.has(match[1]), `${file}: unique expected skill name`);
  names.add(match[1]);
  assert(text.includes("agent-skills.md#"), `${file}: link shared contract`);
}
assert.equal(names.size, expected.size, "all skills have frontmatter");
for (const file of markdownFiles) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(link)) {
    const href = match[1].trim();
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith("#")) continue;
    const target = decodeURIComponent(href.split("#", 1)[0]);
    assert(existsSync(path.resolve(path.dirname(file), target)), `${file}: broken local link ${href}`);
  }
}
const narrator = readFileSync(path.join(skillsRoot, "odm-narrator", "SKILL.md"), "utf8");
const narratorContract = narrator.replace(/\s+/g, " ").toLowerCase();
for (const phrase of ["start_encounter", "инициатив", "свежей генерации", "group_check"]) assert(narratorContract.includes(phrase), `narrator contract must mention ${phrase}`);
const policySkill = readFileSync(path.join(skillsRoot, "odm-dm-policy", "SKILL.md"), "utf8");
assert(policySkill.includes("fun/freeform/cinematic-success"), "policy skill must prohibit implicit fun mode");
console.log(`agent skills: ${names.size} skills and local Markdown links verified`);
