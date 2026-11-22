import test from "node:test";
import assert from "node:assert/strict";
import { formatProgress, formatHeartbeat } from "./progress.mjs";

test("formatProgress formats uncached document completion line", () => {
  assert.equal(formatProgress(1, 18, "annotate-decorated", "serve", 412), "[1/18] annotate-decorated serve 412s");
});

test("formatProgress formats cached document completion line", () => {
  assert.equal(formatProgress(2, 18, "lightbox-8697", "serve", 0, true), "[2/18] lightbox-8697 serve 0s (cached)");
});

test("formatHeartbeat formats multiple in-flight documents", () => {
  const inFlight = [
    { id: "annotate-decorated", level: "serve", seconds: 412 },
    { id: "lightbox-8697", level: "serve", seconds: 95 },
  ];
  assert.equal(
    formatHeartbeat(inFlight, 18),
    "still running 2 of 18: annotate-decorated (serve) 412s, lightbox-8697 (serve) 95s",
  );
});

test("formatHeartbeat formats single in-flight document", () => {
  const inFlight = [{ id: "quarto-html", level: "archive", seconds: 30 }];
  assert.equal(formatHeartbeat(inFlight, 10), "still running 1 of 10: quarto-html (archive) 30s");
});
