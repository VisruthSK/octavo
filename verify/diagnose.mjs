import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { launch } from "./engines/index.mjs";
import { capture, scenarios } from "./capture.mjs";
import { differences } from "./compare.mjs";

const [original, optimized, scenarioName, directory] = process.argv.slice(2);
const scenario = scenarios.find((entry) => entry.name === scenarioName);
if (!scenario) throw new Error(`unknown scenario ${scenarioName}`);
mkdirSync(directory, { recursive: true });

const probe = (page, point) =>
  page.evaluate(
    ({ point }) => {
      const describe = (element) => {
        if (!element) return null;
        const computed = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          class: element.className?.toString?.() || null,
          backgroundColor: computed.backgroundColor,
          color: computed.color,
          colorScheme: computed.colorScheme,
        };
      };
      const iframes = [...document.querySelectorAll("iframe")].map((frame) => {
        const rect = frame.getBoundingClientRect();
        let inner;
        try {
          inner = frame.contentDocument
            ? {
                href: frame.contentDocument.location?.href ?? null,
                readyState: frame.contentDocument.readyState,
                title: frame.contentDocument.title,
                html: describe(frame.contentDocument.documentElement),
                body: describe(frame.contentDocument.body),
              }
            : { crossOrigin: true };
        } catch (error) {
          inner = { error: error.message };
        }
        return { src: frame.getAttribute("src"), resolved: frame.src, srcdoc: frame.srcdoc || null, box: [rect.x, rect.y, rect.width, rect.height], inner };
      });
      const at = point ? document.elementFromPoint(point[0], point[1]) : null;
      return {
        prefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
        html: describe(document.documentElement),
        body: describe(document.body),
        elementAtPoint: describe(at),
        iframes,
        iframeRequests: performance
          .getEntriesByType("resource")
          .filter((entry) => entry.initiatorType === "iframe" || /\.html$/.test(entry.name))
          .map((entry) => ({ name: entry.name, duration: Math.round(entry.duration), transferSize: entry.transferSize })),
      };
    },
    { point },
  );

const open = await launch({ args: ["--allow-file-access-from-files"] });
try {
  const before = await capture(open, original, scenario, false, { interact: false });
  const after = await capture(open, optimized, scenario, false, { interact: false });
  const left = PNG.sync.read(before.states[0].screenshot);
  const right = PNG.sync.read(after.states[0].screenshot);
  writeFileSync(join(directory, "original.png"), before.states[0].screenshot);
  writeFileSync(join(directory, "optimized.png"), after.states[0].screenshot);
  const lines = [];
  let point = null;
  if (left.width !== right.width || left.height !== right.height) {
    lines.push(`sizes differ: ${left.width}x${left.height} vs ${right.width}x${right.height}`);
  } else {
    const found = differences(left, right);
    lines.push(`pixels off by more than one level: ${found.count}`, `pixels off by exactly one level: ${found.rounded}`);
    const [minX, minY, maxX, maxY] = found.anyBox;
    if (maxX >= 0) {
      lines.push(`pixels that differ at all lie within x ${minX}-${maxX} y ${minY}-${maxY}`);
      for (let y = minY; y <= Math.min(maxY, minY + 8); y++) {
        for (let x = minX; x <= Math.min(maxX, minX + 8); x++) {
          const at = (y * left.width + x) * 4;
          if (left.data[at] !== right.data[at] || left.data[at + 1] !== right.data[at + 1] || left.data[at + 2] !== right.data[at + 2]) {
            lines.push(`first (${x},${y}) rgba(${left.data.subarray(at, at + 4).join(",")}) vs rgba(${right.data.subarray(at, at + 4).join(",")})`);
            y = maxY;
            break;
          }
        }
      }
      point = [minX, minY];
    }
  }
  writeFileSync(join(directory, "summary.txt"), `${lines.join("\n")}\n`);
  const sides = {};
  const context = await open.newContext({ viewport: scenario.viewport, colorScheme: scenario.colorScheme, deviceScaleFactor: 1, reducedMotion: "reduce" });
  try {
    for (const [side, file] of [["original", original], ["optimized", optimized]]) {
      const page = await context.newPage();
      await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1000);
      sides[side] = await probe(page, point);
      await page.close();
    }
  } finally {
    await context.close();
  }
  writeFileSync(join(directory, "probe.json"), `${JSON.stringify({ engine: process.env.OCTAVO_BROWSER || "chromium", scenario: scenario.name, point, sides }, null, 2)}\n`);
} finally {
  await open.close();
}
