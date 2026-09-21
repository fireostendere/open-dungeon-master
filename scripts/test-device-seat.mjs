import test from "node:test";
import assert from "node:assert/strict";
import {
  mintSeatSecret,
  normalizeSeatSecret,
  readSeatSecret,
  rememberSeatSecret,
} from "../src/lib/device-seat.ts";

test("seat secrets are portable credentials with a strict format", () => {
  const first = mintSeatSecret();
  const second = mintSeatSecret();
  assert.match(first, /^[0-9a-f]{48}$/);
  assert.match(second, /^[0-9a-f]{48}$/);
  assert.notEqual(first, second);
  assert.equal(normalizeSeatSecret(`  ${first.toUpperCase()}  `), first);
  assert.equal(normalizeSeatSecret("room-code-is-not-a-seat-secret"), "");
});

test("seat secret can be copied to another browser without changing the account", (t) => {
  const data = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
      },
    },
  });
  t.after(() => previous
    ? Object.defineProperty(globalThis, "window", previous)
    : delete globalThis.window);

  const secret = mintSeatSecret();
  assert.equal(rememberSeatSecret(" Alice ", secret), true);
  assert.equal(readSeatSecret("alice"), secret);
  assert.equal(readSeatSecret("ALICE"), secret);
});
