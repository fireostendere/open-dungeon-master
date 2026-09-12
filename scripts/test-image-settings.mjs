// Per-campaign cloud image settings + profile apply: normalization,
// masking/scrubbing contract, OpenAI-image config precedence
// (campaign override > global config > env > default), the producer gate,
// and applyLlmProfileToCampaign returning the FRESH settings.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-image-settings-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { normalizeSettings, maskStorySettings, scrubStorySettings } = await import(
  "../src/lib/db/settings.ts"
);
const { resolveOpenAiImageConfig, openAiImagesConfigured } = await import(
  "../src/lib/openai-images.ts"
);
const { imageProducerReady } = await import("../src/lib/image-generate.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createLlmProfile, applyLlmProfileToCampaign, deleteLlmProfile } = await import(
  "../src/lib/db/llm-profiles.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

test("normalizeSettings carries the cloud image fields with caps", () => {
  const s = normalizeSettings({
    imageModel: " gpt-image-1 ",
    imageBaseUrl: " https://proxy.example.com/v1/ ",
    imageApiKey: " sk-secret ",
  });
  assert.equal(s.imageModel, "gpt-image-1");
  assert.equal(s.imageBaseUrl, "https://proxy.example.com/v1/");
  assert.equal(s.imageApiKey, "sk-secret");
  const empty = normalizeSettings({});
  assert.equal(empty.imageModel, "");
  assert.equal(empty.imageBaseUrl, "");
  assert.equal(empty.imageApiKey, "");
});

test("mask exposes hasImageApiKey and never the key; scrub blanks it", () => {
  const s = normalizeSettings({ imageApiKey: "sk-secret" });
  const masked = maskStorySettings(s);
  assert.equal(masked.hasImageApiKey, true);
  assert.equal(masked.imageApiKey, undefined);
  assert.ok(!JSON.stringify(masked).includes("sk-secret"));
  const scrubbed = scrubStorySettings(s);
  assert.equal(scrubbed.imageApiKey, "");
});

test("resolveOpenAiImageConfig: override > global > env > default", () => {
  // env layer
  process.env.OPENAI_IMAGE_API_KEY = "env-key";
  process.env.OPENAI_IMAGE_MODEL = "env-model";
  process.env.OPENAI_IMAGE_BASE_URL = "https://env.example.com/v1";
  let cfg = resolveOpenAiImageConfig();
  assert.equal(cfg.apiKey, "env-key");
  assert.equal(cfg.model, "env-model");
  assert.equal(cfg.baseUrl, "https://env.example.com/v1");

  // global config layer beats env
  saveGlobalConfig({
    images: { openaiApiKey: "global-key", openaiModel: "global-model", openaiBaseUrl: "" },
  });
  cfg = resolveOpenAiImageConfig();
  assert.equal(cfg.apiKey, "global-key");
  assert.equal(cfg.model, "global-model");
  assert.equal(cfg.baseUrl, "https://env.example.com/v1", "empty global falls to env");

  // campaign override beats everything; empty override falls through
  cfg = resolveOpenAiImageConfig({ apiKey: "campaign-key", model: "", baseUrl: "  " });
  assert.equal(cfg.apiKey, "campaign-key");
  assert.equal(cfg.model, "global-model");
  assert.equal(cfg.baseUrl, "https://env.example.com/v1");

  // trailing slashes are trimmed from the base
  cfg = resolveOpenAiImageConfig({ baseUrl: "https://x.example.com/v1//" });
  assert.equal(cfg.baseUrl, "https://x.example.com/v1");

  delete process.env.OPENAI_IMAGE_API_KEY;
  delete process.env.OPENAI_IMAGE_MODEL;
  delete process.env.OPENAI_IMAGE_BASE_URL;
  saveGlobalConfig({ images: { openaiApiKey: "", openaiModel: "", openaiBaseUrl: "" } });
  cfg = resolveOpenAiImageConfig();
  assert.equal(cfg.baseUrl, "https://api.openai.com/v1");
  assert.equal(cfg.model, "gpt-image-1");
  assert.equal(cfg.apiKey, "");
  assert.equal(openAiImagesConfigured(), false);
});

test("imageProducerReady counts a campaign-scoped key", () => {
  assert.equal(imageProducerReady("comfyui"), true);
  assert.equal(imageProducerReady("openai"), false, "no key anywhere");
  assert.equal(imageProducerReady("openai", { imageApiKey: "campaign-key" }), true);
  assert.equal(imageProducerReady("openai", { imageApiKey: "  " }), false);
  assert.equal(imageProducerReady("mflux-hs"), false);
});

test("applyLlmProfileToCampaign returns the FRESH merged settings", () => {
  const user = createUser("image-owner", randomBytes(9).toString("hex"));
  const campaign = createCampaign(user.id, {
    title: "Image settings check",
    description: "",
    theme: "",
    maxPlayers: 4,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: {},
  });
  const profile = createLlmProfile({
    name: "Cloud Qwen",
    kind: "cloud-preset",
    preset: "dashscope",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    authMode: "api-key",
    apiKey: "sk-cloud",
  });
  const fresh = applyLlmProfileToCampaign(profile.id, campaign.id);
  assert.ok(fresh && typeof fresh === "object", "must return settings, not a boolean");
  assert.equal(fresh.customBaseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  assert.equal(fresh.customModel, "qwen-plus");
  assert.equal(fresh.customApiKey, "sk-cloud");
  assert.equal(fresh.textProvider, "custom");
  assert.equal(applyLlmProfileToCampaign("no-such-profile", campaign.id), null);
  deleteLlmProfile(profile.id);
});

removeTempDir(dir);
console.log(`test-image-settings: ${passed} passed`);
