import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { coverage } from "./coverage-check.mjs";

const layout = (engines) => {
  const root = mkdtempSync(join(tmpdir(), "coverage-"));
  const write = (name, count) => {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "report.md"), count === null ? "no header\n" : `Tier smoke, ${count} documents, levels safe.\n`);
  };
  for (const [browser, counts] of Object.entries(engines)) {
    counts.forEach((count, at) => write(`engines-report-${browser}-${at + 1}`, count));
  }
  return root;
};

test("every browser covering every document across all shards is accepted", () => {
  const engines = layout({ alpha: [19, 18, 19, 18], bravo: [19, 18, 19, 18] });
  assert.deepEqual(coverage(engines, 74, 4).problems, []);
});

test("browser short a shard is reported", () => {
  const engines = layout({ alpha: [19, 18, 19], bravo: [19, 18, 19, 18] });
  const { problems } = coverage(engines, 74, 4);
  assert.ok(problems.some((problem) => problem.includes("alpha has 3 shard reports but expected 4")));
});

test("browser with a different total is reported", () => {
  const engines = layout({ alpha: [18, 18, 18, 18], bravo: [19, 18, 19, 18] });
  const { problems } = coverage(engines, 74, 4);
  assert.ok(problems.some((problem) => problem.includes("alpha verified 72 documents but the plan selected 74")));
  assert.ok(problems.some((problem) => problem.includes("every browser must report the same total number of documents")));
});

test("a shard report without a document count is reported", () => {
  const engines = layout({ alpha: [19, 18, 19, null], bravo: [19, 18, 19, 18] });
  assert.ok(coverage(engines, 74, 4).problems.some((problem) => problem.includes("have no document count")));
});

test("nested report layout, as the artifact upload lays them out, is counted", () => {
  const root = mkdtempSync(join(tmpdir(), "coverage-"));
  const put = (path, count) => {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "report.md"), `Tier smoke, ${count} documents, levels safe.\n`);
  };
  put("engines-report-alpha-1/engines-alpha-1", 37);
  put("engines-report-alpha-2/engines-alpha-2", 37);
  put("engines-report-bravo-1/engines-bravo-1", 37);
  put("engines-report-bravo-2/engines-bravo-2", 37);
  const { problems, byBrowser } = coverage(root, 74, 2);
  assert.deepEqual(problems, []);
  assert.equal(byBrowser.get("alpha").documents, 74);
  assert.equal(byBrowser.get("bravo").documents, 74);
});

test("no engine reports at all is reported", () => {
  const root = mkdtempSync(join(tmpdir(), "coverage-"));
  assert.ok(coverage(root, 74, 4).problems.some((problem) => problem.includes("no engine reports were found")));
});
