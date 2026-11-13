import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { brotliCompressSync } from "node:zlib";
import { documentPath, materialize } from "../corpus/build.mjs";
import { readRendered, renderedPath } from "../corpus/upstream.mjs";
import { rejections } from "../corpus/spec.mjs";
import { scenariosFor } from "./capture.mjs";
import { engine, engineNotice, checksOf } from "./engines/index.mjs";

const SLOWDOWN_LIMIT = 100;
const RATE_FLOOR_BYTES = 256 * 1024;
const STARTUP_ALLOWANCE_MS = 2000;

const root = resolve(import.meta.dirname, "..");
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};
const tier = flag("tier", "smoke");
const deadlineMinutes = Number(flag("deadline-minutes", "0"));
if (!Number.isFinite(deadlineMinutes) || deadlineMinutes < 0) throw new RangeError("deadline-minutes must be a non-negative number");
const deadlineAt = deadlineMinutes ? Date.now() + deadlineMinutes * 60_000 : Infinity;
const deadlineReached = () => Date.now() >= deadlineAt;
const revalidatePercent = Number(flag("revalidate", process.env.CI && tier === "full" ? "5" : "0"));
const levels = flag("levels", tier === "full" ? "safe,scripts,packed" : "safe,packed").split(",");
const filter = new RegExp(flag("filter", "."));
const cores = cpus().length;
const jobs = Number(flag("jobs", Math.max(1, Math.floor(cores / 2))));
const threads = Math.max(1, Math.floor(cores / jobs));
const browser = process.argv.includes("--browser");
const verdictCache = !process.argv.includes("--no-verdict-cache");
const upstream = !process.argv.includes("--no-upstream");
const octavoArgs = flag("octavo-args", "").split(/\s+/).filter(Boolean);
const outDirectory = resolve(flag("out", join(root, "out", "corpus")));

const built = resolve(flag("binary", join(root, "target", "release", process.platform === "win32" ? "octavo.exe" : "octavo")));
const scratch = mkdtempSync(join(tmpdir(), "octavo-corpus-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const binary = join(scratch, basename(built));
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

const pool = async (items, limit, work, unstarted) => {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const at = next++;
        results[at] = deadlineReached() ? await unstarted(items[at]) : await work(items[at]);
      }
    }),
  );
  return results;
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scenarioHash = sha256(Buffer.concat(readdirSync(join(root, "corpus")).filter((name) => name.endsWith(".mjs")).sort().flatMap((name) => [Buffer.from(name), readFileSync(join(root, "corpus", name))])));

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

const binaryVersion = (await run(["--version", ...octavoArgs])).stdout.trim();
const upstreamRows = upstream
  ? readRendered().map((entry) => ({ ...entry, browser: true, expect: { outcome: "accepts" }, path: renderedPath(entry.id) }))
  : [];
const [shardPosition, shardCount] = flag("shard", "").split("/").map(Number);
const ownHandWritten = (_, index) => !shardCount || index % shardCount === shardPosition - 1;
const handWritten = (await materialize())
  .map((row) => ({ ...row, path: documentPath(row.id) }))
  .filter((row) => tier === "full" || row.tier === "smoke")
  .filter(ownHandWritten);
const rows = [...handWritten, ...upstreamRows];
const selected = rows.filter((row) => (tier === "full" || row.tier === "smoke") && filter.test(row.id));
rmSync(outDirectory, { recursive: true, force: true });
mkdirSync(outDirectory, { recursive: true });

const work = selected.flatMap((row) => levels.map((level) => ({ row, level })));
const deadlineFailure = ({ row, level }) => {
  const input = row.path;
  const source = readFileSync(input, "utf8");
  return {
    id: row.id,
    category: row.category,
    level,
    inBytes: statSync(input).size,
    outBytes: null,
    ms: 0,
    outcome: "not run",
    baselines: { naive: naive(source).length, brotliOriginal: brotli(source), brotliOptimized: null },
    problems: [`not processed because the ${deadlineMinutes}-minute verification deadline was reached`],
    excluded: null,
    browser: false,
    input,
    output: join(outDirectory, `${row.id}.${level}.html`),
  };
};
const results = await pool(work, jobs, async ({ row, level }) => {
  const input = row.path;
  const output = join(outDirectory, `${row.id}.${level}.html`);
  const result = await run([input, output, "--level", level, "--jobs", String(threads), ...octavoArgs]);
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
}, deadlineFailure);

const timing = { original: 0, optimized: 0, compare: 0, cached: 0 };
const browserCache = { hits: 0, misses: 0 };
let browserName = "";
const engineTag = engine.tag;
const browserChecks = {
  scenarios: new Set(),
  totals: { elements: 0, hover: 0, focus: 0, focusVisible: 0, active: 0 },
  unreachable: {
    original: { elements: 0, hover: 0, focus: 0, focusVisible: 0, active: 0 },
    optimized: { elements: 0, hover: 0, focus: 0, focusVisible: 0, active: 0 },
  },
  unreachableDetails: [],
  screenshotLimits: [],
  degraded: [],
};

if (browser) {
  const { closeBrowser, pages, verifyLevels } = await import("./verify.mjs");
  const { browserIdentity } = await import("./verify.mjs");
  const { readVerdict, revalidateVerdict, shouldRevalidate, verdictKey, verifierHash, writeVerdict } = await import("./verdicts.mjs");
  const { formatHeartbeat, formatProgress } = await import("./progress.mjs");
  const verifier = verifierHash();
  console.log(`browser: ${engineNotice()}`);
  const identity = await browserIdentity();
  const documents = [...Map.groupBy(results.filter((entry) => entry.browser), (entry) => entry.input).values()];
  const totalLevels = documents.reduce((acc, entries) => acc + entries.length, 0);
  let doneLevels = 0;
  const inFlight = new Map();
  const heartbeat = setInterval(() => {
    if (inFlight.size === 0) return;
    const items = [...inFlight.values()].map((item) => ({
      id: item.id,
      level: item.level,
      seconds: Math.round((Date.now() - item.startedAt) / 1000),
    }));
    console.log(formatHeartbeat(items, documents.length));
  }, 60_000);
  heartbeat.unref?.();
  const cache = { hits: 0, misses: 0 };
  await pool(documents, pages, async (entries) => {
    const original = entries[0].input;
    const originalBytes = readFileSync(original);
    const plans = [];
    const cachedEntries = [];
    for (const entry of entries) {
      const optimized = sha256(readFileSync(entry.output));
      const key = verdictKey({ original: originalBytes, optimized, level: entry.level, verifier, browser: identity, scenarios: scenarioHash, version: binaryVersion });
      const started = process.hrtime.bigint();
      const verdict = verdictCache ? readVerdict(key) : null;
      timing.cached += Number(process.hrtime.bigint() - started) / 1e6;
      if (verdict) {
        if (!shouldRevalidate(key, revalidatePercent)) {
          entry.cached = true;
          cache.hits += 1;
          cachedEntries.push(entry);
          continue;
        }
        plans.push({ level: entry.level, path: entry.output, key, optimized, revalidate: true });
        cache.hits += 1;
        continue;
      }
      cache.misses += 1;
      plans.push({ level: entry.level, path: entry.output, key, optimized });
    }
    for (const entry of cachedEntries) {
      doneLevels += 1;
      console.log(formatProgress(doneLevels, totalLevels, entry.id, entry.level, 0, true));
    }
    if (!plans.length) return;
    const docId = entries[0].id;
    const docStarted = Date.now();
    inFlight.set(docId, { id: docId, level: plans.map((p) => p.level).join(","), startedAt: docStarted });
    try {
      const measured = await verifyLevels(original, plans.map(({ level, path, optimized }) => ({ level, path, key: optimized })), { deadlineReached });
      timing.original += measured.timing.original;
      timing.optimized += measured.timing.optimized;
      timing.compare += measured.timing.compare;
      const elapsed = Math.round((Date.now() - docStarted) / 1000);
      for (const [at, plan] of plans.entries()) {
        const entry = entries.find((candidate) => candidate.level === plan.level && candidate.output === plan.path);
        const report = measured.reports[at];
        for (const { scenario, checks, optimizedChecks } of report) {
          if (!checks) continue;
          browserChecks.scenarios.add(scenario);
          for (const state of ["elements", "hover", "focus", "focusVisible", "active"]) browserChecks.totals[state] += checks[state] ?? 0;
          for (const [side, captureChecks] of [["original", checks], ["optimized", optimizedChecks]]) {
            if (!captureChecks) continue;
            for (const limit of captureChecks.screenshots?.limits ?? []) {
              browserChecks.screenshotLimits.push({ id: entry.id, scenario, side, ...limit });
            }
            for (const state of ["elements", "hover", "focus", "focusVisible", "active"]) {
              browserChecks.unreachable[side][state] += captureChecks.unreachable?.[state] ?? 0;
            }
            if (captureChecks.unreachable?.details.length) {
              browserChecks.unreachableDetails.push({ id: entry.id, scenario, side, details: captureChecks.unreachable.details });
            }
            const missing = checksOf(captureChecks);
            if (missing.length) browserChecks.degraded.push({ id: entry.id, scenario, side, missing });
          }
        }
        const unfinished = report.some(({ issues }) => issues.some((issue) => issue.includes("verification deadline reached")));
        if (plan.revalidate && !unfinished) {
          try {
            await revalidateVerdict(
              plan.key,
              true,
              async () => report.every(({ scenario, issues }) =>
                plan.level === "packed" && scenario === "no-js"
                  ? !issues.some((issue) => issue.startsWith("check incomplete:") || issue.includes("screenshot missing"))
                  : !issues.length,
              ),
            );
          } catch (error) {
            entry.problems.push(error.message);
          }
        }
        entry.roundedPixels = report.reduce((total, item) => total + item.rounded, 0);
        const issues = [];
        for (const { scenario, issues: found } of report) {
          for (const issue of found) {
            if (entry.level === "packed" && scenario === "no-js" && !issue.startsWith("check incomplete:") && !issue.includes("screenshot missing")) continue;
            issues.push(`${engineTag}${scenario}: ${issue}`);
          }
        }
        entry.problems.push(...issues);
        if (!issues.length && verdictCache) {
          writeVerdict(plan.key, {
            level: plan.level,
            original: sha256(originalBytes),
            optimized: plan.optimized,
            verifier,
            browser: identity,
          });
        }
        doneLevels += 1;
        console.log(formatProgress(doneLevels, totalLevels, entry.id, plan.level, elapsed, false));
      }
    } finally {
      inFlight.delete(docId);
    }
  }, (entries) => {
    cache.misses += entries.length;
    for (const entry of entries) {
      entry.problems.push(`browser comparison not started because the ${deadlineMinutes}-minute verification deadline was reached`);
      doneLevels += 1;
      console.log(formatProgress(doneLevels, totalLevels, entry.id, entry.level, 0, false));
    }
  });
  clearInterval(heartbeat);
  await closeBrowser();
  browserName = identity;
  browserCache.hits = cache.hits;
  browserCache.misses = cache.misses;
}

const measured = results.filter((entry) => !entry.excluded);
const timed = measured.filter((entry) => entry.outBytes !== null);
const large = timed.filter((entry) => entry.inBytes >= RATE_FLOOR_BYTES);
const medianRate = Math.max(median(large.map((entry) => entry.ms / entry.inBytes)), 1e-6);
for (const entry of timed) {
  const allowed = STARTUP_ALLOWANCE_MS + SLOWDOWN_LIMIT * medianRate * entry.inBytes;
  if (entry.ms > allowed && !deadlineReached()) {
    const retry = await run([entry.input, entry.output.replace(/.html$/, ".retry.html"), "--level", entry.level, "--jobs", String(cores), ...octavoArgs]);
    entry.ms = Math.min(entry.ms, retry.ms);
  }
  if (entry.ms > allowed) {
    entry.problems.push(`took ${entry.ms.toFixed(0)} ms, over ${SLOWDOWN_LIMIT}x the corpus median rate (${allowed.toFixed(0)} ms allowed)`);
  }
}

const overall = [...Map.groupBy(
  measured.filter((entry) => entry.outBytes !== null),
  (entry) => entry.level,
)].map(([level, entries]) => {
  const input = entries.reduce((total, entry) => total + entry.inBytes, 0);
  const output = entries.reduce((total, entry) => total + entry.outBytes, 0);
  const seconds = entries.reduce((total, entry) => total + entry.ms, 0) / 1000;
  return `| ${level} | ${entries.length} | ${(input / 1048576).toFixed(1)} | ${(output / 1048576).toFixed(1)} | ${((output / input) * 100).toFixed(1)}% | ${seconds.toFixed(1)} | ${(input / 1048576 / seconds).toFixed(2)} |`;
});

const categories = Map.groupBy(measured, (entry) => `${entry.category} / ${entry.level}`);
const kib = (bytes) => (bytes / 1024).toFixed(1);
const lines = [`# Corpus report`, ``, `Tier ${tier}, ${selected.length} documents, levels ${levels.join(", ")}, browser ${browser ? engineNotice() : "off"}. ${jobs} documents at a time, ${threads} threads each.`, ``];
lines.push(`## Overall by level`, ``, `| Level | Docs | Input MiB | Output MiB | Output as % of input | Octavo seconds | MiB/s |`, `|---|---|---|---|---|---|---|`, ...overall, ``);
if (browser) {
  lines.push(
    `## Browser verification`,
    ``,
    `Scenarios: ${levels.map((level) => `${level}: ${scenariosFor(level).map((scenario) => scenario.name).join(", ")}`).join("; ")}.`,
    ``,
    `| Stage | Seconds |`,
    `|---|---|`,
    `| capture original | ${(timing.original / 1000).toFixed(1)} |`,
    `| capture optimized | ${(timing.optimized / 1000).toFixed(1)} |`,
    `| compare | ${(timing.compare / 1000).toFixed(1)} |`,
    `| cached | ${(timing.cached / 1000).toFixed(1)} |`,
    ``,
    `Verdict cache: ${browserCache.hits} of ${browserCache.hits + browserCache.misses} comparisons served from the cache by ${browserName}.`,
    ``,
  );
}
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
if (browser) {
  const limits = [
    ...(engine.placeholderStyle ? [] : [`${engine.label}: computed style for ::placeholder is unavailable; screenshot pixel comparison remains active.`]),
    ...browserChecks.screenshotLimits.map((entry) =>
      `${entry.id} (${entry.scenario}, ${entry.side}, ${entry.label}): page too large for screenshots limit ${entry.limit} pixels at ${entry.height}px tall (${entry.width}px wide).`,
    ),
  ];
  lines.push(``, `## Limits`, limits.length ? "" : "None.", ...limits.map((limit) => `- ${limit}`));
}
const cachedRows = results.filter((entry) => entry.cached);
lines.push(``, `## Cached verdicts`, cachedRows.length ? "" : "None.");
for (const entry of cachedRows) lines.push(`- ${entry.id} (${entry.level}): cached`);
const total = (timing.original + timing.optimized + timing.compare + timing.cached) / 1000;
lines.push(
  ``,
  `Total browser verification: ${total.toFixed(1)} s for ${browserCache.hits + browserCache.misses} comparisons (${browserCache.hits} cached) by ${browserName}.`,
);
if (browser) {
  const totals = browserChecks.totals;
  lines.push(
    ``,
    `## Browser checks`,
    ``,
    `Engine ${engineNotice()} compared the scenarios ${[...browserChecks.scenarios].join(", ")}.`,
    `Forced hover, focus, focus-visible and active states were checked with real pointer and keyboard events in scenarios with scripts. Hidden and unreachable targets are recorded in the compared state.`,
    `Checked ${totals.elements} elements: hover applied to ${totals.hover}, focus to ${totals.focus}, focus visible to ${totals.focusVisible}, active to ${totals.active}.`,
    ``,
    `Incomplete checks: ${browserChecks.degraded.length ? browserChecks.degraded.length : "none"}.`,
    ...browserChecks.degraded.map((entry) => `- ${entry.id} (${entry.scenario}, ${entry.side}): ${entry.missing.join(", ")}`),
    `Unreachable elements: original ${browserChecks.unreachable.original.elements}, optimized ${browserChecks.unreachable.optimized.elements}.`,
    `Unreachable states: original ${browserChecks.unreachable.original.hover} hover, ${browserChecks.unreachable.original.focus} focus, ${browserChecks.unreachable.original.focusVisible} focus-visible, ${browserChecks.unreachable.original.active} active; optimized ${browserChecks.unreachable.optimized.hover} hover, ${browserChecks.unreachable.optimized.focus} focus, ${browserChecks.unreachable.optimized.focusVisible} focus-visible, ${browserChecks.unreachable.optimized.active} active.`,
    `Unreachable details: ${browserChecks.unreachableDetails.length ? browserChecks.unreachableDetails.length : "none"}.`,
    ...browserChecks.unreachableDetails.map((entry) => `- ${entry.id} (${entry.scenario}, ${entry.side}): ${entry.details.join("; ")}`),
  );
}

writeFileSync(join(outDirectory, "report.md"), `${lines.join("\n")}\n`);
writeFileSync(join(outDirectory, "report.json"), `${JSON.stringify(results.map(({ input, output, ...rest }) => rest), null, 2)}\n`);
console.log(lines.join("\n"));
process.exit(failures.length ? 1 : 0);
