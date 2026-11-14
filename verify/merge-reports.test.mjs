import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadReports, reportJsonIn, summarizeReports } from "./merge-reports.mjs";

test("reportJsonIn finds direct report.json", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-"));
  const dir = join(root, "shard-1");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "report.json");
  writeFileSync(file, JSON.stringify([{ id: "sample", level: "safe", inBytes: 100, outBytes: 80, ms: 10, excluded: false, problems: [], roundedPixels: 0 }]));
  assert.equal(reportJsonIn(dir), file);
});

test("reportJsonIn finds nested report.json", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-"));
  const dir = join(root, "artifact-1");
  const nested = join(dir, "inner-1");
  mkdirSync(nested, { recursive: true });
  const file = join(nested, "report.json");
  writeFileSync(file, JSON.stringify([{ id: "sample", level: "safe", inBytes: 100, outBytes: 80, ms: 10, excluded: false, problems: [], roundedPixels: 0 }]));
  assert.equal(reportJsonIn(dir), file);
});

test("loadReports loads and merges all report rows across shards", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-"));
  const dir1 = join(root, "shard-1");
  const dir2 = join(root, "shard-2", "nested");
  mkdirSync(dir1, { recursive: true });
  mkdirSync(dir2, { recursive: true });
  writeFileSync(join(dir1, "report.json"), JSON.stringify([{ id: "doc-1", category: "c1", level: "safe", inBytes: 100, outBytes: 80, ms: 10, excluded: false, problems: [], roundedPixels: 0 }]));
  writeFileSync(join(dir2, "report.json"), JSON.stringify([{ id: "doc-2", category: "c2", level: "safe", inBytes: 200, outBytes: 150, ms: 20, excluded: false, problems: [], roundedPixels: 0 }]));

  const results = loadReports(root);
  assert.equal(results.length, 2);
  const summary = summarizeReports(results);
  assert.ok(summary.includes("2 document runs from 2 documents"));
  assert.ok(summary.includes("Corpus totals"));
});
