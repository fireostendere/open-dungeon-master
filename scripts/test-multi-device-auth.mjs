import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReviewModule } from "./lib/review-module.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const authFile = path.join(root, "src/lib/auth.ts");

function digest(token) {
  return createHash("sha256").update(token).digest("hex");
}

function harness() {
  const sessions = new Map();
  let cookieToken = "";
  const cookieStore = {
    get(name) {
      return name === "odm_session" && cookieToken ? { value: cookieToken } : undefined;
    },
    set(name, value) {
      if (name === "odm_session") cookieToken = value;
    },
    delete(name) {
      if (name === "odm_session") cookieToken = "";
    },
  };
  const auth = loadReviewModule(authFile, {
    "next/headers": {
      cookies: async () => cookieStore,
      headers: async () => new Headers(),
    },
    "@/lib/db/users": {
      deleteSession: (tokenHash) => sessions.delete(tokenHash),
      getSessionUser: () => null,
      insertSession: (tokenHash, userId, expiresAt) => sessions.set(tokenHash, { userId, expiresAt }),
    },
    "@/lib/server-env": {
      serverEnv: () => "",
    },
  });
  return {
    auth,
    sessions,
    setCookieToken(value) {
      cookieToken = value;
    },
  };
}

test("one account may hold arbitrarily many independent sessions", async () => {
  const h = harness();
  const first = h.auth.mintSession("user-1");
  const second = h.auth.mintSession("user-1");
  const third = h.auth.mintSession("user-1");

  assert.equal(h.sessions.size, 3);
  assert.notEqual(first.token, second.token);
  assert.notEqual(second.token, third.token);
  assert.deepEqual(
    new Set([...h.sessions.values()].map((session) => session.userId)),
    new Set(["user-1"]),
  );

  h.setCookieToken(second.token);
  await h.auth.endSession();

  assert.equal(h.sessions.size, 2);
  assert.equal(h.sessions.has(digest(first.token)), true);
  assert.equal(h.sessions.has(digest(second.token)), false);
  assert.equal(h.sessions.has(digest(third.token)), true);
});

test("logging out one browser does not revoke another browser", async () => {
  const h = harness();
  const phone = h.auth.mintSession("user-1");
  const desktop = h.auth.mintSession("user-1");

  h.setCookieToken(phone.token);
  await h.auth.endSession();

  assert.equal(h.sessions.has(digest(phone.token)), false);
  assert.equal(h.sessions.has(digest(desktop.token)), true);
});
