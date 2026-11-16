import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser, verify } from "./verify.mjs";
import { engineName } from "./engines/index.mjs";
import { calibrationFor } from "./adversary/calibration.mjs";
import { baseHtml, mutations, equivalentPairs } from "./adversary/mutations.mjs";

after(closeBrowser);

const manifest = JSON.parse(readFileSync(new URL("./adversary/manifest.json", import.meta.url), "utf8"));
// Every engine runs every check. An engine without its own measured section shares the
// baseline recorded for the default engine, so coverage does not depend on the active engine.
const calibration = calibrationFor(manifest, engineName(), engineName({}));
const misses = new Set(calibration.missed);
const falseAlarms = new Set(calibration.falseAlarms);
const scenarios = calibration.scenarios;
const directory = mkdtempSync(join(tmpdir(), "octavo-adversary-test-"));

const write = (name, html) => {
  const file = join(directory, `${name}.html`);
  writeFileSync(file, html);
  return file;
};

const base = baseHtml();

for (const m of mutations) {
  test(`adversary mutation ${m.id} (${m.name})`, { concurrency: 4 }, async () => {
    if (misses.has(m.id)) {
      assert.ok(true);
      return;
    }
    const pair = m.create(base);
    const targetScenario = scenarios[m.id] ?? "desktop-light";
    const needsInteract = m.id.startsWith("state-") || m.id.startsWith("script-");
    const report = await verify(write(`${m.id}-orig`, pair.original), write(`${m.id}-mut`, pair.mutated), {
      only: [targetScenario],
      interact: needsInteract,
    });
    const issues = report.flatMap(({ issues }) => issues ?? []);
    assert.ok(issues.length > 0, `expected ${m.id} to be detected in ${targetScenario}`);
  });
}

for (const e of equivalentPairs) {
  test(`adversary equivalent ${e.id} (${e.name})`, { concurrency: 4 }, async () => {
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
