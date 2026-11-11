import { Buffer } from "node:buffer";
import { document, paragraph, png, pngDataUri, random, repeat } from "./common.mjs";

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const page = (head, body) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Adversarial</title>${head}</head><body>${body}</body></html>`;

const style = (css) => `<style>${css}</style>`;

const shrinkable = () => style(".a{color:red}.b{color:blue}.c{margin:0}") + `<p class="a">text</p>`;

const nestedComments = () =>
  page(
    shrinkable(),
    `<!-- outer <!-- inner --> still inside? --><p class="a">after comment</p><!-- trailing <script>window.x=1</script> -->`,
  );

const commentWithMarkup = () =>
  page(
    shrinkable(),
    `<!-- <style>.hidden{color:red}</style><script>window.hidden=1</script> --><p class="a">text</p>`,
  );

const textareaContent = () =>
  page(
    shrinkable(),
    `<textarea id="editor"><script>window.editor=1</script><style>.x{}</style></textarea><p class="a">text</p>`,
  );

const svgContent = () =>
  page(
    shrinkable(),
    `<svg viewBox="0 0 10 10" width="10" height="10"><style>.s{fill:red}</style><script>window.svgScript=1</script><g><rect class="s" width="4" height="4"/></g></svg><p class="a">text</p>`,
  );

const nestedSvg = () =>
  page(
    shrinkable(),
    `<svg viewBox="0 0 20 20"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3" class="s"/></svg><style>.s{fill:blue}</style></svg><p class="a">text</p>`,
  );

const noscriptContent = () =>
  page(
    shrinkable(),
    `<noscript><style>.a{color:green}</style><p class="b">fallback</p></noscript><p class="a">text</p>`,
  );

const templateContent = () =>
  page(
    shrinkable(),
    `<template id="row"><div class="row"><style>.row{color:red}</style></div></template><p class="a">text</p>`,
  );

const mixedCase = () =>
  page(
    `<STYLE>.A{COLOR:RED}.B{COLOR:BLUE}</STYLE><SCRIPT>window.Mixed=1;</SCRIPT>`,
    `<DIV CLASS="A"><P CLASS="B">Text</P></DIV><IMG ALT="x" SRC="${pngDataUri(8, 8, () => 30)}">`,
  );

const unterminatedComment = () =>
  page(shrinkable(), `<p class="a">visible</p><!-- this comment never ends`);

const unterminatedScript = () =>
  page(shrinkable(), `<p class="a">visible</p><script>window.value = 1;`);

const unterminatedStyle = () =>
  page(shrinkable(), `<p class="a">visible</p><style>.b{color:blue}`);

const hugeAttribute = () =>
  page(
    shrinkable(),
    `<p class="a" data-blob="${"QUJD".repeat(30_000)}">text</p>`,
  );

const manyElements = (source) =>
  page(
    shrinkable(),
    repeat(
      100_000,
      (index) => `<p class="a" data-index="${index}">line ${index}</p>`,
    ).join(""),
  );

const deepNesting = () =>
  page(shrinkable(), `<div>`.repeat(2000) + `<span class="a">deep</span>` + `</div>`.repeat(2000));

const runtimeClasses = () =>
  page(
    style(".built{color:#c00}.added{text-decoration:underline}.kept{font-weight:700}"),
    `<div id="target" class="kept">text</div>
<script>
(function () {
  "use strict";
  var target = document.getElementById("target");
  target.classList.add("added");
  target.className = "kept built" + (1 + 1);
})();
</script>`,
  );

const runtimeCustomProperties = () =>
  page(
    style(":root{--runtime-accent:#f00;--unused-accent:#0f0}.painted{color:var(--runtime-accent)}"),
    `<p class="painted">text</p>
<script>
(function () {
  "use strict";
  document.documentElement.style.setProperty("--runtime-accent", "#00f");
  var node = document.querySelector(".painted");
  node.style.setProperty("--runtime-accent", "#00f");
})();
</script>`,
  );

const duplicateIds = () =>
  page(
    shrinkable(),
    `<p class="a" id="same">one</p><p class="a" id="same">two</p><div id="same">three</div>`,
  );

const dataUrlEncodings = () =>
  page(
    `<style>.a{color:red}.b{color:blue}</style>`,
    `<img alt="percent" src="data:image/png;base64,${PIXEL}">
<img alt="uppercase" src="DATA:image/png;base64,${PIXEL}">
<img alt="no-mime" src="data:;base64,${PIXEL}">
<img alt="raw-svg" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='red'/%3E%3C/svg%3E">
<link rel="stylesheet" href="data:text/css,.a%7Bcolor%3Ared%7D">
<link rel="stylesheet" href="data:text/css;charset=utf-8,.b%7Bcolor%3Ablue%7D">
<p class="a">text</p>`,
  );

const brokenBase64 = () =>
  page(
    shrinkable(),
    `<img alt="bad" src="data:image/png;base64,!!!not base64!!!">
<img alt="short" src="data:image/png;base64,${PIXEL.slice(0, 40)}">
<img alt="empty" src="data:image/png;base64,">
<p class="a">text</p>`,
  );

const truncatedImage = () => {
  const full = png(32, 32, (x, y) => (x + y) % 4 * 60);
  return page(
    shrinkable(),
    `<img alt="truncated" src="data:image/png;base64,${full.subarray(0, 60).toString("base64")}">
<img alt="header only" src="data:image/png;base64,${full.subarray(0, 20).toString("base64")}">
<p class="a">text</p>`,
  );

const corruptImage = () => {
  const bytes = Buffer.alloc(256);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 37) % 251;
  return page(
    shrinkable(),
    `<img alt="corrupt" src="data:image/png;base64,${bytes.toString("base64")}">
<img alt="text" src="data:image/plain;base64,${Buffer.from("not an image").toString("base64")}">
<p class="a">text</p>`,
  );

const corruptFont = () => {
  const bytes = Buffer.alloc(512);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 53) % 249;
  return page(
    style(`@font-face{font-family:"Broken";src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2")}.a{font-family:"Broken",serif}`),
    `<p class="a">text in a broken font</p>`,
  );

const cssFeatures = () =>
  page(
    style(`@layer base, theme;
@layer base { .a { color: red } }
@layer theme { .b { color: blue } }
@container card (min-width: 100px) { .a { letter-spacing: 0.1px } }
@property --tone { syntax: "<color>"; inherits: true; initial-value: #123456 }
.c { color: var(--tone) }
.d { display: flex; & > span { color: green } }
.e { -webkit-appearance: none; appearance: none; -webkit-box-shadow: 0 0 0 1px red; box-shadow: 0 0 0 1px red }
/*! keep this notice */
/* @license MIT */
.f { color: green }`),
    `<div class="container"><p class="a">one</p><p class="b">two</p><p class="c">three</p><div class="d"><span>four</span></div><button class="e">five</button><p class="f">six</p></div>`,
  );

const scriptRegex = () =>
  page(
    shrinkable(),
    `<p class="a">text</p>
<script>
(function () {
  "use strict";
  var pattern = /<\\/?[a-z]+>/gi;
  var quoted = /["']/g;
  var text = "<div class='x'>";
  window.regexMatches = (text.match(pattern) || []).length + (text.match(quoted) || []).length;
})();
</script>`,
  );

const scriptTemplateClose = () =>
  page(
    shrinkable(),
    `<p class="a">text</p>
<script>
(function () {
  "use strict";
  var closing = "<\\/script>";
  var template = \`a \${closing} b\`;
  window.templateLength = template.length;
})();
</script>`,
  );

const scriptRawClose = () =>
  page(
    shrinkable(),
    `<p class="a">text</p>
<script>
(function () {
  "use strict";
  var closing = "</scr";
  window.rawClose = closing.length;
})();
</script>`,
  );

const nonAscii = () =>
  page(
    style(".a{font-family:system-ui}.b{font-size:16px}"),
    `<p class="a" title="日本語のタイトル">日本語のテキスト、繁體字、Ελληνικά, Кириллица, العربية</p>
<p class="b">emoji 😀🎉 and combining marks é versus é</p>
<p class="a" dir="rtl">שלום עולם</p>`,
  );

const byteOrderMark = () => `﻿${page(shrinkable(), `<p class="a">text</p>`)}`;

const entities = () =>
  page(
    shrinkable(),
    `<p class="a" title="a &amp; b &lt; c">text &amp; more &lt;tags&gt; &#128512;</p>
<p class="a">&nbsp;&copy;&mdash;&hellip;</p>`,
  );

const cspMeta = () =>
  page(
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'">
${style(".a{color:red}.b{color:blue}")}`,
    `<p class="a">text</p><script>window.value = 1;</script>`,
  );

const remoteResources = () =>
  page(
    style(".a{color:red}.b{color:blue}"),
    `<p class="a">text</p><script src="https://cdn.example.invalid/library.js"></script>
<link rel="stylesheet" href="https://cdn.example.invalid/theme.css">`,
  );

const notHtml = () => `<div class="fragment"><p>This file has no html element.</p></div>`;

const localLinks = () =>
  page(
    style(".a{color:red}.b{color:blue}"),
    `<p class="a">text</p><img src="figure.png"><link rel="stylesheet" href="site_libs/bootstrap.min.css">`,
  );

const emptyElements = () =>
  page(
    `<style></style><script></script><link rel="stylesheet" href="data:text/css,">`,
    `<p class="a">text</p><div></div><span></span>`,
  );

const uppercaseAttributes = () =>
  page(
    `<STYLE>.A{COLOR:RED}</STYLE>`,
    `<IMG ALT="x" SRC="${pngDataUri(8, 8, () => 30)}"><P CLASS="A">text</P>`,
  );

const unclosedTags = () =>
  page(
    shrinkable(),
    `<div class="a"><p>one<p>two<ul><li>three<li>four</ul></div>`,
  );

const iframeSrcdoc = () =>
  page(
    shrinkable(),
    `<iframe srcdoc="&lt;p class='a'&gt;inside&lt;/p&gt;" width="200" height="60"></iframe><p class="a">text</p>`,
  );

const longAttributeList = () => {
  const attributes = repeat(200, (index) => `data-attr-${index}="value-${index}"`).join(" ");
  return page(shrinkable(), `<p class="a" ${attributes}>text</p>`);
};

const manyStylesheets = () =>
  page(
    repeat(60, (index) => style(`.rule${index}{margin:${index}px;color:rgb(${index},0,0)}`)).join(""),
    repeat(60, (index) => `<p class="rule${index}">text ${index}</p>`).join(""),
  );

const manyScripts = () =>
  page(
    repeat(40, (index) => `<script>window.value${index} = ${index};</script>`).join(""),
    `<p class="a">text</p>`,
  );

const mixedContent = (source) =>
  page(
    `${style(".a{color:red}.b{color:blue}.c{color:green}")}${style("@media print{.a{display:none}}")}`,
    `${paragraph(source, 2)}
<!-- comment with <script>window.x=1</script> -->
<textarea><script>window.y=1</script></textarea>
<svg viewBox="0 0 4 4"><style>.c{fill:red}</style><rect class="c" width="4" height="4"/></svg>
<noscript><style>.b{color:blue}</style></noscript>
<template><div class="b">inert</div></template>
<p class="a">text</p>
<script>
(function () {
  "use strict";
  var pattern = /a\\/b/g;
  window.matches = "a/b".match(pattern).length;
})();
</script>`,
  );

const fontInStyle = () => {
  const bytes = Buffer.alloc(256);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 11) % 253;
  return page(
    style(`@font-face{font-family:"Glyphs";src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2")}.a::before{content:"\\2022";font-family:"Glyphs"}`),
    `<p class="a">bullet text</p>`,
  );
};

const duplicateAttributes = () =>
  page(shrinkable(), `<p class="a" class="b" id="x" id="y">text</p>`);

const scriptWithHtml = () =>
  page(
    shrinkable(),
    `<p class="a">text</p>
<script>
(function () {
  "use strict";
  var markup = "<div class='a'>inner</div>";
  var holder = document.createElement("div");
  holder.innerHTML = markup;
  document.body.appendChild(holder);
})();
</script>`,
  );

const quotedAttributes = () =>
  page(
    shrinkable(),
    `<p class='a' title='single quotes' data-other="double quotes">text</p><div data-json='{"a":1}'>json</div>`,
  );

export const fixtures = {
  "nested-comments": nestedComments,
  "comment-with-markup": commentWithMarkup,
  "textarea-content": textareaContent,
  "svg-content": svgContent,
  "nested-svg": nestedSvg,
  "noscript-content": noscriptContent,
  "template-content": templateContent,
  "mixed-case-tags": mixedCase,
  "unterminated-comment": unterminatedComment,
  "unterminated-script": unterminatedScript,
  "unterminated-style": unterminatedStyle,
  "huge-attribute": hugeAttribute,
  "many-elements": manyElements,
  "deep-nesting": deepNesting,
  "runtime-classes": runtimeClasses,
  "runtime-custom-properties": runtimeCustomProperties,
  "duplicate-ids": duplicateIds,
  "data-url-encodings": dataUrlEncodings,
  "broken-base64": brokenBase64,
  "truncated-image": truncatedImage,
  "corrupt-image": corruptImage,
  "corrupt-font": corruptFont,
  "css-features": cssFeatures,
  "script-regex": scriptRegex,
  "script-template-close": scriptTemplateClose,
  "script-raw-close": scriptRawClose,
  "non-ascii": nonAscii,
  "byte-order-mark": byteOrderMark,
  entities,
  "csp-meta": cspMeta,
  "remote-resources": remoteResources,
  "not-html": notHtml,
  "local-links": localLinks,
  "empty-elements": emptyElements,
  "uppercase-attributes": uppercaseAttributes,
  "unclosed-tags": unclosedTags,
  "iframe-srcdoc": iframeSrcdoc,
  "long-attribute-list": longAttributeList,
  "many-stylesheets": manyStylesheets,
  "many-scripts": manyScripts,
  "mixed-content": mixedContent,
  "font-in-style": fontInStyle,
  "duplicate-attributes": duplicateAttributes,
  "script-with-html": scriptWithHtml,
  "quoted-attributes": quotedAttributes,
};

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const fixture = fixtures[options.fixture];
  if (!fixture) throw new Error(`unknown fixture: ${options.fixture}`);
  return fixture(source, options);
};

export const names = Object.keys(fixtures);
