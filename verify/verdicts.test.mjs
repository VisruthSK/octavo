import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
    browser: "Browser A 140.0.0.1",
    scenarios: "d".repeat(64),
    version: "octavo 1.2.3",
    ...overrides,
  });

test("the key depends on the original, the optimized file, the level, the verifier and the browser", () => {
  const base = key();
  assert.equal(base, key());
  assert.notEqual(base, key({ original: "d".repeat(64) }));
  assert.notEqual(base, key({ optimized: "e".repeat(64) }));
  assert.notEqual(base, key({ level: "packed" }));
  assert.notEqual(base, key({ verifier: "f".repeat(64) }));
  assert.notEqual(base, key({ browser: "Browser A 141.0.0.1" }));
  assert.notEqual(base, key({ scenarios: "e".repeat(64) }));
  assert.notEqual(base, key({ version: "octavo 1.2.4" }));
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

test("the verifier hash follows engine sources and ignores tests", () => {
  const sources = mkdtempSync(join(tmpdir(), "verifier-"));
  mkdirSync(join(sources, "engines"));
  writeFileSync(join(sources, "package-lock.json"), "{}");
  writeFileSync(join(sources, "capture.mjs"), "one");
  writeFileSync(join(sources, "engines", "engine.mjs"), "one");
  const before = verifierHash(sources);
  writeFileSync(join(sources, "capture.test.mjs"), "changed");
  assert.equal(verifierHash(sources), before);
  writeFileSync(join(sources, "engines", "engine.mjs"), "two");
  assert.notEqual(verifierHash(sources), before);
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
