import { launch } from "./browser.mjs";
import { capture, scenarios } from "./capture.mjs";
import { compare, signature } from "./compare.mjs";

const MAX_PAGES = Number(process.env.OCTAVO_PAGES ?? 4);

const limit = (size) => {
  const waiting = [];
  let free = size;
  return async (task) => {
    while (free === 0) await new Promise((resolve) => waiting.push(resolve));
    free--;
    try {
      return await task();
    } finally {
      free++;
      waiting.shift()?.();
    }
  };
};

export async function verify(original, optimized, { lossy = false } = {}) {
  const browser = await launch({ args: ["--allow-file-access-from-files"] });
  const gate = limit(MAX_PAGES);
  try {
    return await Promise.all(
      scenarios.map(async (scenario) => {
        const run = (file) =>
          gate(() => capture(browser, file, scenario, lossy)).catch((error) => ({ crashed: error.message.slice(0, 200), states: [] }));
        const [before, after] = await Promise.all([run(original), run(optimized)]);
        let issues = compare(before, after, lossy);
        if (issues.length) {
          const [before2, after2] = await Promise.all([run(original), run(optimized)]);
          const noise = new Set([...compare(before, before2, lossy), ...compare(after, after2, lossy)].map(signature));
          const reproduced = new Set(compare(before2, after2, lossy).map(signature));
          issues = issues.filter((issue) => !noise.has(signature(issue)) && reproduced.has(signature(issue)));
        }
        return { scenario: scenario.name, issues };
      }),
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1].endsWith("verify.mjs")) {
  const flags = process.argv.slice(2).filter((arg) => arg.startsWith("--"));
  const [original, optimized] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const report = (await verify(original, optimized, { lossy: flags.includes("--lossy") })).filter(
    ({ scenario }) => !(flags.includes("--allow-js-required") && scenario === "no-js"),
  );
  for (const { scenario, issues } of report) {
    console.log(scenario.padEnd(14), issues.length ? "FAIL" : "ok", ...issues.map((issue) => `\n    ${issue}`));
  }
  process.exit(report.some(({ issues }) => issues.length) ? 1 : 0);
}
