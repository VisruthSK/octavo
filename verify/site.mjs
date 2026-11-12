import { readdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { closeBrowser, verify } from "./verify.mjs";

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  );

export const sitePages = (directory) =>
  walk(resolve(directory))
    .filter((file) => /\.html?$/i.test(file) && !file.split(sep).includes("site_libs"))
    .map((file) => relative(resolve(directory), file))
    .sort();

export async function verifySite(original, optimized, { report = () => {} } = {}) {
  const root = resolve(original);
  const results = [];
  for (const page of sitePages(root)) {
    const optimizedPage = resolve(optimized, page);
    if (!existsSync(optimizedPage)) {
      results.push({ page, issues: ["missing from the optimized site"] });
      report(results.at(-1));
      continue;
    }
    const scenarios = await verify(join(root, page), optimizedPage, { roots: { original: root, optimized: resolve(optimized) } });
    const issues = scenarios.flatMap(({ scenario, issues: found }) => found.map((issue) => `${scenario}: ${issue}`));
    results.push({ page, issues });
    report(results.at(-1));
  }
  return results;
}

if (process.argv[1]?.endsWith("site.mjs")) {
  const [original, optimized] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!original || !optimized) {
    console.error("usage: node verify/site.mjs <original-directory> <optimized-directory>");
    process.exit(2);
  }
  const results = await verifySite(original, optimized, {
    report: ({ page, issues }) => {
      console.log(page.padEnd(48), issues.length ? `FAIL (${issues.length})` : "ok");
      for (const issue of issues.slice(0, 3)) console.log(`    ${issue.slice(0, 220)}`);
    },
  });
  await closeBrowser();
  const failed = results.filter((result) => result.issues.length).length;
  console.log(`\n${results.length - failed} of ${results.length} pages match`);
  process.exit(failed ? 1 : 0);
}
