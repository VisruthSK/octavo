import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureFonts } from "./fonts.mjs";
import { digest, render } from "./spec.mjs";
import { loadSpecs } from "./specs.mjs";

export const cacheDirectory = join(import.meta.dirname, ".cache");
export const manifestPath = join(import.meta.dirname, "manifest.json");
export const documentPath = (id) => join(cacheDirectory, "docs", `${id}.html`);

export async function materialize() {
  await ensureFonts();
  mkdirSync(join(cacheDirectory, "docs"), { recursive: true });
  const rows = [];
  for (const spec of await loadSpecs()) {
    const html = render(spec);
    writeFileSync(documentPath(spec.id), html);
    rows.push({
      id: spec.id,
      category: spec.category,
      tier: spec.tier,
      browser: spec.browser,
      expect: spec.expect,
      bytes: Buffer.byteLength(html),
      sha256: digest(html),
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
