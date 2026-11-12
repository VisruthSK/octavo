import { cpus } from "node:os";
import { launch } from "./browser.mjs";
import { capture, hasInteractions, scenarios } from "./capture.mjs";
import { compare, signature } from "./compare.mjs";

export const pages = Number(process.env.OCTAVO_PAGES ?? Math.max(2, Math.floor(cpus().length / 2)));
const SCENARIOS_AT_ONCE = 3;

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

const lost = (error) => /closed|disconnected|crashed/i.test(error.message);

async function resilient(work) {
  try {
    return await work(await browser());
  } catch (error) {
    if (!lost(error)) throw error;
    return work(await browser());
  }
}

export async function closeBrowser() {
  const open = shared;
  shared = undefined;
  if (open) await (await open).close().catch(() => {});
}

const crashed = (error) => ({ crashed: error.message.slice(0, 200), states: [] });

const eachLimited = async (items, limit, work) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
};

async function confirmed(original, file, scenario, before, after, lossy, interact) {
  const stats = { roundedPixels: 0 };
  const issues = compare(before, after, lossy, stats);
  if (!issues.length) return { issues, rounded: stats.roundedPixels };
  const kept = await slots.using(async () => {
    const [before2, after2] = await Promise.all([
      resilient((open) => capture(open, original, scenario, lossy, { interact })).catch(crashed),
      resilient((open) => capture(open, file, scenario, lossy, { interact })).catch(crashed),
    ]);
    const noise = new Set([...compare(before, before2, lossy), ...compare(after, after2, lossy)].map(signature));
    const reproduced = new Set(compare(before2, after2, lossy).map(signature));
    return issues.filter((issue) => !noise.has(signature(issue)) && reproduced.has(signature(issue)));
  }, pages);
  return { issues: kept, rounded: stats.roundedPixels };
}

export async function verify(original, optimized, { lossy = false } = {}) {
  const files = [optimized].flat();
  const reports = files.map(() => []);
  const interact = await slots.using(() => resilient((open) => hasInteractions(open, original)).catch(() => true));
  const run = (file, scenario) =>
    slots.using(() => resilient((open) => capture(open, file, scenario, lossy, { interact })).catch(crashed));
  await eachLimited(scenarios, SCENARIOS_AT_ONCE, async (scenario) => {
    const [before, ...afters] = await Promise.all([original, ...files].map((file) => run(file, scenario)));
    await Promise.all(
      files.map(async (file, at) => {
        const { issues, rounded } = await confirmed(original, file, scenario, before, afters[at], lossy, interact);
        reports[at].push({ scenario: scenario.name, issues, rounded });
      }),
    );
  });
  const order = (entry) => scenarios.findIndex((scenario) => scenario.name === entry.scenario);
  for (const report of reports) report.sort((a, b) => order(a) - order(b));
  return Array.isArray(optimized) ? reports : reports[0];
}

if (process.argv[1].endsWith("verify.mjs")) {
  const flags = process.argv.slice(2).filter((arg) => arg.startsWith("--"));
  const [original, optimized] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const report = (await verify(original, optimized, { lossy: flags.includes("--lossy") })).filter(
    ({ scenario }) => !(flags.includes("--allow-js-required") && scenario === "no-js"),
  );
  await closeBrowser();
  for (const { scenario, issues } of report) {
    console.log(scenario.padEnd(14), issues.length ? "FAIL" : "ok", ...issues.map((issue) => `\n    ${issue}`));
  }
  process.exit(report.some(({ issues }) => issues.length) ? 1 : 0);
}
