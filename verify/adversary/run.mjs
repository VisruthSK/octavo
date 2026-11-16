import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser, verify } from "../verify.mjs";
import { baseHtml, mutations, equivalentPairs } from "./mutations.mjs";

const directory = mkdtempSync(join(tmpdir(), "octavo-adversary-run-"));

const write = (name, html) => {
  const file = join(directory, `${name}.html`);
  writeFileSync(file, html);
  return file;
};

const categorizeIssue = (issue) => {
  if (issue.startsWith("dom differs")) return "dom";
  if (issue.includes("computed style") || issue.includes("style count") || issue.includes("style sheets")) return "style";
  if (issue.includes("laid out differently") || issue.includes("scroll size")) return "box";
  if (issue.startsWith("screenshot:") || issue.startsWith("page too large") || issue.startsWith("screenshot size") || issue.includes("tile at")) return "pixel";
  if (issue.includes("accessibility tree differs")) return "a11y";
  if (issue.startsWith("console errors:")) return "console";
  if (issue.startsWith("requests:")) return "requests";
  if (issue.startsWith("fonts ")) return "fonts";
  if (issue.startsWith("animations ")) return "animation";
  if (issue.startsWith("forced :")) return "forced state";
  if (issue.includes("interaction")) return "interaction";
  return "other";
};

const runPair = async (id, name, originalHtml, modifiedHtml) => {
  const origFile = write(`${id}-orig`, originalHtml);
  const modFile = write(`${id}-mod`, modifiedHtml);
  const report = await verify(origFile, modFile);
  const detectedScenarios = [];
  const comparisons = new Set();
  const allIssues = [];

  for (const { scenario, issues } of report) {
    if (issues && issues.length > 0) {
      detectedScenarios.push(scenario);
      for (const issue of issues) {
        allIssues.push(`[${scenario}] ${issue}`);
        comparisons.add(categorizeIssue(issue));
      }
    }
  }

  return {
    id,
    name,
    detected: detectedScenarios.length > 0,
    scenarios: detectedScenarios,
    comparisons: [...comparisons],
    issues: allIssues,
  };
};

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const at = args.indexOf(flag);
  return at >= 0 && args[at + 1] ? args[at + 1] : def;
};

const mode = getArg("--mode", "all");
const from = Number(getArg("--from", "0"));
const to = Number(getArg("--to", String(mutations.length)));
const outFile = getArg("--out", join(process.cwd(), "adversary-results.json"));
const subsetArg = getArg("--subset", "");
const subsetIds = subsetArg ? new Set(subsetArg.split(",")) : null;

async function main() {
  const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { mutations: {}, equivalents: {} };

  const base = baseHtml();

  if (mode === "mutations" || mode === "all") {
    const list = subsetIds ? mutations.filter((m) => subsetIds.has(m.id)) : mutations.slice(from, to);
    for (const m of list) {
      const pair = m.create(base);
      const res = await runPair(m.id, m.name, pair.original, pair.mutated);
      results.mutations[m.id] = { ...res, family: m.family };
      console.log(`[MUTATION] ${m.id}: ${res.detected ? "DETECTED" : "MISSED"} via [${res.comparisons.join(",")}] in [${res.scenarios.join(",")}]`);
    }
  }

  if (mode === "equivalents" || mode === "all") {
    for (const e of equivalentPairs) {
      const pair = e.create(base);
      const res = await runPair(e.id, e.name, pair.original, pair.equivalent);
      results.equivalents[e.id] = res;
      console.log(`[EQUIV] ${e.id}: ${res.detected ? "FALSE_ALARM" : "PASSED"}${res.detected ? ` via [${res.comparisons.join(",")}] in [${res.scenarios.join(",")}]` : ""}`);
    }
  }

  writeFileSync(outFile, JSON.stringify(results, null, 2));
  await closeBrowser();
}

main().catch(async (err) => {
  console.error("Runner error:", err);
  await closeBrowser();
  process.exit(1);
});
