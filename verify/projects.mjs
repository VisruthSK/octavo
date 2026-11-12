import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { htmlPages, projectEntries, renderProject, scratchDirectory } from "../corpus/projects.mjs";
import { launch } from "./browser.mjs";
import { compareSearch, serve } from "./search.mjs";
import { verifySite } from "./site.mjs";
import { closeBrowser, verify } from "./verify.mjs";

process.env.OCTAVO_VERIFY_OFFLINE ??= "1";

const root = resolve(import.meta.dirname, "..");
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};
const tier = flag("tier", "smoke");
const filter = new RegExp(flag("filter", "."));
const browser = process.argv.includes("--browser");
const [position, count] = flag("shard", "").split("/").map(Number);
const shard = count ? { index: position - 1, count } : undefined;
const binary = resolve(flag("binary", join(root, "target", "release", process.platform === "win32" ? "octavo.exe" : "octavo")));
const outDirectory = resolve(flag("out", join(root, "out", "projects")));
const QUERIES_PER_PROJECT = 4;
const MIN_WORD = 5;

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );
const wire = (bytes) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
const weigh = (files) => files.reduce((total, file) => ({ raw: total.raw + statSync(file).size, wire: total.wire + wire(readFileSync(file)) }), { raw: 0, wire: 0 });
const mib = (bytes) => (bytes / 1048576).toFixed(2);

const octavo = (args) => spawnSync(binary, args, { encoding: "utf8", maxBuffer: 1 << 26 });

function searchQueries(site, expectSearch) {
  const index = join(site, "search.json");
  if (!existsSync(index)) return null;
  const home = join(site, "index.html");
  if (!existsSync(home) || !/id="quarto-search"[\s>]/.test(readFileSync(home, "utf8"))) return null;
  if (expectSearch) return [...expectSearch.found, ...expectSearch.absent];
  const counts = new Map();
  for (const record of JSON.parse(readFileSync(index, "utf8"))) {
    for (const word of `${record.title} ${record.text}`.toLowerCase().match(/[a-z]{5,}/g) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const common = [...counts].filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, QUERIES_PER_PROJECT).map(([word]) => word);
  return [...common, "zzzzqx"];
}

async function interaction(browserInstance, port, spec) {
  const context = await browserInstance.newContext({ viewport: spec.viewport ?? { width: 1200, height: 800 } });
  const page = await context.newPage();
  const failures = [];
  try {
    await page.goto(`http://127.0.0.1:${port}/${spec.page}`, { waitUntil: "networkidle" });
    for (const step of spec.steps) {
      await page.locator(step.click).first().click({ timeout: 10000 });
      await page.waitForTimeout(500);
    }
    for (const expectation of spec.expect) {
      const found = await page.evaluate((e) => {
        const nodes = [...document.querySelectorAll(e.selector)];
        const out = [];
        if (e.exists === true && nodes.length === 0) out.push("no element matches");
        if (e.exists === false && nodes.length > 0) out.push("an element matches");
        if (e.count !== undefined && nodes.length !== e.count) out.push(`${nodes.length} matches, expected ${e.count}`);
        if (e.countAtMost !== undefined && nodes.length > e.countAtMost) out.push(`${nodes.length} matches, expected at most ${e.countAtMost}`);
        const node = nodes[0];
        if (node) {
          if (e.class && !node.classList.contains(e.class)) out.push(`lacks class ${e.class}`);
          if (e.notClass && node.classList.contains(e.notClass)) out.push(`has class ${e.notClass}`);
          if (e.attr && node.getAttribute(e.attr[0]) !== e.attr[1]) out.push(`${e.attr[0]} is ${node.getAttribute(e.attr[0])}, expected ${e.attr[1]}`);
          if (e.computed && !String(getComputedStyle(node)[e.computed[0]]).includes(e.computed[1])) out.push(`${e.computed[0]} is ${getComputedStyle(node)[e.computed[0]]}, expected ${e.computed[1]}`);
          if (e.text && !node.textContent.includes(e.text)) out.push(`text lacks ${e.text}`);
        }
        if (e.loaded) for (const image of nodes) if (!(image.complete && image.naturalWidth > 0)) out.push("an image did not load");
        return out;
      }, expectation);
      for (const message of found) failures.push(`${spec.name}: ${expectation.selector}: ${message}`);
    }
  } catch (error) {
    failures.push(`${spec.name}: ${String(error.message).split("\n")[0]}`);
  }
  await context.close();
  return failures;
}

async function behaviour(normal, site, expect) {
  const problems = [];
  const instance = await launch();
  const queries = searchQueries(normal, expect.search);
  if (queries) {
    let before = null;
    try {
      const compared = await compareSearch(instance, normal, site, queries);
      problems.push(...compared.issues);
      before = compared.before;
    } catch (error) {
      problems.push(`search: ${String(error.message).split("\n")[0]}`);
    }
    if (before) {
      for (const query of expect.search?.found ?? []) if (!(before[query]?.length > 0)) problems.push(`spec: "${query}" finds nothing in the normal site`);
      for (const query of expect.search?.absent ?? []) if (before[query]?.length > 0) problems.push(`spec: "${query}" finds results in the normal site`);
      if (!expect.search && !queries.slice(0, -1).some((query) => before[query]?.length > 0)) problems.push("none of the default search queries found anything in the normal site");
    }
  } else if (expect.search) {
    problems.push("spec: the project has search expectations but the normal site has no search");
  }
  const [a, b] = await Promise.all([serve(normal), serve(site)]);
  for (const spec of expect.interactions ?? []) {
    const original = await interaction(instance, a.port, spec);
    for (const failure of original) problems.push(`spec invalid on the normal site: ${failure}`);
    if (original.length) continue;
    for (const failure of await interaction(instance, b.port, spec)) problems.push(`site mode broke: ${failure}`);
  }
  a.server.close();
  b.server.close();
  await instance.close();
  return problems;
}

function assertSpec(normal, site, expect, entry, pages) {
  const problems = [];
  const expectedPages = expect.pages ?? entry.pages;
  if (pages.length !== expectedPages) problems.push(`spec: ${pages.length} pages rendered, expected ${expectedPages}`);
  for (const file of expect.files ?? []) if (!existsSync(join(normal, file))) problems.push(`spec: ${file} is missing from the normal site`);
  for (const file of expect.site?.present ?? []) if (!existsSync(join(site, file))) problems.push(`site mode: ${file} is missing`);
  for (const file of expect.site?.absent ?? []) if (existsSync(join(site, file))) problems.push(`site mode: ${file} should have been dropped`);
  const css = (directory) => walk(directory).filter((file) => file.endsWith(".css")).map((file) => readFileSync(file, "utf8")).join("\n");
  const before = css(normal);
  const after = css(site);
  for (const selector of expect.prune?.removed ?? []) {
    if (!before.includes(selector)) problems.push(`spec: ${selector} is not in the normal site's CSS`);
    else if (after.includes(selector)) problems.push(`site mode kept ${selector}`);
  }
  for (const selector of expect.prune?.kept ?? []) if (!after.includes(selector)) problems.push(`site mode lost ${selector}`);
  return problems;
}

rmSync(outDirectory, { recursive: true, force: true });
mkdirSync(outDirectory, { recursive: true });
const entries = await projectEntries({ tier, shard, filter });
const rows = [];
for (const entry of entries) {
  const row = { id: entry.id, kind: entry.kind, problems: [] };
  rows.push(row);
  const expect = entry.expect ?? {};
  const assets = entry.assets ? await entry.assets() : undefined;
  const rendered = await renderProject(entry.directory, join(scratchDirectory, entry.id), assets);
  if (!rendered.ok || !rendered.output) {
    row.problems.push(`quarto failed to render${rendered.timedOut ? " (timed out)" : ""}: ${rendered.log.trim().split("\n").at(-1).slice(0, 200)}`);
    console.log(entry.id.padEnd(60), "RENDER FAILED");
    continue;
  }
  const normal = rendered.output;
  const pages = htmlPages(normal);
  const site = join(outDirectory, entry.id, "site");
  mkdirSync(dirname(site), { recursive: true });
  const siteRun = octavo([normal, site]);
  if (siteRun.status !== 0) {
    row.problems.push(`site mode failed: ${siteRun.stderr.trim().split("\n").at(-1)}`);
    console.log(entry.id.padEnd(60), "SITE MODE FAILED");
    continue;
  }
  row.problems.push(...assertSpec(normal, site, expect, entry, pages));
  const linkedDirectory = join(outDirectory, entry.id, "pages");
  mkdirSync(linkedDirectory, { recursive: true });
  const standalone = [];
  for (const page of pages) {
    const target = join(linkedDirectory, page);
    mkdirSync(dirname(target), { recursive: true });
    const run = octavo([join(normal, page), target, "--level", "safe", "--no-fetch"]);
    if (run.status !== 0) row.problems.push(`standalone ${page}: ${run.stderr.trim().split("\n").at(0)?.slice(0, 200)}`);
    else {
      standalone.push(target);
      const embedded = readFileSync(target, "utf8");
      for (const text of expect.linked?.contains ?? []) if (!embedded.includes(text)) row.problems.push(`linked ${page}: does not contain ${text}`);
      for (const text of expect.linked?.absent ?? []) if (embedded.includes(text)) row.problems.push(`linked ${page}: contains ${text}`);
    }
  }
  const normalFiles = walk(normal);
  Object.assign(row, { pages: pages.length, normal: weigh(normalFiles), site: weigh(walk(site)), standalone: weigh(standalone) });
  if (browser) {
    row.problems.push(...(await behaviour(normal, site, expect)));
    for (const { page, issues } of await verifySite(normal, site)) for (const issue of issues.slice(0, 2)) row.problems.push(`site ${page}: ${issue.slice(0, 200)}`);
    for (const page of pages) {
      if (!existsSync(join(linkedDirectory, page))) continue;
      const environment = join(outDirectory, entry.id, "environment");
      rmSync(environment, { recursive: true, force: true });
      cpSync(normal, environment, { recursive: true });
      cpSync(join(linkedDirectory, page), join(environment, page));
      const scenarios = await verify(join(normal, page), join(environment, page), { linked: true, roots: { original: normal, optimized: environment } });
      for (const { scenario, issues } of scenarios) for (const issue of issues.slice(0, 1)) row.problems.push(`standalone ${page}: ${scenario}: ${issue.slice(0, 200)}`);
    }
  }
  rmSync(join(scratchDirectory, entry.id), { recursive: true, force: true });
  console.log(entry.id.padEnd(60), row.problems.length ? `FAIL (${row.problems.length})` : "ok");
  for (const problem of row.problems.slice(0, 4)) console.log(`    ${problem.slice(0, 240)}`);
}
if (browser) await closeBrowser();

const measured = rows.filter((row) => row.normal);
const lines = [
  "# Project corpus report",
  "",
  `Tier ${tier}, ${rows.length} projects, browser ${browser ? "on" : "off"}. Sizes are the whole output directory, raw and Brotli quality 5. Standalone is the sum of every page optimized on its own from the normal render.`,
  "",
  "| Project | Pages | Normal MiB | Site mode MiB | Site mode Brotli / normal | Standalone MiB | Problems |",
  "|---|---|---|---|---|---|---|",
  ...measured.map(
    (row) =>
      `| ${row.id} | ${row.pages} | ${mib(row.normal.raw)} | ${mib(row.site.raw)} | ${(row.site.wire / row.normal.wire).toFixed(2)} | ${mib(row.standalone.raw)} | ${row.problems.length} |`,
  ),
  "",
];
for (const row of rows.filter((entry) => entry.problems.length)) lines.push(`## ${row.id}`, "", ...row.problems.map((problem) => `- ${problem}`), "");
writeFileSync(join(outDirectory, "report.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.slice(0, 4 + measured.length + 4).join("\n")}`);
process.exit(rows.some((row) => row.problems.length) ? 1 : 0);
