import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { costOf, readCosts } from "./costs.mjs";
import { assign, shardSlice } from "./sharding.mjs";

const selectionPath = join(import.meta.dirname, "selection.json");
const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
const subsetUpstream = selection.filter((entry) => entry.tier === "subset");

const manifestPath = join(import.meta.dirname, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const subsetManifest = manifest.filter((entry) => entry.tier === "subset");
const allSubset = [...subsetManifest, ...subsetUpstream];

const costs = readCosts();

test("balanced assignment is deterministic", () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const run1 = assign(subsetUpstream, costs, 4, engine);
    const run2 = assign(subsetUpstream, costs, 4, engine);
    assert.deepStrictEqual(run1, run2);
  }
});

test("the union of all shards equals the input with no duplicates for counts 2, 4 and 10", () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    for (const input of [subsetUpstream, selection]) {
      for (const count of [2, 4, 10]) {
        const shards = assign(input, costs, count, engine);
        assert.equal(shards.length, count);
        const flattened = shards.flat();
        assert.equal(flattened.length, input.length);
        const ids = flattened.map((item) => item.id);
        const uniqueIds = new Set(ids);
        assert.equal(uniqueIds.size, input.length);
        for (const item of input) {
          assert.ok(uniqueIds.has(item.id));
        }
      }
    }
  }
});

test("the heavy documents land in different shards at count 4", () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const shards = assign(subsetUpstream, costs, 4, engine);
    const sorted = [...subsetUpstream].sort((a, b) => costOf(b, costs, engine) - costOf(a, costs, engine));
    const top4 = sorted.slice(0, 4);
    const assignedShards = new Set();
    for (const heavy of top4) {
      const shardIndex = shards.findIndex((shard) => shard.some((item) => item.id === heavy.id));
      assert.ok(shardIndex >= 0);
      assert.ok(!assignedShards.has(shardIndex));
      assignedShards.add(shardIndex);
    }
    assert.equal(assignedShards.size, 4);
  }
});

test("for counts 4 and 10 and each engine the shards cover the selection exactly once and the heaviest shard is bounded", () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    for (const count of [4, 10]) {
      const shards = assign(selection, costs, count, engine);
      assert.equal(shards.length, count);
      const flattened = shards.flat();
      assert.equal(flattened.length, selection.length);
      const ids = flattened.map((item) => item.id);
      const uniqueIds = new Set(ids);
      assert.equal(uniqueIds.size, selection.length);
      for (const item of selection) {
        assert.ok(uniqueIds.has(item.id));
      }

      const shardCosts = shards.map((shard) => shard.reduce((sum, item) => sum + costOf(item, costs, engine), 0));
      const totalCost = shardCosts.reduce((a, b) => a + b, 0);
      const average = totalCost / count;
      const maxCost = Math.max(...shardCosts);
      const maxDocCost = Math.max(...selection.map((item) => costOf(item, costs, engine)));
      const bound = Math.max(average * 1.30, maxDocCost);
      assert.ok(maxCost <= bound, `${engine} count ${count} max ${maxCost} exceeds bound ${bound} (mean ${average})`);
    }
  }
});

test("the heaviest shard is within a stated bound of the average on subset documents", () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    for (const count of [2, 4]) {
      const shards = assign(allSubset, costs, count, engine);
      const shardCosts = shards.map((shard) => shard.reduce((sum, item) => sum + costOf(item, costs, engine), 0));
      const totalCost = shardCosts.reduce((a, b) => a + b, 0);
      const average = totalCost / count;
      const maxCost = Math.max(...shardCosts);
      assert.ok(maxCost <= average * 1.25);
    }
    const shards10 = assign(allSubset, costs, 10, engine);
    const costs10 = shards10.map((shard) => shard.reduce((sum, item) => sum + costOf(item, costs, engine), 0));
    const total10 = costs10.reduce((a, b) => a + b, 0);
    const average10 = total10 / 10;
    const max10 = Math.max(...costs10);
    const maxDoc10 = Math.max(...allSubset.map((item) => costOf(item, costs, engine)));
    const bound10 = Math.max(average10 * 1.30, maxDoc10);
    assert.ok(max10 <= bound10);
  }
});

test("a document missing from costs.json still gets assigned", () => {
  const missing = { id: "unknown-synthetic-doc", tier: "subset", bytes: 2048 };
  const items = [...subsetUpstream, missing];
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const shards = assign(items, costs, 4, engine);
    const found = shards.flat().find((item) => item.id === missing.id);
    assert.ok(found);
    assert.equal(costOf(missing, costs, engine), 2);
  }
});

test("shardSlice returns slice matching assign", () => {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    for (let index = 0; index < 4; index++) {
      const slice = shardSlice(subsetUpstream, { index, count: 4 }, costs, engine);
      const expected = assign(subsetUpstream, costs, 4, engine)[index];
      assert.deepStrictEqual(slice, expected);
    }
  }
});
