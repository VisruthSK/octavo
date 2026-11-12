import test from "node:test";
import assert from "node:assert/strict";
import { capabilities, engineName, engineNotice, launchOptions } from "./browser.mjs";

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

test("only chromium forces pseudo-class states", () => {
  assert.equal(capabilities("chromium").forcedStates, true);
  assert.equal(capabilities("firefox").forcedStates, false);
  assert.equal(capabilities("webkit").forcedStates, false);
});

test("the report names what a non-chromium engine skips", () => {
  assert.equal(engineNotice("chromium"), "chromium");
  assert.match(engineNotice("webkit"), /^webkit .*not checked/);
});

test("chromium launch options are passed through and other engines drop chromium flags", () => {
  const options = { args: ["--allow-file-access-from-files"], headless: true };
  assert.deepEqual(launchOptions("chromium", options, "chrome.exe"), { executablePath: "chrome.exe", ...options });
  assert.deepEqual(launchOptions("firefox", options), { headless: true });
});
