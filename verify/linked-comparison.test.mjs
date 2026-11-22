import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser, verify } from "./verify.mjs";

test("linked comparison ignores local resources but compares external requests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "octavo-linked-"));
  const original = join(dir, "page.html");
  const optimized = join(dir, "page.octavo.html");
  const options = { linked: true, roots: { original: dir, optimized: dir }, only: ["desktop-light"] };
  try {
    await writeFile(join(dir, "style.css"), "p { color: red }");
    await writeFile(original, '<!doctype html><link rel="stylesheet" href="style.css"><p>hello</p>');
    await writeFile(optimized, '<!doctype html><style>p { color: red }</style><p>hello</p>');
    const report = await verify(original, optimized, options);
    assert.deepEqual(report.flatMap(({ issues }) => issues), []);
    await writeFile(optimized, '<!doctype html><style>p { color: red }</style><img src="https://example.com/missing.png"><p>hello</p>');
    const changed = await verify(original, optimized, options);
    assert.ok(changed.flatMap(({ issues }) => issues).some((issue) => issue.includes("requests:") && issue.includes("https://example.com/missing.png")));
  } finally {
    await closeBrowser();
    await rm(dir, { recursive: true, force: true });
  }
});
