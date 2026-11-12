import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { inShard, readRendered, renderLinked, renderedPath } from "../corpus/upstream.mjs";
import { closeBrowser, verify } from "./verify.mjs";

const root = resolve(import.meta.dirname, "..");
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};
const tier = flag("tier", "smoke");
const level = flag("level", "safe");
const filter = new RegExp(flag("filter", "."));
const browser = process.argv.includes("--browser");
const binary = resolve(flag("binary", join(root, "target", "release", process.platform === "win32" ? "octavo.exe" : "octavo")));
const outDirectory = resolve(flag("out", join(root, "out", "linked")));
const [position, count] = flag("shard", "").split("/").map(Number);
const shard = count ? { index: position - 1, count } : undefined;
const selected = readRendered()
  .filter((entry) => (tier === "full" || entry.tier === tier) && filter.test(entry.id))
  .filter((_, index) => inShard(index, shard));

const wire = (path) =>
  brotliCompressSync(readFileSync(path), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
const octavo = (input, output) => {
  const run = spawnSync(binary, [input, output, "--level", level], { encoding: "utf8" });
  return run.status === 0 ? { size: statSync(output).size, wire: wire(output) } : { error: (run.stderr.trim().split("\n")[0] ?? "").slice(0, 160) };
};

mkdirSync(outDirectory, { recursive: true });
const rows = [];
for (const entry of selected) {
  const directory = join(outDirectory, entry.id);
  const row = { id: entry.id };
  const linked = await renderLinked(entry, directory);
  if (!linked.page) {
    rows.push({ ...row, note: "the linked render failed" });
    continue;
  }
  const embeddedRoute = octavo(renderedPath(entry.id), join(outDirectory, `${entry.id}.from-embedded.html`));
  const linkedOutput = join(outDirectory, `${entry.id}.from-linked.html`);
  const linkedRoute = octavo(linked.page, linkedOutput);
  Object.assign(row, { embeddedRoute, linkedRoute });
  if (linkedRoute.error) row.note = linkedRoute.error;
  else if (browser) {
    const report = await verify(linked.page, linkedOutput, { roots: { original: directory, optimized: outDirectory } });
    const issues = report.flatMap(({ scenario, issues: found }) => found.map((issue) => `${scenario}: ${issue}`));
    row.issues = issues;
  }
  rmSync(directory, { recursive: true, force: true });
  rows.push(row);
  const ratio = row.linkedRoute.size ? (row.linkedRoute.size / row.embeddedRoute.size).toFixed(3) : "-";
  console.log(entry.id.padEnd(64), row.note ? `REFUSED ${row.note}` : `linked/embedded size ${ratio}${row.issues ? (row.issues.length ? `  FAIL ${row.issues[0].slice(0, 100)}` : "  browser ok") : ""}`);
}
if (browser) await closeBrowser();

const worked = rows.filter((row) => row.linkedRoute && !row.note && row.embeddedRoute?.size);
const sum = (key, field) => worked.reduce((total, row) => total + row[key][field], 0);
const lines = [
  `| ${"Documents".padEnd(10)} | Optimized from the embedded render | Optimized from the linked render | Ratio |`,
  "|---|---|---|---|",
  `| ${worked.length} of ${rows.length} (${level}) | ${(sum("embeddedRoute", "size") / 1048576).toFixed(2)} MiB | ${(sum("linkedRoute", "size") / 1048576).toFixed(2)} MiB | ${(sum("linkedRoute", "size") / sum("embeddedRoute", "size")).toFixed(3)} |`,
  "",
  `Brotli: ${(sum("embeddedRoute", "wire") / 1048576).toFixed(2)} MiB against ${(sum("linkedRoute", "wire") / 1048576).toFixed(2)} MiB`,
  "",
  ...rows.filter((row) => row.note).map((row) => `- ${row.id}: ${row.note}`),
  ...rows.filter((row) => row.issues?.length).map((row) => `- ${row.id}: ${row.issues.slice(0, 2).join("; ")}`),
];
writeFileSync(join(outDirectory, "report.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}`);
process.exit(rows.some((row) => row.note || row.issues?.length) ? 1 : 0);
