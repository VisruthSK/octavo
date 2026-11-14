import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const reportJsonIn = (directory) => {
  const direct = join(directory, "report.json");
  if (existsSync(direct)) return direct;
  if (!existsSync(directory)) return null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const nested = join(directory, entry.name, "report.json");
    if (entry.isDirectory() && existsSync(nested)) return nested;
  }
  return null;
};

export function loadReports(directory) {
  if (!existsSync(directory)) return [];
  const reports = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const report = reportJsonIn(join(directory, entry.name));
    if (report) reports.push(report);
  }
  return reports.flatMap((file) => JSON.parse(readFileSync(file, "utf8")));
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const size = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`);

export function summarizeReports(results) {
  const produced = results.filter((entry) => entry.outBytes !== null && !entry.excluded);

  const row = (name, entries) => {
    const input = entries.reduce((total, entry) => total + entry.inBytes, 0);
    const output = entries.reduce((total, entry) => total + entry.outBytes, 0);
    const seconds = entries.reduce((total, entry) => total + entry.ms, 0) / 1000;
    const ratio = median(entries.map((entry) => entry.inBytes / entry.outBytes));
    return `| ${name} | ${entries.length} | ${size(input)} | ${size(output)} | ${((output / input) * 100).toFixed(1)}% | ${ratio.toFixed(2)} | ${seconds.toFixed(1)} | ${(input / 1048576 / seconds).toFixed(2)} |`;
  };
  const header = ["| | Documents | Input | Output | Output % of input | Median ratio | Octavo seconds | MiB/s |", "|---|---|---|---|---|---|---|---|"];

  const lines = [
    `## Corpus totals`,
    ``,
    `${results.length} document runs from ${new Set(results.map((entry) => entry.id)).size} documents.`,
    ``,
    `### By level`,
    ``,
    `Times come from a shared runner with documents processed in parallel, so compare levels with each other and do not read them as absolute speed.`,
    ``,
    ...header,
  ];
  for (const [level, entries] of [...Map.groupBy(produced, (entry) => entry.level)].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(row(level, entries));
  }
  lines.push(``, `### By category and level`, ``, ...header);
  for (const [name, entries] of [...Map.groupBy(produced, (entry) => `${entry.category} / ${entry.level}`)].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(row(name, entries));
  }
  const rounding = results.filter((entry) => entry.roundedPixels > 0);
  lines.push(
    ``,
    `### Pixels off by exactly one level`,
    ``,
    `Rendering rounding that the screenshot check allows. A rise in these counts across many documents would point to a systematic cause.`,
    ``,
    `| Level | Documents with any | Pixels |`,
    `|---|---|---|`,
    ...[...Map.groupBy(results, (entry) => entry.level)].sort(([a], [b]) => a.localeCompare(b)).map(([level, entries]) => {
      const some = entries.filter((entry) => entry.roundedPixels > 0);
      return `| ${level} | ${some.length} of ${entries.length} | ${some.reduce((total, entry) => total + entry.roundedPixels, 0)} |`;
    }),
    ``,
    ...rounding.sort((a, b) => b.roundedPixels - a.roundedPixels).slice(0, 5).map((entry) => `- ${entry.id} (${entry.level}): ${entry.roundedPixels}`),
  );
  const problems = results.filter((entry) => entry.problems.length);
  lines.push(``, `### Problems`, ``, problems.length ? problems.map((entry) => `- ${entry.id} (${entry.level}): ${entry.problems.join("; ").slice(0, 300)}`).join("\n") : "None.");

  return `${lines.join("\n")}\n`;
}

if (process.argv[1]?.endsWith("merge-reports.mjs")) {
  const [directory, summary = process.env.GITHUB_STEP_SUMMARY] = process.argv.slice(2);
  const results = loadReports(directory);
  const text = summarizeReports(results);
  console.log(text);
  if (summary) appendFileSync(summary, text);
}
