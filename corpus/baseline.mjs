import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const baselinePath = join(import.meta.dirname, "baseline.json");
export const GROWTH_LIMIT = 0.005;
export const levels = ["safe", "scripts", "packed"];

export function parseBaseline(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("baseline.json must be an object");
  for (const [id, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`baseline.json entry ${id} must be an object`);
    for (const [level, size] of Object.entries(entry)) {
      if (!levels.includes(level)) throw new Error(`baseline.json entry ${id} has an unknown level ${level}`);
      if (!Number.isInteger(size) || size < 1) throw new Error(`baseline.json entry ${id}.${level} must be a byte count`);
    }
  }
  return data;
}

export const readBaseline = (path = baselinePath) => (existsSync(path) ? parseBaseline(readFileSync(path, "utf8")) : {});

export function serializeBaseline(data) {
  const ordered = {};
  for (const id of Object.keys(data).sort()) {
    const entry = {};
    for (const level of levels) if (Number.isInteger(data[id][level]) && data[id][level] > 0) entry[level] = data[id][level];
    if (Object.keys(entry).length > 0) ordered[id] = entry;
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export const writeBaseline = (data, path = baselinePath) => writeFileSync(path, serializeBaseline(data));

const measuredSizes = (results) => results.filter((entry) => Number.isInteger(entry.outBytes));

export function compareBaseline(baseline, results, limit = GROWTH_LIMIT) {
  const growth = [];
  const unrecorded = [];
  const categories = new Map();
  let compared = 0;
  for (const entry of measuredSizes(results)) {
    const before = baseline[entry.id]?.[entry.level];
    if (before === undefined) {
      unrecorded.push(`${entry.id} (${entry.level})`);
      continue;
    }
    compared += 1;
    const after = entry.outBytes;
    if (after * 1000 > before * 1000 + before * limit * 1000) {
      growth.push({ id: entry.id, level: entry.level, before, after, change: after / before - 1 });
    }
    const name = `${entry.category} / ${entry.level}`;
    const row = categories.get(name) ?? { category: entry.category, level: entry.level, docs: 0, before: 0, after: 0 };
    row.docs += 1;
    row.before += before;
    row.after += after;
    categories.set(name, row);
  }
  return {
    compared,
    growth: growth.sort((a, b) => b.change - a.change || a.id.localeCompare(b.id)),
    unrecorded: unrecorded.sort(),
    categories: [...categories.values()]
      .map((row) => ({ ...row, change: row.after / row.before - 1 }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.level.localeCompare(b.level)),
  };
}

export function mergeBaseline(baseline, results, { prune = false } = {}) {
  const merged = {};
  const keep = prune ? new Set(measuredSizes(results).map((entry) => entry.id)) : null;
  for (const [id, entry] of Object.entries(baseline)) if (!keep || keep.has(id)) merged[id] = { ...entry };
  for (const entry of measuredSizes(results)) {
    merged[entry.id] ??= {};
    merged[entry.id][entry.level] = entry.outBytes;
  }
  return merged;
}

export function mergeBaselineFiles(directory) {
  const merged = {};
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".json")).sort()) {
    const data = parseBaseline(readFileSync(join(directory, name), "utf8"));
    for (const [id, entry] of Object.entries(data)) merged[id] = { ...entry, ...merged[id] };
  }
  return merged;
}

if (process.argv[1]?.endsWith("baseline.mjs")) {
  const at = process.argv.indexOf("--merge");
  if (at < 0) {
    console.error("usage: node corpus/baseline.mjs --merge <directory>");
    process.exit(1);
  }
  const directory = process.argv[at + 1];
  const merged = mergeBaselineFiles(directory);
  writeBaseline(merged);
  console.log(`wrote ${Object.keys(merged).length} documents to baseline.json from ${directory}`);
}
