import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDocument } from "./capture.mjs";
import { engine } from "./engines/index.mjs";

{
  test(`${engine.name} uses a common origin for files and resources`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "octavo-origin-"));
    const browser = await engine.launch();
    try {
      const captures = [];
      for (const side of ["original", "optimized"]) {
        const folder = join(dir, side);
        await mkdir(folder);
        await writeFile(join(folder, "page.html"), '<iframe src="missing.html"></iframe>');
        await writeFile(join(folder, "data.json"), '{"value":42}');
        await writeFile(join(dir, "secret.json"), '42');
        const page = await browser.newPage();
        const errors = [];
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await loadDocument(page, join(folder, "page.html"));
        const result = await page.evaluate(async () => ({
          value: (await (await fetch("data.json")).json()).value,
          traversal: (await fetch("/..%2fsecret.json")).status,
        }));
        captures.push({ url: page.url(), errors, screenshot: await page.screenshot(), ...result });
        await page.close();
      }
      assert.deepEqual(captures[0], captures[1]);
      assert.equal(captures[0].url, "http://localhost/index.html");
      assert.equal(captures[0].value, 42);
      assert.equal(captures[0].traversal, 404);
      const page = await browser.newPage();
      await loadDocument(page, join(dir, "original", "page.html"), dir);
      assert.equal(page.url(), "http://localhost/original/page.html");
      await page.close();
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test(`${engine.name} serves the virtual origin as a secure context so image fingerprints can hash pixels`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "octavo-secure-"));
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    const file = join(dir, "page.html");
    await writeFile(file, "<!DOCTYPE html><title>x</title><p>x</p>");
    await loadDocument(page, file);
    assert.equal(await page.evaluate(() => window.isSecureContext && typeof crypto.subtle?.digest === "function"), true);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test(`${engine.name} blocks every request that leaves the virtual origin`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "octavo-hermetic-"));
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    const failed = [];
    page.on("requestfailed", (request) => failed.push(request.url()));
    const file = join(dir, "page.html");
    await writeFile(file, '<!DOCTYPE html><title>x</title><script src="https://example.com/a.js"></script><p>x</p>');
    await loadDocument(page, file);
    assert.deepEqual(failed, ["https://example.com/a.js"]);
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
});
