import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, posix, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { cacheDirectory } from "./build.mjs";
import { featuresOf, select } from "./select.mjs";
import { inShard, sourceDirectory } from "./upstream.mjs";

const quarto = process.env.QUARTO ?? "quarto";
const RENDER_TIMEOUT_MS = 240_000;
const MAX_PROJECT_BYTES = 3 * 1024 * 1024;
const MIN_SOURCES = 3;
const MAX_PAGES = 40;
const SMOKE_UPSTREAM = 6;
const SMOKE_MAX_PAGES = 10;

export const projectsFile = join(import.meta.dirname, "projects.json");
export const fixturesDirectory = join(import.meta.dirname, "projects");
export const scratchDirectory = join(cacheDirectory, "projects");

const executableChunk = /^```+\s*\{\s*(r|python|julia|bash|sh|sql|ojs|observable|stata|sas|mathematica)\b/im;
const unsupportedConfig = /^\s*(pre-render|post-render|filters|extensions?|engine|jupyter|knitr|freeze)\s*:/im;
const sourceFile = /\.(qmd|md|rmd|ipynb)$/i;
const transient = /(^|[\\/])(\.quarto|_site|_book|_freeze|_out|_extensions|node_modules)([\\/]|$)/;
const remoteResource =
  /<(?:img|script|iframe|video|audio|source)\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\/|<link\b[^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*\bhref\s*=\s*["'](?:https?:)?\/\//i;

const walk = (directory, prefix = "") =>
  readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? (transient.test(path) ? [] : walk(directory, path)) : [path];
  });

export const htmlPages = (output) =>
  walk(output)
    .filter((path) => /\.html?$/i.test(path) && !path.split("/").includes("site_libs"))
    .sort();

export function projectCandidates(directory) {
  const files = walk(directory);
  const roots = files.filter((path) => /(^|\/)_quarto\.ya?ml$/.test(path)).map((path) => posix.dirname(path));
  const nested = (root) => roots.some((other) => other !== root && (other === "." || root.startsWith(`${other}/`)));
  return roots
    .filter((root) => !nested(root))
    .map((root) => {
      const inside = (path) => root === "." || path.startsWith(`${root}/`);
      const own = files.filter(inside);
      const configPath = own.find((path) => /(^|\/)_quarto\.ya?ml$/.test(path));
      const config = readFileSync(join(directory, configPath), "utf8");
      const sources = own.filter((path) => sourceFile.test(path));
      const texts = sources.map((path) => readFileSync(join(directory, path), "utf8"));
      const bytes = own.reduce((total, path) => total + statSync(join(directory, path)).size, 0);
      const extensions = existsSync(join(directory, root, "_extensions"));
      return { root, config, sources, texts, bytes, extensions };
    })
    .filter(
      ({ config, sources, texts, bytes, extensions }) =>
        !extensions &&
        sources.filter((path) => /\.(qmd|md)$/i.test(path)).length >= MIN_SOURCES &&
        sources.length <= MAX_PAGES &&
        bytes <= MAX_PROJECT_BYTES &&
        !sources.some((path) => /\.(rmd|ipynb)$/i.test(path)) &&
        !/type:\s*manuscript/.test(config) &&
        !unsupportedConfig.test(config) &&
        !texts.some((text) => executableChunk.test(text) || unsupportedConfig.test(text.slice(0, 2000))),
    )
    .map(({ root, sources }) => ({ root, sources: sources.length }));
}

const run = (args, cwd) =>
  new Promise((done) => {
    const child = spawn(quarto, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, RENDER_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ ok: code === 0 && !timedOut, output, timedOut });
    });
  });

export async function renderProject(source, scratch, assets) {
  rmSync(scratch, { recursive: true, force: true });
  const project = join(scratch, "project");
  mkdirSync(project, { recursive: true });
  cpSync(source, project, { recursive: true, filter: (path) => !transient.test(relative(source, path)) });
  for (const [path, bytes] of Object.entries(assets ?? {})) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), bytes);
  }
  const outcome = await run(["render", ".", "--to", "html", "--output-dir", "_out", "--quiet"], project);
  const output = join(project, "_out");
  return { ...outcome, log: outcome.output, output: existsSync(output) ? output : null, project };
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export const readSelected = () => (existsSync(projectsFile) ? readJson(projectsFile) : []);

export async function loadFixtures() {
  if (!existsSync(fixturesDirectory)) return [];
  const fixtures = [];
  for (const name of readdirSync(fixturesDirectory).sort()) {
    const directory = join(fixturesDirectory, name);
    if (!statSync(directory).isDirectory()) continue;
    const expect = readJson(join(directory, "expect.json"));
    const generator = join(directory, "assets.mjs");
    const assets = existsSync(generator) ? (await import(pathToFileURL(generator))).default : null;
    fixtures.push({ id: name, kind: "fixture", directory, expect, tier: expect.tier, assets });
  }
  return fixtures;
}

export async function projectEntries({ tier = "smoke", shard, filter = /./ } = {}) {
  const fixtures = await loadFixtures();
  const upstream = [];
  const base = readSelected().length ? await sourceDirectory("quarto-cli") : null;
  for (const entry of readSelected()) {
    upstream.push({ ...entry, kind: "upstream", directory: join(base, entry.root), expect: entry.expect ?? {} });
  }
  return [...fixtures, ...upstream]
    .filter((entry) => tier === "full" || entry.tier === "smoke")
    .filter((entry) => filter.test(entry.id))
    .filter((_, index) => inShard(index, shard));
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const pool = async (items, limit, work) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
};

export async function chooseProjects({ jobs = 2 } = {}) {
  const base = await sourceDirectory("quarto-cli");
  const eligible = projectCandidates(base);
  const rendered = [];
  const skipped = new Map();
  const skip = (reason) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  await pool(eligible, jobs, async ({ root, sources }) => {
    const id = `quarto-cli-${slug(root)}`;
    const outcome = await renderProject(join(base, root), join(scratchDirectory, id));
    if (!outcome.ok || !outcome.output) return skip("failed to render");
    const pages = htmlPages(outcome.output);
    if (pages.length === 0) return skip("no pages");
    const markup = pages.map((page) => readFileSync(join(outcome.output, page), "utf8"));
    const config = readFileSync(join(base, root, "_quarto.yml"), "utf8");
    rendered.push({
      id,
      root,
      group: /type:\s*book/.test(config) ? "book" : /type:\s*website|website:/.test(config) ? "website" : "default",
      pages: pages.length,
      sources,
      remote: markup.some((text) => remoteResource.test(text)),
      quarto: "1.11.9",
      features: featuresOf(markup.join("\n")),
    });
    rmSync(join(scratchDirectory, id), { recursive: true, force: true });
  });
  rendered.sort((a, b) => a.id.localeCompare(b.id));
  const smoke = new Set(select(rendered.filter((entry) => !entry.remote && entry.pages <= SMOKE_MAX_PAGES), SMOKE_UPSTREAM));
  const selected = rendered.map(({ features, ...entry }) => ({
    ...entry,
    markers: features.markers,
    tier: smoke.has(entry.id) ? "smoke" : "full",
  }));
  writeFileSync(projectsFile, `${JSON.stringify(selected, null, 2)}\n`);
  return { eligible: eligible.length, selected, skipped };
}

if (process.argv[1]?.endsWith("projects.mjs")) {
  if (process.argv.includes("--select")) {
    const at = process.argv.indexOf("--jobs");
    const jobs = at < 0 ? Math.max(1, Math.floor(cpus().length / 4)) : Number(process.argv[at + 1]);
    const { eligible, selected, skipped } = await chooseProjects({ jobs });
    const dropped = [...skipped].map(([reason, count]) => `${count} ${reason}`).join(", ");
    console.log(`${eligible} candidates${dropped ? `, dropped ${dropped}` : ""}`);
    console.log(`wrote ${selected.length} to projects.json (${selected.filter((entry) => entry.tier === "smoke").length} smoke)`);
  }
}
