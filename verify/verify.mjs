import { cpus } from "node:os";
import { capture, hasInteractions, scenariosFor } from "./capture.mjs";
import { compare, signature } from "./compare.mjs";
import { checksOf, engine, engineNotice, launch } from "./engines/index.mjs";

const wanted = Number(process.env.OCTAVO_PAGES ?? Math.max(2, Math.floor(cpus().length / 2)));
const isolated = engine.isolated;
export const pages = isolated ? Math.min(wanted, 4) : wanted;

class Slots {
  free = pages;
  waiting = [];
  exclusive = 0;

  async take(count = 1) {
    while (this.free < count || (this.exclusive > 0 && count < pages)) {
      await new Promise((wake) => this.waiting.push(wake));
    }
    this.free -= count;
  }

  give(count = 1) {
    this.free += count;
    for (const wake of this.waiting.splice(0)) wake();
  }

  async using(task, count = 1) {
    if (count === pages) this.exclusive += 1;
    await this.take(count);
    if (count === pages) this.exclusive -= 1;
    try {
      return await task();
    } finally {
      this.give(count);
    }
  }
}

const slots = new Slots();
let shared;
const browser = () => {
  if (!shared) {
    const launching = launch({ args: ["--allow-file-access-from-files", "--disable-dev-shm-usage"] }).then((open) => {
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
  const open = await launch();
  const entry = { open, busy: true };
  pool.push(entry);
  return { open, release: async () => { entry.busy = false; } };
}

const lost = (error) => /closed|disconnected|crashed/i.test(error.message);

export async function closeBrowser() {
  const open = shared;
  shared = undefined;
  if (open) await (await open).close().catch(() => {});
  for (const entry of pool.splice(0)) await entry.open.close().catch(() => {});
}

export async function browserIdentity() {
  const held = await acquire();
  try {
    return engine.identity(held.open);
  } finally {
    await held.release();
  }
}

const crashed = (error) => ({ crashed: error.message.slice(0, 200), states: [] });

const RECAPTURES = 3;
const COMPARISON_TIMEOUT_MS = 120_000;

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
      if (!lost(error) || attempt > 0) throw error;
    } finally {
      await held.release();
    }
  }
}

async function confirmed(original, file, scenario, before, after, lossy, interact, sweep, isDeadlineReached) {
  const stats = { roundedPixels: 0 };
  const issues = compare(before, after, lossy, stats);
  if (!issues.length || issues.some((issue) => issue.includes("capture timed out"))) return { issues, rounded: stats.roundedPixels };
  const kept = await slots.using(async () => {
    const pairs = [{ before, after }];
    for (let round = 0; round < RECAPTURES; round++) {
      if (isDeadlineReached()) return [...issues, "verification deadline reached during document comparison"];
      const patient = round > 0;
      const [again, optimizedAgain] = await Promise.all([
        take(original, scenario, lossy, { interact, patient }).catch(crashed),
        take(file, scenario, lossy, { interact, patient }).catch(crashed),
      ]);
      if ([again.crashed, optimizedAgain.crashed].some((message) => message?.includes("capture timed out"))) {
        return ["capture timed out during confirmation"];
      }
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
    return issues.filter((issue) => {
      const key = signature(issue);
      return across.every((set) => set.has(key)) && within.every((set) => !set.has(key));
    });
  }, pages);
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

export async function verifyLevels(original, entries, { lossy = false, deadlineReached = () => false } = {}) {
  const plans = entries.map((entry) => ({ ...entry, set: scenariosFor(entry.level).filter(({ name }) => !entry.only || entry.only.includes(name)) }));
  const groups = [...Map.groupBy(plans, (plan) => plan.key ?? plan.path).values()];
  const reports = plans.map(() => []);
  const timing = { original: 0, optimized: 0, compare: 0 };
  const interact = await slots.using(async () => {
    const held = await acquire();
    try {
      return await hasInteractions(held.open, original);
    } finally {
      await held.release();
    }
  }).catch(() => true);
  const run = (file, scenario) =>
    slots.using(async () => {
      try {
        return await withTimeout(
          () => take(file, scenario, lossy, { interact }),
          COMPARISON_TIMEOUT_MS,
          closeBrowser,
        );
      } catch (error) {
        return crashed(error);
      }
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
  for (const [scenarioAt, scenario] of scenarios.entries()) {
    if (deadlineReached()) {
      failRemainder(scenarioAt, "verification deadline reached before document comparison");
      break;
    }
    const startedOriginal = process.hrtime.bigint();
    const before = await run(original, scenario);
    timing.original += elapsed(startedOriginal);
    if (before.crashed?.includes("capture timed out")) {
      failRemainder(scenarioAt, before.crashed);
      break;
    }
    if (deadlineReached()) {
      failRemainder(scenarioAt, "verification deadline reached before optimized capture");
      break;
    }
    let stopped = false;
    for (const group of groups) {
      const wanted = group.filter((plan) => plan.set.some((entry) => entry.name === scenario.name));
      if (!wanted.length) continue;
      const sweep = wanted.some((plan) => plan.set.some((entry) => entry.name === scenario.name && entry.sweep));
      const startedOptimized = process.hrtime.bigint();
      const after = await run(group[0].path, { ...scenario, sweep });
      timing.optimized += elapsed(startedOptimized);
      if (after.crashed?.includes("capture timed out")) {
        failRemainder(scenarioAt, after.crashed);
        stopped = true;
        break;
      }
      if (deadlineReached()) {
        failRemainder(scenarioAt, "verification deadline reached before comparison");
        stopped = true;
        break;
      }
      for (const plan of wanted) {
        const entry = plan.set.find((candidate) => candidate.name === scenario.name);
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
        );
        timing.compare += elapsed(startedCompare);
        reports[plans.indexOf(plan)].push({ scenario: scenario.name, issues, rounded, checks: before.checks });
        if (issues.some((issue) => issue.includes("capture timed out") || issue.includes("verification deadline reached"))) {
          failRemainder(scenarioAt, issues.find((issue) => issue.includes("capture timed out") || issue.includes("verification deadline reached")));
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
    if (stopped) break;
  }
  const order = orderOf(plans);
  for (const report of reports) {
    report.sort((left, right) => order.indexOf(left.scenario) - order.indexOf(right.scenario));
  }
  return { reports, timing };
}

export async function verify(original, optimized, { lossy = false, level = "safe", only } = {}) {
  const files = [optimized].flat();
  const { reports } = await verifyLevels(
    original,
    files.map((path) => ({ level, path, only })),
    { lossy },
  );
  return Array.isArray(optimized) ? reports : reports[0];
}

if (process.argv[1].endsWith("verify.mjs")) {
  const flags = process.argv.slice(2).filter((arg) => arg.startsWith("--"));
  const [original, optimized] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const report = (await verify(original, optimized, { lossy: flags.includes("--lossy") })).filter(
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
