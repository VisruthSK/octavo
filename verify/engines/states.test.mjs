import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch, incompleteChecks } from "./index.mjs";
import { forcedStates, withStateRules } from "./states.mjs";

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

test("a stylesheet the page cannot read is reported as an incomplete check", async () => {
  const browser = await launch();
  try {
    const tab = await browser.newPage();
    await tab.route("http://page.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: '<!DOCTYPE html><html><head><link rel="stylesheet" href="http://other.test/a.css"></head><body><a href="#x">x</a></body></html>' }),
    );
    await tab.route("http://other.test/a.css", (route) => route.fulfill({ contentType: "text/css", body: "a:hover{color:red}" }));
    await tab.goto("http://page.test/", { waitUntil: "load" });
    const { checks } = await forcedStates(tab, selector, observe);
    assert.deepEqual(checks.unreadable, ["http://other.test/a.css"]);
    assert.match(incompleteChecks(checks)[0], /1 stylesheets could not be read/);
  } finally {
    await browser.close();
  }
});

test("imported, adopted and shadow root stylesheets are mirrored and a readable page reports nothing missing", async () => {
  const url = page("shapes", "a{color:rgb(1,1,1)}", '<a href="#x">x</a><div id="host"></div>');
  await run(url, async (tab) => {
    await tab.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync("a:hover{color:rgb(6,6,6)}");
      document.adoptedStyleSheets = [sheet];
    });
    const { states, checks } = await forcedStates(tab, selector, observe);
    assert.match(stateOf(states, ":hover on interactive #0"), /6, 6, 6/);
    assert.equal(checks.mirrored, 1);
    assert.deepEqual(incompleteChecks(checks), []);
  });
});

test("state rules on a pseudo-element are mirrored onto the element that owns it", async () => {
  const url = page(
    "pseudo",
    "input{color:rgb(1,1,1)}input::-webkit-slider-thumb:hover{background:rgb(6,6,6)}input:hover::-webkit-slider-thumb{background:rgb(5,5,5)}",
    '<input type="range">',
  );
  await run(url, async (tab) => {
    const { checks } = await forcedStates(tab, selector, observe);
    assert.equal(checks.unmirrored, 0);
    assert.equal(checks.mirrored, 2);
  });
});

test("a stylesheet whose request the verifier blocked has no rules to force and is not reported", async () => {
  const browser = await launch();
  try {
    const tab = await browser.newPage();
    await tab.route("http://page.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: '<!DOCTYPE html><html><head><link rel="stylesheet" href="http://other.test/a.css"></head><body><a href="#x">x</a></body></html>' }),
    );
    await tab.route("http://other.test/a.css", (route) => route.fulfill({ contentType: "text/css", body: "a:hover{color:red}" }));
    await tab.goto("http://page.test/", { waitUntil: "load" });
    tab.blockedUrls = new Set(["http://other.test/a.css"]);
    const { checks } = await forcedStates(tab, selector, observe);
    assert.deepEqual(checks.unreadable, []);
  } finally {
    await browser.close();
  }
});

test("an unreadable data stylesheet is only reported when it contains state rules", async () => {
  const url = page("data-sheets", "", "<a href=\"#x\">x</a>");
  await run(url, async (tab) => {
    const plain = "data:text/css,.imported%7Bmargin-left%3A1px%7D";
    const stateful = "data:text/css,a%3Ahover%7Bcolor%3Ared%7D";
    assert.deepEqual(await withStateRules(tab, [plain, stateful, "https://cdn.test/a.css"]), [stateful, "https://cdn.test/a.css"]);
  });
});
