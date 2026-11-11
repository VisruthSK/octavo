import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { define } from "./spec.mjs";

const directory = join(import.meta.dirname, "docs");

export async function loadSpecs() {
  const files = readdirSync(directory).filter((name) => name.endsWith(".mjs")).sort();
  const specs = [];
  for (const file of files) {
    const { default: entries } = await import(pathToFileURL(join(directory, file)));
    if (!Array.isArray(entries)) throw new Error(`${file}: the default export must be an array of specs`);
    specs.push(...entries.map(define));
  }
  const seen = new Set();
  for (const { id } of specs) {
    if (seen.has(id)) throw new Error(`${id}: duplicate id`);
    seen.add(id);
  }
  return specs.sort((a, b) => a.id.localeCompare(b.id));
}
