import { Buffer } from "node:buffer";
import { between, document, paragraph, random, repeat } from "./common.mjs";

const fontFace = (family, seed) => {
  const bytes = Buffer.alloc(768);
  let state = seed >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    bytes[index] = (state >>> 16) & 0xff;
  }
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${bytes.toString(
    "base64",
  )}) format("woff2")}`;
};

const blocks = {
  layer: () => `@layer reset, layout, components;
@layer reset {
  h1 { margin: 0; padding: 0; }
  p { margin: 0 0 1rem 0; }
}
@layer layout {
  .layout { display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; }
  .layout > .main { min-width: 0; }
  .layout > .aside { background: #f5f5f5; padding: 1rem; }
}
@layer components {
  .card { border: 1px solid #ddd; border-radius: 4px; padding: 1rem; }
  .card .title { font-weight: 700; }
}`,
  container: () => `@container card (min-width: 320px) {
  .responsive { display: flex; gap: 1rem; }
  .responsive .panel { flex: 1 1 0; }
}
@container card (max-width: 200px) {
  .responsive { display: block; }
}
.card-container { container-type: inline-size; container-name: card; }`,
  property: () => `@property --brand {
  syntax: "<color>";
  inherits: true;
  initial-value: #0d6efd;
}
@property --gap {
  syntax: "<length>";
  inherits: false;
  initial-value: 8px;
}
.themed { color: var(--brand); padding: var(--gap); }`,
  nesting: () => `.card {
  color: #222;
  border: 1px solid #ccc;
  & .title { font-size: 1.25rem; font-weight: 700; }
  & .body { color: #555; }
  &:hover { border-color: #0d6efd; }
  & > ul { list-style: square; }
}`,
  prefixes: () => `.legacy {
  -webkit-appearance: none;
  appearance: none;
  -webkit-box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  -webkit-text-size-adjust: 100%;
  -moz-osx-font-smoothing: grayscale;
  -webkit-font-smoothing: antialiased;
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  -webkit-user-select: none;
  user-select: none;
}`,
  comments: () => `/*! Stylesheet v1.2 | MIT License | build 4471 */
/* @license MIT */
/* @preserve This rule must survive minification */
.licensed { border-left: 3px solid #0d6efd; padding-left: .5rem; }
/* an ordinary comment that may be dropped */
.ordinary { color: #333; }`,
  supports: () => `@supports (display: grid) {
  .supported { display: grid; grid-auto-flow: column; }
}
@supports not (display: grid) {
  .supported { display: block; }
}
@supports (container-type: inline-size) {
  .container-query { container-type: inline-size; }
}`,
  media: () => `@media print {
  .screen-only { display: none; }
  .print-only { display: block; }
}
@media (prefers-color-scheme: dark) {
  .adaptive { color: #eee; background: #222; }
}
@media (min-width: 600px) {
  .wide { padding: 2rem; }
}`,
  keyframes: () => `@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spinner {
  animation: spin 1.2s linear infinite;
  border: 2px solid #ddd;
  border-top-color: #0d6efd;
  border-radius: 50%;
  width: 24px;
  height: 24px;
}`,
  variables: () => `:root {
  --brand: #0d6efd;
  --surface: #ffffff;
  --radius: 6px;
  --spacing: 12px;
}
.surface {
  background: var(--surface);
  border-radius: var(--radius);
  padding: var(--spacing);
  color: var(--brand);
}`,
};

const markup = {
  layer: () => `<div class="layout"><div class="main"><h1>Layered</h1><p>Text.</p></div><div class="aside">Aside</div></div>`,
  container: () => `<div class="card-container"><div class="responsive"><div class="panel">One</div><div class="panel">Two</div></div></div>`,
  property: () => `<div class="themed">Themed block</div>`,
  nesting: () => `<div class="card"><div class="title">Nested title</div><div class="body">Nested body</div><ul><li>Item</li></ul></div>`,
  prefixes: () => `<button class="legacy">Legacy</button>`,
  comments: () => `<div class="licensed">Licensed</div><div class="ordinary">Ordinary</div>`,
  supports: () => `<div class="supported">Supported</div><div class="container-query">Query</div>`,
  media: () => `<div class="screen-only">Screen</div><div class="print-only">Print</div><div class="adaptive">Adaptive</div><div class="wide">Wide</div>`,
  keyframes: () => `<div class="spinner"></div>`,
  variables: () => `<div class="surface">Surface</div>`,
};

const runtimeVariables = () => `<script>
(function () {
  "use strict";
  var root = document.documentElement;
  root.style.setProperty("--runtime-accent", "#ff8800");
  var element = document.querySelector(".runtime");
  if (element) element.style.color = "var(--runtime-accent)";
})();
</script>`;

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const features = options.features ?? Object.keys(blocks);
  const title = options.title ?? "Modern CSS";

  const head = [];
  head.push(`<title>${title}</title>`);
  const css = features.map((feature) => blocks[feature]()).join("\n");
  head.push(`<style>${css}</style>`);
  if (options.fonts !== false) head.push(`<style>${fontFace("FeatureFont", options.seed ?? 1)}</style>`);
  head.push(runtimeVariables());

  const body = [];
  body.push(`<h1>${title}</h1>`);
  body.push(paragraph(source, between(source, 1, 3)));
  for (const feature of features) body.push(markup[feature]());
  body.push('<div class="runtime">Runtime</div>');
  body.push(repeat(3, (index) => `<p class="filler" data-index="${index}">Filler ${index}</p>`).join(""));

  return document({ lang: "en", className: "", head: head.join("\n"), body: body.join("\n") });
};
