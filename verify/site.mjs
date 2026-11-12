import { readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { closeBrowser, verify } from "./verify.mjs";

const [original, optimized] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!original || !optimized) {
  console.error("usage: node verify/site.mjs <original-directory> <optimized-directory>");
  process.exit(2);
}

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );

const root = resolve(original);
const pages = walk(root)
  .filter((file) => /\.html?$/i.test(file) && !file.split(sep).includes("site_libs"))
  .map((file) => relative(root, file))
  .sort();

let failed = 0;
for (const page of pages) {
  const optimizedPage = resolve(optimized, page);
  if (!existsSync(optimizedPage)) {
    console.log(page.padEnd(48), "MISSING");
    failed += 1;
    continue;
  }
  const report = await verify(join(root, page), optimizedPage, { roots: { original: root, optimized: resolve(optimized) } });
  const issues = report.flatMap(({ scenario, issues: found }) => found.map((issue) => `${scenario}: ${issue}`));
  console.log(page.padEnd(48), issues.length ? `FAIL (${issues.length})` : "ok");
  for (const issue of issues.slice(0, 3)) console.log(`    ${issue.slice(0, 220)}`);
  failed += issues.length ? 1 : 0;
}
await closeBrowser();
console.log(`\n${pages.length - failed} of ${pages.length} pages match`);
process.exit(failed ? 1 : 0);
