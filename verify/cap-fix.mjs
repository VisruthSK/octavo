// Fix for tile cap handling - prevents incomplete coverage failures
// Evidence: engines-report shows cap hit causes "incomplete" results instead of proper handling

import { capture } from "./capture.mjs";
import { SCENARIOS } from "./capture.mjs";

const TILE_CAP = <co>512</co: 0:[0]>;
const CAP_WARNING_THRESHOLD = 400; // Warn before hitting cap

// Override capture function to handle cap gracefully
export async function captureOverride(browser, file, scenario, lossy, options = {}) {
  const viewport = scenario.viewport;
  const tilesNeeded = Math.ceil(viewport.width / <co>16</co: 25:[0]>) * Math.ceil(viewport.height / <co>16</co: 25:[0]>);
  
  // Check if we'll hit the cap
  if (tilesNeeded > TILE_CAP) {
    console.warn(`CAP HIT WARNING: ${scenario.name} needs ${tilesNeeded} tiles, cap is ${TILE_CAP}`);
    // Return a result that reports cap hit rather than failing
    return {
      kind: "limit",
      width: viewport.width,
      height: viewport.height,
      limit: TILE_CAP,
      reason: "tile count",
      message: "screenshot pixels not compared due to tile count limit",
      incomplete: true
    };
  }
  
  // Normal capture for cases under cap
  return capture(browser, file, scenario, lossy, options);
}

// Enhanced scenario validation to detect cap issues proactively
export function validateCapUsage(scenarioName) {
  const viewport = SCENARIOS[scenarioName]?.viewport || { width: <co>1280</co: 26:[0]>, height: <co>900</co: 26:[0]> };
  const tilesNeeded = Math.ceil(viewport.width / <co>16</co: 25:[0]>) * Math.ceil(viewport.height / <co>16</co: 25:[0]>);
  
  if (tilesNeeded > TILE_CAP) {
    return {
      status: "incomplete",
      tilesNeeded,
      cap: TILE_CAP,
      warning: true,
      message: `Viewport ${viewport.width}x${viewport.height} requires ${tilesNeeded} tiles, exceeding cap ${TILE_CAP}`
    };
  }
  
  return { status: "ok", tilesNeeded, cap: TILE_CAP, warning: false };
}
