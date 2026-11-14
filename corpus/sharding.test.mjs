import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { costOf, readCosts } from "./costs.mjs";
import { assign, shardSlice } from "./sharding.mjs";

const selectionPath = join(import.meta.dirname, "selection.json");
const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
const smokeUpstream = selection.filter((entry) => entry.tier === "smoke");

const manifestPath = join(import.meta.dirname, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const smokeManifest = manifest.filter((entry) => entry.tier === "smoke");
const allSmoke = [...smokeManifest, ...smokeUpstream];

const costs = readCosts();

const TOP_HEAVY_UPSTREAM = [
  "quarto-cli-crossrefs-all",
  "quarto-cli-smoke-all-2026-07-13-issue-14684-dashboard",
  "quarto-cli-syntax-test",
  "quarto-cli-text-highlighting-github-dark",
];

test("balanced assignment is deterministic", () => {
  const run1 = assign(smokeUpstream, costs, 4);
  const run2 = assign(smokeUpstream, costs, 4);
  assert.deepStrictEqual(run1, run2);
});

test("the union of all shards equals the input with no duplicates for counts 2, 4 and 10", () => {
  for (const count of [2, 4, 10]) {
    const shards = assign(smokeUpstream, costs, count);
    assert.equal(shards.length, count);
    const flattened = shards.flat();
    assert.equal(flattened.length, smokeUpstream.length);
    const ids = flattened.map((item) => item.id);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, smokeUpstream.length);
    for (const item of smokeUpstream) {
      assert.ok(uniqueIds.has(item.id));
    }
  }
});

test("the heavy documents land in different shards at count 4", () => {
  const shards = assign(smokeUpstream, costs, 4);
  const assignedShards = new Set();
  for (const heavyId of TOP_HEAVY_UPSTREAM) {
    const shardIndex = shards.findIndex((shard) => shard.some((item) => item.id === heavyId));
    assert.ok(shardIndex >= 0);
    assert.ok(!assignedShards.has(shardIndex));
    assignedShards.add(shardIndex);
  }
  assert.equal(assignedShards.size, 4);
});

test("the heaviest shard is within a stated bound of the average on the real costs file", () => {
  for (const count of [2, 4]) {
    const shards = assign(smokeUpstream, costs, count);
    const shardCosts = shards.map((shard) => shard.reduce((sum, item) => sum + costOf(item, costs), 0));
    const totalCost = shardCosts.reduce((a, b) => a + b, 0);
    const average = totalCost / count;
    const maxCost = Math.max(...shardCosts);
    assert.ok(maxCost <= average * 1.25);
  }
  const shards10 = assign(smokeUpstream, costs, 10);
  const costs10 = shards10.map((shard) => shard.reduce((sum, item) => sum + costOf(item, costs), 0));
  const total10 = costs10.reduce((a, b) => a + b, 0);
  const average10 = total10 / 10;
  const max10 = Math.max(...costs10);
  assert.ok(max10 <= average10 * 1.30, `count 10 max ${max10} exceeds 1.30x mean ${average10} because crossrefs-all is 1452s while mean is 1221.6s`);

  for (const count of [2, 4, 10]) {
    const shards = assign(allSmoke, costs, count);
    const shardCosts = shards.map((shard) => shard.reduce((sum, item) => sum + costOf(item, costs), 0));
    const totalCost = shardCosts.reduce((a, b) => a + b, 0);
    const average = totalCost / count;
    const maxCost = Math.max(...shardCosts);
    assert.ok(maxCost <= average * 1.25);
  }
});

test("a document missing from costs.json still gets assigned", () => {
  const missing = { id: "unknown-synthetic-doc", tier: "smoke", bytes: 2048 };
  const items = [...smokeUpstream, missing];
  const shards = assign(items, costs, 4);
  const found = shards.flat().find((item) => item.id === missing.id);
  assert.ok(found);
  assert.equal(costOf(missing, costs), 2);
});

test("shardSlice returns slice matching assign", () => {
  for (let index = 0; index < 4; index++) {
    const slice = shardSlice(smokeUpstream, { index, count: 4 }, costs);
    const expected = assign(smokeUpstream, costs, 4)[index];
    assert.deepStrictEqual(slice, expected);
  }
});
