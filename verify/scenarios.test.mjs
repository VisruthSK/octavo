import test from "node:test";
import assert from "node:assert/strict";
import { SCENARIO_SETS, scenarios, scenariosFor } from "./capture.mjs";

test("the serve set keeps every scenario and the full sweep", () => {
  assert.deepEqual(
    scenariosFor("serve").map((scenario) => scenario.name),
    ["desktop-light", "desktop-dark", "mobile", "tablet", "motion", "no-js", "print"],
  );
  assert.deepEqual(
    scenariosFor("serve")
      .filter((scenario) => scenario.sweep)
      .map((scenario) => scenario.name),
    ["desktop-light", "desktop-dark", "mobile", "tablet"],
  );
});

test("the portable and archive sets run three scenarios and sweep on desktop light only", () => {
  for (const level of ["portable", "archive"]) {
    assert.deepEqual(
      scenariosFor(level).map((scenario) => scenario.name),
      ["desktop-light", "mobile", "no-js"],
    );
    assert.deepEqual(
      scenariosFor(level)
        .filter((scenario) => scenario.sweep)
        .map((scenario) => scenario.name),
      ["desktop-light"],
    );
  }
});

test("the portable and archive sets only drop scenarios that keep the same verdict", () => {
  for (const level of ["portable", "archive"]) {
    for (const scenario of scenariosFor(level)) {
      const serve = scenariosFor("serve").find((entry) => entry.name === scenario.name);
      assert.ok(serve, `${level} runs ${scenario.name}, which the serve set does not`);
      assert.deepEqual(scenario.viewport, serve.viewport);
      assert.equal(scenario.colorScheme, serve.colorScheme);
      assert.equal(scenario.media, serve.media);
      assert.equal(scenario.motion, serve.motion);
      assert.equal(scenario.javaScriptEnabled, serve.javaScriptEnabled);
    }
  }
});

test("an unknown level falls back to the serve set", () => {
  assert.deepEqual(scenariosFor("nonsense"), scenariosFor("serve"));
  assert.deepEqual(scenarios, scenariosFor("serve"));
});

test("every set names known scenarios", () => {
  for (const [level, set] of Object.entries(SCENARIO_SETS)) {
    for (const name of set.scenarios) {
      assert.ok(scenariosFor(level).some((scenario) => scenario.name === name), `${level}: ${name}`);
    }
    for (const name of set.sweep) {
      assert.ok(set.scenarios.includes(name), `${level}: ${name} is swept but not run`);
    }
  }
});
