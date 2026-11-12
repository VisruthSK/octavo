import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { launch } from "./browser.mjs";

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export function serve(directory) {
  const root = resolve(directory);
  const server = createServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname));
    let file = join(root, path);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, port: server.address().port })));
}

export async function searchResults(browser, port, queries) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`error: ${error.message}`));
  page.on("console", (message) => message.type() === "error" && problems.push(`console: ${message.text()}`));
  page.on("response", (response) => response.status() >= 400 && problems.push(`${response.status()} ${response.url()}`));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  const results = {};
  for (const query of queries) {
    await page.locator("#quarto-search button, #quarto-search .aa-DetachedSearchButton").first().click().catch(() => {});
    const field = page.locator(".aa-Input").first();
    await field.fill("");
    await field.fill(query);
    await page.waitForTimeout(700);
    results[query] = await page.locator(".aa-Item").evaluateAll((items) => items.map((item) => item.textContent.replace(/\s+/g, " ").trim()));
    await page.keyboard.press("Escape");
  }
  await context.close();
  return { results, problems };
}

export async function compareSearch(browser, original, optimized, queries) {
  const [a, b] = await Promise.all([serve(original), serve(optimized)]);
  try {
    const before = await searchResults(browser, a.port, queries);
    const after = await searchResults(browser, b.port, queries);
    const issues = [];
    for (const query of queries) {
      if (JSON.stringify(before.results[query]) !== JSON.stringify(after.results[query])) {
        issues.push(`search "${query}": ${before.results[query].length} results before, ${after.results[query].length} after`);
      }
    }
    for (const problem of after.problems.filter((entry) => !before.problems.includes(entry))) issues.push(`new problem: ${problem}`);
    return { before: before.results, after: after.results, issues };
  } finally {
    a.server.close();
    b.server.close();
  }
}

if (process.argv[1]?.endsWith("search.mjs")) {
  const [original, optimized] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!original || !optimized) {
    console.error("usage: node verify/search.mjs <original-directory> <optimized-directory>");
    process.exit(2);
  }
  const queries = ["quarto", "page", "about", "website", "listing", "zzzzqx"];
  const browser = await launch();
  const { before, after, issues } = await compareSearch(browser, original, optimized, queries);
  for (const query of queries) {
    console.log(`${query.padEnd(10)} ${before[query].length} results before, ${after[query].length} after`);
  }
  if (!queries.some((query) => before[query].length > 0)) issues.push("the original produced no search results; the test did not exercise search");
  for (const issue of issues) console.log(issue);
  await browser.close();
  console.log(issues.length === 0 ? "search matches" : `${issues.length} differences`);
  process.exit(issues.length === 0 ? 0 : 1);
}
