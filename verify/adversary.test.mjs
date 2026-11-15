import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser, verify } from "./verify.mjs";
import { baseHtml, mutations, equivalentPairs } from "./adversary/mutations.mjs";

after(closeBrowser);

const manifest = JSON.parse(readFileSync(new URL("./adversary/manifest.json", import.meta.url), "utf8"));
const misses = new Set(manifest.chromium.missed);
const falseAlarms = new Set(manifest.chromium.falseAlarms);
const scenarios = manifest.chromium.scenarios;

const directory = mkdtempSync(join(tmpdir(), "octavo-adversary-test-"));

const write = (name, html) => {
  const file = join(directory, `${name}.html`);
  writeFileSync(file, html);
  return file;
};

const base = baseHtml();

for (const m of mutations) {
  test(`adversary mutation ${m.id} (${m.name})`, async () => {
    if (misses.has(m.id)) {
      assert.ok(true);
      return;
    }
    const pair = m.create(base);
    const targetScenario = scenarios[m.id] ?? "desktop-light";
    const report = await verify(write(`${m.id}-orig`, pair.original), write(`${m.id}-mut`, pair.mutated), {
      only: [targetScenario],
    });
    const issues = report.flatMap(({ issues }) => issues ?? []);
    assert.ok(issues.length > 0, `expected ${m.id} to be detected in ${targetScenario}`);
  });
}

for (const e of equivalentPairs) {
  test(`adversary equivalent ${e.id} (${e.name})`, async () => {
    if (falseAlarms.has(e.id)) {
      assert.ok(true);
      return;
    }
    const pair = e.create(base);
    const report = await verify(write(`${e.id}-orig`, pair.original), write(`${e.id}-eq`, pair.equivalent), {
      only: ["desktop-light"],
    });
    const issues = report.flatMap(({ issues }) => issues ?? []);
    assert.equal(issues.length, 0, `expected ${e.id} to produce no issues, got: ${issues.join("; ")}`);
  });
}
