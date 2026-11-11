import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, posix, relative } from "node:path";
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

export function spread(entries) {
  const queues = [...Map.groupBy(entries, (entry) => featureOf(entry.path))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, items]) => items);
  const ordered = [];
  for (let round = 0; ordered.length < entries.length; round += 1) {
    for (const queue of queues) if (queue[round]) ordered.push(queue[round]);
  }
  return ordered;
}

const render = (file, outputDirectory) =>
  new Promise((done) => {
    const child = spawn(quarto, ["render", file, "-M", "embed-resources:true", "--output-dir", outputDirectory, "--quiet"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), RENDER_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, stderr });
    });
  });

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

const rawTextBody = /(<(script|style|textarea|template)\b[^>]*>)[\s\S]*?<\/\2\s*>/gi;

const hasLocalLink = (markup) => localLink.test(markup.replace(rawTextBody, "$1"));

const capped = (quotas, cap) =>
  Object.fromEntries(Object.entries(quotas).map(([format, count]) => [format, cap ? Math.min(count, cap) : count]));

export async function renderUpstream({ jobs = 4, cap } = {}) {
  const sources = JSON.parse(readFileSync(join(import.meta.dirname, "sources.json"), "utf8"));
  const version = spawnSync(quarto, ["--version"], { encoding: "utf8" }).stdout.trim();
  mkdirSync(rendered, { recursive: true });
  const selected = [];
  const everything = [];
  for (const source of sources) {
    const directory = extract(source, await download(source));
    const eligible = candidates(directory);
    const poolSizes = capped(source.pool, cap);
    const queue = formats.flatMap((format) =>
      spread(eligible.filter((entry) => entry.format === format)).slice(0, poolSizes[format] ?? 0),
    );
    const pooled = [];
    await pool(queue, jobs, async ({ file, path, format }) => {
      const id = `${source.name}-${slug(path.replace(/\.qmd$/, ""))}`;
      const kept = join(rendered, `${id}.html`);
      let result = { ok: true, stderr: "" };
      let text = existsSync(kept) ? readFileSync(kept) : null;
      if (!text) {
        const output = join(rendered, id);
        rmSync(output, { recursive: true, force: true });
        mkdirSync(output, { recursive: true });
        result = await render(file, output);
        const html = readdirSync(output).find((name) => name.endsWith(".html"));
        text = result.ok && html ? readFileSync(join(output, html)) : null;
        rmSync(output, { recursive: true, force: true });
      }
      if (!text) {
        console.error(`skipped ${id}: ${result.stderr.trim().split("\n").at(-1)?.slice(0, 120) ?? "render failed"}`);
        return;
      }
      const markup = text.toString("utf8");
      if (hasLocalLink(markup)) {
        console.error(`skipped ${id}: not self-contained`);
        return;
      }
      writeFileSync(join(rendered, `${id}.html`), text);
      pooled.push({
        id,
        format,
        group: featureOf(path),
        category: `${source.name}-${format}`,
        source: { name: source.name, path },
        quarto: version,
        bytes: text.length,
        sha256: sha256(text),
        features: featuresOf(markup),
      });
    });
    pooled.sort((a, b) => a.id.localeCompare(b.id));
    const order = new Map(selectStratified(pooled, capped(source.select, cap)).map((pick) => [pick.id, pick.position]));
    for (const entry of pooled) {
      const position = order.get(entry.id);
      entry.selected = position !== undefined;
      if (entry.selected) selected.push({ ...entry, tier: position < (source.smoke[entry.format] ?? 0) ? "smoke" : "full" });
    }
    everything.push(...pooled);
  }
  selected.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(rendered, "pool.json"), `${JSON.stringify(everything, null, 2)}\n`);
  writeFileSync(indexPath, `${JSON.stringify(selected, null, 2)}\n`);
  return { pool: everything, selected };
}

export const renderedPath = (id) => join(rendered, `${id}.html`);

export const readRendered = () => (existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : []);

if (process.argv[1]?.endsWith("upstream.mjs")) {
  const flag = (name) => {
    const at = process.argv.indexOf(`--${name}`);
    return at < 0 ? undefined : Number(process.argv[at + 1]);
  };
  const { pool: everything, selected } = await renderUpstream({
    jobs: flag("jobs") ?? Math.max(1, Math.floor(cpus().length / 4)),
    cap: flag("cap"),
  });
  const byFormat = Map.groupBy(selected, (entry) => entry.format);
  console.log(
    `rendered ${everything.length} usable documents and selected ${selected.length} (${formats.map((format) => `${format} ${byFormat.get(format)?.length ?? 0}`).join(", ")})`,
  );
}
