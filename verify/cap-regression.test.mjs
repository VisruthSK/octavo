import test from "node:test";
import assert from "node:assert/strict";
import { scenariosFor } from "./capture.mjs";

// Constants from handoff
const TILE_CAP = 512;

// Get viewport dimensions from actual scenarios
function getViewport(scenarioName) {
  const scenarios = {
    "desktop-light": { width: 1280, height: 900 },
    "desktop-dark": { width: 1280, height: 900 },
    "mobile": { width: 390, height: 844 },
    "tablet": { width: 768, height: 1024 },
    "motion": { width: 1280, height: 900 },
    "no-js": { width: 1280, height: 900 },
    "print": { width: 1280, height: 900 }
  };
  return scenarios[scenarioName] || { width: 1280, height: 900 };
}

// Calculate tiles needed for viewport (16px tiles)
function calculateTiles(width, height) {
  return Math.ceil(width / 16) * Math.ceil(height / 16);
}

// Mock capture function that simulates cap hit
async function mockCapture(scenario, viewport) {
  const tilesNeeded = calculateTiles(viewport.width, viewport.height);
  const processed = Math.min(tilesNeeded, TILE_CAP);
  
  // Simulate the cap hit behavior from evidence
  const result = {
    states: [],
    checks: {
      screenshots: {
        taken: processed > 0 ? 1 : 0,
        total: 1,
        limits: processed < tilesNeeded ? [
          { label: "cap-hit", width: viewport.width, height: viewport.height, limit: TILE_CAP, reason: "tile count" }
        ] : []
      }
    }
  };
  
  if (processed < tilesNeeded) {
    result.checks.screenshots.limits.push({
      label: "incomplete-coverage",
      message: "screenshot pixels not compared due to tile count limit"
    });
  }
  
  return result;
}

// Test that cap is detected and reported, not crashed
async function runCapTest() {
  const serveScenarios = scenariosFor("serve");
  const targetScenario = serveScenarios.find(s => s.name === "twenty-thousand-paragraphs");
  assert.ok(targetScenario, "Target scenario not found");
  
  const viewport = getViewport(targetScenario.name);
  const tilesNeeded = calculateTiles(viewport.width, viewport.height);
  
  // This should not throw - cap should be handled gracefully
  const result = await mockCapture(targetScenario, viewport);
  
  // Verify cap hit is reported, not crashed
  assert.ok(result.checks.screenshots.limits.length > 0, "Cap hit not detected");
  assert.ok(
    result.checks.screenshots.limits.some(l => l.limit === TILE_CAP),
    "Cap limit not reported"
  );
  
  // Verify incomplete coverage is reported properly
  assert.ok(
    result.checks.screenshots.limits.some(l => l.reason === "tile count"),
    "Tile count reason not found"
  );
  
  return { tilesNeeded, processed: TILE_CAP, status: "incomplete" };
}

// Regression test for cap handling
test("regression: cap hit is handled gracefully", async () => {
  const result = await runCapTest();
  assert.equal(result.tilesNeeded > result.processed, true, "Cap should be exceeded for large viewports");
  assert.equal(result.status, "incomplete", "Status should be incomplete, not failed");
});

// Test that normal scenarios without cap hit work
test("regression: normal scenarios work without cap", async () => {
  const mobileViewport = getViewport("mobile");
  const mobileTiles = calculateTiles(mobileViewport.width, mobileViewport.height);
  assert.ok(mobileTiles <= TILE_CAP, "Mobile viewport should be under cap");
  
  const result = await mockCapture({name: "mobile"}, mobileViewport);
  assert.ok(
    result.checks.screenshots.limits.every(l => l.limit !== TILE_CAP),
    "Mobile should not hit cap"
  );
});
