import { Buffer } from "node:buffer";
import {
  between,
  document,
  paragraph,
  pick,
  pngDataUri,
  random,
  repeat,
  scriptUri,
} from "./common.mjs";
import { bootstrapCss, highlightCss, quartoCss } from "./styles.mjs";
import {
  anchorJs,
  bootstrapJs,
  clipboardJs,
  mathjaxJs,
  plotlyJs,
  popperJs,
  revealJs,
  tippyJs,
} from "./scripts.mjs";

const libraryScript = (code) =>
  `<script src="${scriptUri(code)}" type="application/javascript"></script>`;

const librarySheet = (css) =>
  `<link rel="stylesheet" href="data:text/css;base64,${Buffer.from(css, "utf8").toString("base64")}">`;

const runtimeScript = () => `<script type="application/javascript" id="quarto-html-quarto-runtime">
(function () {
  "use strict";
  var quarto = window.quarto || {};
  window.quarto = quarto;
  window.quartoToggleColorScheme = function () {
    var root = document.documentElement;
    var dark = root.getAttribute("data-bs-theme") === "dark";
    root.setAttribute("data-bs-theme", dark ? "light" : "dark");
    document.body.setAttribute("data-color-scheme", dark ? "light" : "dark");
    return !dark;
  };
  var footnotes = function () {
    var refs = document.querySelectorAll(".footnote-ref");
    for (var index = 0; index < refs.length; index += 1) {
      var ref = refs[index];
      if (!ref.getAttribute("data-footnote")) {
        var target = document.querySelector(ref.getAttribute("href"));
        ref.setAttribute("data-footnote", target ? target.textContent : "");
      }
      if (window.tippy) window.tippy(ref, { content: ref.getAttribute("data-footnote") });
    }
  };
  var anchors = function () {
    if (window.AnchorJS) window.AnchorJS.init();
  };
  quarto.init = function () {
    footnotes();
    anchors();
  };
  if (document.readyState !== "loading") quarto.init();
  else document.addEventListener("DOMContentLoaded", function () { quarto.init(); });
})();
</script>`;

const searchScript = (entries) => `<script id="quarto-search" type="application/json">
${JSON.stringify({ text: entries, metadata: { tag: { "content": "search", "index": 1 } } }, null, 1)}
</script>`;

const codeCell = (source, index, copy) => {
  const lines = [
    "import pandas as pd",
    `frame = pd.read_csv("data-${index}.csv")`,
    `summary = frame.describe().round(2)`,
    `print(summary.head())`,
  ];
  const highlighted = lines
    .map((line) =>
      line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(
          /\b(import|as|print)\b/g,
          '<span class="hljs-keyword">$1</span>',
        )
        .replace(
          /\b(pd|DataFrame)\b/g,
          '<span class="hljs-title function_">$1</span>',
        ),
    )
    .join("\n");
  const rows = repeat(4, (row) => `<tr><td>${row}</td><td>${(row * 7) % 13}</td></tr>`).join("");
  const button = copy
    ? `<button class="code-copy-button" data-clipboard-target="#cell-${index}" title="Copy to clipboard">Copy</button>`
    : "";
  return `<div class="cell">
  <div class="cell-input">
    <div class="quarto-article-cell code-cell" id="cell-${index}">
      <div class="cell-code">
        <pre class="sourceCode python"><code>${highlighted}
</code></pre>
        ${button}
      </div>
    </div>
  </div>
  <div class="cell-output">
    <div class="cell-output-stdout">
      <pre><code>${rows}</code></pre>
    </div>
  </div>
</div>`;
};

const figureBlock = (source, index) => {
  const width = between(source, 24, 64);
  const height = between(source, 18, 48);
  const tint = between(source, 0, 3);
  const uri = pngDataUri(width, height, (x, y) => ((x + y + tint) % 4) * 60 + 20);
  return `<figure class="quarto-figure">
  <div class="quarto-figure-container">
    <img src="${uri}" class="img-fluid quarto-figure img" alt="Figure ${index}">
  </div>
  <figcaption>Figure ${index}: a generated plot</figcaption>
</figure>`;
};

const tableBlock = (source, index) => {
  const headers = ["name", "value", "share"];
  const rows = repeat(5, (row) =>
    `<tr class="gt_row"><td>row ${row}</td><td>${row * index}</td><td>${(row * 3) % 7}%</td></tr>`,
  ).join("");
  return `<div class="gt_table">
  <table>
    <thead><tr>${headers.map((head) => `<th>${head}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
};

const calloutBlock = (source, kind) =>
  `<div class="callout callout-${kind}">
  <div class="callout-header callout-title">${kind}</div>
  <div class="callout-content">${paragraph(source, 1)}</div>
</div>`;

const tabsetBlock = (source, index) => {
  const tabs = ["First", "Second", "Third"];
  const links = tabs
    .map(
      (tab, position) =>
        `<li class="nav-item" role="presentation"><a class="nav-link${position === 0 ? " active" : ""}" id="tab-${index}-${position}" data-bs-toggle="tab" data-bs-target="#panel-${index}-${position}" role="tab" aria-controls="panel-${index}-${position}" aria-selected="${position === 0}">${tab}</a></li>`,
    )
    .join("");
  const panels = tabs
    .map(
      (tab, position) =>
        `<div id="panel-${index}-${position}" class="tab-pane${position === 0 ? " active show" : ""}" role="tabpanel" aria-labelledby="tab-${index}-${position}">${paragraph(source, 1)}</div>`,
    )
    .join("");
  return `<div class="panel-tabset" data-tabset="tabset-${index}">
  <ul class="nav nav-tabs" role="tablist">${links}</ul>
  <div class="tab-content">${panels}</div>
</div>`;
};

const listBlock = (source) =>
  `<ul>${repeat(4, (index) => `<li>Item ${index}: ${pick(source, ["alpha", "beta", "gamma"])}</li>`).join("")}</ul>`;

const quoteBlock = (source) =>
  `<blockquote class="blockquote"><p>${pick(source, ["A quoted thought", "Another quotation"])}</p></blockquote>`;

const mathBlock = () =>
  `<div class="math display">\\[\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\\]</div>`;

const chartWidget = (source) => {
  const values = repeat(8, (index) => between(source, 1, 40));
  return `<div id="widget-${between(source, 1000, 9999)}" class="plotly html-widget" data-for="plotly-widget">
  <script type="application/json" data-for="plotly-widget">${JSON.stringify({ values })}</script>
</div>`;
};

const sectionBody = (source, index, { features, copy }) => {
  const parts = [paragraph(source, between(source, 1, 3))];
  for (const feature of features) {
    if (feature === "code") parts.push(codeCell(source, index, copy));
    if (feature === "figure") parts.push(figureBlock(source, index));
    if (feature === "table") parts.push(tableBlock(source, index));
    if (feature === "callout") parts.push(calloutBlock(source, pick(source, ["note", "warning", "important"])));
    if (feature === "tabset") parts.push(tabsetBlock(source, index));
    if (feature === "list") parts.push(listBlock(source));
    if (feature === "quote") parts.push(quoteBlock(source));
    if (feature === "math") parts.push(mathBlock());
    if (feature === "widget") parts.push(chartWidget(source));
  }
  return parts.join("\n");
};

const header = (source, { title, subtitle, features }) => {
  const lines = [
    '<header id="title-block-header" class="quarto-title-block default">',
    `<h1 class="title">${title}</h1>`,
  ];
  if (subtitle) lines.push(`<p class="subtitle">${subtitle}</p>`;
  lines.push('<div class="quarto-title-meta">');
  if (features.includes("citation")) {
    lines.push('<p class="author">A. Author</p>');
    lines.push('<p class="date">1 January 2024</p>");
  }
  lines.push("</div>");
  lines.push("</header>");
  return lines.join("\n");
};

const footnotesBlock = (source, count) =>
  `<section id="footnotes" class="footnotes csl-footnotes">
<hr>
<ol>
${repeat(
  count,
  (index) =>
    `<li id="fn${index + 1}"><p>${pick(source, ["A footnote", "Another note"])} ${index + 1}. <a href="#fnref${index + 1}" class="footnote-backref">&#8617;</a></p></li>`,
).join("\n")}
</ol>
</section>`;

const bibliographyBlock = (source) =>
  `<section id="references" class="references csl-bib-body">
<h2 id="references">References</h2>
<div id="ref-knuth1984" class="csl-entry" role="listitem">
<span class="csl-left-margin">[1]</span><span class="csl-right-inline">Knuth, D. (1984). <em>The TeXbook</em>.</span>
</div>
<div id="ref-ionic2023" class="csl-entry" role="listitem">
<span class="csl-left-margin">[2]</span><span class="csl-right-inline">Ionic, J. (2023). <em>Quarto</em>.</span>
</div>
</section>`;

const sidebar = (source, count) =>
  `<nav id="quarto-sidebar" class="quarto-sidebar" data-title="Contents">
  <div class="sidebar-header">
    <a href="index.html" class="quarto-title">${pick(source, ["Handbook", "Notes", "Analysis"])}</a>
  </div>
  <div class="sidebar-item">
    <div class="sidebar-item-text">${pick(source, ["Preface", "Introduction", "Summary"])}</div>
  </div>
  <div class="sidebar-item">
    <div class="sidebar-item-text">${repeat(count, (index) => `<a href="chapter-${index}.html">Chapter ${index}</a>`).join("")}</div>
  </div>
</nav>`;

const slidesDeck = (source, count) => {
  const slides = repeat(count, (index) => {
    const body =
      index === 0
        ? `<h1 class="title">${pick(source, ["Slides", "Deck", "Talk"])}</h1><p class="subtitle">${pick(source, ["An overview", "A summary"])}</p>`
        : `${paragraph(source, 2)}<ul><li>Point ${index}</li></ul>`;
    return `<section id="slide-${index}" data-background="#ffffff">
${body}
</section>`;
  }).join("\n");
  return `<div class="reveal">
<div class="slides">
${slides}
</div>
</div>
<div class="slide-number"></div>`;
};

const dashboardCards = (source, count) =>
  `<div class="dashboard">
${repeat(
  count,
  (index) => `<div class="card" id="card-${index}">
  <div class="card-body">
    <h3 class="card-title">Metric ${index}</h3>
    <p class="value">${between(source, 10, 9999)}</p>
    <p class="label">${pick(source, ["sessions", "errors", "requests", "bytes"])}</p>
  </div>
</div>`,
).join("\n")}
</div>`;

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const features = options.features ?? ["paragraph"];
  const libraries = options.libraries ?? ["bootstrap"];
  const theme = options.theme ?? "cosmo";
  const density = options.density ?? 2;
  const sections = options.sections ?? 4;
  const kind = options.kind ?? "article";
  const title = options.title ?? "A generated report";
  const subtitle = options.subtitle ?? "Everything is deterministic";
  const language = options.language ?? "en";
  const anchored = options.anchored ?? false;
  const dark = options.dark ?? false;
  const copyButton = options.copyButton ?? false;

  const head = [];
  head.push('<meta name="generator" content="quarto-1.6.42">');
  head.push(`<meta name="description" content="${subtitle}">`);
  head.push(`<meta property="og:title" content="${title}">`);
  head.push(`<meta property="og:description" content="${subtitle}">`);
  head.push(`<meta property="og:image" content="${pngDataUri(16, 16, () => 40)}">`);
  head.push(`<link rel="icon" href="${pngDataUri(16, 16, () => 90)}">`);
  if (theme !== "none") head.push(librarySheet(bootstrapCss({ density })));
  head.push(librarySheet(quartoCss({ theme })));
  head.push(`<style>${highlightCss()}</style>`);
  if (libraries.includes("bootstrap")) head.push(libraryScript(bootstrapJs()));
  if (libraries.includes("popper")) head.push(libraryScript(popperJs()));
  if (libraries.includes("tippy")) head.push(libraryScript(tippyJs()));
  if (libraries.includes("clipboard")) head.push(libraryScript(clipboardJs()));
  if (libraries.includes("anchor")) head.push(libraryScript(anchorJs()));
  if (features.includes("math")) head.push(libraryScript(mathjaxJs()));
  if (features.includes("widget")) head.push(libraryScript(plotlyJs()));
  head.push(`<script>window.MathJax = { tex: { inlineMath: [["\\\\(", "\\\\)"]] }, options: { skipHtmlTags: ["script", "noscript", "style", "textarea", "pre"] } };</script>`);
  head.push(runtimeScript());

  const body = [];
  if (kind === "slides") {
    body.push(slidesDeck(source, sections));
    body.push(`<script src="${scriptUri(revealJs())}" type="application/javascript"></script>`);
  } else {
    if (kind === "book") body.push(sidebar(source, sections));
    body.push('<header id="quarto-header" class="headroom fixed-top">');
    body.push('<nav class="navbar navbar-expand-lg">');
    body.push('<a class="navbar-brand" href="index.html">Report</a>');
    body.push('<ul class="navbar-nav"><li class="nav-item"><a class="nav-link" href="index.html">Home</a></li></ul>');
    if (dark) body.push('<button class="btn btn-secondary" id="quarto-color-scheme-toggle" onclick="window.quartoToggleColorScheme()">Dark</button>');
    body.push("</nav>");
    body.push("</header>");
    body.push('<main class="content" id="quarto-document-content">');
    body.push('<article id="quarto-article" class="quarto-article">');
    body.push(header(source, { title, subtitle, features }));
    if (kind === "dashboard") body.push(dashboardCards(source, sections));
    for (let index = 1; index <= sections; index += 1) {
      body.push(`<section id="sec-${index}" class="section level2">`);
      body.push(`<h2 id="sec-${index}-heading">Section ${index}</h2>`);
      body.push(sectionBody(source, index, { features, copy: copyButton }));
      body.push("</section>");
    }
    if (features.includes("footnote")) {
      const count = between(source, 1, 3);
      body.push(
        `<p>Some text with a note<sup id="fnref1" class="footnote-ref"><a href="#fn1" class="footnote-ref">1</a></sup>.</p>`,
      );
      body.push(footnotesBlock(source, count));
    }
    if (features.includes("citation")) body.push(bibliographyBlock(source));
    body.push("</article>");
    body.push("</main>");
    if (features.includes("search")) {
      body.push(
        searchScript(repeat(6, (index) => ({ title: `Entry ${index}`, href: `#sec-${index}`, text: "sample" }))),
      );
    }
  }
  body.push('<footer class="footer"><div class="quarto-footer-meta">Generated document</div></footer>');

  const classes = [anchored ? "anchored" : "", dark ? "quarto-dark" : "", kind === "book" ? "nav-page" : ""]
    .filter(Boolean)
    .join(" ");

  return document({
    lang: language,
    className: classes,
    head: head.join("\n"),
    body: body.join("\n"),
  });
};
