// Regression: requestCustomMessage must ALWAYS ask the backend for a stream.
// A non-streaming request to a slow local model dies on Node/undici's ~300s
// headersTimeout with a misleading "Could not reach the backend" (this broke
// story-arc generation against a 27B Ollama model that needs >5 minutes for
// the whole reply). With stream:true the headers land immediately and the
// per-chunk idle timeout governs. Also covers: SSE assembly without onDelta,
// streamed tool_calls assembly without onDelta, and the plain-JSON fallback
// for backends that ignore stream:true.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-model-client-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { requestCustomMessage } = await import("../src/lib/model-client.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// A mock OpenAI-compatible server: handler(reqBody) decides the response.
function withServer(handler, run) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          handler(JSON.parse(raw || "{}"), res);
        } catch (error) {
          res.writeHead(500).end(String(error));
        }
      });
    });
    server.listen(0, "127.0.0.1", async () => {
      const base = `http://127.0.0.1:${server.address().port}/v1`;
      try {
        await run(base);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

const sse = (res, chunks) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
};

const delta = (content) => ({ choices: [{ delta: { content } }] });

await test("always sends stream:true even without onDelta", () =>
  withServer(
    (body, res) => {
      assert.equal(body.stream, true, "request body must carry stream:true");
      sse(res, [delta("Стол.")]);
    },
    async (base) => {
      const result = await requestCustomMessage(base, "mock-model", "", [
        { role: "user", content: "стол или стул?" },
      ], { timeoutMs: 30_000 });
      assert.ok(!result.error, "no error expected");
      assert.equal(result.message?.content, "Стол.");
    },
  ));

await test("assembles streamed content without onDelta (arc path)", () =>
  withServer(
    (_body, res) => sse(res, [delta('{"premise":'), delta('"Сердце мёртвого бога"'), delta("}")]),
    async (base) => {
      const result = await requestCustomMessage(base, "mock-model", "", [
        { role: "user", content: "arc" },
      ], { timeoutMs: 30_000 });
      assert.equal(result.message?.content, '{"premise":"Сердце мёртвого бога"}');
    },
  ));

await test("assembles streamed tool_calls without onDelta", () =>
  withServer(
    (_body, res) =>
      sse(res, [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "probe_echo", arguments: '{"wo' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'rd":"куб","n":7}' } }] } },
          ],
        },
      ]),
    async (base) => {
      const result = await requestCustomMessage(base, "mock-model", "", [
        { role: "user", content: "вызови инструмент" },
      ], { timeoutMs: 30_000 });
      const call = result.message?.tool_calls?.[0];
      assert.equal(call?.function?.name, "probe_echo");
      assert.deepEqual(JSON.parse(call.function.arguments), { word: "куб", n: 7 });
    },
  ));

await test("falls back to plain JSON when the backend ignores stream:true", () =>
  withServer(
    (_body, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Обычный JSON-ответ." } }],
        }),
      );
    },
    async (base) => {
      const result = await requestCustomMessage(base, "mock-model", "", [
        { role: "user", content: "привет" },
      ], { timeoutMs: 30_000 });
      assert.equal(result.message?.content, "Обычный JSON-ответ.");
    },
  ));

await test("onDelta still receives deltas when provided", () =>
  withServer(
    (_body, res) => sse(res, [delta("Раз, "), delta("два.")]),
    async (base) => {
      const seen = [];
      const result = await requestCustomMessage(
        base,
        "mock-model",
        "",
        [{ role: "user", content: "считай" }],
        { timeoutMs: 30_000, onDelta: (text) => seen.push(text) },
      );
      assert.equal(result.message?.content, "Раз, два.");
      assert.deepEqual(seen, ["Раз, ", "два."]);
    },
  ));

removeTempDir(dir);
console.log(`test-model-client-stream: ${passed} passed`);
