import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { documentPath, materialize } from "../corpus/build.mjs";
import { readRendered, renderedPath } from "../corpus/upstream.mjs";
import { rejections } from "../corpus/spec.mjs";

const SLOWDOWN_LIMIT = 100;
const RATE_FLOOR_BYTES = 256 * 1024;
const STARTUP_ALLOWANCE_MS = 2000;

const root = resolve(import.meta.dirname, "..");
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};
const tier = flag("tier", "smoke");
const levels = flag("levels", "safe,packed").split(",");
const filter = new RegExp(flag("filter", "."));
const cores = cpus().length;
const jobs = Number(flag("jobs", Math.max(1, Math.floor(cores / 2))));
const threads = Math.max(1, Math.floor(cores / jobs));
const browser = process.argv.includes("--browser");
const upstream = !process.argv.includes("--no-upstream");
const outDirectory = resolve(flag("out", join(root, "out", "corpus")));

const built = resolve(flag("binary", join(root, "target", "release", process.platform === "win32" ? "octavo.exe" : "octavo")));
const binary = join(mkdtempSync(join(tmpdir(), "octavo-corpus-")), basename(built));
copyFileSync(built, binary);

const run = (args) =>
  new Promise((done) => {
    const started = process.hrtime.bigint();
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => done({ code, stdout, stderr, ms: Number(process.hrtime.bigint() - started) / 1e6 }));
  });

const pool = async (items, limit, work) => {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next++;
        results[at] = await work(items[at]);
      }
    }),
  );
  return results;
};

const naive = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, "><").replace(/\s{2,}/g, " ");
const brotli = (text) => brotliCompressSync(Buffer.from(text)).length;
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const median = (values) => percentile([...values].sort((a, b) => a - b), 0.5);

const outcomeOf = ({ code, stdout }, same) => {
  if (code !== 0) return "rejects";
  return /kept the original/.test(stdout) && same ? "keeps" : "optimizes";
};

const check = (row, expect, result, output, input) => {
  const problems = [];
  const outcome = outcomeOf(result, output === input);
  const accepted = expect.outcome === "accepts" ? ["optimizes", "keeps"].includes(outcome) : outcome === expect.outcome;
  if (!accepted) problems.push(`expected ${expect.outcome}, got ${outcome}`);
  if (expect.outcome === "rejects" && outcome === "rejects" && !result.stderr.includes(rejections[expect.error])) {
    problems.push(`expected the ${expect.error} error, got: ${result.stderr.trim().slice(0, 120)}`);
  }
  if (outcome !== "rejects" && output.length > input.length) problems.push(`output grew from ${input.length} to ${output.length} bytes`);
  if (row.level === "safe") {
    for (const text of expect.retains ?? []) if (!output.includes(text)) problems.push(`lost required text: ${text.slice(0, 60)}`);
    for (const text of expect.removes ?? []) if (output.includes(text)) problems.push(`kept text that should go: ${text.slice(0, 60)}`);
  }
  return problems;
};

await run(["--version"]);
const upstreamRows = upstream
  ? readRendered().map((entry) => ({ ...entry, browser: true, expect: { outcome: "accepts" }, path: renderedPath(entry.id) }))
  : [];
const rows = [...(await materialize()).map((row) => ({ ...row, path: documentPath(row.id) })), ...upstreamRows];
const selected = rows.filter((row) => (tier === "full" || row.tier === "smoke") && filter.test(row.id));
rmSync(outDirectory, { recursive: true, force: true });
mkdirSync(outDirectory, { recursive: true });

const work = selected.flatMap((row) => levels.map((level) => ({ row, level })));
const results = await pool(work, jobs, async ({ row, level }) => {
  const input = row.path;
  const output = join(outDirectory, `${row.id}.${level}.html`);
  const result = await run(["optimize", input, output, "--level", level, "--jobs", String(threads)]);
  const source = readFileSync(input, "utf8");
  const produced = result.code === 0 ? readFileSync(output, "utf8") : "";
  const excluded = Boolean(row.source) && result.stderr.includes(rejections["not-self-contained"]);
  const problems = excluded ? [] : check({ level }, row.expect, result, produced, source);
  return {
    id: row.id,
    category: row.category,
    level,
    inBytes: statSync(input).size,
    outBytes: result.code === 0 ? statSync(output).size : null,
    ms: result.ms,
    outcome: outcomeOf(result, produced === source),
    baselines: {
      naive: naive(source).length,
      brotliOriginal: brotli(source),
      brotliOptimized: result.code === 0 ? brotli(produced) : null,
    },
    problems,
    excluded: excluded ? result.stderr.trim().split("\n").at(-1).slice(0, 200) : null,
    browser: row.browser && result.code === 0 && produced !== source,
    input,
    output,
  };
});

if (browser) {
  const { verify } = await import("./verify.mjs");
  for (const result of results.filter((entry) => entry.browser)) {
    const report = (await verify(result.input, result.output)).filter(
      ({ scenario }) => !(result.level === "packed" && scenario === "no-js"),
    );
    for (const { scenario, issues } of report) for (const issue of issues) result.problems.push(`${scenario}: ${issue}`);
  }
}

const measured = results.filter((entry) => !entry.excluded);
const large = measured.filter((entry) => entry.inBytes >= RATE_FLOOR_BYTES);
const medianRate = Math.max(median(large.map((entry) => entry.ms / entry.inBytes)), 1e-6);
for (const entry of measured) {
  const allowed = STARTUP_ALLOWANCE_MS + SLOWDOWN_LIMIT * medianRate * entry.inBytes;
  if (entry.ms > allowed) {
    const retry = await run(["optimize", entry.input, entry.output.replace(/.html$/, ".retry.html"), "--level", entry.level, "--jobs", String(cores)]);
    entry.ms = Math.min(entry.ms, retry.ms);
  }
  if (entry.ms > allowed) {
    entry.problems.push(`took ${entry.ms.toFixed(0)} ms, over ${SLOWDOWN_LIMIT}x the corpus median rate (${allowed.toFixed(0)} ms allowed)`);
  }
}

const categories = Map.groupBy(measured, (entry) => `${entry.category} / ${entry.level}`);
const kib = (bytes) => (bytes / 1024).toFixed(1);
const lines = [`# Corpus report`, ``, `Tier ${tier}, ${selected.length} documents, levels ${levels.join(", ")}, browser ${browser ? "on" : "off"}. ${jobs} documents at a time, ${threads} threads each.`, ``];
lines.push(`| Category / level | Docs | Input KiB | Output KiB | Median ratio | p50 ms | p95 ms | Naive KiB | Brotli(original) KiB |`);
lines.push(`|---|---|---|---|---|---|---|---|---|`);
for (const [name, entries] of [...categories].sort(([a], [b]) => a.localeCompare(b))) {
  const produced = entries.filter((entry) => entry.outBytes !== null);
  const ratios = produced.map((entry) => entry.inBytes / entry.outBytes);
  const times = entries.map((entry) => entry.ms).sort((a, b) => a - b);
  const sum = (list, pick) => list.reduce((total, entry) => total + pick(entry), 0);
  lines.push(
    `| ${name} | ${entries.length} | ${kib(sum(entries, (e) => e.inBytes))} | ${kib(sum(produced, (e) => e.outBytes))} | ${median(ratios).toFixed(2)} | ${percentile(times, 0.5).toFixed(0)} | ${percentile(times, 0.95).toFixed(0)} | ${kib(sum(entries, (e) => e.baselines.naive))} | ${kib(sum(entries, (e) => e.baselines.brotliOriginal))} |`,
  );
}
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);
lines.push(``, `## Slowest`, ...slowest.map((e) => `- ${e.id} (${e.level}): ${e.ms.toFixed(0)} ms for ${kib(e.inBytes)} KiB`));
const excludedRows = results.filter((entry) => entry.excluded && entry.level === levels[0]);
const failures = results.filter((entry) => entry.problems.length);
lines.push(``, `## Excluded (upstream render was not self-contained)`, excludedRows.length ? "" : "None.");
for (const entry of excludedRows) lines.push(`- ${entry.id}: ${entry.excluded}`);
lines.push(``, `## Problems`, failures.length ? "" : "None.");
for (const entry of failures) lines.push(`- ${entry.id} (${entry.level}): ${entry.problems.join("; ")}`);

writeFileSync(join(outDirectory, "report.md"), `${lines.join("\n")}\n`);
writeFileSync(join(outDirectory, "report.json"), `${JSON.stringify(results.map(({ input, output, ...rest }) => rest), null, 2)}\n`);
console.log(lines.join("\n"));
process.exit(failures.length ? 1 : 0);
