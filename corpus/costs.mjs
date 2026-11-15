import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
export const costsPath = join(import.meta.dirname, "costs.json");
export const DEFAULT_FALLBACK_COST = 38;

const findLogFiles = (target) => {
  if (!existsSync(target)) return [];
  const stat = statSync(target);
  if (!stat.isDirectory()) return [target];
  const results = [];
  for (const entry of readdirSync(target)) {
    const full = join(target, entry);
    const subStat = statSync(full);
    if (subStat.isDirectory()) {
      results.push(...findLogFiles(full));
    } else if (entry.endsWith(".log") || entry.endsWith(".txt")) {
      results.push(full);
    }
  }
  return results;
};

export function buildCosts(source = root) {
  const files = typeof source === "string" && existsSync(source) ? findLogFiles(source) : [];
  const perEngine = { chromium: {}, firefox: {}, webkit: {} };
  const progressRegex = /\[(\d+)\/(\d+)\]\s+([^\s]+)\s+([^\s]+)\s+(\d+)s(\s+\(cached\))?/;

  const processText = (text) => {
    let currentEngine = "chromium";
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.includes("firefox")) {
        currentEngine = "firefox";
      } else if (line.includes("webkit")) {
        currentEngine = "webkit";
      } else if (line.includes("Corpus (smoke, shard") || line.includes("chromium")) {
        currentEngine = "chromium";
      }
      const match = line.match(progressRegex);
      if (!match) continue;
      if (match[6]) continue;
      const id = match[3];
      const level = match[4];
      const seconds = Number(match[5]);
      if (!perEngine[currentEngine][id]) {
        perEngine[currentEngine][id] = {};
      }
      perEngine[currentEngine][id][level] = seconds;
    }
  };

  if (files.length > 0) {
    for (const file of files) {
      processText(readFileSync(file, "utf8"));
    }
  } else if (typeof source === "string") {
    processText(source);
  }

  const allDocIds = new Set([
    ...Object.keys(perEngine.chromium),
    ...Object.keys(perEngine.firefox),
    ...Object.keys(perEngine.webkit),
  ]);

  const table = {};
  for (const id of allDocIds) {
    const cr = Object.values(perEngine.chromium[id] ?? {}).reduce((a, b) => a + b, 0);
    const ff = Object.values(perEngine.firefox[id] ?? {}).reduce((a, b) => a + b, 0);
    const wk = Object.values(perEngine.webkit[id] ?? {}).reduce((a, b) => a + b, 0);
    table[id] = Math.max(cr, ff, wk);
  }

  const sorted = {};
  for (const key of Object.keys(table).sort()) {
    sorted[key] = table[key];
  }
  return sorted;
}

export function readCosts(path = costsPath) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

export function costOf(doc, costs = {}) {
  const id = typeof doc === "string" ? doc : doc?.id;
  if (id && costs[id] !== undefined) return costs[id];
  if (doc?.bytes) return Math.max(1, Math.round(doc.bytes / 1024));
  return DEFAULT_FALLBACK_COST;
}

if (process.argv[1]?.endsWith("costs.mjs")) {
  const target = process.argv[2] ?? root;
  const table = buildCosts(target);
  if (Object.keys(table).length > 0) {
    writeFileSync(costsPath, `${JSON.stringify(table, null, 2)}\n`);
    console.log(`Wrote ${Object.keys(table).length} costs to ${costsPath}`);
  }
}
