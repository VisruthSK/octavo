import { cpus } from "node:os";
import { relative } from "node:path";
import { readFileSync } from "node:fs";
import { captureKey, cachedCapture } from "./capture-cache.mjs";
import { capture, hasInteractions, scenariosFor } from "./capture.mjs";
import { compare, signature } from "./compare.mjs";
import { checksOf, engine, engineNotice, launch, withIncompleteCheckIssues } from "./engines/index.mjs";
import { worthRetrying } from "./transient.mjs";
import { verifierHash } from "./verdicts.mjs";

const configuredPages = process.env.OCTAVO_PAGES;
const wanted = configuredPages === undefined ? Math.max(2, cpus().length) : Number(configuredPages);
if (!Number.isInteger(wanted) || wanted < 1) throw new Error(`OCTAVO_PAGES must be a positive integer, got "${configuredPages}"`);
const isolated = engine.isolated;
export const pages = isolated ? Math.min(wanted, 4) : wanted;

export class Slots {
  capacity = pages;
  running = 0;
  priorityQueue = [];
  queue = [];

  take(onWait = () => {}, priority = false) {
    if (this.running < this.capacity) {
      this.running++;
      onWait(0);
      return Promise.resolve();
    }
    const started = process.hrtime.bigint();
    return new Promise((wake) => {
      const entry = {
        run: () => {
          this.running++;
          onWait(Number(process.hrtime.bigint() - started) / 1e6);
          wake();
        },
      };
      if (priority) this.priorityQueue.push(entry);
      else this.queue.push(entry);
    });
  }

  give(count = 1) {
    this.running -= count;
    while (this.running < this.capacity && (this.priorityQueue.length > 0 || this.queue.length > 0)) {
      const entry = this.priorityQueue.length > 0 ? this.priorityQueue.shift() : this.queue.shift();
      entry.run();
    }
  }

  async using(task, count = 1, onWait = () => {}, priority = false) {
    await this.take(onWait, priority);
    try {
      return await task();
    } finally {
      this.give(count);
    }
  }
}

const slots = new Slots();
let shared;
const launchOptions = { args: ["--allow-file-access-from-files", "--disable-dev-shm-usage"] };
const browser = () => {
  if (!shared) {
    const launching = launch(launchOptions).then((open) => {
      open.on("disconnected", () => {
        if (shared === launching) shared = undefined;
      });
      return open;
    });
    shared = launching;
  }
  return shared;
};

const pool = [];

async function acquire() {
  if (!isolated) return { open: await browser(), release: async () => {} };
  const idle = pool.find((entry) => !entry.busy && entry.open.isConnected());
  if (idle) {
    idle.busy = true;
    return { open: idle.open, release: async () => { idle.busy = false; } };
  }
  const open = await launch(launchOptions);
  const entry = { open, busy: true };
  pool.push(entry);
  return { open, release: async () => { entry.busy = false; } };
}


export async function closeBrowser() {
  const open = shared;
  shared = undefined;
  if (open) await (await open).close().catch(() => {});
  for (const entry of pool.splice(0)) await entry.open.close().catch(() => {});
}

export async function browserIdentity() {
  const held = await acquire();
  try {
    return engine.identity(held.open, launchOptions);
  } finally {
    await held.release();
  }
}

const crashed = (error) => ({ crashed: error.message, states: [] });

let engineIdentity;
const captureIdentity = () => (engineIdentity ??= browserIdentity());

const RECAPTURES = 3;
const COMPARISON_TIMEOUT_MS = 660_000;

export async function withTimeout(task, milliseconds, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(async () => {
          await onTimeout();
          reject(new Error(`comparison timed out after ${milliseconds} ms`));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const withoutSweep = (result) => ({
  ...result,
  states: result.base?.states ?? result.states.slice(0, 1),
  errors: result.base?.errors ?? result.errors,
  requests: result.base?.requests ?? result.requests,
});

const view = (result, sweep) => (sweep ? result : withoutSweep(result));

async function take(file, scenario, lossy, options) {
  for (let attempt = 0; ; attempt++) {
    const held = await acquire();
    try {
      return await capture(held.open, file, scenario, lossy, options);
    } catch (error) {
      if (!worthRetrying(error, attempt)) throw error;
    } finally {
      await held.release();
    }
  }
}

async function confirmed(original, file, scenario, before, after, lossy, interact, sweep, isDeadlineReached, rootFor, linked, metrics, entryPath) {
  const stats = { roundedPixels: 0 };
  const issues = compare(before, after, lossy, stats);
  if (before.crashed || after.crashed || !issues.length || issues.some((issue) => issue.includes("capture timed out") || issue.includes("screenshot missing"))) {
    return { issues, rounded: stats.roundedPixels };
  }
  const pairs = [{ before, after }];
  for (let round = 0; round < RECAPTURES; round++) {
    if (isDeadlineReached()) return { issues: [...issues, "verification deadline reached during document comparison"], rounded: stats.roundedPixels };
    metrics.recaptures += 1;
    const patient = round > 0;
    const [again, optimizedAgain] = await Promise.all([
      slots.using(
        () => take(original, scenario, lossy, { interact, patient, root: rootFor?.(original), linked, entryPath, onPhase: metrics.phase("confirmation original") }).catch(crashed),
        1,
        (ms) => { metrics.confirmationWait += ms; },
        true,
      ),
      slots.using(
        () => take(file, scenario, lossy, { interact, patient, root: rootFor?.(file), linked, entryPath, onPhase: metrics.phase("confirmation optimized") }).catch(crashed),
        1,
        (ms) => { metrics.confirmationWait += ms; },
        true,
      ),
    ]);
    if (again.crashed || optimizedAgain.crashed) return { issues: compare(again, optimizedAgain, lossy), rounded: stats.roundedPixels };
    pairs.push({ before: view(again, sweep), after: view(optimizedAgain, sweep) });
    if (!compare(view(again, sweep), view(optimizedAgain, sweep), lossy).length) break;
  }
  const seen = (left, right) => new Set(compare(left, right, lossy).map(signature));
  const across = pairs.map((pair) => seen(pair.before, pair.after));
  const within = [];
  for (const side of ["before", "after"]) {
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) within.push(seen(pairs[i][side], pairs[j][side]));
    }
  }
  const kept = issues.filter((issue) => {
    const key = signature(issue);
    return across.every((set) => set.has(key)) && within.every((set) => !set.has(key));
  });
  return { issues: kept, rounded: stats.roundedPixels };
}

const elapsed = (started) => Number(process.hrtime.bigint() - started) / 1e6;

const unionOf = (plans) => {
  const union = new Map();
  for (const plan of plans) {
    for (const scenario of plan.set) {
      const known = union.get(scenario.name);
      union.set(scenario.name, { ...scenario, sweep: Boolean(known?.sweep || scenario.sweep) });
    }
  }
  return [...union.values()];
};

const orderOf = (plans) => unionOf(plans).map((scenario) => scenario.name);

export async function verifyLevels(original, entries, { lossy = false, deadlineReached = () => false, roots, linked = false, captureCache = false } = {}) {
  const rootFor = (file) => (roots ? (file === original ? roots.original : roots.optimized) : undefined);
  const entryPath = roots ? relative(roots.original, original) : undefined;
  const plans = entries.map((entry) => ({ ...entry, set: scenariosFor(entry.level).filter(({ name }) => !entry.only || entry.only.includes(name)) }));
  const planIndex = new Map(plans.map((plan, index) => [plan, index]));
  const groups = [...Map.groupBy(plans, (plan) => plan.key ?? plan.path).values()];
  const reports = plans.map(() => []);
  const timing = { original: 0, optimized: 0, compare: 0, captureCache: { hits: 0, misses: 0 } };
  const caching = captureCache && !linked;
  const source = caching ? readFileSync(original) : null;
  const identity = caching ? await captureIdentity() : "";
  const verifier = caching ? verifierHash() : "";
  const interact = await slots.using(async () => {
    const held = await acquire();
    try {
      return await hasInteractions(held.open, original, rootFor(original));
    } finally {
      await held.release();
    }
  }, 1, () => {}, true).catch(() => true);
  const keyFor = (scenario) =>
    captureKey({
      original: source,
      scenario: scenario.name,
      engine: identity,
      verifier,
      interactions: JSON.stringify({
        interact,
        linked,
        lossy,
        root: rootFor(original) ?? null,
        sweep: Boolean(scenario.sweep),
      }),
    });
  const scenarios = unionOf(plans);
  const failRemainder = (from, reason) => {
    for (const [index, plan] of plans.entries()) {
      for (const entry of plan.set) {
        const scenarioIndex = scenarios.findIndex((scenario) => scenario.name === entry.name);
        if (scenarioIndex < from || reports[index].some((report) => report.scenario === entry.name)) continue;
        reports[index].push({ scenario: entry.name, issues: [reason], rounded: 0 });
      }
    }
  };

  const makePhase = (target, side) => {
    let previous, started;
    return (next) => {
      const now = process.hrtime.bigint();
      if (previous) target[`${side}: ${previous}`] = (target[`${side}: ${previous}`] ?? 0) + Number(now - started) / 1e6;
      previous = next;
      started = now;
    };
  };

  const tasks = [];
  let stoppedReason = null;

  for (const [scenarioAt, scenario] of scenarios.entries()) {
    if (deadlineReached()) {
      failRemainder(scenarioAt, "verification deadline reached before document comparison");
      break;
    }
    let origWait = 0;
    const origPhases = {};
    const beforePromise = slots.using(async () => {
      if (stoppedReason) return { crashed: stoppedReason };
      if (deadlineReached()) return { crashed: "verification deadline reached before document comparison" };
      const startedOriginal = process.hrtime.bigint();
      const options = { interact, root: rootFor(original), linked, entryPath, onPhase: makePhase(origPhases, "original") };
      try {
        const before = await withTimeout(
          async () => {
            if (!caching) return await take(original, scenario, lossy, options);
            const outcome = await cachedCapture({ key: keyFor(scenario), capture: () => take(original, scenario, lossy, options) });
            timing.captureCache[outcome.cached ? "hits" : "misses"] += 1;
            return outcome.result;
          },
          COMPARISON_TIMEOUT_MS,
          closeBrowser,
        );
        timing.original += elapsed(startedOriginal);
        return before;
      } catch (error) {
        return crashed(error);
      }
    }, 1, (ms) => { origWait += ms; });

    for (const group of groups) {
      const wanted = group.filter((plan) => plan.set.some((entry) => entry.name === scenario.name));
      if (!wanted.length) continue;
      const sweep = wanted.some((plan) => plan.set.some((entry) => entry.name === scenario.name && entry.sweep));
      let optWait = 0;
      const optPhases = {};
      const afterPromise = slots.using(async () => {
        if (stoppedReason) return { crashed: stoppedReason };
        if (deadlineReached()) return { crashed: "verification deadline reached before optimized capture" };
        const startedOptimized = process.hrtime.bigint();
        const options = { interact, root: rootFor(group[0].path), linked, entryPath, onPhase: makePhase(optPhases, "optimized") };
        try {
          const after = await withTimeout(
            () => take(group[0].path, { ...scenario, sweep }, lossy, options),
            COMPARISON_TIMEOUT_MS,
            closeBrowser,
          );
          timing.optimized += elapsed(startedOptimized);
          return after;
        } catch (error) {
          return crashed(error);
        }
      }, 1, (ms) => { optWait += ms; });

      tasks.push(
        Promise.all([beforePromise, afterPromise]).then(async ([before, after]) => {
          if (before.crashed?.includes("capture timed out")) {
            stoppedReason ??= before.crashed;
            for (const plan of wanted) {
              if (!reports[planIndex.get(plan)].some((r) => r.scenario === scenario.name)) {
                reports[planIndex.get(plan)].push({ scenario: scenario.name, issues: [before.crashed], rounded: 0 });
              }
            }
            failRemainder(scenarioAt, before.crashed);
            return;
          }
          if (after.crashed?.includes("capture timed out")) {
            stoppedReason ??= after.crashed;
            for (const plan of wanted) {
              if (!reports[planIndex.get(plan)].some((r) => r.scenario === scenario.name)) {
                reports[planIndex.get(plan)].push({ scenario: scenario.name, issues: [after.crashed], rounded: 0 });
              }
            }
            failRemainder(scenarioAt, after.crashed);
            return;
          }
          if (deadlineReached()) {
            stoppedReason ??= "verification deadline reached before comparison";
            for (const plan of wanted) {
              if (!reports[planIndex.get(plan)].some((r) => r.scenario === scenario.name)) {
                reports[planIndex.get(plan)].push({ scenario: scenario.name, issues: ["verification deadline reached before comparison"], rounded: 0 });
              }
            }
            failRemainder(scenarioAt, "verification deadline reached before comparison");
            return;
          }
          for (const plan of wanted) {
            if (reports[planIndex.get(plan)].some((r) => r.scenario === scenario.name)) continue;
            const entry = plan.set.find((candidate) => candidate.name === scenario.name);
            const metrics = {
              slotWait: origWait + optWait,
              confirmationWait: 0,
              recaptures: 0,
              phases: { ...origPhases, ...optPhases },
              phase(side) {
                let previous, started;
                return (next) => {
                  const now = process.hrtime.bigint();
                  if (previous) this.phases[`${side}: ${previous}`] = (this.phases[`${side}: ${previous}`] ?? 0) + Number(now - started) / 1e6;
                  previous = next;
                  started = now;
                };
              },
            };
            const startedCompare = process.hrtime.bigint();
            const { issues, rounded } = await confirmed(
              original,
              group[0].path,
              { ...scenario, sweep: entry.sweep },
              view(before, entry.sweep),
              view(after, entry.sweep),
              lossy,
              interact,
              entry.sweep,
              deadlineReached,
              rootFor,
              linked,
              metrics,
              entryPath,
            );
            timing.compare += elapsed(startedCompare);
            reports[planIndex.get(plan)].push({
              scenario: scenario.name,
              issues: withIncompleteCheckIssues(issues, before.checks, after.checks),
              rounded,
              metrics: structuredClone({ slotWait: metrics.slotWait, confirmationWait: metrics.confirmationWait, recaptures: metrics.recaptures, phases: metrics.phases }),
              checks: before.checks,
              optimizedChecks: after.checks,
            });
            if (issues.some((issue) => issue.includes("capture timed out") || issue.includes("verification deadline reached"))) {
              const matched = issues.find((issue) => issue.includes("capture timed out") || issue.includes("verification deadline reached"));
              stoppedReason ??= matched;
              failRemainder(scenarioAt, matched);
              break;
            }
          }
        }),
      );
    }
  }
  await Promise.all(tasks);
  const order = orderOf(plans);
  const orderMap = new Map(order.map((name, index) => [name, index]));
  for (const report of reports) {
    report.sort((left, right) => orderMap.get(left.scenario) - orderMap.get(right.scenario));
  }
  return { reports, timing };
}

export async function verify(original, optimized, { lossy = false, level = "serve", only, roots, linked = false, captureCache = false } = {}) {
  const files = [optimized].flat();
  const { reports } = await verifyLevels(
    original,
    files.map((path) => ({ level, path, only })),
    { lossy, roots, linked, captureCache },
  );
  return Array.isArray(optimized) ? reports : reports[0];
}

if (process.argv[1].endsWith("verify.mjs")) {
  const flags = process.argv.slice(2).filter((arg) => arg.startsWith("--"));
  const [original, optimized] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const report = (await verify(original, optimized, { lossy: flags.includes("--lossy"), captureCache: !flags.includes("--no-capture-cache") })).filter(
    ({ scenario }) => !(flags.includes("--allow-js-required") && scenario === "no-js"),
  );
  await closeBrowser();
  console.log(engineNotice());
  for (const { scenario, issues } of report) {
    console.log(scenario.padEnd(14), issues.length ? "FAIL" : "ok", ...issues.map((issue) => `\n    ${issue}`));
  }
  for (const { scenario, checks } of report) {
    for (const text of checksOf(checks)) console.log(`${scenario}: degraded, ${text}`);
  }
  process.exit(report.some(({ issues }) => issues.length) ? 1 : 0);
}
