import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { PNG } from "pngjs";
import { launch } from "./engines/index.mjs";
import { capture, scenariosFor, settle, trackNetwork, trackTimers } from "./capture.mjs";

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
    const [state] = (await capture(browser, file, scenariosFor("serve")[0], false)).states;
    assert.match(state.dom, /Settled/);
    assert.match(state.styles.join(""), /width:150px/);
  } finally {
    await browser.close();
  }
});

test("a capture with JavaScript disabled produces a stable digest", async () => {
  const browser = await launch();
  try {
    const scenario = scenariosFor("safe").find(({ name }) => name === "no-js");
    const result = await capture(browser, file, scenario, false, { timeoutMs: 10000 });
    assert.match(result.states[0].digest, /^[a-f0-9]{64}$/);
    assert.match(result.states[0].dom, /Title/);
  } finally {
    await browser.close();
  }
});

test("the settle treats a bare pending network object as not quiet", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    const network = { pending: 1, count: 1, last: Date.now() - 500 };
    const quiet = await settle(page, { network, limit: 200, quiet: 50 });
    assert.equal(quiet, false);
  } finally {
    await browser.close();
  }
});

test("settle waits for a new request to the same URL as an open long-lived request", async () => {
  const responses = [];
  const server = createServer((request, response) => {
    if (request.url !== "/stream") return response.end("<!doctype html><body>test</body>");
    responses.push(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript(trackTimers);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const network = trackNetwork(page);
    await page.evaluate(() => { fetch("/stream"); });
    while (responses.length < 1) await new Promise((resolve) => setTimeout(resolve, 10));
    const longLived = new Set(network.openRequests);
    await page.evaluate(() => { fetch("/stream"); });
    while (responses.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
    let settled = false;
    const result = settle(page, { network, longLived, quiet: 100, limit: 3000 }).then((value) => { settled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(settled, false);
    responses[1].end("done");
    assert.equal(await result, true);
    assert.equal(network.pending, 1);
  } finally {
    for (const response of responses) response.destroy();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
const iframeFile = join(directory, "iframe.html");
const iframeDoc = [
  "<!DOCTYPE html><html><body style=\"margin:0;background:rgb(255,0,0)\">",
  "<script>",
  "requestAnimationFrame(() => {",
  "  requestAnimationFrame(() => {",
  "    document.body.style.background = 'rgb(0,255,0)';",
  "  });",
  "});",
  "</script>",
  "</body></html>",
].join("");
writeFileSync(
  iframeFile,
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>iframe</title></head><body style="margin:0"><iframe id="frame" style="width:200px;height:200px;border:0" srcdoc="${iframeDoc.replaceAll('"', "&quot;")}"></iframe></body></html>`,
);

test("the settle waits for an iframe srcdoc to paint its frames", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(iframeFile).href, { waitUntil: "load" });
    await settle(page);
    const color = await page.evaluate(() => {
      const frame = document.getElementById("frame");
      return getComputedStyle(frame.contentDocument.body).backgroundColor;
    });
    assert.equal(color, "rgb(0, 255, 0)");
  } finally {
    await browser.close();
  }
});

test("the capture snapshot sees the updated colour inside an iframe srcdoc", async () => {
  const browser = await launch();
  try {
    const [state] = (await capture(browser, iframeFile, scenariosFor("serve")[0], false)).states;
    assert.ok(state.screenshot);
    const png = PNG.sync.read(state.screenshot);
    const offset = (50 * png.width + 50) * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    assert.equal(g > 200 && r < 50, true);
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
