import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HEADER = /^Tier \w+, (\d+) documents/m;

export const reportIn = (directory) => {
  const direct = join(directory, "report.md");
  if (existsSync(direct)) return direct;
  if (!existsSync(directory)) return null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const nested = join(directory, entry.name, "report.md");
    if (entry.isDirectory() && existsSync(nested)) return nested;
  }
  return null;
};

export const documentsIn = (directory) => {
  const report = reportIn(directory);
  if (!report) return null;
  const match = HEADER.exec(readFileSync(report, "utf8"));
  return match ? Number(match[1]) : null;
};

export function coverage(enginesDirectory, expectedDocuments, shardCount) {
  const problems = [];
  const expected = typeof expectedDocuments === "number" && !Number.isNaN(expectedDocuments)
    ? expectedDocuments
    : null;
  const expectedShards = typeof shardCount === "number" && !Number.isNaN(shardCount)
    ? shardCount
    : null;

  const byBrowser = new Map();
  for (const name of existsSync(enginesDirectory) ? readdirSync(enginesDirectory) : []) {
    const match = /^engines-report-([a-z0-9_-]+)-\d+$/.exec(name);
    if (!match) continue;
    const browser = match[1];
    const count = documentsIn(join(enginesDirectory, name));
    const entry = byBrowser.get(browser) ?? { shards: 0, documents: 0, missing: 0 };
    entry.shards += 1;
    if (count === null) entry.missing += 1;
    else entry.documents += count;
    byBrowser.set(browser, entry);
  }

  if (byBrowser.size === 0) {
    problems.push("no engine reports were found");
    return { expected, byBrowser, problems };
  }

  const documentTotals = new Set([...byBrowser.values()].map((entry) => entry.documents));
  if (documentTotals.size > 1) {
    problems.push("every browser must report the same total number of documents");
  }

  for (const [browser, entry] of byBrowser) {
    if (entry.missing) {
      problems.push(`${browser}: ${entry.missing} of ${entry.shards} shard reports have no document count`);
    }
    if (expectedShards !== null && entry.shards !== expectedShards) {
      problems.push(`${browser} has ${entry.shards} shard reports but expected ${expectedShards}`);
    }
    if (expected !== null && entry.documents !== expected) {
      problems.push(`${browser} verified ${entry.documents} documents but the plan selected ${expected}`);
    }
  }

  return { expected, byBrowser, problems };
}

if (process.argv[1]?.endsWith("coverage-check.mjs")) {
  const [engines, expectedCount, shardCount] = process.argv.slice(2);
  const { expected, byBrowser, problems } = coverage(
    engines,
    expectedCount ? Number(expectedCount) : undefined,
    shardCount ? Number(shardCount) : undefined,
  );
  for (const [browser, entry] of byBrowser) {
    console.log(`${browser}: ${entry.documents} of ${expected ?? entry.documents} documents in ${entry.shards} shards`);
  }
  for (const problem of problems) {
    console.error(`coverage problem: ${problem}`);
  }
  process.exit(problems.length ? 1 : 0);
}
