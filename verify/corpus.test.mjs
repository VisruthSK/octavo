import assert from "node:assert/strict";
import test from "node:test";
import { brotli, gzip, computeWireSizes, generateReport } from "./corpus.mjs";

test("brotli and gzip compute compressed lengths", () => {
  const content = "<html><body>" + "hello world ".repeat(200) + "</body></html>";
  const br = brotli(content, 11);
  const gz = gzip(content);
  assert.ok(br > 0 && br < content.length);
  assert.ok(gz > 0 && gz < content.length);
});

test("computeWireSizes selects q11 when within time budget", () => {
  const results = [
    {
      id: "doc-1",
      category: "cat1",
      level: "serve",
      inBytes: 1000,
      outBytes: 500,
      ms: 100,
      produced: "<html>" + "a".repeat(400) + "</html>",
      baselines: {},
      problems: [],
    },
  ];
  const quality = computeWireSizes(results, 50000);
  assert.equal(quality, 11);
  assert.ok(results[0].baselines.brotliOptimized > 0);
  assert.ok(results[0].baselines.gzipOptimized > 0);
});

test("computeWireSizes falls back to q9 when q11 exceeds time budget", () => {
  const results = [
    {
      id: "doc-1",
      category: "cat1",
      level: "serve",
      inBytes: 10000,
      outBytes: 5000,
      ms: 1,
      produced: "<html>" + "xyz ".repeat(1000) + "</html>",
      baselines: {},
      problems: [],
    },
  ];
  const quality = computeWireSizes(results, 0.0001);
  assert.equal(quality, 9);
  assert.ok(results[0].baselines.brotliOptimized > 0);
  assert.ok(results[0].baselines.gzipOptimized > 0);
});

test("generateReport includes wire size columns for q11", () => {
  const results = [
    {
      id: "doc-1",
      category: "cat1",
      level: "serve",
      inBytes: 2048,
      outBytes: 1024,
      ms: 50,
      baselines: {
        naive: 1800,
        brotliOriginal: 600,
        brotliOptimized: 400,
        gzipOptimized: 500,
      },
      problems: [],
    },
  ];
  const text = generateReport(results, { brotliQuality: 11, levels: ["serve"] });
  assert.ok(text.includes("| Level | Docs | Input MiB | Output MiB | Brotli q11 MiB | Gzip 9 MiB | Output as % of input | Octavo seconds | MiB/s |"));
  assert.ok(text.includes("| Category / level | Docs | Input KiB | Output KiB | Brotli q11 KiB | Gzip 9 KiB | Median ratio | p50 ms | p95 ms | Naive KiB | Brotli(original) KiB |"));
  assert.ok(text.includes("| cat1 / serve | 1 | 2.0 | 1.0 | 0.4 | 0.5 | 2.00 | 50 | 50 | 1.8 | 0.6 |"));
});

test("generateReport includes wire size columns for q9", () => {
  const results = [
    {
      id: "doc-1",
      category: "cat1",
      level: "serve",
      inBytes: 2048,
      outBytes: 1024,
      ms: 50,
      baselines: {
        naive: 1800,
        brotliOriginal: 600,
        brotliOptimized: 420,
        gzipOptimized: 500,
      },
      problems: [],
    },
  ];
  const text = generateReport(results, { brotliQuality: 9, levels: ["serve"] });
  assert.ok(text.includes("| Level | Docs | Input MiB | Output MiB | Brotli q9 MiB | Gzip 9 MiB | Output as % of input | Octavo seconds | MiB/s |"));
  assert.ok(text.includes("| Category / level | Docs | Input KiB | Output KiB | Brotli q9 KiB | Gzip 9 KiB | Median ratio | p50 ms | p95 ms | Naive KiB | Brotli(original) KiB |"));
  assert.ok(text.includes("| cat1 / serve | 1 | 2.0 | 1.0 | 0.4 | 0.5 | 2.00 | 50 | 50 | 1.8 | 0.6 |"));
});


test("archive no-js capture failures are not ignored", async () => {
  const { ignoredArchiveNoJsIssue } = await import("./corpus.mjs");
  for (const issue of ["crashed: original=failed optimized=failed", "capture timed out during confirmation", "verification deadline reached during document comparison", "screenshot missing", "check incomplete: focus"]) {
    assert.equal(ignoredArchiveNoJsIssue(issue), false);
  }
  assert.equal(ignoredArchiveNoJsIssue("pixels differ"), true);
});
