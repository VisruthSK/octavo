import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildCosts, costOf, DEFAULT_FALLBACK_COST, readCosts } from "./costs.mjs";

test("readCosts reads committed costs table", () => {
  const table = readCosts();
  assert.equal(typeof table, "object");
  assert.equal(typeof table["quarto-cli-crossrefs-all"], "object");
  assert.equal(table["quarto-cli-crossrefs-all"].chromium, 356);
  assert.equal(table["quarto-cli-crossrefs-all"].firefox, 1080);
  assert.equal(table["quarto-cli-crossrefs-all"].webkit, 1224);
  assert.equal(table["twenty-thousand-paragraphs"].chromium, 904);
  assert.equal(table["twenty-thousand-paragraphs"].firefox, 552);
  assert.equal(table["twenty-thousand-paragraphs"].webkit, 432);
});

test("costOf uses costs table and documented fallbacks", () => {
  const costs = { known: { chromium: 42, firefox: 52, webkit: 62 }, legacy: 99 };
  assert.equal(costOf("known", costs, "chromium"), 42);
  assert.equal(costOf("known", costs, "firefox"), 52);
  assert.equal(costOf("known", costs, "webkit"), 62);
  assert.equal(costOf({ id: "known" }, costs, "webkit"), 62);
  assert.equal(costOf("legacy", costs), 99);
  assert.equal(costOf("missing", costs), DEFAULT_FALLBACK_COST);
  assert.equal(costOf({ id: "missing", bytes: 4096 }, costs), 4);
  assert.equal(costOf({ id: "missing" }, costs), DEFAULT_FALLBACK_COST);
});

test("buildCosts aggregates progress log seconds per engine and fills missing with median", () => {
  const tmpDir = join(import.meta.dirname, ".tmp-test-costs");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const sampleLog = [
    "Chromium checks (smoke, shard 1)\t[1/2] doc-a safe 10s",
    "Chromium checks (smoke, shard 1)\t[2/2] doc-a packed 15s",
    "Chromium checks (smoke, shard 1)\t[1/1] doc-b safe 25s",
    "Firefox checks (smoke, shard 1)\t[1/2] doc-a safe 20s",
    "Firefox checks (smoke, shard 1)\t[2/2] doc-a packed 30s",
    "Firefox checks (smoke, shard 1)\t[1/1] doc-b safe 12s (cached)",
    "WebKit checks (smoke, shard 1)\t[1/2] doc-a safe 5s",
    "WebKit checks (smoke, shard 1)\t[2/2] doc-a packed 5s",
    "WebKit checks (smoke, shard 1)\t[1/1] doc-b safe 40s",
  ].join("\n");
  writeFileSync(join(tmpDir, "sample.log"), sampleLog);

  const table = buildCosts(tmpDir);
  assert.deepStrictEqual(table["doc-a"], { chromium: 25, firefox: 50, webkit: 10 });
  assert.deepStrictEqual(table["doc-b"], { chromium: 25, firefox: 50, webkit: 40 });
  rmSync(tmpDir, { recursive: true, force: true });
});
