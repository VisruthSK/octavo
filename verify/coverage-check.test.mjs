import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverage } from "./coverage-check.mjs";

const layout = ({ corpus, engines }) => {
  const root = mkdtempSync(join(tmpdir(), "coverage-"));
  const write = (directory, name, count) => {
    mkdirSync(join(root, directory, name), { recursive: true });
    writeFileSync(join(root, directory, name, "report.md"), count === null ? "no header\n" : `Tier smoke, ${count} documents, levels safe.\n`);
  };
  corpus.forEach((count, at) => write("reports", `corpus-report-${at + 1}`, count));
  for (const [browser, counts] of Object.entries(engines)) counts.forEach((count, at) => write("engines", `engines-report-${browser}-${at + 1}`, count));
  return { reports: join(root, "reports"), engines: join(root, "engines") };
};

test("every browser covering every document is accepted even with a different shard count", () => {
  const { reports, engines } = layout({ corpus: [37, 37], engines: { alpha: [19, 18, 19, 18], bravo: [19, 18, 19, 18] } });
  assert.deepEqual(coverage(reports, engines).problems, []);
});

test("half the documents in a browser is reported", () => {
  const { reports, engines } = layout({ corpus: [37, 37], engines: { alpha: [19, 18], bravo: [19, 18, 19, 18] } });
  const { problems } = coverage(reports, engines);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /alpha verified 37 documents but the corpus has 74/);
});

test("a shard report without a document count is reported", () => {
  const { reports, engines } = layout({ corpus: [10], engines: { alpha: [5, null] } });
  assert.ok(coverage(reports, engines).problems.some((problem) => problem.includes("have no document count")));
});

test("no engine reports at all is reported", () => {
  const { reports, engines } = layout({ corpus: [10], engines: {} });
  assert.ok(coverage(reports, engines).problems.some((problem) => problem.includes("no engine reports")));
});
