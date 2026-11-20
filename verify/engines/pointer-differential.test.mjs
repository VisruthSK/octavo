import test from "node:test";
import assert from "node:assert/strict";
import * as chromium from "./chromium.mjs";
import * as firefox from "./firefox.mjs";
import * as webkit from "./webkit.mjs";
import { forcedStates as reference } from "./pointer-reference.mjs";
import { forcedStates } from "./pointer.mjs";

const selector = "a[href], button, input, select, summary, [role=tab], [tabindex]";
const fixtures = {
  static: `<button>One</button><a href="#a">Two</a>`,
  popper: `<button id="target">Hover</button><script>target.addEventListener("mouseenter", () => { const p = document.createElement("div"); p.textContent = "Tip"; p.id = "tip"; document.body.append(p) }, { once: true })</script>`,
  anchor: `<style>.anchor { visibility: hidden } h2:hover .anchor { visibility: visible }</style><h2>Heading <a class="anchor" href="#heading">#</a></h2>`,
  covered: `<button>Covered</button><div style="position:absolute;inset:0;background:white"></div>`,
  clipped: `<a href="#content" style="position:absolute;clip:rect(0px,0px,0px,0px)">Skip</a>`,
  tabindex: `<button tabindex="-1">Programmatic</button>`,
  hidden: `<button hidden>Hidden</button><button style="visibility:hidden">Invisible</button>`,
  noState: `<button id="target">Blurred</button><script>target.addEventListener("focus", () => target.blur())</script>`,
};

const observe = ({ probe }) => {
  const target = document.querySelectorAll(probe.selector)[probe.index];
  const style = getComputedStyle(target);
  return {
    style: style.color,
    writingMode: style.writingMode,
    states: {
      hover: target.matches(":hover"),
      focus: target.matches(":focus"),
      focusVisible: target.matches(":focus-visible"),
      active: target.matches(":active"),
    },
  };
};

for (const [name, engine] of Object.entries({ chromium, firefox, webkit }).filter(([name]) => name === (process.env.OCTAVO_BROWSER || "chromium"))) {
  test(`${name} forced-state sweep matches its reference`, async () => {
    const browser = await engine.launch();
    try {
      for (const [fixture, html] of Object.entries(fixtures)) {
        const original = await browser.newPage();
        const candidate = await browser.newPage();
        try {
          await original.setContent(html);
          await candidate.setContent(html);
          const expected = await reference(original, selector, observe);
          const actual = await forcedStates(candidate, selector, observe);
          assert.deepEqual(actual, expected, fixture);
        } finally {
          await original.close();
          await candidate.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
}

