import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

execSync("python verify/prep-variants.py", { stdio: "inherit" });

const variants = [
  ["woff2-no-octavo", "Original page, font converted to WOFF2 without Octavo"],
  ["octavo-ttf", "Octavo safe output, font left as original TTF"],
  ["octavo-subset-ttf", "Octavo safe output, subsetted font decompressed to TTF"],
  ["octavo-whole-woff2", "Octavo safe output, whole WOFF2 font (--no-subset-fonts)"],
  ["octavo-subset-woff2", "Octavo safe output, subset WOFF2 font (default safe)"],
];

const origPath = join(process.cwd(), "out/variants/original.html");
const scenario = "tablet";

console.log("\n=======================================================");
console.log("RUNNING LINUX FIREFOX FONT RENDER DIAGNOSIS");
console.log("=======================================================\n");

const results = [];

for (const [name, desc] of variants) {
  const variantPath = join(process.cwd(), `out/variants/${name}.html`);
  const outDir = join(process.cwd(), `out/diag/${name}`);
  
  console.log(`Testing ${name}: ${desc}...`);
  try {
    execSync(`node verify/screenshots.mjs "${origPath}" "${variantPath}" "${scenario}" "${outDir}"`, {
      stdio: "pipe",
      env: { ...process.env, OCTAVO_BROWSER: "firefox" }
    });
    
    const summaryFile = join(outDir, "summary.txt");
    const summary = existsSync(summaryFile) ? readFileSync(summaryFile, "utf8").trim() : "no summary";
    const firstLine = summary.split("\n")[0] || "";
    const secondLine = summary.split("\n")[1] || "";
    const diffLine = summary.split("\n").find((l) => l.startsWith("pixels that differ")) || "";
    
    results.push({ name, desc, firstLine, secondLine, diffLine });
  } catch (err) {
    console.error(`Error testing ${name}:`, err.message);
    results.push({ name, desc, firstLine: "ERROR", secondLine: err.message, diffLine: "" });
  }
}

console.log("\n=======================================================");
console.log("DIAGNOSIS RESULTS TABLE");
console.log("=======================================================\n");

for (const r of results) {
  console.log(`[${r.name}] (${r.desc})`);
  console.log(`  ${r.firstLine}`);
  console.log(`  ${r.secondLine}`);
  if (r.diffLine) console.log(`  ${r.diffLine}`);
  console.log("");
}
