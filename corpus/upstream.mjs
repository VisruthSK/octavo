import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cacheDirectory } from "./build.mjs";
import { featuresOf, select } from "./select.mjs";

const quarto = process.env.QUARTO ?? "quarto";
const downloads = join(cacheDirectory, "upstream");
const rendered = join(cacheDirectory, "rendered");
export const indexPath = join(rendered, "index.json");

const RENDER_TIMEOUT_MS = 180_000;
const executableChunk = /^```+\s*\{\s*(r|python|julia|bash|sh|sql|ojs|observable|stata|sas|mathematica)\b/im;
const unsupportedHeader = /^\s*(jupyter|engine|knitr|filters|bibliography|csl|ipynb-filters|extensions?)\s*:/im;

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

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );

export function candidates(directory) {
  const projectRoots = new Set(
    walk(directory)
      .filter((file) => /(^|[\/])_quarto\.ya?ml$/.test(file))
      .map((file) => file.replace(/[\/][^\/]*$/, "")),
  );
  return walk(directory)
    .filter((file) => file.endsWith(".qmd") && !/(^|[\/])_/.test(relative(directory, file)))
    .filter((file) => ![...projectRoots].some((root) => file.startsWith(root)))
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      const header = text.startsWith("---") ? text.slice(0, text.indexOf("\n---", 3) + 1) : "";
      return !executableChunk.test(text) && !unsupportedHeader.test(header) && !/\{\{<\s*(include|embed)\b/.test(text);
    })
    .map((file) => ({ file, path: relative(directory, file).replaceAll("\\", "/") }))
    .map((entry) => ({ ...entry, rank: sha256(entry.path) }))
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
    const child = spawn(
      quarto,
      ["render", file, "--to", "html", "-M", "embed-resources:true", "--output-dir", outputDirectory, "--quiet"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
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

const localLink = /<(?:img|script)\b[^>]*\bsrc\s*=\s*["'](?!data:|https?:|\/\/|#|blob:|about:)[^"']+|<link\b[^>]*\bhref\s*=\s*["'](?!data:|https?:|\/\/|#|blob:|about:)[^"']+/i;

export async function renderUpstream({ jobs = 4, poolSize, selectCount } = {}) {
  const sources = JSON.parse(readFileSync(join(import.meta.dirname, "sources.json"), "utf8"));
  const version = spawnSync(quarto, ["--version"], { encoding: "utf8" }).stdout.trim();
  mkdirSync(rendered, { recursive: true });
  const selected = [];
  const everything = [];
  for (const source of sources) {
    const directory = extract(source, await download(source));
    const queue = spread(candidates(directory)).slice(0, poolSize ?? source.pool);
    const pooled = [];
    await pool(queue, jobs, async ({ file, path }) => {
      const id = `${source.name}-${slug(path.replace(/.qmd$/, ""))}`;
      const output = join(rendered, id);
      rmSync(output, { recursive: true, force: true });
      mkdirSync(output, { recursive: true });
      const result = await render(file, output);
      const html = readdirSync(output).find((name) => name.endsWith(".html"));
      const text = result.ok && html ? readFileSync(join(output, html)) : null;
      rmSync(output, { recursive: true, force: true });
      if (!text) {
        console.error(`skipped ${id}: ${result.stderr.trim().split("\n").at(-1)?.slice(0, 120) ?? "render failed"}`);
        return;
      }
      const markup = text.toString("utf8");
      if (localLink.test(markup)) {
        console.error(`skipped ${id}: not self-contained`);
        return;
      }
      writeFileSync(join(rendered, `${id}.html`), text);
      pooled.push({
        id,
        group: featureOf(path),
        category: source.name,
        source: { name: source.name, path },
        quarto: version,
        bytes: text.length,
        sha256: sha256(text),
        features: featuresOf(markup),
      });
    });
    pooled.sort((a, b) => a.id.localeCompare(b.id));
    const order = select(pooled, selectCount ?? source.select);
    for (const entry of pooled) {
      const position = order.indexOf(entry.id);
      entry.selected = position >= 0;
      if (!entry.selected) rmSync(join(rendered, `${entry.id}.html`), { force: true });
      else selected.push({ ...entry, tier: position < source.smoke ? "smoke" : "full" });
    }
    everything.push(...pooled);
  }
  selected.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(rendered, "pool.json"), `${JSON.stringify(everything, null, 2)}
`);
  writeFileSync(indexPath, `${JSON.stringify(selected, null, 2)}
`);
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
    jobs: flag("jobs") ?? 4,
    poolSize: flag("pool"),
    selectCount: flag("select"),
  });
  console.log(`rendered ${everything.length} usable documents and selected ${selected.length}`);
}
