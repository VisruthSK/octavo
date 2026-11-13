import test from "node:test";
import assert from "node:assert/strict";
import { SCENARIO_SETS, scenarios, scenariosFor } from "./capture.mjs";

test("the safe set keeps every scenario and the full sweep", () => {
  assert.deepEqual(
    scenariosFor("safe").map((scenario) => scenario.name),
    ["desktop-light", "desktop-dark", "mobile", "tablet", "motion", "no-js", "print"],
  );
  assert.deepEqual(
    scenariosFor("safe")
      .filter((scenario) => scenario.sweep)
      .map((scenario) => scenario.name),
    ["desktop-light", "desktop-dark", "mobile", "tablet"],
  );
});

test("the scripts and packed sets run three scenarios and sweep on desktop light only", () => {
  for (const level of ["scripts", "packed"]) {
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

test("the scripts and packed sets only drop scenarios that keep the same verdict", () => {
  for (const level of ["scripts", "packed"]) {
    for (const scenario of scenariosFor(level)) {
      const safe = scenariosFor("safe").find((entry) => entry.name === scenario.name);
      assert.ok(safe, `${level} runs ${scenario.name}, which the safe set does not`);
      assert.deepEqual(scenario.viewport, safe.viewport);
      assert.equal(scenario.colorScheme, safe.colorScheme);
      assert.equal(scenario.media, safe.media);
      assert.equal(scenario.motion, safe.motion);
      assert.equal(scenario.javaScriptEnabled, safe.javaScriptEnabled);
    }
  }
});

test("an unknown level falls back to the safe set", () => {
  assert.deepEqual(scenariosFor("nonsense"), scenariosFor("safe"));
  assert.deepEqual(scenarios, scenariosFor("safe"));
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
