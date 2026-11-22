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
  const element = (window[Symbol.for("octavo.interactive")] ?? document.querySelectorAll(probe.selector))[probe.index];
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

test("forced states retain their targets when hovering inserts an interactive element", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const dynamicFile = join(directory, "dynamic.html");
    writeFileSync(dynamicFile, '<!DOCTYPE html><button id="first">First</button><button id="second">Second</button>');
    await page.goto(pathToFileURL(dynamicFile).href);
    await page.evaluate(() => {
      document.querySelector("#first").addEventListener("mouseenter", () => {
        if (document.querySelector("#inserted")) return;
        const inserted = document.createElement("span");
        inserted.id = "inserted";
        inserted.tabIndex = -1;
        document.querySelector("#second").before(inserted);
      });
    });
    const { checks } = await forcedStates(page, selector, observe);
    assert.equal(await page.locator("#inserted").count(), 1);
    assert.deepEqual(checks.details, { hover: [], focus: [], focusVisible: [], active: [] });
    assert.deepEqual([checks.hover, checks.focus, checks.focusVisible, checks.active], [2, 2, 2, 2]);
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

test("a control revealed only while its card is hovered is still focused and sampled", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<style>.card { padding: 40px } .reveal { display: none } .card:hover .reveal { display: inline-block } .reveal:focus { outline: 3px solid rgb(10, 88, 202) }</style><div class="card"><button>Open</button> <span class="reveal" tabindex="0">Enlarge</span></div>');
    const observe = ({ probe }) => {
      const element = window[Symbol.for("octavo.interactive")][probe.index];
      const style = getComputedStyle(element);
      return {
        style: `outline-color:${style.outlineColor}`,
        writingMode: style.writingMode,
        states: {
          hover: element.matches(":hover"),
          focus: element.matches(":focus"),
          focusVisible: element.matches(":focus-visible"),
          active: element.matches(":active"),
        },
      };
    };
    const { states, checks } = await forcedStates(page, "button, .reveal", observe);
    assert.equal(checks.focus, 2);
    assert.equal(checks.focusVisible, 2);
    assert.deepEqual(checks.details.focus, []);
    assert.deepEqual(checks.details.focusVisible, []);
    assert.match(states.find(([label]) => label === ":focus on interactive #1")[1], /rgb\(10, 88, 202\)/);
  } finally {
    await browser.close();
  }
});

test("a state that does not apply reports what is under the pointer", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="target" class="sample">Target</button>');
    const { checks } = await forcedStates(page, "button", () => ({ style: "", writingMode: "horizontal-tb", states: { hover: false, focus: false, focusVisible: false, active: false } }));
    for (const state of ["hover", "focus", "focusVisible", "active"]) {
      const context = JSON.parse(checks.details[state][0].split("; context ")[1]);
      assert.deepEqual(context.hit, { tag: "button", id: "target", class: "sample", descendant: true });
      assert.equal(context.probe.hover, false);
    }
  } finally {
    await browser.close();
  }
});

test("a target at the bottom edge of a page with a classic scrollbar is hovered inside the content area", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent('<style>html { overflow-x: scroll } body { margin: 0; height: 2000px; width: 1000px } a { position: absolute; left: 20px; top: 1976px; display: block; width: 22px; height: 24px; background: #eee } a:hover { background: #222 }</style><a href="#x">x</a>');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const observe = ({ probe }) => {
      const element = window[Symbol.for("octavo.interactive")][probe.index];
      return { style: getComputedStyle(element).backgroundColor, writingMode: "horizontal-tb", states: { hover: element.matches(":hover"), focus: element.matches(":focus"), focusVisible: element.matches(":focus-visible"), active: element.matches(":active") } };
    };
    const { checks } = await forcedStates(page, "a", observe);
    assert.deepEqual(checks.details.hover, []);
    assert.deepEqual(checks.details.active, []);
  } finally {
    await browser.close();
  }
});

test("the last element of a page is centred for sampling and the page is left as it was", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent('<!DOCTYPE html><style>body { margin: 0; height: 2000px } a { position: absolute; left: 20px; top: 1976px; display: block; width: 22px; height: 24px; background: #eee } a:hover { background: #222 }</style><a href="#x">x</a>');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const before = await page.evaluate(() => document.documentElement.scrollHeight);
    const observe = ({ probe }) => {
      const element = window[Symbol.for("octavo.interactive")][probe.index];
      const box = element.getBoundingClientRect();
      return { style: getComputedStyle(element).backgroundColor, writingMode: "horizontal-tb", states: { hover: element.matches(":hover"), focus: element.matches(":focus"), focusVisible: element.matches(":focus-visible"), active: element.matches(":active") }, middle: box.top > 200 && box.bottom < innerHeight - 200 };
    };
    const { checks } = await forcedStates(page, "a", observe);
    assert.deepEqual(checks.details.hover, []);
    assert.deepEqual(checks.details.active, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), before);
    assert.equal(await page.evaluate(() => document.getElementById("octavo-sweep-spacer")), null);
  } finally {
    await browser.close();
  }
});
