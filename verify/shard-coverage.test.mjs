import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readCosts } from "../corpus/costs.mjs";
import { checkShardCoverage, expectedShardDocuments } from "./shard-coverage.mjs";

test("expectedShardDocuments balances handwritten and upstream docs for given shard", () => {
  const manifest = [
    { id: "alpha-1", tier: "smoke", browser: true },
    { id: "alpha-2", tier: "smoke", browser: true },
    { id: "alpha-3", tier: "smoke", browser: false },
    { id: "alpha-4", tier: "full", browser: true },
  ];
  const selection = [
    { id: "upstream-1", tier: "smoke" },
    { id: "upstream-2", tier: "smoke" },
  ];
  const costs = { "alpha-1": 100, "alpha-2": 50, "alpha-3": 10, "upstream-1": 80, "upstream-2": 40 };

  const shard1 = expectedShardDocuments({ manifest, selection, tier: "smoke", shard: { index: 0, count: 2 }, costs });
  const shard2 = expectedShardDocuments({ manifest, selection, tier: "smoke", shard: { index: 1, count: 2 }, costs });

  assert.equal(shard1.length + shard2.length, 5);
  const ids1 = new Set(shard1.map((d) => d.id));
  const ids2 = new Set(shard2.map((d) => d.id));
  for (const id of ids1) {
    assert.ok(!ids2.has(id), `Duplicate across shards: ${id}`);
  }
});

test("checkShardCoverage passes when all assigned documents are verified", () => {
  const expected = [
    { id: "doc-1", browser: true },
    { id: "doc-2", browser: false },
  ];
  const results = [
    { id: "doc-1", level: "safe", browser: true },
    { id: "doc-1", level: "packed", browser: true },
    { id: "doc-2", level: "safe", browser: false },
    { id: "doc-2", level: "packed", browser: false },
  ];
  const coverage = checkShardCoverage({
    expected,
    results,
    shard: { position: 1, count: 2 },
    browser: true,
  });

  assert.equal(coverage.ok, true);
  assert.equal(coverage.verifiedCount, 2);
  assert.equal(coverage.expectedCount, 2);
  assert.equal(coverage.message, "Shard 1/2: 2 of 2 assigned documents verified");
  assert.deepEqual(coverage.problems, []);
});

test("checkShardCoverage fails when an assigned document is missing", () => {
  const expected = [
    { id: "doc-1", browser: true },
    { id: "doc-2", browser: true },
  ];
  const results = [
    { id: "doc-1", level: "safe", browser: true },
  ];
  const coverage = checkShardCoverage({
    expected,
    results,
    shard: { position: 2, count: 4 },
    browser: true,
  });

  assert.equal(coverage.ok, false);
  assert.equal(coverage.verifiedCount, 1);
  assert.equal(coverage.expectedCount, 2);
  assert.equal(coverage.message, "Shard 2/4: 1 of 2 assigned documents verified");
  assert.deepEqual(coverage.missing, ["doc-2"]);
  assert.ok(coverage.problems.some((p) => p.includes("missing 1 assigned documents: doc-2")));
});

test("checkShardCoverage fails when an unassigned document is present", () => {
  const expected = [
    { id: "doc-1", browser: true },
  ];
  const results = [
    { id: "doc-1", level: "safe", browser: true },
    { id: "doc-extra", level: "safe", browser: true },
  ];
  const coverage = checkShardCoverage({
    expected,
    results,
    shard: { position: 1, count: 1 },
    browser: true,
  });

  assert.equal(coverage.ok, false);
  assert.deepEqual(coverage.extra, ["doc-extra"]);
  assert.ok(coverage.problems.some((p) => p.includes("extra 1 unassigned documents: doc-extra")));
});

test("checkShardCoverage fails when browser comparison is missing with browser flag", () => {
  const expected = [
    { id: "doc-browser", browser: true },
  ];
  const results = [
    { id: "doc-browser", level: "safe", browser: false },
  ];
  const coverage = checkShardCoverage({
    expected,
    results,
    shard: { position: 3, count: 4 },
    browser: true,
  });

  assert.equal(coverage.ok, false);
  assert.deepEqual(coverage.missingBrowser, ["doc-browser"]);
  assert.ok(coverage.problems.some((p) => p.includes("missing browser comparison for 1 assigned documents: doc-browser")));
});

test("checkShardCoverage ignores missing browser comparison when browser is disabled", () => {
  const expected = [
    { id: "doc-browser", browser: true },
  ];
  const results = [
    { id: "doc-browser", level: "safe", browser: false },
  ];
  const coverage = checkShardCoverage({
    expected,
    results,
    shard: { position: 1, count: 2 },
    browser: false,
  });

  assert.equal(coverage.ok, true);
  assert.equal(coverage.verifiedCount, 1);
  assert.equal(coverage.message, "Shard 1/2: 1 of 1 assigned documents verified");
});

test("real smoke tier covers all 73 documents partitioned across 4 shards", () => {
  const root = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(join(root, "corpus", "manifest.json"), "utf8"));
  const selectionPath = join(root, "corpus", "selection.json");
  const selection = existsSync(selectionPath) ? JSON.parse(readFileSync(selectionPath, "utf8")) : [];
  const costs = readCosts();

  const allAssigned = [];
  for (let i = 0; i < 4; i++) {
    const shardDocs = expectedShardDocuments({
      manifest,
      selection,
      tier: "smoke",
      shard: { index: i, count: 4 },
      costs,
    });
    allAssigned.push(...shardDocs);
  }

  assert.equal(allAssigned.length, 73);
  const ids = new Set(allAssigned.map((d) => d.id));
  assert.equal(ids.size, 73);
});
