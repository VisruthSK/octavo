import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { closeBrowser, verifyLevels } from "./verify.mjs";

const [binary, directory, ...files] = process.argv.slice(2);
if (!binary || !directory || !files.length) throw new Error("usage: node corpus-bench.mjs OCTAVO OUTPUT_DIR HTML...");
mkdirSync(directory, { recursive: true });

try {
  for (const file of files) {
    const entries = [["serve", "safe"], ["portable", "scripts"], ["archive", "packed"]].map(([level, binaryLevel]) => {
      const path = join(directory, `${basename(file, ".html")}.${level}.html`);
      execFileSync(binary, [file, path, "--level", binaryLevel]);
      return { level, path };
    });
    const started = performance.now();
    const { reports, timing } = await verifyLevels(file, entries);
    console.log(JSON.stringify({ file, wallMs: performance.now() - started, timing, reports }));
  }
} finally {
  await closeBrowser();
}
