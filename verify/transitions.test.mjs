import test from "node:test";
import assert from "node:assert/strict";
import { finishTransitions } from "./capture.mjs";
import { engine } from "./engines/index.mjs";

test(`${engine.name} sampled style does not depend on how far a transition has run`, async () => {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<style>a{display:block;width:80px;height:30px;color:rgb(0,0,0);transition:color 30s linear}a.on{color:rgb(100,100,100)}</style><a id="a" href="#x">x</a>',
    );
    await page.evaluate(() => document.getElementById("a").classList.add("on"));
    const during = await page.evaluate(() => getComputedStyle(document.getElementById("a")).color);
    await finishTransitions(page);
    const after = await page.evaluate(() => getComputedStyle(document.getElementById("a")).color);
    assert.notEqual(during, "rgb(100, 100, 100)");
    assert.equal(after, "rgb(100, 100, 100)");
    await finishTransitions(page);
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("a")).color), "rgb(100, 100, 100)");
  } finally {
    await browser.close();
  }
});
