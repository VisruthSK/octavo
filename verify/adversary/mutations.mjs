export const FONT_BASE64 = "AAEAAAAKAIAAAwAgT1MvMkUgRP0AAAEoAAAAYGNtYXAADACUAAABkAAAADRnbHlmW9FWzgAAAcwAAAAaaGVhZDAF1SwAAACsAAAANmhoZWEF3gJbAAAA5AAAACRobXR4BLAAZAAAAYgAAAAIbG9jYQANAAAAAAHEAAAABm1heHAABAAGAAABCAAAACBuYW1lgmT+AwAAAegAAABscG9zdAAoAAAAAAJUAAAAJgABAAAAAQAA6Tm4GV8PPPUAAwPoAAAAAOcZyMgAAAAA5xnIyABkAAACWAK8AAAAAwACAAAAAAAAAAEAAAMg/zgAAAK8AGQAZAJYAAEAAAAAAAAAAAAAAAAAAAACAAEAAAACAAQAAQAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwJYAZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAAEEAQQMgAAAAAAMgAMgAAAAAAAAAAAAAAAAAAAAgAAAB9AAAArwAZAAAAAIAAAADAAAAFAADAAEAAAAUAAQAIAAAAAQABAABAAAAQf//AAAAQf///8AAAQAAAAAAAAAAAA0AAAABAGQAAAJYArwAAwAAMxEhEWQB9AK8/UQAAAAAAAAEADYAAQAAAAAAAQALAAAAAQAAAAAAAgAHAAsAAwABBAkAAQAWABIAAwABBAkAAgAOAChPY3Rhdm8gVGVzdFJlZ3VsYXIATwBjAHQAYQB2AG8AIABUAGUAcwB0AFIAZQBnAHUAbABhAHIAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAJAAA";

export const PNG_BASE64_ORIGINAL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2Nk+M/wn4GBgYGJgQEAJWkC/wZ614EAAAAASUVORK5CYII=";
export const PNG_BASE64_MUTATED = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIW2P8z/Cf4T8DAwMDEwMDEwAAJWkC/2XF57cAAAAASUVORK5CYII=";

export const baseHtml = () => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Base Adversary Document</title>
<style>
@font-face {
  font-family: "OctavoTest";
  font-style: normal;
  font-weight: 400;
  src: url("data:font/ttf;base64,${FONT_BASE64}");
}
:root {
  --main-color: rgb(20, 40, 60);
  --unused-custom: rgb(77, 88, 99);
}
body {
  margin: 10px;
  font-family: sans-serif;
  color: var(--main-color);
  background-color: rgb(255, 255, 255);
}
h1 {
  font-size: 24px;
  color: rgb(10, 20, 30);
}
h2 {
  font-size: 18px;
}
ul.features {
  list-style-type: square;
}
ul.features li {
  margin-bottom: 4px;
}
ul.features li::marker {
  color: rgb(255, 0, 0);
}
a.link {
  color: rgb(0, 0, 200);
  transition: color 0.5s ease;
}
a.link::before {
  content: "-> ";
  color: rgb(100, 100, 100);
}
a.link::after {
  content: " <-";
  color: rgb(100, 100, 100);
}
a.link:hover {
  color: rgb(200, 0, 0);
}
a.link:focus {
  outline: 2px solid rgb(0, 200, 0);
}
a.link:focus-visible {
  outline: 3px dashed rgb(0, 100, 200);
}
a.link:active {
  color: rgb(200, 200, 0);
}
input.text-input::placeholder {
  color: rgb(0, 128, 0);
}
input:disabled {
  background-color: rgb(220, 220, 220);
}
input:checked + label.chk-label {
  font-weight: bold;
}
table.data-table {
  border-collapse: collapse;
  width: 100%;
}
table.data-table th, table.data-table td {
  border: 1px solid rgb(200, 200, 200);
  padding: 6px;
}
.box-animated {
  width: 40px;
  height: 40px;
  background-color: rgb(100, 50, 150);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  from { opacity: 1; }
  to { opacity: 0.5; }
}
.overlap-container {
  position: relative;
  width: 100px;
  height: 50px;
}
.layer-a {
  position: absolute;
  top: 0;
  left: 0;
  width: 40px;
  height: 40px;
  background-color: rgb(200, 50, 50);
  z-index: 1;
}
.layer-b {
  position: absolute;
  top: 10px;
  left: 10px;
  width: 40px;
  height: 40px;
  background-color: rgb(50, 50, 200);
  z-index: 2;
}
.casc-a.casc-b {
  color: rgb(10, 100, 10);
}
.casc-b.casc-a {
  color: rgb(100, 10, 10);
}
p.selectable::selection {
  background-color: rgb(255, 255, 0);
}
.custom-scroll::-webkit-scrollbar {
  width: 8px;
}
.script-styled {
  background-color: rgb(240, 240, 100);
}
.tooltip-wrap:hover .tooltip-text {
  display: block;
}
.tooltip-text {
  display: none;
  background: rgb(0, 0, 0);
  color: rgb(255, 255, 255);
}
.focus-tabindex-neg:focus {
  outline: 2px solid rgb(255, 0, 255);
}
.skip-link {
  position: absolute;
  top: -100px;
  left: 0;
}
.skip-link:focus {
  top: 0;
}
.custom-font-sample {
  font-family: "OctavoTest", sans-serif;
}
.desktop-indicator {
  display: none;
}
@media (max-width: 500px) {
  h1 { font-size: 14px; }
}
@media (min-width: 700px) and (max-width: 900px) {
  h1 { font-size: 32px; }
}
@media (min-width: 1000px) {
  .desktop-indicator { display: inline-block; }
}
@media (prefers-color-scheme: dark) {
  body { background-color: rgb(20, 20, 20); color: rgb(240, 240, 240); }
  .dark-elem { color: rgb(0, 255, 100); }
}
@media print {
  .no-print { display: none; }
  .print-only { display: block; }
}
@media (prefers-reduced-motion: reduce) {
  h1 { letter-spacing: 2px; }
}
</style>
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
<h1 id="main-content">Adversary Base Page</h1>
<h2>Subtitle Section</h2>
<ul class="features">
  <li class="item" id="item-1">First item</li>
  <li class="item" id="item-2">Second item</li>
</ul>
<p><a class="link" href="#next" id="nav-anchor" title="Navigation Anchor">Navigation Link</a></p>
<form id="main-form">
  <label for="username" id="username-label">Username</label>
  <input class="text-input" type="text" id="username" placeholder="Type name here...">
  <button type="submit" id="submit-button">Submit</button>
  <input type="checkbox" id="agree-chk">
  <label class="chk-label" for="agree-chk">I agree</label>
  <input type="text" id="disabled-box" disabled value="Fixed">
</form>
<table class="data-table">
  <thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>
  <tbody><tr><td>Cell A</td><td>Cell B</td></tr></tbody>
</table>
<div id="image-container">
  <img id="sample-png" src="${PNG_BASE64_ORIGINAL}" width="50" height="50" alt="Sample 2x2 image">
</div>
<svg id="sample-svg" width="40" height="40" viewBox="0 0 40 40">
  <circle cx="20" cy="20" r="18" fill="rgb(30, 144, 255)" />
</svg>
<details id="sample-details">
  <summary id="sample-summary">More Details</summary>
  <p id="details-body">Expanded details text inside summary container.</p>
</details>
<dialog id="sample-dialog"><p>Modal Dialog Content</p></dialog>
<p class="custom-font-sample">Text rendered in OctavoTest font</p>
<div class="box-animated"></div>
<div class="overlap-container">
  <div class="layer-a"></div>
  <div class="layer-b"></div>
</div>
<div class="casc-a casc-b" id="cascade-target">Cascade text</div>
<p class="selectable" id="selectable-text">Selectable text</p>
<div class="custom-scroll" style="overflow-y:scroll;height:40px;">
  <p>Scrollable line 1</p><p>Scrollable line 2</p><p>Scrollable line 3</p>
</div>
<div class="tooltip-wrap" id="tooltip-container">
  <span>Hover me for tip</span>
  <span class="tooltip-text">Secret tooltip text</span>
</div>
<div class="focus-tabindex-neg" tabindex="-1" id="prog-focus">Programmatic focus target</div>
<div class="desktop-indicator">Desktop viewport active</div>
<div class="dark-elem">Dark theme element</div>
<div class="no-print">Hidden when printed</div>
<div class="print-only" style="display:none;">Visible in print</div>
<div id="dynamic-container" data-meta="original-meta" aria-label="Widget Area" role="region">
  <span>Inline A</span> <span>Inline B</span>
</div>
<div id="sibling-a">Sibling A</div>
<div id="sibling-b">Sibling B</div>
<script>
window.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("dynamic-container");
  const dynNode = document.createElement("div");
  dynNode.id = "script-created";
  dynNode.textContent = "Script DOM created";
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    dynNode.setAttribute("data-theme", "dark");
  }
  if (window.innerWidth <= 390) {
    dynNode.setAttribute("data-mobile", "true");
  }
  container.appendChild(dynNode);

  const btn = document.getElementById("submit-button");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      document.body.classList.toggle("script-styled");
    });
  }

  setTimeout(() => {
    const el = document.getElementById("details-body");
    if (el) el.setAttribute("data-settled", "true");
  }, 100);
});
</script>
</body>
</html>`;

export const mutations = [
  {
    id: "css-drop-rule",
    family: "css",
    name: "drop one rule",
    create: (b) => ({
      original: b,
      mutated: b.replace("h2 {\n  font-size: 18px;\n}", ""),
    }),
  },
  {
    id: "css-color-channel-1",
    family: "css",
    name: "change one colour by 1 in one channel",
    create: (b) => ({
      original: b,
      mutated: b.replace("color: rgb(10, 20, 30);", "color: rgb(10, 20, 31);"),
    }),
  },
  {
    id: "css-length-tenth-px",
    family: "css",
    name: "change a length by 0.1px",
    create: (b) => ({
      original: b,
      mutated: b.replace(".box-animated {\n  width: 40px;", ".box-animated {\n  width: 40.1px;"),
    }),
  },
  {
    id: "css-length-hundredth-px",
    family: "css",
    name: "change a length by 0.01px",
    create: (b) => ({
      original: b,
      mutated: b.replace(".box-animated {\n  width: 40px;", ".box-animated {\n  width: 40.01px;"),
    }),
  },
  {
    id: "css-cascade-order",
    family: "css",
    name: "swap rule order that changes cascade",
    create: (b) => ({
      original: b,
      mutated: b.replace(
        ".casc-a.casc-b {\n  color: rgb(10, 100, 10);\n}\n.casc-b.casc-a {\n  color: rgb(100, 10, 10);\n}",
        ".casc-b.casc-a {\n  color: rgb(100, 10, 10);\n}\n.casc-a.casc-b {\n  color: rgb(10, 100, 10);\n}",
      ),
    }),
  },
  {
    id: "css-drop-hover",
    family: "css",
    name: "drop a :hover rule",
    create: (b) => ({
      original: b,
      mutated: b.replace("a.link:hover {\n  color: rgb(200, 0, 0);\n}", ""),
    }),
  },
  {
    id: "css-drop-focus",
    family: "css",
    name: "drop a :focus rule",
    create: (b) => ({
      original: b,
      mutated: b.replace("a.link:focus {\n  outline: 2px solid rgb(0, 200, 0);\n}", ""),
    }),
  },
  {
    id: "css-drop-focus-visible",
    family: "css",
    name: "drop a :focus-visible rule",
    create: (b) => ({
      original: b,
      mutated: b.replace("a.link:focus-visible {\n  outline: 3px dashed rgb(0, 100, 200);\n}", ""),
    }),
  },
  {
    id: "css-drop-active",
    family: "css",
    name: "drop a :active rule",
    create: (b) => ({
      original: b,
      mutated: b.replace("a.link:active {\n  color: rgb(200, 200, 0);\n}", ""),
    }),
  },
  {
    id: "css-drop-disabled",
    family: "css",
    name: "drop a :disabled rule",
    create: (b) => ({
      original: b,
      mutated: b.replace("input:disabled {\n  background-color: rgb(220, 220, 220);\n}", ""),
    }),
  },
  {
    id: "css-drop-checked",
    family: "css",
    name: "drop a :checked rule",
    create: (b) => ({
      original: b,
      mutated: b.replace("input:checked + label.chk-label {\n  font-weight: bold;\n}", ""),
    }),
  },
  {
    id: "css-drop-dark-prop",
    family: "css",
    name: "drop one property inside dark media query",
    create: (b) => ({
      original: b,
      mutated: b.replace(".dark-elem { color: rgb(0, 255, 100); }", ""),
    }),
  },
  {
    id: "css-drop-print-prop",
    family: "css",
    name: "drop one property inside print media query",
    create: (b) => ({
      original: b,
      mutated: b.replace(".no-print { display: none; }", ""),
    }),
  },
  {
    id: "css-drop-reduced-motion",
    family: "css",
    name: "drop one property inside reduced-motion media query",
    create: (b) => ({
      original: b,
      mutated: b.replace("h1 { letter-spacing: 2px; }", ""),
    }),
  },
  {
    id: "css-drop-min-width",
    family: "css",
    name: "drop one property inside min-width media query",
    create: (b) => ({
      original: b,
      mutated: b.replace(".desktop-indicator { display: inline-block; }", ""),
    }),
  },
  {
    id: "css-change-custom-prop-default",
    family: "css",
    name: "change a custom property default",
    create: (b) => ({
      original: b,
      mutated: b.replace("--unused-custom: rgb(77, 88, 99);", "--unused-custom: rgb(11, 22, 33);"),
    }),
  },
  {
    id: "css-drop-before",
    family: "css",
    name: "drop ::before styles",
    create: (b) => ({
      original: b,
      mutated: b.replace('a.link::before {\n  content: "-> ";\n  color: rgb(100, 100, 100);\n}', ""),
    }),
  },
  {
    id: "css-drop-marker",
    family: "css",
    name: "drop ::marker styles",
    create: (b) => ({
      original: b,
      mutated: b.replace("ul.features li::marker {\n  color: rgb(255, 0, 0);\n}", ""),
    }),
  },
  {
    id: "css-drop-placeholder",
    family: "css",
    name: "drop ::placeholder styles",
    create: (b) => ({
      original: b,
      mutated: b.replace("input.text-input::placeholder {\n  color: rgb(0, 128, 0);\n}", ""),
    }),
  },
  {
    id: "css-drop-selection",
    family: "css",
    name: "drop ::selection styles",
    create: (b) => ({
      original: b,
      mutated: b.replace("p.selectable::selection {\n  background-color: rgb(255, 255, 0);\n}", ""),
    }),
  },
  {
    id: "css-drop-scrollbar",
    family: "css",
    name: "drop scrollbar styles",
    create: (b) => ({
      original: b,
      mutated: b.replace(".custom-scroll::-webkit-scrollbar {\n  width: 8px;\n}", ""),
    }),
  },
  {
    id: "css-change-transition-duration",
    family: "css",
    name: "change a transition duration",
    create: (b) => ({
      original: b,
      mutated: b.replace("transition: color 0.5s ease;", "transition: color 2.5s ease;"),
    }),
  },
  {
    id: "css-change-animation-keyframe",
    family: "css",
    name: "change an animation keyframe",
    create: (b) => ({
      original: b,
      mutated: b.replace("to { opacity: 0.5; }", "to { opacity: 0.2; }"),
    }),
  },
  {
    id: "css-change-z-index-overlap",
    family: "css",
    name: "change a z-index or position that only matters on overlap",
    create: (b) => ({
      original: b,
      mutated: b.replace("z-index: 1;", "z-index: 5;"),
    }),
  },
  {
    id: "css-remove-unused-looking-class",
    family: "css",
    name: "remove an unused-looking class that script adds later",
    create: (b) => ({
      original: b,
      mutated: b.replace(".script-styled {\n  background-color: rgb(240, 240, 100);\n}", ""),
    }),
  },
  {
    id: "css-change-opacity",
    family: "css",
    name: "change opacity value",
    create: (b) => ({
      original: b.replace(".box-animated {", ".box-animated {\n  opacity: 0.9;"),
      mutated: b.replace(".box-animated {", ".box-animated {\n  opacity: 0.85;"),
    }),
  },
  {
    id: "css-change-font-size-tenth",
    family: "css",
    name: "change font-size by tenth of a pixel",
    create: (b) => ({
      original: b,
      mutated: b.replace("font-size: 18px;", "font-size: 18.1px;"),
    }),
  },
  {
    id: "css-drop-after",
    family: "css",
    name: "drop ::after styles",
    create: (b) => ({
      original: b,
      mutated: b.replace('a.link::after {\n  content: " <-";\n  color: rgb(100, 100, 100);\n}', ""),
    }),
  },
  {
    id: "css-border-radius-change",
    family: "css",
    name: "change border radius",
    create: (b) => ({
      original: b.replace(".box-animated {", ".box-animated {\n  border-radius: 4px;"),
      mutated: b.replace(".box-animated {", ".box-animated {\n  border-radius: 8px;"),
    }),
  },
  {
    id: "html-drop-data-attr",
    family: "html",
    name: "drop a data- attribute",
    create: (b) => ({
      original: b,
      mutated: b.replace('data-meta="original-meta"', ""),
    }),
  },
  {
    id: "html-drop-aria-attr",
    family: "html",
    name: "drop an aria attribute",
    create: (b) => ({
      original: b,
      mutated: b.replace('aria-label="Widget Area"', ""),
    }),
  },
  {
    id: "html-drop-aria-role",
    family: "html",
    name: "drop an aria role",
    create: (b) => ({
      original: b,
      mutated: b.replace('role="region"', ""),
    }),
  },
  {
    id: "html-change-alt",
    family: "html",
    name: "change an alt attribute",
    create: (b) => ({
      original: b,
      mutated: b.replace('alt="Sample 2x2 image"', 'alt="Modified 2x2 image description"'),
    }),
  },
  {
    id: "html-change-tabindex",
    family: "html",
    name: "change a tab order tabindex",
    create: (b) => ({
      original: b.replace('<button type="submit" id="submit-button">', '<button type="submit" id="submit-button" tabindex="1">'),
      mutated: b.replace('<button type="submit" id="submit-button">', '<button type="submit" id="submit-button" tabindex="2">'),
    }),
  },
  {
    id: "html-drop-lang",
    family: "html",
    name: "drop a lang attribute",
    create: (b) => ({
      original: b,
      mutated: b.replace('<html lang="en">', "<html>"),
    }),
  },
  {
    id: "html-change-inline-block-whitespace",
    family: "html",
    name: "change whitespace between inline-blocks",
    create: (b) => ({
      original: b,
      mutated: b.replace("<span>Inline A</span> <span>Inline B</span>", "<span>Inline A</span><span>Inline B</span>"),
    }),
  },
  {
    id: "html-add-comment-text-node",
    family: "html",
    name: "add a comment-looking text node",
    create: (b) => ({
      original: b,
      mutated: b.replace('<div id="sibling-a">Sibling A</div>', '<div id="sibling-a">Sibling A &lt;!-- comment --&gt;</div>'),
    }),
  },
  {
    id: "html-drop-comment-text-node",
    family: "html",
    name: "drop a comment-looking text node",
    create: (b) => ({
      original: b.replace('<div id="sibling-a">Sibling A</div>', '<div id="sibling-a">Sibling A &lt;!-- comment --&gt;</div>'),
      mutated: b,
    }),
  },
  {
    id: "html-reorder-siblings",
    family: "html",
    name: "reorder siblings",
    create: (b) => ({
      original: b,
      mutated: b.replace(
        '<div id="sibling-a">Sibling A</div>\n<div id="sibling-b">Sibling B</div>',
        '<div id="sibling-b">Sibling B</div>\n<div id="sibling-a">Sibling A</div>',
      ),
    }),
  },
  {
    id: "html-change-input-type",
    family: "html",
    name: "change input type",
    create: (b) => ({
      original: b,
      mutated: b.replace('<input class="text-input" type="text" id="username"', '<input class="text-input" type="search" id="username"'),
    }),
  },
  {
    id: "html-drop-label-for",
    family: "html",
    name: "drop a label for=",
    create: (b) => ({
      original: b,
      mutated: b.replace('for="username"', ""),
    }),
  },
  {
    id: "html-drop-title-attr",
    family: "html",
    name: "drop title attribute",
    create: (b) => ({
      original: b,
      mutated: b.replace('title="Navigation Anchor"', ""),
    }),
  },
  {
    id: "html-change-button-type",
    family: "html",
    name: "change button type submit to button",
    create: (b) => ({
      original: b,
      mutated: b.replace('<button type="submit" id="submit-button">', '<button type="button" id="submit-button">'),
    }),
  },
  {
    id: "script-change-click-effect",
    family: "scripts",
    name: "change an event handler effect",
    create: (b) => ({
      original: b,
      mutated: b.replace('document.body.classList.toggle("script-styled");', 'document.body.classList.toggle("other-styled");'),
    }),
  },
  {
    id: "script-drop-listener",
    family: "scripts",
    name: "drop a listener",
    create: (b) => ({
      original: b,
      mutated: b.replace('btn.addEventListener("click", (e) => {\n      e.preventDefault();\n      document.body.classList.toggle("script-styled");\n    });', ""),
    }),
  },
  {
    id: "script-settle-timer-exceeded",
    family: "scripts",
    name: "change a timer delay so effect shows after settle window",
    create: (b) => ({
      original: b,
      mutated: b.replace("}, 100);", "}, 7000);"),
    }),
  },
  {
    id: "script-dark-mode-text",
    family: "scripts",
    name: "change text built by script only in dark mode",
    create: (b) => ({
      original: b,
      mutated: b.replace('dynNode.setAttribute("data-theme", "dark");', 'dynNode.setAttribute("data-theme", "night-theme");'),
    }),
  },
  {
    id: "script-viewport-resize-text",
    family: "scripts",
    name: "change text built by script on resize",
    create: (b) => ({
      original: b.replace(
        'window.addEventListener("DOMContentLoaded", () => {',
        'window.addEventListener("DOMContentLoaded", () => {\n  window.addEventListener("resize", () => { document.body.setAttribute("data-resized", "1"); });',
      ),
      mutated: b.replace(
        'window.addEventListener("DOMContentLoaded", () => {',
        'window.addEventListener("DOMContentLoaded", () => {\n  window.addEventListener("resize", () => { document.body.setAttribute("data-resized", "2"); });',
      ),
    }),
  },
  {
    id: "script-mobile-viewport-behavior",
    family: "scripts",
    name: "change behaviour only at mobile viewport",
    create: (b) => ({
      original: b,
      mutated: b.replace('dynNode.setAttribute("data-mobile", "true");', 'dynNode.setAttribute("data-mobile", "altered");'),
    }),
  },
  {
    id: "script-drop-fetch",
    family: "scripts",
    name: "drop a fetch or a request",
    create: (b) => ({
      original: b.replace('window.addEventListener("DOMContentLoaded", () => {', 'window.addEventListener("DOMContentLoaded", () => {\n  fetch("http://localhost:9999/api/telemetry").catch(() => {});'),
      mutated: b,
    }),
  },
  {
    id: "script-add-console-error",
    family: "scripts",
    name: "add a console error",
    create: (b) => ({
      original: b,
      mutated: b.replace('window.addEventListener("DOMContentLoaded", () => {', 'window.addEventListener("DOMContentLoaded", () => {\n  console.error("Adversary triggered error");'),
    }),
  },
  {
    id: "script-reorder-requests",
    family: "scripts",
    name: "change the order of requests",
    create: (b) => ({
      original: b.replace('window.addEventListener("DOMContentLoaded", () => {', 'window.addEventListener("DOMContentLoaded", () => {\n  fetch("http://localhost:9999/api/first").catch(() => {});\n  fetch("http://localhost:9999/api/second").catch(() => {});'),
      mutated: b.replace('window.addEventListener("DOMContentLoaded", () => {', 'window.addEventListener("DOMContentLoaded", () => {\n  fetch("http://localhost:9999/api/second").catch(() => {});\n  fetch("http://localhost:9999/api/first").catch(() => {});'),
    }),
  },
  {
    id: "script-uncaught-exception",
    family: "scripts",
    name: "uncaught exception thrown in script",
    create: (b) => ({
      original: b,
      mutated: b.replace('window.addEventListener("DOMContentLoaded", () => {', 'window.addEventListener("DOMContentLoaded", () => {\n  throw new Error("Adversary uncaught error");'),
    }),
  },
  {
    id: "asset-change-image-pixel",
    family: "assets",
    name: "change one pixel of an image",
    create: (b) => ({
      original: b,
      mutated: b.replace(PNG_BASE64_ORIGINAL, PNG_BASE64_MUTATED),
    }),
  },
  {
    id: "asset-change-image-dimension",
    family: "assets",
    name: "change an image dimension",
    create: (b) => ({
      original: b,
      mutated: b.replace('width="50" height="50"', 'width="54" height="50"'),
    }),
  },
  {
    id: "asset-replace-font-fallback",
    family: "assets",
    name: "replace a font with a fallback",
    create: (b) => ({
      original: b,
      mutated: b.replace('.custom-font-sample {\n  font-family: "OctavoTest", sans-serif;\n}', '.custom-font-sample {\n  font-family: monospace;\n}'),
    }),
  },
  {
    id: "asset-drop-font-weight",
    family: "assets",
    name: "drop a font weight",
    create: (b) => ({
      original: b.replace('@font-face {', '@font-face {\n  font-weight: 400 700;'),
      mutated: b,
    }),
  },
  {
    id: "asset-corrupt-font-bytes",
    family: "assets",
    name: "change decoded bytes of a font slightly",
    create: (b) => ({
      original: b,
      mutated: b.replace(FONT_BASE64.slice(0, 40), FONT_BASE64.slice(0, 36) + "XXXX"),
    }),
  },
  {
    id: "asset-drop-animation-frame",
    family: "assets",
    name: "drop an animation keyframe",
    create: (b) => ({
      original: b.replace(
        "@keyframes pulse {\n  from { opacity: 1; }\n  to { opacity: 0.5; }\n}",
        "@keyframes pulse {\n  0% { opacity: 1; }\n  50% { opacity: 0.7; }\n  100% { opacity: 0.5; }\n}",
      ),
      mutated: b,
    }),
  },
  {
    id: "asset-change-svg-fill",
    family: "assets",
    name: "change SVG circle fill",
    create: (b) => ({
      original: b,
      mutated: b.replace('fill="rgb(30, 144, 255)"', 'fill="rgb(30, 144, 254)"'),
    }),
  },
  {
    id: "state-hover-only-tooltip",
    family: "states",
    name: "hover-only tooltip on non-interactive element",
    create: (b) => ({
      original: b,
      mutated: b.replace("Secret tooltip text", "Altered secret tooltip text"),
    }),
  },
  {
    id: "state-focus-only-outline",
    family: "states",
    name: "focus-only outline on programmatic focus target",
    create: (b) => ({
      original: b,
      mutated: b.replace("outline: 2px solid rgb(255, 0, 255);", "outline: 2px solid rgb(0, 255, 255);"),
    }),
  },
  {
    id: "state-details-open",
    family: "states",
    name: "details open state styling",
    create: (b) => ({
      original: b.replace("</style>", "details[open] { background-color: rgb(230, 240, 255); }\n</style>"),
      mutated: b,
    }),
  },
  {
    id: "state-skip-to-content",
    family: "states",
    name: "hidden element that appears on keyboard focus",
    create: (b) => ({
      original: b,
      mutated: b.replace(".skip-link:focus {\n  top: 0;\n}", ".skip-link:focus {\n  top: 15px;\n}"),
    }),
  },
  {
    id: "state-active-non-interactive",
    family: "states",
    name: "active state on non-interactive element",
    create: (b) => ({
      original: b.replace("</style>", "#sibling-a:active { color: rgb(255, 0, 0); }\n</style>"),
      mutated: b,
    }),
  },
];

export const equivalentPairs = [
  {
    id: "equiv-attr-order",
    name: "attribute order",
    create: (b) => ({
      original: b.replace('id="sample-png" src=', 'src="${PNG_BASE64_ORIGINAL}" id="sample-png" data-x=').replace('src="${PNG_BASE64_ORIGINAL}" ', ""),
      equivalent: b,
    }),
  },
  {
    id: "equiv-comment-removal",
    name: "comment removal",
    create: (b) => ({
      original: b.replace("<h2>Subtitle Section</h2>", "<h2>Subtitle Section</h2><!-- removable comment -->"),
      equivalent: b,
    }),
  },
  {
    id: "equiv-block-whitespace",
    name: "insignificant whitespace between block elements",
    create: (b) => ({
      original: b.replace("</div>\n<div id=\"sibling-b\">", "</div>    \n\n    <div id=\"sibling-b\">"),
      equivalent: b,
    }),
  },
  {
    id: "equiv-shorthand-longhand",
    name: "shorthand versus longhand with equal computed values",
    create: (b) => ({
      original: b.replace("margin: 10px;", "margin-top: 10px; margin-right: 10px; margin-bottom: 10px; margin-left: 10px;"),
      equivalent: b,
    }),
  },
  {
    id: "equiv-number-formatting",
    name: "number formatting 0.50 vs .5",
    create: (b) => ({
      original: b.replace("to { opacity: 0.5; }", "to { opacity: 0.50; }"),
      equivalent: b.replace("to { opacity: 0.5; }", "to { opacity: .5; }"),
    }),
  },
  {
    id: "equiv-duplicate-rules",
    name: "duplicate identical rules",
    create: (b) => ({
      original: b.replace("h2 {\n  font-size: 18px;\n}", "h2 {\n  font-size: 18px;\n}\nh2 {\n  font-size: 18px;\n}"),
      equivalent: b,
    }),
  },
  {
    id: "equiv-hex-color-case",
    name: "hex color uppercase vs lowercase",
    create: (b) => ({
      original: b.replace("background: rgb(0, 0, 0);", "background: #000000;"),
      equivalent: b.replace("background: rgb(0, 0, 0);", "background: #000;"),
    }),
  },
  {
    id: "equiv-font-family-quoting",
    name: "font-family quoting",
    create: (b) => ({
      original: b.replace('font-family: "OctavoTest", sans-serif;', "font-family: OctavoTest, sans-serif;"),
      equivalent: b,
    }),
  },
  {
    id: "equiv-trailing-semicolon",
    name: "trailing semicolon in style attribute",
    create: (b) => ({
      original: b.replace('style="overflow-y:scroll;height:40px;"', 'style="overflow-y:scroll;height:40px"'),
      equivalent: b,
    }),
  },
  {
    id: "equiv-leading-zero-length",
    name: "leading zero in lengths",
    create: (b) => ({
      original: b.replace("margin-bottom: 4px;", "margin-bottom: 4.0px;"),
      equivalent: b,
    }),
  },
  {
    id: "equiv-boolean-attr",
    name: "boolean attribute syntax",
    create: (b) => ({
      original: b.replace('disabled value="Fixed"', 'disabled="disabled" value="Fixed"'),
      equivalent: b,
    }),
  },
  {
    id: "equiv-unquoted-attr",
    name: "unquoted attribute values in HTML",
    create: (b) => ({
      original: b.replace('class="box-animated"', "class=box-animated"),
      equivalent: b,
    }),
  },
  {
    id: "equiv-rgb-spacing",
    name: "rgb color spacing",
    create: (b) => ({
      original: b.replace("color: rgb(10, 20, 30);", "color: rgb(10,20,30);"),
      equivalent: b,
    }),
  },
  {
    id: "equiv-css-rule-whitespace",
    name: "redundant whitespace inside CSS rule",
    create: (b) => ({
      original: b.replace("h1 {\n  font-size: 24px;\n  color: rgb(10, 20, 30);\n}", "h1 {   font-size:   24px;   color:  rgb(10, 20, 30);   }"),
      equivalent: b,
    }),
  },
  {
    id: "equiv-declaration-order",
    name: "css property declaration order within non-conflicting rule",
    create: (b) => ({
      original: b.replace("h1 {\n  font-size: 24px;\n  color: rgb(10, 20, 30);\n}", "h1 {\n  color: rgb(10, 20, 30);\n  font-size: 24px;\n}"),
      equivalent: b,
    }),
  },
];
