import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HEADER = /^Tier \w+, (\d+) documents/m;

const documentsIn = (directory) => {
  const report = join(directory, "report.md");
  if (!existsSync(report)) return null;
  const match = HEADER.exec(readFileSync(report, "utf8"));
  return match ? Number(match[1]) : null;
};

const sum = (values) => values.reduce((total, value) => total + value, 0);

export function coverage(reportsDirectory, enginesDirectory) {
  const problems = [];
  const reference = readdirSync(reportsDirectory).map((name) => documentsIn(join(reportsDirectory, name)));
  if (reference.length === 0 || reference.includes(null)) problems.push("a corpus report is missing or has no document count");
  const expected = sum(reference.filter((count) => count !== null));
  const byBrowser = new Map();
  for (const name of existsSync(enginesDirectory) ? readdirSync(enginesDirectory) : []) {
    const match = /^engines-report-([a-z]+)-\d+$/.exec(name);
    if (!match) continue;
    const count = documentsIn(join(enginesDirectory, name));
    const entry = byBrowser.get(match[1]) ?? { shards: 0, documents: 0, missing: 0 };
    entry.shards += 1;
    if (count === null) entry.missing += 1;
    else entry.documents += count;
    byBrowser.set(match[1], entry);
  }
  if (byBrowser.size === 0) problems.push("no engine reports were found");
  for (const [browser, entry] of byBrowser) {
    if (entry.missing) problems.push(`${browser}: ${entry.missing} of ${entry.shards} shard reports have no document count`);
    if (entry.documents !== expected) problems.push(`${browser} verified ${entry.documents} documents but the corpus has ${expected}`);
  }
  return { expected, byBrowser, problems };
}

if (process.argv[1]?.endsWith("coverage-check.mjs")) {
  const [reports, engines] = process.argv.slice(2);
  const { expected, byBrowser, problems } = coverage(reports, engines);
  for (const [browser, entry] of byBrowser) console.log(`${browser}: ${entry.documents} of ${expected} documents in ${entry.shards} shards`);
  for (const problem of problems) console.error(`coverage problem: ${problem}`);
  process.exit(problems.length ? 1 : 0);
}
