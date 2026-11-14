import test from "node:test";
import assert from "node:assert/strict";
import { captureDeadline } from "../capture.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as chromium from "./chromium.mjs";
import * as firefox from "./firefox.mjs";
import * as webkit from "./webkit.mjs";
import { checksOf, engineName, engineNames, engineNotice, incompleteChecks, withIncompleteCheckIssues } from "./index.mjs";

const engines = { chromium, firefox, webkit };
const shape = {
  name: "string",
  label: "string",
  tag: "string",
  isolated: "boolean",
  contextOptions: "object",
  placeholderStyle: "boolean",
  pixel: "object",
  noise: "object",
  launch: "function",
  identity: "function",
  settle: "function",
  normalizeError: "function",
  forcedStates: "function",
  focus: "function",
};

test("every engine implements the whole interface with the right types and nothing else", () => {
  for (const [name, module] of Object.entries(engines)) {
    assert.deepEqual(Object.keys({ ...module }).sort(), Object.keys(shape).sort(), name);
    for (const [key, type] of Object.entries(shape)) {
      const value = module[key];
      if (type === "object") assert.ok(value && typeof value === "object", `${name}.${key}`);
      else assert.equal(typeof value, type, `${name}.${key}`);
    }
    assert.equal(module.name, name);
  }
});

test("no verifier file outside the engines names a browser", () => {
  const verify = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const file of readdirSync(verify).filter((entry) => entry.endsWith(".mjs"))) {
    assert.doesNotMatch(readFileSync(join(verify, file), "utf8"), /chromium|firefox|webkit/i, file);
  }
});

test("chromium is the default engine", () => {
  assert.equal(engineName({}), "chromium");
  assert.equal(engineName({ OCTAVO_BROWSER: "" }), "chromium");
});

test("firefox and webkit are selected by name", () => {
  assert.equal(engineName({ OCTAVO_BROWSER: "firefox" }), "firefox");
  assert.equal(engineName({ OCTAVO_BROWSER: "webkit" }), "webkit");
});

test("placeholder computed-style support is declared per engine", () => {
  assert.equal(chromium.placeholderStyle, true);
  assert.equal(firefox.placeholderStyle, true);
  assert.equal(webkit.placeholderStyle, false);
});

test("an unknown engine is refused with its name", () => {
  assert.throws(() => engineName({ OCTAVO_BROWSER: "safari" }), /not safari/);
  assert.throws(() => engineName({ OCTAVO_BROWSER: "toString" }), /not toString/);
});

test("every engine is listed and described", () => {
  assert.deepEqual(engineNames, ["chromium", "firefox", "webkit"]);
  for (const module of Object.values(engines)) assert.ok(module.label, module.name);
  assert.match(engineNotice(), /\(\w+\)/);
});

test("every engine has a pixel tolerance above its measured noise", () => {
  for (const [name, module] of Object.entries(engines)) {
    assert.ok(module.pixel.channel >= 1, name);
    assert.ok(module.pixel.channel > module.noise.max, name);
    assert.ok(module.pixel.faint >= module.pixel.channel, name);
    assert.ok(module.pixel.budget >= 0, name);
    assert.ok(module.noise.pixels > 0, name);
    assert.equal(module.noise.differing, 0, name);
  }
});

test("firefox gives every capture a browser of its own", () => {
  assert.equal(firefox.isolated, true);
  assert.equal(chromium.isolated, false);
  assert.equal(webkit.isolated, false);
});

test("a check that could not be applied is reported", () => {
  assert.deepEqual(checksOf({ elements: 4, hover: 4, focus: 4, focusVisible: 4, active: 4 }), []);
  assert.deepEqual(checksOf({ elements: 4, hover: 3, focus: 4, focusVisible: 4, active: 4 }), ["hover on 1 of 4 elements"]);
  assert.deepEqual(checksOf({ elements: 0, hover: 0, focus: 0, focusVisible: 0, active: 0, screenshots: { taken: 3, total: 4 } }), ["screenshot on 1 of 4 states"]);
  assert.deepEqual(checksOf(null), []);
  assert.deepEqual(
    incompleteChecks({ elements: 1, hover: 1, focus: 0, focusVisible: 0, active: 0, screenshots: { taken: 0, total: 1 } }),
    ["check incomplete: focus on 1 of 1 elements", "check incomplete: focusVisible on 1 of 1 elements", "check incomplete: active on 1 of 1 elements", "check incomplete: screenshot on 1 of 1 states"],
  );
  assert.deepEqual(
    checksOf({ elements: 1, hover: 0, focus: 1, focusVisible: 1, active: 1, expected: { hover: 0, focus: 1, focusVisible: 1, active: 1 } }),
    [],
  );
});

test("an incomplete visible-control fixture creates a verification issue", () => {
  const visibleButton = {
    elements: 1,
    hover: 0,
    focus: 1,
    focusVisible: 1,
    active: 1,
    expected: { hover: 1, focus: 1, focusVisible: 1, active: 1 },
    details: { hover: ['button, selector "button", index 0: state did not apply although the target was reachable'] },
  };
  assert.deepEqual(
    withIncompleteCheckIssues([], visibleButton),
    ['check incomplete: hover on 1 of 1 elements: button, selector "button", index 0: state did not apply although the target was reachable'],
  );
});

test("browser identity changes with launch arguments and channel", () => {
  const browser = { version: () => "test" };
  assert.notEqual(chromium.identity(browser, { args: ["--first"] }), chromium.identity(browser, { args: ["--second"] }));
  assert.notEqual(chromium.identity(browser, { channel: "stable" }), chromium.identity(browser, { channel: "beta" }));
});

test("webkit error comparison keeps the error kind and ignores the source snippet", () => {
  assert.equal(webkit.normalizeError("null is not an object (evaluating 'document.body.className=`built-3`')"), "null is not an object");
  assert.equal(webkit.normalizeError("undefined is not an object (evaluating 'ev.currentSlide.querySelector')"), "undefined is not an object");
  assert.equal(webkit.normalizeError("undefined is not an object (evaluating 'ev.currentSlide.querySelector')"), webkit.normalizeError("undefined is not an object (evaluating 'e.currentSlide.querySelector')"));
  assert.notEqual(webkit.normalizeError("undefined is not an object (evaluating 'e.x')"), webkit.normalizeError("null is not an object (evaluating 'e.x')"));
  assert.equal(chromium.normalizeError("TypeError: null is not an object"), "TypeError: null is not an object");
  assert.equal(firefox.normalizeError("TypeError: null is not an object"), "TypeError: null is not an object");
  assert.equal(firefox.normalizeError("can't access property \"querySelector\", ev.currentSlide is undefined"), "can't access property \"querySelector\", <value> is undefined");
  assert.equal(firefox.normalizeError("can't access property \"querySelector\", e.currentSlide is undefined"), firefox.normalizeError("can't access property \"querySelector\", ev.currentSlide is undefined"));
  assert.notEqual(firefox.normalizeError("can't access property \"querySelector\", e.x is undefined"), firefox.normalizeError("can't access property \"classList\", e.x is undefined"));
});

test("a timed out capture closes its own browser context", async () => {
  let closed = false;
  const deadline = captureDeadline({ close: async () => { closed = true; } }, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(deadline.timedOut(), true);
  await deadline.close();
  assert.equal(closed, true);
});
