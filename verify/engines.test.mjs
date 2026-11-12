import test from "node:test";
import assert from "node:assert/strict";
import { capabilities, checksOf, engineName, engineNotice, engineNames, focusVisible, pixelTolerance, subtleCrypto } from "./engines.mjs";
import { launchOptions } from "./browser.mjs";

test("chromium is the default engine", () => {
  assert.equal(engineName({}), "chromium");
  assert.equal(engineName({ OCTAVO_BROWSER: "" }), "chromium");
});

test("firefox and webkit are selected by name", () => {
  assert.equal(engineName({ OCTAVO_BROWSER: "firefox" }), "firefox");
  assert.equal(engineName({ OCTAVO_BROWSER: "webkit" }), "webkit");
});

test("an unknown engine is refused with its name", () => {
  assert.throws(() => engineName({ OCTAVO_BROWSER: "safari" }), /not safari/);
  assert.throws(() => engineName({ OCTAVO_BROWSER: "toString" }), /not toString/);
});

test("every engine is listed and described", () => {
  assert.deepEqual(engineNames, ["chromium", "firefox", "webkit"]);
  for (const name of engineNames) {
    assert.ok(capabilities(name).label, name);
    assert.match(engineNotice(name), new RegExp(name));
  }
});

test("chromium forces the pseudo states through the protocol and the others with real events", () => {
  assert.equal(capabilities("chromium").states, "protocol");
  assert.equal(capabilities("firefox").states, "pointer");
  assert.equal(capabilities("webkit").states, "pointer");
});

test("every engine has a pixel tolerance", () => {
  for (const name of engineNames) {
    const tolerance = pixelTolerance(name);
    assert.ok(tolerance.channel >= 1, name);
    assert.ok(tolerance.faint >= tolerance.channel, name);
    assert.ok(tolerance.budget >= 0, name);
  }
});

test("every engine applies focus visible and has a subtle digest", () => {
  for (const name of engineNames) {
    assert.equal(typeof focusVisible(name), "boolean", name);
    assert.equal(typeof subtleCrypto(name), "boolean", name);
  }
});

test("a check that could not be applied is reported", () => {
  assert.deepEqual(checksOf({ elements: 4, hover: 4, focus: 4, focusVisible: 4, active: 4 }), []);
  assert.deepEqual(checksOf({ elements: 4, hover: 3, focus: 4, focusVisible: 4, active: 4 }), ["hover on 1 of 4 elements"]);
  assert.deepEqual(checksOf(null), []);
});

test("chromium launch options are passed through and other engines drop chromium flags", () => {
  const options = { args: ["--allow-file-access-from-files"], headless: true };
  assert.deepEqual(launchOptions("chromium", options, "chrome.exe"), { executablePath: "chrome.exe", ...options });
  assert.deepEqual(launchOptions("firefox", options), { headless: true });
});
