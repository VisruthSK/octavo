import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./index.mjs";
import { forcedStates } from "./pointer.mjs";

const directory = mkdtempSync(join(tmpdir(), "octavo-pointer-"));
const selector = "a[href], button, input, select, summary, [role=tab], [tabindex]";

const file = join(directory, "inert.html");
writeFileSync(
  file,
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title>
<style>body{margin:8px}button{width:80px;height:30px}</style></head><body>
<button id="live">Live</button>
<div inert><button id="dead">Dead</button><a id="deadlink" href="#x">Dead link</a></div>
</body></html>`,
);

const observe = ({ probe }) => {
  const element = document.querySelectorAll(probe.selector)[probe.index];
  if (!element) return { style: "", states: {} };
  const style = getComputedStyle(element);
  return {
    style: style.color,
    writingMode: style.writingMode,
    states: {
      hover: element.matches(":hover"),
      focus: element.matches(":focus"),
      focusVisible: element.matches(":focus-visible"),
      active: element.matches(":active"),
    },
  };
};

test("forced states record inert targets as unreachable without retrying every state", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    const start = Date.now();
    const { checks, states } = await forcedStates(page, selector, observe);
    const duration = Date.now() - start;
    assert.deepEqual(checks.details, { hover: [], focus: [], focusVisible: [], active: [] });
    assert.equal(checks.unreachable.elements, 2);
    assert.equal(checks.unreachable.hover, 2);
    assert.equal(checks.unreachable.focus, 2);
    assert.equal(checks.unreachable.active, 2);
    assert.equal(states.find(([label]) => label === ":hover on interactive #1")?.[1], "unreachable");
    assert.equal(states.find(([label]) => label === ":active on interactive #2")?.[1], "unreachable");
    assert.ok(checks.hover >= 1, "the live button is still hovered");
    assert.ok(checks.focus >= 1, "the live button is still focused");
    assert.ok(checks.active >= 1, "the live button is still active");
    assert.ok(duration < 15000, `duration ${duration}ms >= 15000ms`);
  } finally {
    await browser.close();
  }
});


test("clipped skip links and negative tabindex targets remain focusable", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>a { position: absolute; clip: rect(0, 0, 0, 0); width: 1px; height: 1px } a:focus { clip: auto; width: auto; height: auto }</style><a href="#content">Skip</a><main id="content" tabindex="-1">Content</main><main id="plain">Plain</main>`);
    const { checks, states } = await forcedStates(page, "a, main", observe);
    assert.equal(checks.focus, 2);
    assert.equal(checks.focusVisible, 2);
    assert.equal(states.find(([label]) => label === ":hover on interactive #0")[1], "unreachable");
    assert.equal(states.find(([label]) => label === ":focus on interactive #2")[1], "unreachable");
    assert.ok(checks.unreachable.details.some((detail) => detail.includes("main#plain") && detail.includes("not focusable")));
  } finally {
    await browser.close();
  }
});
