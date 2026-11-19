import { deflateSync } from "node:zlib";
import { page, repeat, random } from "../spec.mjs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, tail]);
};

const pngPixels = (width, height, seed, bands, noise) => {
  const rand = random(seed);
  const row = width * 4;
  const raw = Buffer.alloc((row + 1) * height);
  const bandHeight = Math.max(1, Math.floor(height / bands));
  const palette = Array.from({ length: bands }, () => [
    40 + Math.floor(rand() * 180),
    40 + Math.floor(rand() * 180),
    40 + Math.floor(rand() * 180),
  ]);
  for (let y = 0; y < height; y++) {
    const offset = y * (row + 1);
    const color = palette[Math.floor(y / bandHeight) % bands];
    for (let x = 0; x < width; x++) {
      const at = offset + 1 + x * 4;
      raw[at] = color[0];
      raw[at + 1] = color[1];
      raw[at + 2] = color[2];
      raw[at + 3] = 255;
    }
  }
  const dots = noise ? width : 24;
  for (let i = 0; i < dots; i++) {
    const cx = Math.floor(rand() * width);
    const cy = Math.floor(rand() * height);
    const radius = 1 + Math.floor(rand() * 4);
    const color = [
      Math.floor(rand() * 256),
      Math.floor(rand() * 256),
      Math.floor(rand() * 256),
    ];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const at = y * (row + 1) + 1 + x * 4;
        raw[at] = color[0];
        raw[at + 1] = color[1];
        raw[at + 2] = color[2];
        raw[at + 3] = 255;
      }
    }
  }
  return raw;
};

const pngDataUri = (width, height, seed, options = {}) => {
  const { bands = 7, noise = false } = options;
  const raw = pngPixels(width, height, seed, bands, noise);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const image = Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 1 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${image.toString("base64")}`;
};

const fakeLib = ({ banner, global, size, seed, api = "" }) => {
  const rand = random(seed);
  let out = banner;
  out += `(function(g){'use strict';function ${global}(){this._v='${seed}'};${api}`;
  let body = "";
  let i = 0;
  while (out.length + body.length < size) {
    const term = Math.floor(rand() * 97) + 3;
    body += `var s${i}=function(e){var t=${term};return e==null?t:e+t};${global}.s${i}=s${i};`;
    i += 1;
  }
  out += `${body}g.${global}=${global};})(this);`;
  return out;
};

const BEFORE_BODY =
  "(function(){var root=document.documentElement;var saved=null;" +
  "try{saved=window.localStorage.getItem('quarto-color-scheme')}catch(e){}" +
  "if(saved==='dark'){root.classList.add('quarto-dark')}" +
  "else if(!saved&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){root.classList.add('quarto-dark')}})();";

const RUNTIME =
  "window.quarto=window.quarto||{};\n" +
  "document.addEventListener('DOMContentLoaded',function(){\n" +
  "window.tippy('.footnote-ref',{placement:'bottom'});\n" +
  "var anchors=new window.AnchorJS();anchors.add('.anchored');\n" +
  "var buttons=document.querySelectorAll('.code-copy-button');\n" +
  "buttons.forEach(function(el){var clip=new window.ClipboardJS(el);clip.on('success',function(){})});\n" +
  "var ann=document.querySelectorAll('.code-annotation-anchor');\n" +
  "ann.forEach(function(el){window.tippy(el,{placement:'top'})});\n" +
  "var toggles=document.querySelectorAll('[data-bs-toggle=\"collapse\"]');\n" +
  "toggles.forEach(function(el){el.addEventListener('click',function(){if(window.bootstrap){new window.bootstrap.Collapse(el)}})});\n" +
  "var light=document.querySelectorAll('img[data-zoomable]');\n" +
  "light.forEach(function(el){el.addEventListener('click',function(){})});\n" +
  "});";

const LIB = {
  tippy: {
    banner:
      '/*! Tippy.js v6.3.7 | bundles @popperjs/core | require("@popperjs/core") | MIT License <https://github.com/atomiks/tippyjs-react> */',
    global: "tippy",
    size: 9500,
    seed: 6101,
  },
  popper: {
    banner:
      "/*! @popperjs/core v2.11.8 | popper.js the positioning engine | MIT License */",
    global: "Popper",
    size: 22000,
    seed: 6102,
  },
  bootstrap: {
    banner:
      "/*! Bootstrap v5.3.3 (https://getbootstrap.com/) | Copyright 2011-2024 The Bootstrap Authors | Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE) */",
    global: "bootstrap",
    size: 38000,
    seed: 6103,
    api: "bootstrap.Collapse=function Collapse(){};",
  },
  clipboard: {
    banner:
      "/*! clipboard.js v2.0.11 | https://github.com/zenorocha/clipboard.js | MIT License */",
    global: "ClipboardJS",
    size: 7500,
    seed: 6104,
    api: "ClipboardJS.prototype.on=function(){};",
  },
  anchor: {
    banner:
      "/*! AnchorJS - v4.3.1 | (c) 2012-2024 Bryan Braun | MIT License <https://github.com/bryanbraun/anchorjs> */",
    global: "AnchorJS",
    size: 5200,
    seed: 6105,
    api: "AnchorJS.prototype.add=function(){};",
  },
};

const LIB_ORDER = ["bootstrap", "popper", "tippy", "clipboard", "anchor"];

const libScript = (name) => `<script>${fakeLib(LIB[name])}</script>`;
const libScripts = (names) => names.map(libScript).join("");
const AFTER_BODY = `<script id="quarto-html-after-body" type="text/javascript">${RUNTIME}</script>`;
const BEFORE = `<script id="quarto-html-before-body" type="text/javascript">${BEFORE_BODY}</script>`;
const quartoTail = (libs) => `${libScripts(libs)}${AFTER_BODY}`;

const themeCss = () =>
  [
    "/*! quarto-css-bootstrap-banner-001 */",
    ".row{display:flex;flex-wrap:wrap;margin-right:-.75rem;margin-left:-.75rem}",
    ".col{flex:1 0 0%;max-width:100%;padding-right:.75rem;padding-left:.75rem}",
    ".container{width:100%;max-width:1140px;margin-right:auto;margin-left:auto;padding-right:.75rem;padding-left:.75rem}",
    ".container-fluid{width:100%;padding-right:.75rem;padding-left:.75rem;margin-right:auto;margin-left:auto}",
    ".navbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:.5rem 1rem}",
    ".navbar-toggler{padding:.25rem .75rem;font-size:1.25rem;background:transparent;border:1px solid #dee2e6;border-radius:.375rem}",
    ".quarto-title-block{margin-bottom:1.5rem}",
    ".quarto-title-meta{display:flex;gap:1rem}",
    ".callout{margin:1rem 0;border-left:.25rem solid #b6effb;border-radius:.25rem}",
    ".callout-note{border-left-color:#0dcaf0;background:#cff4fc}",
    ".callout-important{border-left-color:#dc3545;background:#f8d7da}",
    ".callout-tip{border-left-color:#198754;background:#d1e7dd}",
    ".callout-warning{border-left-color:#ffc107;background:#fff3cd}",
    ".panel-tabset{margin:1rem 0}",
    ".panel-tabset-tabby{display:flex;list-style:none;padding-left:0;border-bottom:2px solid #dee2e6}",
    ".nav-link{display:block;padding:.375rem 1rem}",
    ".nav-link.active{color:#0d6efd;border-color:#0d6efd}",
    ".code-copy-button{margin-top:.25rem;margin-right:.25rem;opacity:.75}",
    ".sourceCode{background:#f8f9fa;padding:.5rem;border-radius:.25rem;overflow-x:auto}",
    ".footnotes{margin-top:2rem;border-top:1px solid #dee2e6;padding-top:1rem}",
    ".footnote-ref a{text-decoration:none}",
    ".anchored h2,.anchored h3{scroll-margin-top:2rem}",
    ".quarto-figure{text-align:center;margin:1.5rem 0}",
    ".quarto-figure-caption{font-size:.875rem;color:#6c757d}",
    ".column-margin{font-size:.85rem;color:#495057}",
    ".column-margin-container{}",
    ".toc{border-left:1px solid #dee2e6;padding-left:1rem}",
    ".toc-active{color:#0d6efd}",
    ".task-list-item{list-style:none}",
    ".tbl-parent{overflow-x:auto}",
  ].join("\n");

const unusedCss = (prefix, count, seed) => {
  const rand = random(seed);
  return repeat(count, (i) => {
    const shade = Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0");
    return `.${prefix}-${i}{color:#${shade};padding-top:${i % 23}px;border-color:#fff}`;
  });
};

const miniToc = (items) =>
  `<nav id="TOC" role="doc-toc" class="contents"><ul>${items
    .map(([id, text]) => `<li><a class="nav-link" href="#${id}">${text}</a></li>`)
    .join("")}</ul></nav>`;

const paragraphs = (count, seed) => {
  const rand = random(seed);
  const words = [
    "measure", "swift", "harbor", "bright", "tangle", "orbit", "velvet", "copper",
    "hollow", "cinder", "prairie", "lucid", "anchor", "meadow", "signal", "grain",
  ];
  return repeat(count, (i) => {
    const n = 24 + Math.floor(rand() * 30);
    const sentence = Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(" ");
    return `<p>Paragraph ${i}: ${sentence}.</p>\n`;
  });
};

const codeBlock = (id, code) =>
  `<div class="sourceCode" id="${id}"><pre class="sourceCode"><code class="sourceCode quarto-sourceCode python">${code}</code></pre></div>`;

const footnoteSection = (id, text) =>
  `<div class="footnotes" role="doc-endnotes"><hr><ol><li id="fn${id}"><p>${text}<a href="#fnref${id}" class="footnote-back" role="doc-backlink">↩︎</a></p></li></ol></div>`;

const footnoteRef = (id) =>
  `<sup class="footnote-ref"><a href="#fn${id}" id="fnref${id}" role="doc-noteref">${id}</a></sup>`;

const callout = (type, title, bodyText, collapsible) =>
  `<div class="callout callout-style-default callout-${type} callout-titled${collapsible ? " callout-collapse" : ""}">` +
  `<div class="callout-header d-flex justify-content-between"${collapsible ? ' data-bs-toggle="collapse" data-bs-target="#callout-collapse" aria-expanded="false"' : ""}>` +
  `<div class="callout-icon-container"><i class="callout-icon"></i></div>` +
  `<div class="callout-title-container flex-fill">${title}</div></div>` +
  `<div class="callout-body-container"${collapsible ? ' id="callout-collapse"' : ""}>` +
  `<div class="callout-body"><p>${bodyText}</p></div></div></div>`;

const tabset = (names) =>
  `<div class="panel-tabset"><ul class="panel-tabset-tabby">${names
    .map(
      (name, i) =>
        `<li class="nav-item" role="presentation"><button class="nav-link${i === 0 ? " active" : ""}" data-tabset-id="tabset" data-tabset-value="${name.toLowerCase()}" aria-selected="${i === 0 ? "true" : "false"}">${name}</button></li>`,
    )
    .join("")}</ul><div class="tab-content">${names
    .map(
      (name, i) =>
        `<div class="tab-pane${i === 0 ? " active" : ""}" data-tabset-id="tabset" data-tabset-value="${name.toLowerCase()}" role="tabpanel"><p>${name} content.</p></div>`,
    )
    .join("")}</div></div>`;

export default [
  {
    id: "quarto-plain-article",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["/*! quarto-css-bootstrap-banner-001 */", "window.tippy=n;", "window.AnchorJS=n;", "window.ClipboardJS=n;"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4", "@popperjs/core v2", "Tippy.js v6"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Plain</title><style>${themeCss()}\n${unusedCss("plain-dead", 24, 6601)}</style>`,
        `${BEFORE}<main><h1>Plain article</h1>${paragraphs(3, 6602)}<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-plain-article-no-theme",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: { outcome: "keeps" },
    build: () =>
      page(
        "<title>Minimal</title>",
        "<main><h1>Minimal</h1><p>Nothing to optimize here.</p></main>",
      ),
  },
  {
    id: "quarto-kitchen-sink-everything-used",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [
        "Bootstrap v5",
        "@popperjs/core v2",
        "Tippy.js v6",
        "clipboard.js v2",
        "AnchorJS - v4",
      ],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Sink</title><style>${themeCss()}\n${unusedCss("sink-dead", 30, 6611)}</style>`,
        `${BEFORE}<main><header class="quarto-title-block"><h1 class="anchored">Kitchen sink</h1></header>${miniToc([["tabs", "Tabs"], ["note", "Note"]])}<h2 class="anchored" id="tabs">Tabs</h2>${tabset(["One", "Two"])}<h2 class="anchored" id="note">Note</h2>${callout("note", "Folded", "A collapsible note.", true)}${codeBlock("cb1", "def f(x):\n    return x")}<button class="code-copy-button" type="button">Copy</button><div class="code-annotation-content" id="annot-1">Annotation body</div><p>Text with a footnote.${footnoteRef(1)}</p>${footnoteSection(1, "The note.")}</main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-no-features-dead-libraries",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["window.tippy=n;", "window.ClipboardJS=n;", "window.AnchorJS=n;"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4", "@popperjs/core v2", "Tippy.js v6"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Dead</title><style>${themeCss()}\n${unusedCss("dead-dead", 40, 6621)}</style>`,
        `${BEFORE}<main><h1>A page that uses no Quarto features</h1>${paragraphs(2, 6622)}</main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-footnotes-keep-tippy",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Tippy.js v6", "@popperjs/core v2"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Footnotes</title><style>${themeCss()}\n${unusedCss("fn-dead", 22, 6631)}</style>`,
        `${BEFORE}<main><h1>Notes</h1><p>Body text.${footnoteRef(1)}</p>${footnoteSection(1, "First note.")}</main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-cross-references-keep-tippy",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Tippy.js v6", "@popperjs/core v2"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Xrefs</title><style>${themeCss()}\n${unusedCss("xref-dead", 20, 6641)}</style>`,
        `${BEFORE}<main><h1>Refs</h1><p>See <a class="quarto-xref" href="#fig-plot" data-type="fig">Figure&nbsp;1</a> for details.</p><figure id="fig-plot"><figcaption>Figure 1: A plot.</figcaption></figure></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-citations-keep-tippy",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Tippy.js v6", "@popperjs/core v2"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Citations</title><style>${themeCss()}\n${unusedCss("cite-dead", 20, 6651)}</style>`,
        `${BEFORE}<main><h1>Bayes</h1><p>Workflow is natural.<a href="#ref-gelman2020" class="citation" role="doc-biblioref"><sup>1</sup></a></p><div class="references csl-bib-body" role="doc-bibliography"><div class="csl-entry" id="ref-gelman2020" role="doc-biblioentry">Gelman, A. Bayesian workflow. 2020.</div></div></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-code-annotations-keep-tippy",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Tippy.js v6", "@popperjs/core v2"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Annotations</title><style>${themeCss()}\n${unusedCss("annot-dead", 20, 6661)}</style>`,
        `${BEFORE}<main><h1>Annotated</h1>${codeBlock("ann-1", "x &lt;- 1<1>\nmean(x)<2>")}<div class="code-annotation-content" id="annot-1"><a class="code-annotation-anchor" data-target-annotation="1" aria-label="Annotation 1"></a>Make a vector.</div></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-code-copy-button-keeps-clipboard",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["clipboard.js v2", "Bootstrap v5", "@popperjs/core v2"],
      removes: ["Tippy.js v6", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Copy</title><style>${themeCss()}\n${unusedCss("copy-dead", 20, 6671)}</style>`,
        `${BEFORE}<main><h1>Code</h1>${codeBlock("copy-1", "x &lt;- 1:10\nmean(x)")}<button class="code-copy-button" type="button">Copy</button></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-anchored-headings-keep-anchorjs",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["AnchorJS - v4"],
      removes: ["Bootstrap v5", "clipboard.js v2", "Tippy.js v6", "@popperjs/core v2"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Anchors</title><style>${themeCss()}\n${unusedCss("anchor-dead", 20, 6681)}</style>`,
        `${BEFORE}<main><h1>Headings</h1><h2 class="anchored" id="first">First</h2><p>Text.</p><h3 class="anchored" id="second">Second</h3><p>More text.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-collapsible-callout-keeps-bootstrap",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Bootstrap v5", "@popperjs/core v2"],
      removes: ["Tippy.js v6", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Collapse</title><style>${themeCss()}\n${unusedCss("collapse-dead", 20, 6691)}</style>`,
        `${BEFORE}<main><h1>Callout</h1>${callout("warning", "Folded", "Hidden content under the fold.", true)}</main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-data-bs-modal-keeps-bootstrap",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Bootstrap v5", "@popperjs/core v2"],
      removes: ["Tippy.js v6", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Modal</title><style>${themeCss()}\n${unusedCss("modal-dead", 20, 6701)}</style>`,
        `${BEFORE}<main><h1>Modal</h1><button type="button" class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#demo">Open</button><div class="modal fade" id="demo" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-body">Body</div></div></div></div></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-mixed-footnote-and-copy-keeps-both",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Tippy.js v6", "clipboard.js v2", "Bootstrap v5", "@popperjs/core v2"],
      removes: ["AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Mixed</title><style>${themeCss()}\n${unusedCss("mixed-dead", 20, 6711)}</style>`,
        `${BEFORE}<main><h1>Both</h1><p>Note.${footnoteRef(1)}</p>${footnoteSection(1, "Mixed note.")}<button class="code-copy-button" type="button">Copy</button></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-custom-script-mentions-bootstrap-keeps-it",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Bootstrap v5"],
      removes: ["@popperjs/core v2", "Tippy.js v6", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Custom</title><style>${themeCss()}\n${unusedCss("custom-dead", 20, 6721)}</style><script>document.addEventListener('DOMContentLoaded',function(){if(window.bootstrap){new window.bootstrap.Collapse(document.getElementById('target'))}});</script>`,
        `${BEFORE}<main><h1>Custom</h1><p>A hand-rolled script wires up bootstrap.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-search-index-embedded",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["quarto-search-index", "objectID"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4", "@popperjs/core v2"],
    },
    build: () => {
      const entries = repeat(60, (i) => `{"objectID":"sec-${i}","href":"#sec-${i}","body":"Section ${i} of the guide","title":"Section ${i}"}`);
      const search = `<script type="application/json" id="quarto-search-index">[${entries}]</script>`;
      const engine = `<script>/* quarto search tools */(function(){window.QuartoSearch={index:null,lookup:function(q){return this.index?this.index.filter(function(e){return e.body.indexOf(q)!==-1}):[]},attach:function(id){this.index=JSON.parse(document.getElementById(id).textContent)}}})();</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><meta name="quarto:search" content="true"><title>Search</title><style>${themeCss()}\n${unusedCss("search-dead", 18, 6731)}</style>`,
        `${BEFORE}<main><h1>Searchable guide</h1>${paragraphs(2, 6732)}</main>${search}${engine}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-katex-math-payload",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["KaTeX_Main", "katex.min.js"],
      removes: ["Bootstrap v5", "Tippy.js v6"],
    },
    build: () => {
      const katexCss = [
        ".katex{font:normal 1.21em KaTeX_Main,Times New Roman,serif;white-space:nowrap}",
        ".katex .mord{font-family:KaTeX_Main}",
        ".katex .mop{font-family:KaTeX_Math}",
        ".katex-display{margin:1em 0;text-align:center}",
        "@font-face{font-family:KaTeX_Main;src:url(data:font/woff2;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA) format('woff2');font-weight:400;font-style:normal}",
        "@font-face{font-family:KaTeX_Main;src:url(data:font/woff2;base64,BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB) format('woff2');font-weight:700;font-style:normal}",
        "@font-face{font-family:KaTeX_Math;src:url(data:font/woff2;base64,CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC) format('woff2');font-weight:400;font-style:italic}",
        ".katex-html .mathrm{font-family:KaTeX_Main}",
        unusedCss("katex-dead", 26, 6801),
      ].join("\n");
      const katexLib = `<script>/*! katex.min.js v0.16.11 | KaTeX | MIT License */${repeat(420, (i) => `var kx${i}=function(e){return e?e:e};`)}window.katex={render:function(tex,el){el.textContent=tex}};</script>`;
      const autoRender = `<script>document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('.katex-math').forEach(function(el){el.setAttribute('data-math','inline')})});</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Math</title><style>${katexCss}</style>`,
        `${BEFORE}<main><h1>Math</h1><p>Inline <span class="katex-math">x^2 + y^2 = z^2</span> here.</p><div class="katex-display"><span class="katex"><span class="katex-html"><span class="mord">e</span><span class="mord sup">i pi</span></span></span></div></main>${katexLib}${autoRender}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-mathjax-payload",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["MathJax v3", "window.MathJax"],
      removes: ["Bootstrap v5", "Tippy.js v6"],
    },
    build: () => {
      const tex = `<script>window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$'],['\\\\[','\\\\]']]},options:{skipHtmlTags:['script','noscript','style','textarea','pre']},chtml:{scale:1}};</script>`;
      const mathjaxLib = `<script>/*! MathJax v3.2.2 (tex-chtml) | (c) 2015-2024 The MathJax Consortium | Apache-2.0 License */${repeat(700, (i) => `var mj${i}={t:${i}};`)}window.MathJax.startup={pageReady:function(){return Promise.resolve()}};</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>MathJax</title><style>${themeCss()}\n${unusedCss("mathjax-dead", 18, 6811)}</style>${tex}`,
        `${BEFORE}<main><h1>MathJax</h1><p>$$\\int_0^1 x^2 dx = 1/3$$</p><p>Inline $a^2 + b^2 = c^2$ works.</p></main>${mathjaxLib}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-mermaid-diagram",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["mermaid", "mermaid.initialize"],
      removes: ["Bootstrap v5", "Tippy.js v6"],
    },
    build: () => {
      const mermaidLib = `<script>/*! mermaid v10.9.1 | MIT License <https://github.com/mermaid-js/mermaid> */${repeat(900, (i) => `var mm${i}=function(){return {d:${i}}};`)}window.mermaid={initialize:function(){},run:function(){}};</script>`;
      const init = `<script>window.mermaid.initialize({startOnLoad:true,securityLevel:'loose'});</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Diagram</title><style>${themeCss()}\n${unusedCss("mermaid-dead", 18, 6821)}</style>`,
        `${BEFORE}<main><h1>Diagram</h1><pre class="mermaid">graph LR\n  A[Start] --> B{Choice}\n  B -->|yes| C[Go]\n  B -->|no| D[Stop]</pre></main>${mermaidLib}${init}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-revealjs-simple-deck",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Reveal.js v4", "Reveal"],
      removes: ["Bootstrap v5", "Tippy.js v6", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () => {
      const revealLib = `<script>${fakeLib({ banner: "/*! Reveal.js v4.6.1 | (c) 2011-2024 Hakim El Hattab | MIT License <https://github.com/hakimel/reveal.js> */", global: "Reveal", size: 52000, seed: 6831, api: "Reveal.initialize=function(){};" })}</script>`;
      const revealCss = [
        ".reveal{overflow:auto;position:relative;width:100%;height:100vh}",
        ".reveal .slides{position:relative;text-align:center}",
        ".reveal .slides section{padding:1em;display:block}",
        ".reveal .slides section.past,.reveal .slides section.future{opacity:.3}",
        ".reveal .progress{position:absolute;bottom:0;left:0;height:.2em;background:#000}",
        ".reveal .controls{display:grid;grid-auto-flow:column;gap:.5rem}",
        ".reveal h1{font-size:2.5em}",
        ".reveal h2{font-size:1.75em}",
        ".reveal ul{display:block}",
        ".fragment{opacity:0;visibility:hidden}",
        ".fragment.visible{opacity:1;visibility:visible}",
        unusedCss("reveal-dead", 50, 6832),
      ].join("\n");
      const init = `<script>window.Reveal.initialize({hash:true,transition:'fade'});</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Deck</title><style>${revealCss}</style>`,
        `${BEFORE}<div class="reveal"><div class="slides"><section><h2>Introduction</h2><p>Opening slide.</p></section><section><h2>Fruit</h2><ul><li>One</li><li>Two</li></ul></section></div></div>${revealLib}${init}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-revealjs-notes-plugin",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Reveal.js v4", "RevealNotes"],
      removes: ["Bootstrap v5"],
    },
    build: () => {
      const revealLib = `<script>${fakeLib({ banner: "/*! Reveal.js v4.6.1 | (c) 2011-2024 Hakim El Hattab | MIT License <https://github.com/hakimel/reveal.js> */", global: "Reveal", size: 52000, seed: 6841, api: "Reveal.initialize=function(){};" })}</script>`;
      const notesLib = `<script>${fakeLib({ banner: "/*! reveal.js notes plugin v4.6.1 | MIT License */", global: "RevealNotes", size: 8000, seed: 6842 })}</script>`;
      const init = `<script>window.Reveal.initialize({hash:true});</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Deck notes</title><style>${themeCss()}\n${unusedCss("deck-dead", 18, 6843)}</style>`,
        `${BEFORE}<div class="reveal"><div class="slides"><section><h2>Slide</h2></section></div></div>${revealLib}${notesLib}${init}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-dashboard-valueboxes",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["plotly_1", "htmlwidgets v1", "data-for=\"plotly_1\""],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () => {
      const payload = `{"x":{"data":[{"type":"scatter","x":[1,2,3,4],"y":[4,2,3,1],"mode":"markers"}],"layout":{"title":"Weight vs mpg"},"config":{"responsive":true}},"evals":[],"jsHooks":[]}`;
      const plotlyLib = `<script>${fakeLib({ banner: "/*! plotly.js v2.32.0 | (c) 2012-2024 Plotly, Inc. | MIT License */", global: "Plotly", size: 46000, seed: 6851 })}</script>`;
      const htmlwidgets = `<script>${fakeLib({ banner: "/*! htmlwidgets v1.6.4 | htmlwidgets | MIT License <https://github.com/ramnathv/htmlwidgets> */", global: "HTMLWidgets", size: 18500, seed: 6852 })}</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Dash</title><style>${themeCss()}\n${unusedCss("dash-dead", 20, 6853)}</style>`,
        `${BEFORE}<main class="dashboard"><div class="valuebox-grid"><div class="value-box bg-primary text-white"><div class="body"><div class="title">Cars</div><div class="value-box-value">32</div></div></div></div><div class="card"><div class="card-body"><div id="plotly_1" class="html-widget" style="width:100%;height:420px"></div><script type="application/json" data-for="plotly_1">${payload}</script></div></div></main>${htmlwidgets}${plotlyLib}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-dashboard-datatable",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["DataTable 2", "datatable", "data-for=\"dt_1\""],
      removes: ["Bootstrap v5", "AnchorJS - v4"],
    },
    build: () => {
      const payload = `{"x":{"filter":"top","options":{"pageLength":8},"data":[["Mazda RX4",6,160],["Mazda RX4 Wag",6,160],["Datsun 710",4,108]],"container":"<table class='display'></table>","type":"double","mode":"htmlwidgets"},"evals":[],"jsHooks":[]}`;
      const dtLib = `<script>${fakeLib({ banner: "/*! DataTable 2.0.8 | (c) 2008-2024 SpryMedia Ltd | MIT License */", global: "DataTable", size: 42000, seed: 6861 })}</script>`;
      const htmlwidgets = `<script>${fakeLib({ banner: "/*! htmlwidgets v1.6.4 | htmlwidgets | MIT License <https://github.com/ramnathv/htmlwidgets> */", global: "HTMLWidgets", size: 18500, seed: 6862 })}</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Tables</title><style>${themeCss()}\n${unusedCss("dt-dead", 20, 6863)}</style>`,
        `${BEFORE}<main class="dashboard"><div class="card"><div class="card-body"><div id="dt_1" class="html-widget datatables" style="width:100%"></div><script type="application/json" data-for="dt_1">${payload}</script></div></div></main>${htmlwidgets}${dtLib}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-dashboard-tabset-pills",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Bootstrap v5", "@popperjs/core v2"],
      removes: ["Tippy.js v6", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Pills</title><style>${themeCss()}\n${unusedCss("pills-dead", 20, 6871)}</style>`,
        `${BEFORE}<main class="dashboard"><ul class="nav nav-pills" id="dash-tabs" role="tablist"><li class="nav-item" role="presentation"><button class="nav-link active" id="tab-summary" data-bs-toggle="pill" data-bs-target="#summary" type="button" role="tab">Summary</button></li><li class="nav-item" role="presentation"><button class="nav-link" id="tab-detail" data-bs-toggle="pill" data-bs-target="#detail" type="button" role="tab">Detail</button></li></ul><div class="tab-content"><div class="tab-pane fade show active" id="summary" role="tabpanel"><p>Summary card.</p></div><div class="tab-pane fade" id="detail" role="tabpanel"><p>Detail card.</p></div></div></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-gt-table-output",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["gt_table", "gt_col_heading"],
      removes: [".gt-unused-0{", "Bootstrap v5"],
    },
    build: () => {
      const gtCss = [
        ".gt_table{border-collapse:collapse;width:100%}",
        ".gt_col_heading{font-weight:700;padding:8px;border-bottom:2px solid #e0e0e0}",
        ".gt_row{padding:8px;border-bottom:1px solid #f0f0f0}",
        ".gt_stub{font-style:italic}",
        ".gt_caption{caption-side:top;text-align:left;font-size:.9rem}",
        unusedCss("gt-unused", 40, 6881),
      ].join("\n");
      const rows = repeat(6, (i) => `<tr class="gt_row"><th class="gt_stub">row ${i}</th><td>${i * 2}</td><td>${i * 3}</td></tr>`);
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>gt</title><style>${gtCss}</style>`,
        `${BEFORE}<main><h1>Table</h1><div class="tbl-parent"><table class="gt_table"><caption class="gt_caption">Cars</caption><thead><tr><th class="gt_col_heading">stub</th><th class="gt_col_heading">x</th><th class="gt_col_heading">y</th></tr></thead><tbody>${rows}</tbody></table></div></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-book-chapter",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Tippy.js v6", "quarto-sidebar"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Chapter</title><style>${themeCss()}\n.quarto-sidebar{width:280px;float:left;padding-right:1rem;border-right:1px solid #e0e0e0}\n.chapter-number{}\n${unusedCss("book-dead", 20, 6891)}</style>`,
        `${BEFORE}<nav id="quarto-sidebar" class="quarto-sidebar"><ol class="list-unstyled"><li><a href="#">Chapter 1</a></li><li class="active"><a href="#">Chapter 2</a></li><li><a href="#">Chapter 3</a></li></ol></nav><main><h1>Chapter 2</h1><p>See <a class="quarto-xref" href="#fig-model" data-type="fig">Figure&nbsp;2</a>.</p><p>Text of the chapter.${footnoteRef(1)}</p>${footnoteSection(1, "Chapter note.")}</main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-website-listing-grid",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["quarto-listing", "quarto-listing-grid"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4", "@popperjs/core v2"],
    },
    build: () => {
      const items = repeat(9, (i) => `<div class="quarto-post grid gap-3"><h3 class="listing-title"><a href="post-${i}.html">Post ${i}</a></h3><div class="listing-categories"><span class="listing-category">guide</span></div></div>`);
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Listing</title><style>${themeCss()}\n.quarto-listing{margin:1rem 0}\n.quarto-listing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}\n.listing-title{font-size:1.1rem}\n.listing-category{background:#e9ecef;border-radius:.25rem;padding:.1rem .4rem}\n${unusedCss("listing-dead", 20, 6901)}</style>`,
        `${BEFORE}<main><h1>Posts</h1><div class="quarto-listing quarto-listing-grid">${items}</div></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-website-navbar-toggler",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Bootstrap v5", "@popperjs/core v2", "navbar-toggler"],
      removes: ["Tippy.js v6", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Site</title><style>${themeCss()}\n${unusedCss("navbar-dead", 20, 6911)}</style>`,
        `${BEFORE}<nav class="navbar navbar-expand-lg bg-light"><div class="container-fluid"><a class="navbar-brand" href="/">Home</a><button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#siteNav" aria-controls="siteNav" aria-expanded="false" aria-label="Toggle"><span class="navbar-toggler-icon"></span></button><div class="collapse navbar-collapse" id="siteNav"><ul class="navbar-nav"><li class="nav-item"><a class="nav-link active" href="/">Docs</a></li><li class="nav-item"><a class="nav-link" href="/about/">About</a></li></ul></div></div></nav><main><h1>Docs</h1><p>Page body.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-margin-notes-no-features",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["column-margin"],
      removes: ["Bootstrap v5", "Tippy.js v6", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Margins</title><style>${themeCss()}\n${unusedCss("margin-dead", 20, 6921)}</style>`,
        `${BEFORE}<main class="column-margin-container"><h1>Margin notes</h1><p class="column-margin">A note sitting in the right margin of this page.</p><p>The main text wraps around the margin column here.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-toc-sidebar",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["toc", "nav-link"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>TOC</title><style>${themeCss()}\n${unusedCss("toc-dead", 20, 6931)}</style>`,
        `${BEFORE}<main><h1>Guide</h1>${miniToc([["intro", "Intro"], ["setup", "Setup"], ["build", "Build"]])}<h2 id="intro">Intro</h2><p>Intro text.</p><h2 id="setup">Setup</h2><p>Setup text.</p><h2 id="build">Build</h2><p>Build text.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-theme-dark-light-toggle",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".quarto-dark", "--quarto-bg"],
      removes: [".theme-toggle-unused-0{"],
    },
    build: () => {
      const theme = [
        ":root{--quarto-bg:#fdfdfd;--quarto-fg:#2f2f2f;--quarto-accent:#0d6efd}",
        ".quarto-dark{--quarto-bg:#1a1a1a;--quarto-fg:#e0e0e0;--quarto-accent:#6ea8fe}",
        "body{background:var(--quarto-bg);color:var(--quarto-fg)}",
        "a{color:var(--quarto-accent)}",
        ".theme-toggle{cursor:pointer}",
        unusedCss("theme-toggle-unused", 20, 6941),
      ].join("\n");
      return page(
        `<meta name="generator" content="quarto-1.6.39"><meta name="color-scheme" content="light dark"><title>Themes</title><style>${theme}</style>`,
        `${BEFORE}<main><h1>Theme</h1><button class="theme-toggle" id="quarto-color-scheme-toggle" type="button">Toggle</button><p>Light and dark palettes.</p></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-callout-types",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["callout-note", "callout-tip", "callout-important"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Callouts</title><style>${themeCss()}\n${unusedCss("callout-dead", 20, 6951)}</style>`,
        `${BEFORE}<main><h1>Callouts</h1>${callout("note", "Note", "A plain note.", false)}${callout("tip", "Tip", "A plain tip.", false)}${callout("important", "Important", "Important stuff.", false)}</main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-panel-tabset",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["panel-tabset", "tab-pane"],
      removes: ["Bootstrap v5", "clipboard.js v2", "AnchorJS - v4"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Tabset</title><style>${themeCss()}\n${unusedCss("tabset-dead", 20, 6961)}</style>`,
        `${BEFORE}<main><h1>Tabs</h1>${tabset(["Read", "Write", "Run"])}</main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-syntax-highlighting-used",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".kw{", ".str{", ".cmt{"],
      removes: [".hl-dead-0{"],
    },
    build: () => {
      const highlight = [
        ".kw{color:#005cc5;font-weight:700}",
        ".str{color:#032f62}",
        ".cmt{color:#6a737d;font-style:italic}",
        ".num{color:#005cc5}",
        ".op{color:#d73a49}",
        ".fn{color:#6f42c1}",
        unusedCss("hl-dead", 30, 6971),
      ].join("\n");
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Highlight</title><style>${highlight}</style>`,
        `${BEFORE}<main><h1>Highlighted</h1><div class="sourceCode"><pre class="sourceCode"><code class="sourceCode python"><span class="cmt"># comment</span>\n<span class="kw">def</span> <span class="fn">f</span>(<span class="op">x</span>):\n    <span class="kw">return</span> <span class="str">"ok"</span></code></pre></div></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-figure-plain-png",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["<img", "figcaption"],
      removes: [".figure-dead-0{"],
    },
    build: () => {
      const image = pngDataUri(640, 360, 6991, { bands: 9 });
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Figure</title><style>.figure-dead-0{color:#123456;padding-top:1px}\n${unusedCss("figure-dead", 14, 6992)}</style>`,
        `${BEFORE}<main><figure class="quarto-figure"><img src="${image}" alt="A deterministic gradient figure" width="640" height="360"><figcaption class="quarto-figure-caption">Figure 1: Gradient.</figcaption></figure></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-lightbox-gallery",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["data-zoomable", "figure-lightbox"],
      removes: [".lightbox-dead-0{", "Tippy.js v6"],
    },
    build: () => {
      const one = pngDataUri(480, 320, 7001, { bands: 5 });
      const two = pngDataUri(480, 320, 7002, { bands: 6 });
      const lightboxLib = `<script>${fakeLib({ banner: "/*! quarto-lightbox v1.0.0 | lightbox for quarto figures */", global: "QuartoLightbox", size: 8000, seed: 7003 })}</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Lightbox</title><style>.lightbox-dead-0{color:#123456}\n${unusedCss("lightbox-dead", 14, 7004)}</style>`,
        `${BEFORE}<main><figure class="quarto-figure figure-lightbox" data-gallery="gallery-1"><img src="${one}" alt="One" data-zoomable="" width="480" height="320"><figcaption class="quarto-figure-caption">One</figcaption></figure><figure class="quarto-figure figure-lightbox" data-gallery="gallery-1"><img src="${two}" alt="Two" data-zoomable="" width="480" height="320"><figcaption class="quarto-figure-caption">Two</figcaption></figure></main>${lightboxLib}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-katex-and-mermaid-combined",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["mermaid", "KaTeX_Main"],
      removes: ["Bootstrap v5", "Tippy.js v6"],
    },
    build: () => {
      const katexLib = `<script>/*! katex.min.js v0.16.11 | KaTeX | MIT License */${repeat(300, (i) => `var kx${i}=function(e){return e};`)}window.katex={render:function(){}};</script>`;
      const mermaidLib = `<script>/*! mermaid v10.9.1 | MIT License */${repeat(600, (i) => `var mm${i}=function(){return ${i}};`)}window.mermaid={initialize:function(){}};</script>`;
      const katexFont = "@font-face{font-family:KaTeX_Main;src:url(data:font/woff2;base64,AAAAAAAAAAAAAAAAAAAAAA) format('woff2')}";
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Math and diagrams</title><style>${themeCss()}\n${katexFont}\n.katex{font-family:KaTeX_Main}\n${unusedCss("both-dead", 16, 7011)}</style>`,
        `${BEFORE}<main><h1>Both</h1><p>$$x^2$$</p><pre class="mermaid">graph TD\n  A --> B</pre></main>${katexLib}${mermaidLib}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-style-link-data-uri",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["data:text/css", ".kept-dead-0{"],
      removes: [".link-dead-0{"],
    },
    build: () => {
      const css =
        ".kept-dead-0{color:red}" +
        repeat(30, (i) => `.link-dead-${i}{color:#${(1234567 * (i + 3)).toString(16).slice(0, 6).padStart(6, "0")}}`);
      const href = `data:text/css;charset=utf-8,${encodeURIComponent(css)}`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Inline link</title><link rel="stylesheet" href="${href}">`,
        `${BEFORE}<main><p class="kept-dead-0">Styled through a data URI.</p></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-multiple-stylesheets-pruned",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".multi-used-0{", ".second-used-0{"],
      removes: [".multi-dead-0{", ".second-dead-0{"],
    },
    build: () => {
      const first = [
        ".multi-used-0{color:#036}",
        unusedCss("multi-dead", 18, 7021),
      ].join("\n");
      const second = [
        ".second-used-0{margin:0}",
        unusedCss("second-dead", 18, 7022),
      ].join("\n");
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Two sheets</title><style>${first}</style><style>${second}</style>`,
        `${BEFORE}<main><p class="multi-used-0 second-used-0">Two stylesheets.</p></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-invalid-css-passes-through",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["@@@ {{{ this is not css", ".valid-dead-0{"],
      removes: [".valid-dead-1{"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Invalid</title><style>@@@ {{{ this is not css</style><style>${unusedCss("valid-dead", 12, 7031)}</style>`,
        `${BEFORE}<main><p class="valid-dead-0">One broken sheet, one pruned sheet.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-script-syntax-error-untouched",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["var broken = ;"],
      removes: [".broken-dead-5{"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Broken</title><style>${unusedCss("broken-dead", 12, 7041)}</style><script>var broken = ;</script>`,
        `${BEFORE}<main><p class="broken-dead-0">The bad script cannot be minified and is left alone.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-script-already-minified",
    category: "quarto",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["window.counter=(window.counter||0)+1;window.half=window.counter/2;"],
      removes: [".min-dead-5{"],
    },
    build: () => {
      const minified = `window.counter=(window.counter||0)+1;window.half=window.counter/2;${repeat(60, (i) => `window.step${i}=window.counter*${i};`)}`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Minified</title><style>${unusedCss("min-dead", 12, 7051)}</style><script>${minified}</script>`,
        `${BEFORE}<main><p class="min-dead-0">Already minified, so Octavo leaves it.</p></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-importmap-kept",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["importmap"],
      removes: [".import-dead-5{"],
    },
    build: () => {
      const importmap = `<script type="importmap">{"imports":{"three":"data:text/javascript;base64,AAAA","d3":"data:text/javascript;base64,BBBB"}}</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Importmap</title><style>${unusedCss("import-dead", 12, 7061)}</style>`,
        `${BEFORE}${importmap}<main><p class="import-dead-0">Import maps are never packed or rewritten.</p></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-speculationrules-kept",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["speculationrules", "prefetch"],
      removes: [".spec-dead-5{"],
    },
    build: () => {
      const rules = `<script type="speculationrules">{"prefetch":[{"source":"list","urls":["/about","/docs"]}]}</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Speculation rules</title><style>${unusedCss("spec-dead", 12, 7071)}</style>`,
        `${BEFORE}${rules}<main><p class="spec-dead-0">Speculation rules are left alone.</p></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-search-payload-big-index",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["quarto-search-data", "entry 400"],
      removes: [".search-big-dead-5{"],
    },
    build: () => {
      const entries = repeat(420, (i) => `{"id":${i},"title":"entry ${i}","body":"indexed text of entry ${i} with some shared words about octavo and the quarto toolchain","href":"#entry-${i}"}`);
      const data = `<script type="application/json" id="quarto-search-data">[${entries}]</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Big index</title><style>${unusedCss("search-big-dead", 12, 7081)}</style>`,
        `${BEFORE}<main><p class="search-big-dead-0">Search index.</p></main>${data}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-two-plotly-widgets",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["data-for=\"plot_a\"", "data-for=\"plot_b\"", "plotly.js"],
      removes: ["Bootstrap v5"],
    },
    build: () => {
      const payloadA = `{"x":{"data":[{"type":"scatter","x":[1,2,3],"y":[1,3,2]}],"layout":{},"config":{}},"evals":[],"jsHooks":[]}`;
      const payloadB = `{"x":{"data":[{"type":"box","x":[1,2,3,4],"y":[2,4,1,3]}],"layout":{},"config":{}},"evals":[],"jsHooks":[]}`;
      const htmlwidgets = `<script>${fakeLib({ banner: "/*! htmlwidgets v1.6.4 | htmlwidgets | MIT License */", global: "HTMLWidgets", size: 18500, seed: 7091 })}</script>`;
      const plotly = `<script>${fakeLib({ banner: "/*! plotly.js v2.32.0 | (c) Plotly, Inc. | MIT License */", global: "Plotly", size: 46000, seed: 7092 })}</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Two plots</title><style>${themeCss()}\n${unusedCss("two-plot-dead", 16, 7093)}</style>`,
        `${BEFORE}<main><div id="plot_a" class="html-widget" style="width:100%;height:300px"></div><script type="application/json" data-for="plot_a">${payloadA}</script><div id="plot_b" class="html-widget" style="width:100%;height:300px"></div><script type="application/json" data-for="plot_b">${payloadB}</script></main>${htmlwidgets}${plotly}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-leaflet-map-widget",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["leaflet v1.9", "data-for=\"map_1\""],
      removes: ["Bootstrap v5", "clipboard.js v2"],
    },
    build: () => {
      const payload = `{"x":{"options":{},"calls":[{"method":"addTiles","args":["https://tiles.example.com/{z}/{x}/{y}.png"]}],"dependencies":[]},"evals":[],"jsHooks":[]}`;
      const leaflet = `<script>${fakeLib({ banner: "/*! leaflet v1.9.4 | (c) 2010-2024 Vladimir Agafonkin | BSD-2-Clause License <https://github.com/Leaflet/Leaflet> */", global: "L", size: 40000, seed: 7101 })}</script>`;
      const htmlwidgets = `<script>${fakeLib({ banner: "/*! htmlwidgets v1.6.4 | htmlwidgets | MIT License */", global: "HTMLWidgets", size: 18500, seed: 7102 })}</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Map</title><style>${themeCss()}\n${unusedCss("leaflet-dead", 16, 7103)}</style>`,
        `${BEFORE}<main><div id="map_1" class="html-widget" style="width:100%;height:400px"></div><script type="application/json" data-for="map_1">${payload}</script></main>${htmlwidgets}${leaflet}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-reactable-widget",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Reactable", "data-for=\"table_1\""],
      removes: ["Bootstrap v5", "AnchorJS - v4"],
    },
    build: () => {
      const payload = `{"x":{"data":[["Mazda RX4",6],["Datsun 710",4]],"columns":["name","cyl"],"options":{"searchable":true,"filterable":true}},"evals":[],"jsHooks":[]}`;
      const reactable = `<script>${fakeLib({ banner: "/*! Reactable v0.2.3 | reactable tables | MIT License */", global: "Reactable", size: 26000, seed: 7111 })}</script>`;
      const htmlwidgets = `<script>${fakeLib({ banner: "/*! htmlwidgets v1.6.4 | htmlwidgets | MIT License */", global: "HTMLWidgets", size: 18500, seed: 7112 })}</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Reactable</title><style>${themeCss()}\n${unusedCss("reactable-dead", 16, 7113)}</style>`,
        `${BEFORE}<main><div id="table_1" class="html-widget reactable" style="width:100%"></div><script type="application/json" data-for="table_1">${payload}</script></main>${htmlwidgets}${reactable}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-figure-with-srcset",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["srcset", "figure-srcset"],
      removes: [".srcset-dead-0{"],
    },
    build: () => {
      const small = pngDataUri(320, 180, 7121, { bands: 4 });
      const large = pngDataUri(960, 540, 7122, { bands: 8 });
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Srcset</title><style>.srcset-dead-0{color:#123456}\n${unusedCss("srcset-dead", 14, 7123)}</style>`,
        `${BEFORE}<main><figure class="quarto-figure figure-srcset"><img src="${small}" srcset="${small} 1x, ${large} 2x" alt="Responsive figure" width="320" height="180"><figcaption class="quarto-figure-caption">Responsive figure.</figcaption></figure></main>${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-noscript-style-verbatim",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["noscript-marker{color:#c0ffee}", "show-fallback"],
      removes: [".noscript-dead-5{"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Noscript</title><style>${unusedCss("noscript-dead", 12, 7131)}</style>`,
        `${BEFORE}<noscript><style>noscript-marker{color:#c0ffee}</style><p class="show-fallback">Enable JavaScript to view the interactive figure.</p></noscript><main><p class="noscript-dead-0">Main content.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-embed-remote-script-warns",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["https://cdn.example.com/quarto-widget.js"],
      removes: [".remote-dead-5{"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Remote</title><script src="https://cdn.example.com/quarto-widget.js"></script><style>${unusedCss("remote-dead", 12, 7141)}</style>`,
        `${BEFORE}<main><p class="remote-dead-0">Remote resources only warn; the page still optimizes.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-embed-remote-stylesheet-warns",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["https://cdn.example.com/widget.css"],
      removes: [".remote-css-dead-5{"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Remote CSS</title><link rel="stylesheet" href="https://cdn.example.com/widget.css"><style>${unusedCss("remote-css-dead", 12, 7151)}</style>`,
        `${BEFORE}<main><p class="remote-css-dead-0">A remote stylesheet only warns.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-linked-site-libs-rejected",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: { outcome: "rejects", error: "not-self-contained" },
    build: () =>
      page(
        '<meta name="generator" content="quarto-1.6.39"><link rel="stylesheet" href="site_libs/bootstrap.min.css"><script src="site_libs/quarto.js"></script>',
        "<main><p>Served from disk, not rendered with embed-resources.</p></main>",
      ),
  },
  {
    id: "quarto-empty-document-keeps",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: { outcome: "keeps" },
    build: () => "<!DOCTYPE html><html><head><title>Empty</title></head><body></body></html>",
  },
  {
    id: "quarto-bibliography-section",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".references{", "csl-bib-body", "Tippy.js v6"],
      removes: [".biblio-dead-0{"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>References</title><style>.references{padding-left:2rem}\n${unusedCss("biblio-dead", 14, 7161)}</style>`,
        `${BEFORE}<main><h1>References</h1><div class="references csl-bib-body" role="doc-bibliography"><div class="csl-entry" id="ref-gelman2020" role="doc-biblioentry">Gelman, A. (2020). Bayesian workflow. <a href="#ref-gelman2020" class="citation" role="doc-biblioref"><sup>1</sup></a></div></div></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-htmlwidget-two-payloads-share-loader",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["data-for=\"w_1\"", "data-for=\"w_2\""],
      removes: ["Bootstrap v5"],
    },
    build: () => {
      const payloadA = `{"x":{"v":1},"evals":[],"jsHooks":[]}`;
      const payloadB = `{"x":{"v":2},"evals":[],"jsHooks":[]}`;
      const htmlwidgets = `<script>${fakeLib({ banner: "/*! htmlwidgets v1.6.4 | htmlwidgets | MIT License */", global: "HTMLWidgets", size: 18500, seed: 7171 })}</script>`;
      return page(
        `<meta name="generator" content="quarto-1.6.39"><title>Widgets</title><style>${themeCss()}\n${unusedCss("share-dead", 12, 7172)}</style>`,
        `${BEFORE}<main><div id="w_1" class="html-widget" style="width:300px;height:200px"></div><script type="application/json" data-for="w_1">${payloadA}</script><div id="w_2" class="html-widget" style="width:300px;height:200px"></div><script type="application/json" data-for="w_2">${payloadB}</script></main>${htmlwidgets}${quartoTail(LIB_ORDER)}`,
      );
    },
  },
  {
    id: "quarto-large-paragraph-article",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["quarto-title-block"],
      removes: [".long-dead-0{"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Long</title><style>${themeCss()}\n${unusedCss("long-dead", 26, 7181)}</style>`,
        `${BEFORE}<header class="quarto-title-block"><h1>Long article</h1></header><main>${paragraphs(120, 7182)}</main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-before-body-color-scheme-script",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["quarto-color-scheme", "quarto-dark"],
      removes: [".before-dead-5{"],
    },
    build: () =>
      page(
        `<meta name="generator" content="quarto-1.6.39"><title>Before</title><style>:root{--quarto-bg:#fff}.quarto-dark{--quarto-bg:#000}body{background:var(--quarto-bg)}\n${unusedCss("before-dead", 12, 7191)}</style>`,
        `${BEFORE}<main><button id="quarto-color-scheme-toggle" class="theme-toggle" type="button">Mode</button><p class="before-dead-0">Before-body script stands first in the body.</p></main>${quartoTail(LIB_ORDER)}`,
      ),
  },
  {
    id: "quarto-index-redirect-page",
    category: "quarto",
    tier: "full",
    browser: false,
    expect: { outcome: "keeps" },
    build: () =>
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Index</title><meta http-equiv=\"refresh\" content=\"0; url=./docs/\"></head><body><p>Moved.</p></body></html>",
  },
];

