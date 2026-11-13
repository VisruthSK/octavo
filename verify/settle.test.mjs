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
