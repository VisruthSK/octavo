import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./engines/index.mjs";
import { settle, trackTimers } from "./capture.mjs";

const directory = mkdtempSync(join(tmpdir(), "octavo-mathjax-"));

const page = (name, script) => {
  const file = join(directory, name);
  writeFileSync(
    file,
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${name}</title></head><body><p>math</p><script>${script}</script></body></html>`,
  );
  return file;
};

const queue = page(
  "queue.html",
  `
window.MathJax = { Hub: { queue: { running: 0, pending: 0, queue: [] } } };
window.MathJax.Hub.queue.pending = 1;
const start = performance.now();
let frames = 0;
(function pump() {
  requestAnimationFrame(() => {
    frames++;
    if (!window.late && (frames >= 45 || performance.now() - start >= 700)) {
      window.late = new Image();
      window.late.src = "late.css";
    }
    if (window.late && (frames >= 75 || performance.now() - start >= 1200)) {
      window.MathJax.Hub.queue.pending = 0;
    } else {
      pump();
    }
  });
})();
`,
);

const startup = page(
  "startup.html",
  `
let resolveStartup;
window.MathJax = { startup: { promise: new Promise((done) => { resolveStartup = done; }) } };
window.mathjax3Done = false;
const start = performance.now();
let frames = 0;
(function pump() {
  requestAnimationFrame(() => {
    frames++;
    if (frames >= 40 || performance.now() - start >= 600) {
      window.mathjax3Done = true;
      resolveStartup();
    } else {
      pump();
    }
  });
})();
`,
);

const requests = (page) => {
  const network = { pending: 0, count: 0, last: 0 };
  const seen = [];
  page.on("request", (request) => {
    if (/^(data|blob|about):/.test(request.url())) return;
    network.pending += 1;
    network.count += 1;
    network.last = Date.now();
    if (request.url().endsWith("late.css")) seen.push(request.url());
  });
  const finished = () => {
    network.pending = Math.max(0, network.pending - 1);
    network.last = Date.now();
  };
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  return { network, seen };
};

test("the settle waits while a MathJax 2 queue is still working", async () => {
  const browser = await launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript(trackTimers);
    const page = await context.newPage();
    const { network, seen } = requests(page);
    await page.goto(pathToFileURL(queue).href, { waitUntil: "load" });
    await settle(page, { network });
    const state = await page.evaluate(() => ({
      pending: window.MathJax.Hub.queue.pending,
      late: Boolean(window.late),
    }));
    assert.equal(state.pending, 0, JSON.stringify(state));
    assert.equal(state.late, true, JSON.stringify(state));
    assert.equal(seen.length, 1, JSON.stringify({ seen, state }));
  } finally {
    await browser.close();
  }
});

test("the settle waits for the MathJax 3 startup promise", async () => {
  const browser = await launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript(trackTimers);
    const page = await context.newPage();
    const { network } = requests(page);
    await page.goto(pathToFileURL(startup).href, { waitUntil: "load" });
    await settle(page, { network });
    const done = await page.evaluate(() => window.mathjax3Done);
    assert.equal(done, true);
  } finally {
    await browser.close();
  }
});
