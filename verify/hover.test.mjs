import test from "node:test";
import assert from "node:assert/strict";
import { hoverPopovers } from "./capture.mjs";
import { engine } from "./engines/index.mjs";

const page = (hideDelay) => `
<style>a{display:inline-block;width:80px;height:30px;margin:0 40px}</style>
<a class="quarto-xref" href="#a" aria-expanded="false">a</a>
<a class="quarto-xref" href="#b" aria-expanded="false">b</a>
<a class="quarto-xref" href="#c" aria-expanded="false">c</a>
<script>
for (const link of document.querySelectorAll("a")) {
  let root;
  link.addEventListener("mouseenter", () => {
    link.setAttribute("aria-expanded", "true");
    root = document.body.appendChild(document.createElement("div"));
    root.setAttribute("data-tippy-root", "");
  });
  link.addEventListener("mouseleave", () => {
    const hide = () => {
      link.setAttribute("aria-expanded", "false");
      root.remove();
    };
    ${hideDelay} === 0 ? hide() : setTimeout(hide, ${hideDelay});
  });
}
</script>`;

const expandedAfterHover = async (browser, hideDelay) => {
  const tab = await browser.newPage();
  await tab.setContent(page(hideDelay));
  await hoverPopovers(tab);
  const expanded = await tab.$$eval("a", (links) => links.map((link) => link.getAttribute("aria-expanded")));
  await tab.close();
  return expanded;
};

test(`${engine.name} hovered popovers end in the same state however long they take to hide`, async () => {
  const browser = await engine.launch();
  try {
    const immediate = await expandedAfterHover(browser, 0);
    const slow = await expandedAfterHover(browser, 400);
    assert.deepEqual(immediate, ["false", "false", "true"]);
    assert.deepEqual(slow, immediate);
  } finally {
    await browser.close();
  }
});
