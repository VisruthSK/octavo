import test, { after } from "node:test";
import assert from "node:assert";

// Verify that the comparison timeout constant is set to the expected value after the fix.
test("COMPARISON_TIMEOUT_MS is set to 300000 ms", async () => {
  // Import the verify module to access the timeout constant
  const { COMPARISON_TIMEOUT_MS } = await import("./verify.mjs");
  assert.strictEqual(COMPARISON_TIMEOUT_MS, 300_000, `Expected timeout 300000 ms, got ${COMPARISON_TIMEOUT_MS}`);
});

after(async () => {
  // Clean up if needed
});