import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { verify } from "./verify.mjs";

const root = resolve(import.meta.dirname, "..");
const built = join(root, "target", "release", process.platform === "win32" ? "octavo.exe" : "octavo");
const binary = join(mkdtempSync(join(tmpdir(), "octavo-bench-")), basename(built));
copyFileSync(built, binary);
const outDir = join(root, "out");
const [mode = "packed", ...inputs] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const skipVerify = process.argv.includes("--no-verify");
const lossy = process.argv.includes("--lossy");
const needsJavaScript = mode === "packed";

const files = inputs.flatMap((input) =>
  statSync(input).isDirectory()
    ? readdirSync(input).filter((f) => f.endsWith(".html")).map((f) => join(input, f))
    : [input],
);

mkdirSync(outDir, { recursive: true });
const rows = [];
for (const file of files) {
  const name = basename(file, ".html").replace(/\s+/g, "_");
  const optimized = join(outDir, `${name}.${mode}.html`);
  const started = Date.now();
  execFileSync(binary, [file, optimized, "--level", mode, ...(lossy ? ["--lossy-images"] : [])], { stdio: "pipe", maxBuffer: 1 << 28 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const before = statSync(file).size;
  const after = statSync(optimized).size;
  let status = "skipped";
  let issues = [];
  if (!skipVerify) {
    const report = (await verify(file, optimized, { lossy })).filter((r) => !(needsJavaScript && r.scenario === "no-js"));
    issues = report.flatMap((r) => r.issues.map((i) => `${r.scenario}: ${i}`));
    status = issues.length ? "FAIL" : "ok";
  }
  rows.push({ name, before, after, status, issues });
  console.log(
    name.padEnd(34),
    String(before).padStart(9),
    String(after).padStart(9),
    `${(100 * (1 - after / before)).toFixed(1)}%`.padStart(7),
    `${seconds}s`.padStart(7),
    status,
  );
  for (const issue of issues.slice(0, 4)) console.log("    ", issue.slice(0, 300));
}
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log("TOTAL".padEnd(34), String(sum("before")).padStart(9), String(sum("after")).padStart(9), `${(100 * (1 - sum("after") / sum("before"))).toFixed(1)}%`.padStart(7));
