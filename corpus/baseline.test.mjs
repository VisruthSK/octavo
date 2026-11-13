import assert from "node:assert/strict";
import { test } from "node:test";
import { GROWTH_LIMIT, compareBaseline, mergeBaseline, parseBaseline, serializeBaseline } from "./baseline.mjs";

const result = (id, level, outBytes, category = "pages") => ({ id, level, outBytes, category });

test("growth of exactly 0.5 percent passes and anything above it fails", () => {
  const baseline = { doc: { safe: 1000 } };
  assert.equal(GROWTH_LIMIT, 0.005);
  assert.equal(compareBaseline(baseline, [result("doc", "safe", 1005)]).growth.length, 0);
  const above = compareBaseline(baseline, [result("doc", "safe", 1006)]);
  assert.deepEqual(above.growth.map((row) => [row.id, row.level, row.before, row.after]), [["doc", "safe", 1000, 1006]]);
  assert.ok(Math.abs(above.growth[0].change - 0.006) < 1e-9);
});

test("a smaller output passes", () => {
  assert.deepEqual(compareBaseline({ doc: { packed: 1000 } }, [result("doc", "packed", 900)]).growth, []);
});

test("categories sum the baseline and the current sizes per level", () => {
  const baseline = { a: { safe: 1000, packed: 500 }, b: { safe: 3000, packed: 700 } };
  const report = compareBaseline(baseline, [result("a", "safe", 1001), result("b", "safe", 3100), result("a", "packed", 500, "other")]);
  assert.deepEqual(
    report.categories.map((row) => [row.category, row.level, row.docs, row.before, row.after]),
    [
      ["other", "packed", 1, 500, 500],
      ["pages", "safe", 2, 4000, 4101],
    ],
  );
  assert.ok(Math.abs(report.categories[1].change - (4101 / 4000 - 1)) < 1e-9);
});

test("a document with no baseline is listed but does not fail the gate", () => {
  const report = compareBaseline({}, [result("new", "safe", 10_000)]);
  assert.deepEqual(report.growth, []);
  assert.deepEqual(report.unrecorded, ["new (safe)"]);
  assert.equal(report.compared, 0);
});

test("a failed output without a size is ignored", () => {
  const report = compareBaseline({ doc: { safe: 1000 } }, [result("doc", "safe", null)]);
  assert.equal(report.compared, 0);
  assert.deepEqual(report.growth, []);
});

test("merging updates measured levels and keeps the others", () => {
  const baseline = { doc: { safe: 1000, packed: 700 }, gone: { safe: 10 } };
  const merged = mergeBaseline(baseline, [result("doc", "safe", 900), result("doc", "scripts", 800)]);
  assert.deepEqual(merged, { doc: { safe: 900, packed: 700, scripts: 800 }, gone: { safe: 10 } });
  assert.deepEqual(baseline, { doc: { safe: 1000, packed: 700 }, gone: { safe: 10 } });
});

test("merging with prune drops documents that are not in the run", () => {
  const merged = mergeBaseline({ doc: { safe: 1 }, gone: { safe: 2 } }, [result("doc", "safe", 3)], { prune: true });
  assert.deepEqual(merged, { doc: { safe: 3 } });
});

test("baseline text is sorted, uses the level order and survives a round trip", () => {
  const text = serializeBaseline({ b: { packed: 20, safe: 10 }, a: { scripts: 5 } });
  assert.equal(text, '{\n  "a": {\n    "scripts": 5\n  },\n  "b": {\n    "safe": 10,\n    "packed": 20\n  }\n}\n');
  assert.deepEqual(parseBaseline(text), { a: { scripts: 5 }, b: { safe: 10, packed: 20 } });
});

test("a malformed baseline is rejected", () => {
  assert.throws(() => parseBaseline("[]"), /must be an object/);
  assert.throws(() => parseBaseline('{"a": {"tiny": 1}}'), /unknown level tiny/);
  assert.throws(() => parseBaseline('{"a": {"safe": -1}}'), /byte count/);
});
