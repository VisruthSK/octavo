import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./engines/index.mjs";
import { capture, scenariosFor, settle, trackTimers } from "./capture.mjs";

const directory = mkdtempSync(join(tmpdir(), "octavo-settle-"));

const style = [
  "body{margin:8px;font:16px sans-serif}",
  ".box{width:50px;height:50px;background:rgb(10,20,30);transition:width 400ms linear}",
  ".box.wide{width:150px}",
].join("");

const body = `<h1 id="head">Title</h1><div class="box" id="box"></div>
<script>
setTimeout(() => { document.getElementById("box").classList.add("wide"); }, 100);
setTimeout(() => { document.getElementById("head").textContent = "Settled"; }, 300);
</script>`;

const file = join(directory, "late.html");
writeFileSync(
  file,
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>${style}</style></head><body>${body}</body></html>`,
);

const finalState = (page) =>
  page.evaluate(() => ({
    text: document.getElementById("head").textContent,
    width: getComputedStyle(document.getElementById("box")).width,
  }));

test("the settle waits for a late timeout and for a transition to finish", async () => {
  const browser = await launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript(trackTimers);
    const page = await context.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await settle(page);
    assert.deepEqual(await finalState(page), { text: "Settled", width: "150px" });
  } finally {
    await browser.close();
  }
});

test("the capture sees the state after the timeout and the transition", async () => {
  const browser = await launch();
  try {
    const [state] = (await capture(browser, file, scenariosFor("safe")[0], false)).states;
    assert.match(state.dom, /Settled/);
    assert.match(state.styles.join(""), /width:150px/);
  } finally {
    await browser.close();
  }
});

test("the capture waits for an attribute set after a delay", async () => {
  const delayedFile = join(directory, "delayed-attr.html");
  writeFileSync(
    delayedFile,
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body>
<div id="target" data-status="pending">Initial</div>
<script>
setTimeout(() => {
  const el = document.getElementById("target");
  el.setAttribute("data-status", "ready");
  el.textContent = "Settled Attribute";
}, 200);
</script></body></html>`,
  );
  const browser = await launch();
  try {
    const [state] = (await capture(browser, delayedFile, scenariosFor("safe")[0], false)).states;
    assert.match(state.dom, /data-status="ready"/);
    assert.match(state.dom, /Settled Attribute/);
  } finally {
    await browser.close();
  }
});

test("a page with an empty .reveal div and no Reveal object settles in under 2 s with JS enabled", async () => {
  const emptyRevealFile = join(directory, "empty-reveal-js.html");
  writeFileSync(
    emptyRevealFile,
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>t</title></head><body><div class=\"reveal\"></div></body></html>",
  );
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(emptyRevealFile).href, { waitUntil: "load" });
    const start = Date.now();
    const settled = await settle(page, { javaScriptEnabled: true });
    const duration = Date.now() - start;
    assert.equal(settled, true);
    assert.ok(duration < 2000, `duration ${duration}ms >= 2000ms`);
  } finally {
    await browser.close();
  }
});

test("a page with an empty .reveal div and no Reveal object settles in under 2 s with JS disabled", async () => {
  const emptyRevealFile = join(directory, "empty-reveal-nojs.html");
  writeFileSync(
    emptyRevealFile,
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>t</title></head><body><div class=\"reveal\"></div></body></html>",
  );
  const browser = await launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pathToFileURL(emptyRevealFile).href, { waitUntil: "load" });
    const start = Date.now();
    const settled = await settle(page, { javaScriptEnabled: false });
    const duration = Date.now() - start;
    assert.equal(settled, true);
    assert.ok(duration < 2000, `duration ${duration}ms >= 2000ms`);
  } finally {
    await browser.close();
  }
});

test("delayed Reveal readiness test still waits", async () => {
  const delayedRevealFile = join(directory, "delayed-reveal.html");
  writeFileSync(
    delayedRevealFile,
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body>
<div class="reveal"></div>
<script>
window.Reveal = { isReady: () => false };
setTimeout(() => {
  window.Reveal.isReady = () => true;
  document.querySelector('.reveal').setAttribute('data-ready', 'true');
}, 300);
</script></body></html>`,
  );
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(delayedRevealFile).href, { waitUntil: "load" });
    const start = Date.now();
    const settled = await settle(page);
    const duration = Date.now() - start;
    assert.equal(settled, true);
    assert.ok(duration >= 300, `duration ${duration}ms < 300ms`);
    const ready = await page.evaluate(() => document.querySelector(".reveal").getAttribute("data-ready"));
    assert.equal(ready, "true");
  } finally {
    await browser.close();
  }
});
