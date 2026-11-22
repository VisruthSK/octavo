import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./index.mjs";
import { forcedStates } from "./states.mjs";

const directory = mkdtempSync(join(tmpdir(), "octavo-states-"));
const selector = "a[href], button, input, select, summary, [role=tab], [tabindex]";

const page = (name, css, body) => {
  const file = join(directory, `${name}.html`);
  writeFileSync(file, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>${css}</style></head><body>${body}</body></html>`);
  return pathToFileURL(file).href;
};

const observe = ({ probe }) => {
  const element = (window[Symbol.for("octavo.interactive")] ?? document.querySelectorAll(probe.selector))[probe.index];
  const style = getComputedStyle(element);
  return { style: style.color, writingMode: style.writingMode, states: {} };
};

const run = async (url, check) => {
  const browser = await launch();
  try {
    const tab = await browser.newPage();
    await tab.goto(url, { waitUntil: "load" });
    return await check(tab);
  } finally {
    await browser.close();
  }
};

const stateOf = (states, label) => states.find(([name]) => name === label)?.[1];

test("each state applies its own rule to the target", async () => {
  const url = page(
    "own",
    "a{color:rgb(1,1,1)}a:hover{color:rgb(2,2,2)}a:focus{color:rgb(3,3,3)}a:focus-visible{color:rgb(4,4,4)}a:active{color:rgb(5,5,5)}",
    '<a href="#x">x</a>',
  );
  await run(url, async (tab) => {
    const { states, checks } = await forcedStates(tab, selector, observe);
    assert.match(stateOf(states, ":hover on interactive #0"), /2, 2, 2/);
    assert.match(stateOf(states, ":focus-visible on interactive #0"), /4, 4, 4/);
    assert.match(stateOf(states, ":active on interactive #0"), /5, 5, 5/);
    assert.deepEqual([checks.elements, checks.hover, checks.focus, checks.focusVisible, checks.active], [1, 1, 1, 1, 1]);
  });
});

test("hover and active reach descendants of the hovered ancestor chain", async () => {
  const url = page("chain", "a{color:rgb(1,1,1)}.card:hover a{color:rgb(9,9,9)}", '<div class="card"><a href="#x">x</a></div>');
  await run(url, async (tab) => {
    const { states } = await forcedStates(tab, selector, observe);
    assert.match(stateOf(states, ":hover on interactive #0"), /9, 9, 9/);
    assert.match(stateOf(states, ":focus on interactive #0"), /1, 1, 1/);
  });
});

test("rules inside media queries and :not are mirrored", async () => {
  const url = page(
    "media",
    "a{color:rgb(1,1,1)}@media (min-width:1px){a:hover{color:rgb(7,7,7)}}a:not(:hover){outline:0}",
    '<a href="#x">x</a>',
  );
  await run(url, async (tab) => {
    const { states } = await forcedStates(tab, selector, observe);
    assert.match(stateOf(states, ":hover on interactive #0"), /7, 7, 7/);
  });
});

test("focus-within is not treated as focus", async () => {
  const url = page("within", "a{color:rgb(1,1,1)}div:focus-within a{color:rgb(8,8,8)}", '<div><a href="#x">x</a></div>');
  await run(url, async (tab) => {
    const { states } = await forcedStates(tab, selector, observe);
    assert.match(stateOf(states, ":focus on interactive #0"), /1, 1, 1/);
  });
});

test("the page is left exactly as it was", async () => {
  const url = page("restore", "a:hover{color:red}@media (min-width:1px){a:focus{color:blue}}", '<a href="#x">x</a>');
  await run(url, async (tab) => {
    const before = await tab.evaluate(() => [document.styleSheets[0].cssRules.length, document.styleSheets[0].cssRules[1].cssRules.length, document.documentElement.outerHTML]);
    await forcedStates(tab, selector, observe);
    const after = await tab.evaluate(() => [document.styleSheets[0].cssRules.length, document.styleSheets[0].cssRules[1].cssRules.length, document.documentElement.outerHTML]);
    assert.deepEqual(after, before);
  });
});

test("transitions are finished so the sampled style does not depend on timing", async () => {
  const url = page("transition", "a{color:rgb(1,1,1);transition:color 5s linear}a:hover{color:rgb(2,2,2)}", '<a href="#x">x</a>');
  await run(url, async (tab) => {
    const { states } = await forcedStates(tab, selector, observe);
    assert.match(stateOf(states, ":hover on interactive #0"), /2, 2, 2/);
    assert.match(stateOf(states, ":active on interactive #0"), /1, 1, 1/);
  });
});

test("a dropped state rule changes the recorded state", async () => {
  const withRule = page("with", "a{color:rgb(1,1,1)}a:hover{color:rgb(2,2,2)}", '<a href="#x">x</a>');
  const without = page("without", "a{color:rgb(1,1,1)}", '<a href="#x">x</a>');
  const first = await run(withRule, (tab) => forcedStates(tab, selector, observe));
  const second = await run(without, (tab) => forcedStates(tab, selector, observe));
  assert.notDeepEqual(first.states, second.states);
});
