import test from "node:test";
import assert from "node:assert/strict";

// Constants from the handoff
const TILE_CAP = 512;
const TARGET_IDS = [
  "twenty-thousand-paragraphs",
  "parsing-very-long-line",   
  "quarto-cli-playwright-html-color-scheme-scroll-position"
];

// Viewport dimensions from evidence in Firefox report and capture.mjs
const VIEWPORTS = {
  "desktop-light": { width: 1280, height: 900 },
  "desktop-dark": { width: 1280, height: 900 },
  "mobile": { width: 390, height: 844 },
  "tablet": { width: 768, height: 1024 },
  "motion": { width: 1280, height: 900 },
  "no-js": { width: 1280, height: 900 },
  "print": { width: 1280, height: 900 }
};

// Calculate tiles needed for viewport (16px tiles)
function calculateTiles(width, height) {
  return Math.ceil(width / 16) * Math.ceil(height / 16);
}

// Simulate the scenariosFor function based on actual data
function scenariosFor(level) {
  const serveScenarios = [
    "desktop-light", "desktop-dark", "mobile", "tablet", "motion", "no-js", "print"
  ];
  const portableScenarios = ["desktop-light", "mobile", "no-js"];
  const archiveScenarios = ["desktop-light", "mobile", "no-js"];
  
  if (level === "serve") return serveScenarios.map(name => ({ name, id: name }));
  if (level === "portable") return portableScenarios.map(name => ({ name, id: name }));
  if (level === "archive") return archiveScenarios.map(name => ({ name, id: name }));
  return serveScenarios.map(name => ({ name, id: name }));
}

test("verify tile cap is not exceeded for twenty-thousand-paragraphs", () => {
  const serveScenarios = scenariosFor("serve");
  const scenario = serveScenarios.find(s => s.name === "twenty-thousand-paragraphs");
  assert.ok(scenario, "Scenario not found");
  const viewport = VIEWPORTS["desktop-light"] || { width: 1280, height: 900 };
  const tilesNeeded = calculateTiles(viewport.width, viewport.height);
  assert.ok(tilesNeeded <= TILE_CAP, `Tiles needed (${tilesNeeded}) exceeds cap (${TILE_CAP})`);
  // Also verify the calculation matches expected
  assert.equal(tilesNeeded, 80, "Tile count calculation incorrect");
});

test("verify all target IDs exist in scenarios", () => {
  const serveScenarios = scenariosFor("serve");
  const serveNames = serveScenarios.map(s => s.name);
  for (const id of TARGET_IDS) {
    assert.ok(serveNames.includes(id), `Target ID ${id} not found in scenarios`);
  }
});
