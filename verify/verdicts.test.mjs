import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVerdict, revalidateVerdict, shouldRevalidate, verdictKey, verifierHash, writeVerdict } from "./verdicts.mjs";

const folder = mkdtempSync(join(tmpdir(), "octavo-verdicts-"));

const key = (overrides = {}) =>
  verdictKey({
    original: "a".repeat(64),
    optimized: "b".repeat(64),
    level: "safe",
    verifier: "c".repeat(64),
    browser: "chromium 140.0.0.1",
    ...overrides,
  });

test("the key depends on the original, the optimized file, the level, the verifier and the browser", () => {
  const base = key();
  assert.equal(base, key());
  assert.notEqual(base, key({ original: "d".repeat(64) }));
  assert.notEqual(base, key({ optimized: "e".repeat(64) }));
  assert.notEqual(base, key({ level: "packed" }));
  assert.notEqual(base, key({ verifier: "f".repeat(64) }));
  assert.notEqual(base, key({ browser: "chromium 141.0.0.1" }));
});

test("a verdict is stored and read back", () => {
  const name = key();
  assert.equal(readVerdict(name, folder), null);
  writeVerdict(name, { level: "safe" }, folder);
  const verdict = readVerdict(name, folder);
  assert.equal(verdict.key, name);
  assert.equal(verdict.level, "safe");
  assert.equal(readVerdict(key({ level: "packed" }), folder), null);
});

test("the verifier hash covers the verifier sources", () => {
  const hash = verifierHash();
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, verifierHash());
});

test("revalidation selection is deterministic from the key", () => {
  const selected = Array.from({ length: 100 }, (_, at) => `${at.toString(16).padStart(8, "0")}${"a".repeat(56)}`).filter((name) => shouldRevalidate(name, 5));
  assert.equal(selected.length, 5);
  assert.deepEqual(selected, selected.slice());
  assert.equal(shouldRevalidate("00000000", 0), false);
});

test("a cached verdict mismatch deletes the stale entry and fails", async () => {
  const name = key();
  writeVerdict(name, { level: "safe" }, folder);
  await assert.rejects(revalidateVerdict(name, true, async () => false, folder), /disagrees/);
  assert.equal(readVerdict(name, folder), null);
});
