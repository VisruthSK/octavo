import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureFonts } from "./fonts.mjs";
import { digest, render, renderFiles } from "./spec.mjs";
import { loadSpecs } from "./specs.mjs";

export const cacheDirectory = join(import.meta.dirname, ".cache");
export const manifestPath = join(import.meta.dirname, "manifest.json");
export const documentPath = (id, linked = false) =>
  linked ? join(cacheDirectory, "docs", id, "index.html") : join(cacheDirectory, "docs", `${id}.html`);

export async function materialize() {
  await ensureFonts();
  mkdirSync(join(cacheDirectory, "docs"), { recursive: true });
  const rows = [];
  for (const spec of await loadSpecs()) {
    const html = render(spec);
    const files = renderFiles(spec);
    const names = Object.keys(files).sort();
    if (spec.linked) {
      rmSync(join(cacheDirectory, "docs", spec.id), { recursive: true, force: true });
      for (const name of names) {
        mkdirSync(dirname(join(cacheDirectory, "docs", spec.id, name)), { recursive: true });
        writeFileSync(join(cacheDirectory, "docs", spec.id, name), files[name]);
      }
    }
    mkdirSync(dirname(documentPath(spec.id, spec.linked)), { recursive: true });
    writeFileSync(documentPath(spec.id, spec.linked), html);
    rows.push({
      id: spec.id,
      category: spec.category,
      tier: spec.tier,
      browser: spec.browser,
      expect: spec.expect,
      bytes: Buffer.byteLength(html),
      ...(spec.linked && {
        linked: true,
        extraBytes: names.reduce((total, name) => total + Buffer.byteLength(files[name]), 0),
      }),
      sha256: digest(spec.linked ? html + JSON.stringify(names.map((name) => [name, digest(files[name])])) : html),
    });
  }
  return rows;
}

export const readManifest = () => JSON.parse(readFileSync(manifestPath, "utf8"));

if (process.argv[1]?.endsWith("build.mjs")) {
  const rows = await materialize();
  const text = `${JSON.stringify(rows, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(manifestPath, "utf8") !== text) {
      const known = new Map(readManifest().map((row) => [row.id, row.sha256]));
      const drifted = rows.filter((row) => known.get(row.id) !== row.sha256).map((row) => row.id);
      console.error(`manifest.json is out of date: ${drifted.length} documents changed or are new`);
      console.error(drifted.slice(0, 20).join("\n"));
      process.exit(1);
    }
    console.log(`manifest.json matches ${rows.length} documents`);
  } else {
    writeFileSync(manifestPath, text);
    console.log(`wrote ${rows.length} documents`);
  }
}
