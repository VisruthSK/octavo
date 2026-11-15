import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildCosts, costOf, DEFAULT_FALLBACK_COST, readCosts } from "./costs.mjs";

test("readCosts reads committed costs table", () => {
  const table = readCosts();
  assert.equal(typeof table, "object");
  assert.equal(table["quarto-cli-smoke-all-lightbox-8697"], 714);
  assert.equal(table["quarto-cli-smoke-all-2023-12-04-annotate-decorated"], 1004);
  assert.equal(table["quarto-cli-playwright-html-axe-standard-best-practice"], 870);
  assert.equal(table["quarto-cli-crossrefs-all"], 1452);
  assert.equal(table["twenty-thousand-paragraphs"], 1090);
});

test("costOf uses costs table and documented fallbacks", () => {
  const costs = { known: 42 };
  assert.equal(costOf("known", costs), 42);
  assert.equal(costOf({ id: "known" }, costs), 42);
  assert.equal(costOf("missing", costs), DEFAULT_FALLBACK_COST);
  assert.equal(costOf({ id: "missing", bytes: 4096 }, costs), 4);
  assert.equal(costOf({ id: "missing" }, costs), DEFAULT_FALLBACK_COST);
});

test("buildCosts aggregates progress log seconds across engines and takes max", () => {
  const tmpDir = join(import.meta.dirname, ".tmp-test-costs");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const sampleLog = [
    "Corpus (smoke, shard 1)\t[1/2] doc-a safe 10s",
    "Corpus (smoke, shard 1)\t[2/2] doc-a packed 15s",
    "Corpus (smoke, shard 1)\t[1/1] doc-b safe 25s",
    "firefox (smoke, shard 1)\t[1/2] doc-a safe 20s",
    "firefox (smoke, shard 1)\t[2/2] doc-a packed 30s",
    "firefox (smoke, shard 1)\t[1/1] doc-b safe 12s (cached)",
    "webkit (smoke, shard 1)\t[1/2] doc-a safe 5s",
    "webkit (smoke, shard 1)\t[2/2] doc-a packed 5s",
    "webkit (smoke, shard 1)\t[1/1] doc-b safe 40s",
  ].join("\n");
  writeFileSync(join(tmpDir, "sample.log"), sampleLog);

  const table = buildCosts(tmpDir);
  assert.equal(table["doc-a"], 50);
  assert.equal(table["doc-b"], 40);
  rmSync(tmpDir, { recursive: true, force: true });
});
