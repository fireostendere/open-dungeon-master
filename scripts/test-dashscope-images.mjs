// DashScope Qwen-Image adapter: config precedence (campaign > env > default),
// the two-step async task flow (create → poll → download) against a local
// mock of the native API, size mapping, and honest failure on FAILED tasks.
// The adapter writes into public/generated under process.cwd(), so the test
// chdirs into a throwaway dir first.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-dashscope-"));
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

// register-alias maps "@/lib/*" into the repo; serverEnv reads process.env.
process.env.DASHSCOPE_IMAGE_API_KEY = "";
const { resolveDashScopeImageConfig, dashScopeImagesConfigured, generateDashScopeImage } =
  await import("../src/lib/dashscope-images.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

await test("config precedence: override > env > default", () => {
  let cfg = resolveDashScopeImageConfig();
  assert.equal(cfg.baseUrl, "https://dashscope.aliyuncs.com");
  assert.equal(cfg.model, "qwen-image-plus");
  assert.equal(cfg.apiKey, "");
  assert.equal(dashScopeImagesConfigured(), false);

  process.env.DASHSCOPE_IMAGE_API_KEY = "env-key";
  process.env.DASHSCOPE_IMAGE_MODEL = "qwen-image";
  process.env.DASHSCOPE_IMAGE_BASE_URL = "https://dashscope-intl.aliyuncs.com/api/v1";
  cfg = resolveDashScopeImageConfig();
  assert.equal(cfg.apiKey, "env-key");
  assert.equal(cfg.model, "qwen-image");
  assert.equal(cfg.baseUrl, "https://dashscope-intl.aliyuncs.com", "/api/v1 suffix is normalized");
  assert.equal(dashScopeImagesConfigured(), true);

  cfg = resolveDashScopeImageConfig({
    apiKey: "campaign-key",
    model: "qwen-image-max",
    baseUrl: "https://example.com/",
  });
  assert.equal(cfg.apiKey, "campaign-key");
  assert.equal(cfg.model, "qwen-image-max");
  assert.equal(cfg.baseUrl, "https://example.com");

  delete process.env.DASHSCOPE_IMAGE_API_KEY;
  delete process.env.DASHSCOPE_IMAGE_MODEL;
  delete process.env.DASHSCOPE_IMAGE_BASE_URL;
});

// A 1x1 PNG so the download step stores real bytes.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function startMock(behavior) {
  return new Promise((resolve) => {
    let polls = 0;
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const json = (obj) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(obj));
        };
        if (req.url.endsWith("/services/aigc/text2image/image-synthesis")) {
          const body = JSON.parse(raw);
          assert.equal(req.headers["x-dashscope-async"], "enable", "async header required");
          assert.equal(req.headers.authorization, "Bearer campaign-key");
          behavior.onCreate?.(body);
          if (behavior.createError) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ code: "InvalidParameter", message: behavior.createError }));
            return;
          }
          return json({ output: { task_id: "task-1", task_status: "PENDING" }, request_id: "r1" });
        }
        if (req.url.includes("/tasks/")) {
          polls += 1;
          if (behavior.failTask) {
            return json({
              output: { task_id: "task-1", task_status: "FAILED", message: behavior.failTask },
            });
          }
          if (polls < (behavior.succeedAfterPolls ?? 1)) {
            return json({ output: { task_id: "task-1", task_status: "RUNNING" } });
          }
          return json({
            output: {
              task_id: "task-1",
              task_status: "SUCCEEDED",
              results: [{ url: `http://127.0.0.1:${server.address().port}/img.png` }],
            },
          });
        }
        if (req.url === "/img.png") {
          res.writeHead(200, { "Content-Type": "image/png" });
          return res.end(PNG_1PX);
        }
        res.writeHead(404).end();
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const baseOpts = { prompt: "a red dragon token, top-down", mode: "fast", aspect: "square" };
const overridesFor = (port) => ({
  baseUrl: `http://127.0.0.1:${port}`,
  model: "qwen-image-plus",
  apiKey: "campaign-key",
});

await test("full task flow stores a real PNG and maps the square size", async () => {
  let createdBody = null;
  const { server, port } = await startMock({ onCreate: (b) => (createdBody = b) });
  try {
    const image = await generateDashScopeImage(baseOpts, overridesFor(port));
    assert.equal(createdBody.model, "qwen-image-plus");
    assert.equal(createdBody.parameters.size, "1328*1328");
    assert.equal(createdBody.parameters.n, 1);
    assert.equal(createdBody.parameters.prompt_extend, false, "fast mode keeps the prompt");
    assert.equal(image.backend, "dashscope");
    assert.equal(image.width, 1328);
    const file = path.join(dir, "public", "generated", path.basename(image.url));
    assert.ok(fs.existsSync(file), "image file written under public/generated");
    assert.ok(fs.statSync(file).size > 0);
  } finally {
    server.close();
  }
});

await test("portrait/landscape map to the documented resolutions; slow = prompt_extend", async () => {
  let createdBody = null;
  const { server, port } = await startMock({
    onCreate: (b) => (createdBody = b),
    succeedAfterPolls: 2,
  });
  try {
    const p = await generateDashScopeImage({ ...baseOpts, aspect: "portrait" }, overridesFor(port));
    assert.equal(createdBody.parameters.size, "1104*1472");
    assert.equal(p.height, 1472);
    const l = await generateDashScopeImage({ ...baseOpts, aspect: "landscape", mode: "slow" }, overridesFor(port));
    assert.equal(createdBody.parameters.size, "1472*1104");
    assert.equal(createdBody.parameters.prompt_extend, true, "slow mode lets DashScope expand the prompt");
    assert.equal(l.width, 1472);
  } finally {
    server.close();
  }
});

await test("a FAILED task surfaces the API message", async () => {
  const { server, port } = await startMock({ failTask: "data inspection failed" });
  try {
    await assert.rejects(
      () => generateDashScopeImage(baseOpts, overridesFor(port)),
      /task failed: data inspection failed/,
    );
  } finally {
    server.close();
  }
});

await test("task creation error surfaces the API message", async () => {
  const { server, port } = await startMock({ createError: "model not exist" });
  try {
    await assert.rejects(
      () => generateDashScopeImage(baseOpts, overridesFor(port)),
      /task creation failed: model not exist/,
    );
  } finally {
    server.close();
  }
});

await test("missing key is refused before any request", async () => {
  await assert.rejects(
    () => generateDashScopeImage(baseOpts, { baseUrl: "http://127.0.0.1:1", model: "m" }),
    /no API key/,
  );
});

removeTempDir(dir);
console.log(`test-dashscope-images: ${passed} passed`);
