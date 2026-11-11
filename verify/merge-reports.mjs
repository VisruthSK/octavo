import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [directory, summary = process.env.GITHUB_STEP_SUMMARY] = process.argv.slice(2);
const results = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, "report.json")))
  .flatMap((entry) => JSON.parse(readFileSync(join(directory, entry.name, "report.json"), "utf8")));

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const mib = (bytes) => (bytes / 1048576).toFixed(1);
const produced = results.filter((entry) => entry.outBytes !== null && !entry.excluded);

const row = (name, entries) => {
  const input = entries.reduce((total, entry) => total + entry.inBytes, 0);
  const output = entries.reduce((total, entry) => total + entry.outBytes, 0);
  const seconds = entries.reduce((total, entry) => total + entry.ms, 0) / 1000;
  const ratio = median(entries.map((entry) => entry.inBytes / entry.outBytes));
  return `| ${name} | ${entries.length} | ${mib(input)} | ${mib(output)} | ${((output / input) * 100).toFixed(1)}% | ${ratio.toFixed(2)} | ${seconds.toFixed(1)} | ${(input / 1048576 / seconds).toFixed(2)} |`;
};
const header = ["| | Documents | Input MiB | Output MiB | Output % of input | Median ratio | Octavo seconds | MiB/s |", "|---|---|---|---|---|---|---|---|"];

const lines = [`## Corpus totals`, ``, `${results.length} document runs from ${new Set(results.map((entry) => entry.id)).size} documents.`, ``, `### By level`, ``, `Times come from a shared runner with documents processed in parallel, so compare levels with each other and do not read them as absolute speed.`, ``, ...header];
for (const [level, entries] of [...Map.groupBy(produced, (entry) => entry.level)].sort(([a], [b]) => a.localeCompare(b))) lines.push(row(level, entries));
lines.push(``, `### By category and level`, ``, ...header);
for (const [name, entries] of [...Map.groupBy(produced, (entry) => `${entry.category} / ${entry.level}`)].sort(([a], [b]) => a.localeCompare(b))) lines.push(row(name, entries));
const problems = results.filter((entry) => entry.problems.length);
lines.push(``, `### Problems`, ``, problems.length ? problems.map((entry) => `- ${entry.id} (${entry.level}): ${entry.problems.join("; ").slice(0, 300)}`).join("\n") : "None.");

const text = `${lines.join("\n")}\n`;
console.log(text);
if (summary) appendFileSync(summary, text);
process.exit(problems.length ? 1 : 0);
