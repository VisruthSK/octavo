import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import { launch } from "./browser.mjs";
import { capture, scenarios } from "./capture.mjs";
import { differences } from "./compare.mjs";
import { engineNotice } from "./engines.mjs";
import { readManifest } from "../corpus/build.mjs";

const root = resolve(import.meta.dirname, "..");
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};
const limit = Number(flag("limit", 8));
const outDirectory = resolve(flag("out", join(root, "out", "noise")));
const wanted = scenarios.filter((scenario) => scenario.pixels || scenario.name === "mobile");

const rows = readManifest()
  .filter((row) => row.tier === "smoke" && row.browser)
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, limit);

mkdirSync(outDirectory, { recursive: true });
const options = { args: ["--allow-file-access-from-files", "--disable-dev-shm-usage"] };
let browser = await launch(options);
const measurements = [];
const failures = [];
for (const row of rows) {
  const file = join(root, "corpus", ".cache", "docs", `${row.id}.html`);
  for (const scenario of wanted) {
    try {
      const first = await capture(browser, file, scenario, false, { interact: false });
      const second = await capture(browser, file, scenario, false, { interact: false });
      const left = PNG.sync.read(first.states[0].screenshot);
      const right = PNG.sync.read(second.states[0].screenshot);
      const { count, different, max } = differences(left, right);
      measurements.push({ id: row.id, scenario: scenario.name, pixels: left.width * left.height, count, different, max });
      console.log(row.id.padEnd(48), scenario.name.padEnd(14), `${count} differing, ${different} different, max ${max}`);
    } catch (error) {
      failures.push({ id: row.id, scenario: scenario.name, error: error.message.slice(0, 160) });
      console.log(row.id.padEnd(48), scenario.name.padEnd(14), `failed: ${error.message.slice(0, 120)}`);
      if (!browser.isConnected()) browser = await launch(options);
    }
  }
}
await browser.close();

const total = measurements.reduce((sum, entry) => sum + entry.pixels, 0);
const noise = {
  engine: engineNotice(),
  documents: measurements.length,
  pixels: total,
  differing: measurements.reduce((sum, entry) => sum + entry.count, 0),
  different: measurements.reduce((sum, entry) => sum + entry.different, 0),
  max: Math.max(0, ...measurements.map((entry) => entry.max)),
};
writeFileSync(join(outDirectory, "noise.json"), `${JSON.stringify({ noise, measurements, failures }, null, 2)}\n`);
console.log(`\n${engineNotice()}: ${noise.differing} differing pixels and ${noise.different} different pixels of ${total}, max channel delta ${noise.max}, ${failures.length} failed`);
