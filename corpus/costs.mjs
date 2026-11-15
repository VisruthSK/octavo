import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
export const costsPath = join(import.meta.dirname, "costs.json");
export const DEFAULT_FALLBACK_COST = 38;
export const ENGINES = ["chromium", "firefox", "webkit"];

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

  const processFileOrText = (text, filePath = "") => {
    let defaultEngine = null;
    const lower = filePath.toLowerCase();
    if (lower.includes("chromium")) defaultEngine = "chromium";
    else if (lower.includes("firefox")) defaultEngine = "firefox";
    else if (lower.includes("webkit")) defaultEngine = "webkit";

    let currentEngine = defaultEngine ?? "chromium";
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.includes("out/engines-webkit") || line.includes("WebKit checks") || line.includes("browser: WebKit") || line.includes("OCTAVO_BROWSER: webkit") || (!defaultEngine && line.includes("webkit"))) {
        currentEngine = "webkit";
      } else if (line.includes("out/engines-firefox") || line.includes("Firefox checks") || line.includes("browser: Firefox") || line.includes("OCTAVO_BROWSER: firefox") || (!defaultEngine && line.includes("firefox"))) {
        currentEngine = "firefox";
      } else if (line.includes("out/engines-chromium") || line.includes("Chromium checks") || line.includes("browser: Chromium") || line.includes("OCTAVO_BROWSER: chromium") || (!defaultEngine && (line.includes("Corpus (smoke, shard") || line.includes("chromium")))) {
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
      processFileOrText(readFileSync(file, "utf8"), file);
    }
  } else if (typeof source === "string") {
    processFileOrText(source, "");
  }

  const medians = {};
  for (const eng of ENGINES) {
    const totals = Object.values(perEngine[eng])
      .map((levels) => Object.values(levels).reduce((a, b) => a + b, 0))
      .sort((a, b) => a - b);
    const mid = Math.floor(totals.length / 2);
    medians[eng] = totals.length
      ? (totals.length % 2 !== 0 ? totals[mid] : Math.round((totals[mid - 1] + totals[mid]) / 2))
      : DEFAULT_FALLBACK_COST;
  }

  const allDocIds = new Set([
    ...Object.keys(perEngine.chromium),
    ...Object.keys(perEngine.firefox),
    ...Object.keys(perEngine.webkit),
  ]);

  const table = {};
  for (const id of [...allDocIds].sort()) {
    table[id] = {};
    for (const eng of ENGINES) {
      const levels = perEngine[eng][id];
      const measured = levels ? Object.values(levels).reduce((a, b) => a + b, 0) : null;
      table[id][eng] = measured ?? medians[eng];
    }
  }

  return table;
}

export function readCosts(path = costsPath) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

export function costOf(doc, costs = {}, engine = "chromium") {
  const id = typeof doc === "string" ? doc : doc?.id;
  const entry = id ? costs[id] : undefined;
  if (typeof entry === "number") return entry;
  if (entry && typeof entry === "object") {
    if (typeof entry[engine] === "number") return entry[engine];
    const first = Object.values(entry).find((v) => typeof v === "number");
    if (first !== undefined) return first;
  }
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
