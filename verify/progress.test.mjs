import test from "node:test";
import assert from "node:assert/strict";
import { formatProgress, formatHeartbeat } from "./progress.mjs";

test("formatProgress formats uncached document completion line", () => {
  assert.equal(formatProgress(1, 18, "annotate-decorated", "safe", 412), "[1/18] annotate-decorated safe 412s");
});

test("formatProgress formats cached document completion line", () => {
  assert.equal(formatProgress(2, 18, "lightbox-8697", "safe", 0, true), "[2/18] lightbox-8697 safe 0s (cached)");
});

test("formatHeartbeat formats multiple in-flight documents", () => {
  const inFlight = [
    { id: "annotate-decorated", level: "safe", seconds: 412 },
    { id: "lightbox-8697", level: "safe", seconds: 95 },
  ];
  assert.equal(
    formatHeartbeat(inFlight, 18),
    "still running 2 of 18: annotate-decorated (safe) 412s, lightbox-8697 (safe) 95s",
  );
});

test("formatHeartbeat formats single in-flight document", () => {
  const inFlight = [{ id: "quarto-html", level: "packed", seconds: 30 }];
  assert.equal(formatHeartbeat(inFlight, 10), "still running 1 of 10: quarto-html (packed) 30s");
});
