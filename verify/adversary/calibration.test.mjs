import test from "node:test";
import assert from "node:assert/strict";
import { calibrationFor } from "./calibration.mjs";
import { engineName, engineNames } from "../engines/index.mjs";

const baseline = engineName({});
const shared = { missed: ["css-drop-focus"], falseAlarms: [], scenarios: { "css-drop-rule": "desktop-light" } };
const manifest = { [baseline]: shared };

test("an engine without its own calibration runs the shared baseline", () => {
  for (const name of engineNames) {
    assert.equal(calibrationFor(manifest, name, baseline), shared, name);
  }
});

test("a recorded engine calibration takes precedence over the shared baseline", () => {
  const own = { missed: [], falseAlarms: [], scenarios: {} };
  assert.equal(calibrationFor({ ...manifest, [engineNames[0]]: own }, engineNames[0], baseline), own);
});
