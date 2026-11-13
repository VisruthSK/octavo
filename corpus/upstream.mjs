import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, posix, relative } from "node:path";
import { cacheDirectory } from "./build.mjs";
import { featuresOf, selectStratified } from "./select.mjs";

const quarto = process.env.QUARTO ?? "quarto";
const downloads = join(cacheDirectory, "upstream");
const rendered = join(cacheDirectory, "rendered");
export const indexPath = join(rendered, "index.json");
export const formats = ["html", "slides", "dashboard"];

const RENDER_TIMEOUT_MS = 180_000;
const executableChunk = /^```+\s*\{\s*(r|python|julia|bash|sh|sql|ojs|observable|stata|sas|mathematica)\b/im;
const unsupportedHeader = /^\s*(jupyter|engine|knitr|filters|bibliography|csl|ipynb-filters|extensions?)\s*:/im;
const includeShortcode = /\{\{<\s*(include|embed)\b/;
const htmlFamily = /\b(html|revealjs|dashboard|slidy|s5|dzslides)\b/;
const slideFamily = /\b(revealjs|slidy|s5|dzslides)\b/;
const otherFormats =
  /\b(pdf|latex|beamer|docx|pptx|odt|rtf|epub|typst|gfm|commonmark|jats|ipynb|asciidoc|docbook|man|ms|org|rst|plain|textile|tei|icml|opml|fb2|context|texinfo|mediawiki)\b/;

const declaredFormat = (header) => {
  const found = header.match(/^format:[^\S\n]*([^\n]*)((?:\n[ \t]+[^\n]*)*)/m);
  return found ? found[1] + found[2] : null;
};

export function rendersToHtml(header) {
  const declared = declaredFormat(header);
  return declared === null || (htmlFamily.test(declared) && !otherFormats.test(declared));
}

export function formatOf(header) {
  const declared = declaredFormat(header) ?? "";
  if (slideFamily.test(declared)) return "slides";
  return /\bdashboard\b/.test(declared) ? "dashboard" : "html";
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function download(source) {
  const archive = join(downloads, `${source.name}.tar.gz`);
  if (existsSync(archive) && sha256(readFileSync(archive)) === source.sha256) return archive;
  const response = await fetch(source.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${source.url} returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== source.sha256) throw new Error(`${source.name}: archive does not match the pinned sha256`);
  mkdirSync(downloads, { recursive: true });
  writeFileSync(archive, bytes);
  return archive;
}

function extract(source, archive) {
  const target = join(downloads, source.name);
  if (existsSync(join(target, ".extracted"))) return target;
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const depth = source.prefix.split("/").filter(Boolean).length;
  const result = spawnSync(
    "tar",
    ["-xzf", relative(downloads, archive), "-C", source.name, `--strip-components=${depth}`, source.prefix],
    { encoding: "utf8", cwd: downloads },
  );
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr}`);
  writeFileSync(join(target, ".extracted"), "");
  return target;
}

const walk = (directory, prefix = "") =>
  readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(directory, path) : [path];
  });

export function candidates(directory) {
  const files = walk(directory);
  const projectRoots = files.filter((path) => /(^|\/)_quarto\.ya?ml$/.test(path)).map((path) => posix.dirname(path));
  const inProject = (path) => projectRoots.some((root) => root === "." || path.startsWith(`${root}/`));
  return files
    .filter((path) => path.endsWith(".qmd") && !/(^|\/)_/.test(path) && !inProject(path))
    .map((path) => {
      const file = join(directory, path);
      const text = readFileSync(file, "utf8");
      const header = text.startsWith("---") ? text.slice(0, text.indexOf("\n---", 3) + 1) : "";
      return { path, file, text, header };
    })
    .filter(
      ({ text, header }) =>
        !executableChunk.test(text) && !unsupportedHeader.test(header) && !includeShortcode.test(text) && rendersToHtml(header),
    )
    .map(({ path, file, header }) => ({ path, file, format: formatOf(header), rank: sha256(path) }))
    .sort((a, b) => a.rank.localeCompare(b.rank));
}

export const featureOf = (path) => {
  const [top, next] = path.split("/");
  return top === "smoke-all" ? `${top}/${next}` : top;
};

const render = (file, outputDirectory) =>
  new Promise((done) => {
    const child = spawn(quarto, ["render", file, "-M", "embed-resources:true", "--output-dir", outputDirectory, "--quiet"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (stderr += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, RENDER_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, stderr, code, timedOut });
    });
  });

const directoryTurns = new Map();

const inDirectory = (directory, work) => {
  const turn = (directoryTurns.get(directory) ?? Promise.resolve()).then(work);
  directoryTurns.set(directory, turn.catch(() => {}));
  return turn;
};

const failureReason = ({ stderr, code, timedOut }) =>
  stderr.trim().split("\n").at(-1)?.slice(0, 120) || (timedOut ? "render timed out" : `quarto exited with code ${code}`);

const pool = async (items, limit, work) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
};

const localLink =
  /<(?:img|script)\b[^>]*\bsrc\s*=\s*["'](?!data:|https?:|\/\/|#|blob:|about:)[^"']+|<link\b[^>]*\bhref\s*=\s*["'](?!data:|https?:|\/\/|#|blob:|about:)[^"']+/i;

const remoteResource =
  /<(?:img|script|iframe|video|audio|source)\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\/|<link\b[^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*\bhref\s*=\s*["'](?:https?:)?\/\//i;

const rawTextBody = /(<(script|style|textarea|template)\b[^>]*>)[\s\S]*?<\/\2\s*>/gi;

const withoutRawText = (markup) => markup.replace(rawTextBody, "$1");

const hasLocalLink = (markup) => localLink.test(withoutRawText(markup));

const needsNetwork = (markup) => remoteResource.test(withoutRawText(markup));

async function renderDocument({ id, file }) {
  const kept = join(rendered, `${id}.html`);
  let text = existsSync(kept) ? readFileSync(kept) : null;
  if (!text) {
    const output = join(rendered, id);
    let result;
    for (let attempt = 0; attempt < 2 && !text; attempt += 1) {
      result = await inDirectory(dirname(file), async () => {
        rmSync(output, { recursive: true, force: true });
        mkdirSync(output, { recursive: true });
        const outcome = await render(file, output);
        const html = readdirSync(output).find((name) => name.endsWith(".html"));
        text = outcome.ok && html ? readFileSync(join(output, html)) : null;
        rmSync(output, { recursive: true, force: true });
        return outcome;
      });
    }
    if (!text) return { reason: failureReason(result) };
  }
  const markup = text.toString("utf8");
  if (hasLocalLink(markup)) return { reason: "not self-contained" };
  if (needsNetwork(markup)) return { reason: "needs the network" };
  writeFileSync(kept, text);
  return { text, markup };
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sourcesPath = join(import.meta.dirname, "sources.json");
const pinnedPath = join(import.meta.dirname, "hardest.json");
export const selectionPath = join(import.meta.dirname, "selection.json");

export async function chooseUpstream({ jobs = 4 } = {}) {
  const sources = readJson(sourcesPath);
  const pinned = readJson(pinnedPath);
  const version = spawnSync(quarto, ["--version"], { encoding: "utf8" }).stdout.trim();
  mkdirSync(rendered, { recursive: true });
  const selected = [];
  let candidatesSeen = 0;
  const skipped = new Map();
  for (const source of sources) {
    const directory = extract(source, await download(source));
    const eligible = candidates(directory);
    const pooled = [];
    await pool(eligible, jobs, async ({ file, path, format }) => {
      const id = `${source.name}-${slug(path.replace(/\.qmd$/, ""))}`;
      const outcome = await renderDocument({ id, file });
      if (!outcome.text) {
        skipped.set(outcome.reason, (skipped.get(outcome.reason) ?? 0) + 1);
        return;
      }
      pooled.push({
        id,
        format,
        group: featureOf(path),
        category: `${source.name}-${format}`,
        source: { name: source.name, path },
        quarto: version,
        features: featuresOf(outcome.markup),
      });
    });
    pooled.sort((a, b) => a.id.localeCompare(b.id));
    const smoke = new Set(selectStratified(pooled, source.smoke, pinned).map((pick) => pick.id));
    for (const entry of pooled) selected.push({ ...entry, tier: smoke.has(entry.id) ? "smoke" : "full" });
    candidatesSeen += eligible.length;
  }
  selected.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(selectionPath, `${JSON.stringify(selected, null, 2)}\n`);
  return { candidates: candidatesSeen, selected, skipped };
}

export const inShard = (index, shard) => !shard || index % shard.count === shard.index;

export async function renderSelected({ jobs = 4, tier = "full", shard } = {}) {
  const sources = readJson(sourcesPath);
  mkdirSync(rendered, { recursive: true });
  const entries = readJson(selectionPath)
    .filter((entry) => tier === "full" || entry.tier === tier)
    .filter((_, index) => inShard(index, shard));
  const done = [];
  const failures = [];
  for (const source of sources) {
    const mine = entries.filter((entry) => entry.source.name === source.name);
    if (mine.length === 0) continue;
    const directory = extract(source, await download(source));
    await pool(mine, jobs, async (entry) => {
      const outcome = await renderDocument({ id: entry.id, file: join(directory, entry.source.path) });
      if (!outcome.text) {
        failures.push(`${entry.id}: ${outcome.reason}`);
        return;
      }
      done.push({ ...entry, bytes: outcome.text.length, sha256: sha256(outcome.text) });
    });
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} pinned documents failed to render:\n${failures.sort().join("\n")}`);
  }
  done.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(indexPath, `${JSON.stringify(done, null, 2)}\n`);
  return done;
}

export const renderedPath = (id) => join(rendered, `${id}.html`);

export const readRendered = () => (existsSync(indexPath) ? readJson(indexPath) : []);

if (process.argv[1]?.endsWith("upstream.mjs")) {
  const flag = (name) => {
    const at = process.argv.indexOf(`--${name}`);
    return at < 0 ? undefined : process.argv[at + 1];
  };
  const jobs = Number(flag("jobs") ?? Math.max(1, Math.floor(cpus().length / 4)));
  if (process.argv.includes("--select")) {
    const { candidates: seen, selected, skipped } = await chooseUpstream({ jobs });
    const dropped = [...skipped].map(([reason, count]) => `${count} ${reason}`).join(", ");
    console.log(`${seen} candidates${dropped ? `, dropped ${dropped}` : ""}`);
    const byFormat = Map.groupBy(selected, (entry) => entry.format);
    console.log(
      `wrote ${selected.length} to selection.json (${formats.map((format) => `${format} ${byFormat.get(format)?.length ?? 0}`).join(", ")})`,
    );
  } else {
    const [position, count] = (flag("shard") ?? "").split("/").map(Number);
    const shard = count ? { index: position - 1, count } : undefined;
    const documents = await renderSelected({ jobs, tier: flag("tier") ?? "full", shard });
    console.log(`rendered ${documents.length} pinned documents`);
  }
}
