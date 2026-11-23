import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const ci = read("../.github/workflows/ci.yml");
const corpus = read("../.github/workflows/corpus.yml");
const required = JSON.parse(read("../.github/required-checks.json"));

const TIER = "smoke";
const SHARDS = [1, 2, 3, 4];

const template = (source, pattern) => {
  const match = source.match(pattern);
  assert.ok(match, `workflow no longer matches ${pattern}`);
  return match[1].trim();
};
const expand = (name, values) => name.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => values[key] ?? assert.fail(`unknown expression ${key} in ${name}`));
const list = (source, pattern) => template(source, pattern).replace(/[\[\]"\s]/g, "").split(",");

const emitted = () => {
  const names = [];
  for (const [id, fixed] of [["fmt", "Format"], ["clippy", "Clippy"], ["browser", "Browser tests"]]) {
    assert.equal(template(ci, new RegExp(`\n  ${id}:\n    name: (.+)`)), fixed);
    names.push(fixed);
  }
  const testName = template(ci, /\n  test:\n    name: (.+)/);
  for (const os of list(ci, /\n  test:[\s\S]*?os: (\[[^\]]+\])/)) names.push(expand(testName, { "matrix.os": os }));

  const engines = template(corpus, /\n  engines:\n    name: (.+)/);
  const browsers = list(corpus, /\|\| '(\[[^']*chromium[^']*\])'/);
  const linked = template(corpus, /\n  linked:\n    name: (.+)/);
  const selftest = template(corpus, /\n  selftest:\n    name: (.+)/);
  const tier = { "needs.plan.outputs.tier": TIER };
  for (const shard of SHARDS) {
    for (const browser of browsers) names.push(expand(engines, { ...tier, "matrix.browser": browser, "matrix.shard": String(shard) }));
    names.push(expand(linked, { ...tier, "matrix.shard": String(shard) }));
  }
  for (const browser of list(corpus, /\n  selftest:[\s\S]*?browser: (\[[^\]]+\])/)) names.push(expand(selftest, { "matrix.browser": browser }));
  return names;
};

test("every required check is a name the workflows emit and every emitted smoke check is required", () => {
  assert.deepEqual([...new Set(emitted())].sort(), [...required].sort());
});
