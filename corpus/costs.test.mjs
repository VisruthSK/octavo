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
  assert.equal(table["two-thousand-paragraphs"].chromium, 90);
  assert.equal(table["two-thousand-paragraphs"].firefox, 55);
  assert.equal(table["two-thousand-paragraphs"].webkit, 43);
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
    "Chromium checks (subset, shard 1)\t[1/2] doc-a serve 10s",
    "Chromium checks (subset, shard 1)\t[2/2] doc-a archive 15s",
    "Chromium checks (subset, shard 1)\t[1/1] doc-b serve 25s",
    "Firefox checks (subset, shard 1)\t[1/2] doc-a serve 20s",
    "Firefox checks (subset, shard 1)\t[2/2] doc-a archive 30s",
    "Firefox checks (subset, shard 1)\t[1/1] doc-b serve 12s (cached)",
    "WebKit checks (subset, shard 1)\t[1/2] doc-a serve 5s",
    "WebKit checks (subset, shard 1)\t[2/2] doc-a archive 5s",
    "WebKit checks (subset, shard 1)\t[1/1] doc-b serve 40s",
  ].join("\n");
  writeFileSync(join(tmpDir, "sample.log"), sampleLog);

  const table = buildCosts(tmpDir);
  assert.deepStrictEqual(table["doc-a"], { chromium: 25, firefox: 50, webkit: 10 });
  assert.deepStrictEqual(table["doc-b"], { chromium: 25, firefox: 50, webkit: 40 });
  rmSync(tmpDir, { recursive: true, force: true });
});
