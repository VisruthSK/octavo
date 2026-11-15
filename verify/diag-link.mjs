import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { renderLinked } from "../corpus/upstream.mjs";
import { isLinkedFileLoadFailure } from "./linked-artifacts.mjs";
import { verify, closeBrowser } from "./verify.mjs";

const root = resolve(import.meta.dirname, "..");
const binary = resolve(join(root, "target", "release", process.platform === "win32" ? "octavo.exe" : "octavo"));

const ids = [
  "quarto-cli-doc-layout-title-block",
  "quarto-cli-doc-layout-title-block-banner",
  "quarto-cli-extensions-lexcorp-lexcorp",
  "quarto-cli-smoke-all-2025-09-03-issue-12630",
];

const selection = JSON.parse(readFileSync(join(root, "corpus", "selection.json"), "utf8"));

async function inspect(browser, file, label) {
  console.log(`\n--- [${label}] OPENING ${file} ---`);
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const start = performance.now();
  const time = () => `${(performance.now() - start).toFixed(1)}ms`.padStart(9);

  page.on("request", (req) => {
    console.log(`[${time()}] [${label}] REQUEST: ${req.method()} ${req.resourceType()} ${req.url()}`);
  });
  page.on("response", (res) => {
    console.log(`[${time()}] [${label}] RESPONSE: ${res.status()} ${res.url()}`);
  });
  page.on("requestfailed", (req) => {
    console.log(`[${time()}] [${label}] REQUESTFAILED: ${req.url()} error: ${req.failure()?.errorText}`);
  });
  page.on("console", (msg) => {
    const loc = msg.location();
    const isArtifact = isLinkedFileLoadFailure(msg.text(), loc);
    console.log(`[${time()}] [${label}] CONSOLE ${msg.type()}: "${msg.text()}" at ${loc.url}:${loc.lineNumber}:${loc.columnNumber} (isArtifact=${isArtifact})`);
  });
  page.on("pageerror", (err) => {
    console.log(`[${time()}] [${label}] PAGEERROR: ${err.message}`);
  });

  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(3000);
  } catch (e) {
    console.log(`[${time()}] [${label}] GOTO ERROR: ${e.message}`);
  } finally {
    await page.close();
  }
}

async function run() {
  const browser = await chromium.launch({
    args: ["--allow-file-access-from-files", "--disable-dev-shm-usage"],
  });

  for (const id of ids) {
    const entry = selection.find((e) => e.id === id);
    if (!entry) {
      console.error(`Document not found: ${id}`);
      continue;
    }
    console.log(`\n================================================================`);
    console.log(`DOCUMENT: ${id}`);
    console.log(`================================================================`);

    const linked = await renderLinked(entry);
    if (!linked.page) {
      console.error(`renderLinked failed for ${id}`);
      linked.discard?.();
      continue;
    }

    const stem = linked.stem ?? basename(linked.page, ".html");
    const linkedOutput = join(linked.directory, `${stem}.octavo.html`);

    const res = spawnSync(binary, [linked.page, linkedOutput, "--level", "safe", "--no-fetch"], { encoding: "utf8" });
    if (res.status !== 0) {
      console.error(`octavo failed: ${res.stderr}`);
    } else {
      console.log(`octavo generated ${linkedOutput}`);
      await inspect(browser, linked.page, "ORIGINAL");
      await inspect(browser, linkedOutput, "OPTIMIZED");

      const report = await verify(linked.page, linkedOutput, {
        linked: true,
        roots: { original: linked.directory, optimized: linked.directory },
      });
      const issues = report.flatMap(({ scenario, issues: found }) => found.map((issue) => `${scenario}: ${issue}`));
      console.log(`\nVERIFY REPORT FOR ${id}:`);
      if (issues.length === 0) {
        console.log("  ALL OK");
      } else {
        for (const issue of issues) {
          console.log(`  ISSUE: ${issue}`);
        }
      }
    }

    rmSync(linkedOutput, { force: true });
    linked.discard?.();
  }

  await browser.close();
  await closeBrowser();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
