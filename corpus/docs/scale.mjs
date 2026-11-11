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

const pngNoise = (width, height, seed) => {
  const rand = random(seed);
  const row = width * 4;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (row + 1);
    for (let x = 0; x < width; x++) {
      const at = offset + 1 + x * 4;
      raw[at] = Math.floor(rand() * 256);
      raw[at + 1] = Math.floor(rand() * 256);
      raw[at + 2] = Math.floor(rand() * 256);
      raw[at + 3] = 255;
    }
  }
  return raw;
};

const pngGradient = (width, height, seed, bands) => {
  const rand = random(seed);
  const row = width * 4;
  const raw = Buffer.alloc((row + 1) * height);
  const bandHeight = Math.max(1, Math.floor(height / bands));
  const palette = Array.from({ length: bands }, () => [
    30 + Math.floor(rand() * 200),
    30 + Math.floor(rand() * 200),
    30 + Math.floor(rand() * 200),
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
  return raw;
};

const pngDataUri = (width, height, seed, options = {}) => {
  const { bands = 6, noise = false } = options;
  const raw = noise
    ? pngNoise(width, height, seed)
    : pngGradient(width, height, seed, bands);
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

const unusedCss = (prefix, count, seed) => {
  const rand = random(seed);
  return repeat(count, (i) => {
    const shade = Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0");
    return `.${prefix}-${i}{color:#${shade};padding-top:${i % 29}px;border-bottom:1px solid #fff}`;
  });
};

const frameworkRules = (prefix, count, seed) => {
  const rand = random(seed);
  return repeat(count, (i) => {
    const shade = Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0");
    const padding = (i * 37) % 97;
    return `.${prefix}-${i}{display:block;color:#${shade};padding:${padding}px;margin:0 auto;background:#f8f9fa;border-radius:${padding}px;letter-spacing:0;font-weight:${400 + (i % 6) * 100}}`;
  });
};

const paragraphs = (count, seed) => {
  const rand = random(seed);
  const words = [
    "measure", "swift", "harbor", "bright", "tangle", "orbit", "velvet", "copper",
    "hollow", "cinder", "prairie", "lucid", "anchor", "meadow", "signal", "grain",
    "barrow", "lintel", "sparrow", "wick", "tallow", "quartz", "umber", "falcon",
  ];
  return repeat(count, (i) => {
    const n = 30 + Math.floor(rand() * 25);
    const sentence = Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(" ");
    return `<p>Paragraph ${i}: ${sentence}.</p>\n`;
  });
};

export default [
  {
    id: "scale-one-mib-pure-markup",
    category: "scale",
    tier: "smoke",
    expect: { outcome: "keeps" },
    build: () =>
      page(
        "<title>Pure markup</title>",
        `<main>${paragraphs(3500, 8001)}</main>`,
      ),
  },
  {
    id: "scale-one-mib-paragraphs",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["article-body"],
      removes: [".scale-para-dead-0{"],
    },
    build: () =>
      page(
        `<title>Paragraphs</title><style>.article-body{max-width:46em;margin:0 auto}\n${unusedCss("scale-para-dead", 220, 8002)}</style>`,
        `<main class="article-body">${paragraphs(3500, 8003)}</main>`,
      ),
  },
  {
    id: "scale-one-mib-many-small-scripts",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["smallScriptCount"],
      removes: [".scale-script-dead-0{"],
    },
    build: () => {
      const scripts = repeat(400, (i) => {
        const ops = repeat(64, (k) => `window.cell_${i}_${k}=Math.sqrt(${i * 31 + k})+${k % 13};\n`);
        return `<script>window.smallScriptCount=(window.smallScriptCount||0)+1;\n${ops}</script>`;
      });
      return page(
        `<title>Small scripts</title><style>.scale-script-dead-0{color:#123}\n${unusedCss("scale-script-dead", 30, 8004)}</style>`,
        `<main><h1>400 scripts</h1></main>${scripts}`,
      );
    },
  },
  {
    id: "scale-one-mib-many-small-styles",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".scale-keep-0{"],
      removes: [".scale-styles-dead-0-0{"],
    },
    build: () => {
      const blocks = repeat(720, (i) => {
        const rand = random(8100 + i);
        const shade = Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0");
        const rules = repeat(12, (j) => `.scale-styles-dead-${i}-${j}{color:#${shade};padding:${j % 31}px;margin:0;background:#fff;border-bottom:1px solid #fff;outline:none}`);
        return `<style>.scale-keep-${i}{color:#036;padding-top:${i % 7}px}\n${rules}\n</style>`;
      });
      return page(
        `<title>Small styles</title>`,
        `<main>${repeat(720, (i) => `<p class="scale-keep-${i % 4}">Styled paragraph ${i}</p>`)}${blocks}</main>`,
      );
    },
  },
  {
    id: "scale-one-mib-many-svgs",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["<svg", "scale-svg-keep{"],
      removes: [".scale-svg-dead-0{"],
    },
    build: () => {
      const svgs = repeat(240, (i) => {
        const rand = random(8300 + i);
        const offset = Math.floor(rand() * 40);
        const paths = repeat(64, (j) => `<path d="M${j * 11 % 220} ${offset} L${(j * 11 + 40) % 220} ${offset + 30} L${(j * 11 + 20) % 220} ${offset + 60}" fill="none" stroke="#${(117 * i * (j + 3)).toString(16).slice(0, 6).padStart(6, "0")}" stroke-width="2"/>`);
        return `<svg viewBox="0 0 220 80" width="220" height="80" role="img" aria-label="figure ${i}">${paths}</svg>`;
      });
      return page(
        `<title>SVGs</title><style>.scale-svg-keep{display:inline-block}\n${unusedCss("scale-svg-dead", 30, 8005)}</style>`,
        `<main class="scale-svg-keep">${svgs}</main>`,
      );
    },
  },
  {
    id: "scale-one-mib-big-base64-image",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["<img"],
      removes: [".scale-blob-dead-0{"],
    },
    build: () => {
      const image = pngDataUri(600, 430, 8401, { noise: true });
      return page(
        `<title>Blob</title><style>.scale-blob-dead-0{color:#123}\n${unusedCss("scale-blob-dead", 25, 8006)}</style>`,
        `<main><img src="${image}" alt="High entropy noise" width="900" height="700"></main>`,
      );
    },
  },
  {
    id: "scale-one-mib-deep-nesting",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["deep-179"],
      removes: [".scale-deep-dead-0{"],
    },
    build: () => {
      const depth = 180;
      const open = repeat(depth, (i) => `<div class="deep deep-${i}">`);
      const close = repeat(depth, () => "</div>");
      return page(
        `<title>Deep nesting</title><style>${unusedCss("scale-deep-dead", 25, 8007)}</style>`,
        `<main>${open}<article><p>Deep nesting test.</p>${paragraphs(3100, 8008)}</article>${close}</main>`,
      );
    },
  },
  {
    id: "scale-two-mib-framework-css",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".mega-0{", ".mega-19{"],
      removes: [".mega-12000{", ".mega-8001{"],
    },
    build: () => {
      const css = frameworkRules("mega", 19000, 8501);
      return page(
        `<title>Mega framework</title><style>${css}</style>`,
        `<main>${repeat(20, (i) => `<div class="mega-${i}">row ${i}</div>`)}</main>`,
      );
    },
  },
  {
    id: "scale-three-mib-many-images",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["<img"],
      removes: [".scale-manyimg-dead-0{"],
    },
    build: () => {
      const tags = repeat(60, (i) => `<img src="${pngDataUri(140, 88, 8600 + i, { noise: true })}" alt="thumb ${i}" width="140" height="88">`);
      return page(
        `<title>Many images</title><style>${unusedCss("scale-manyimg-dead", 22, 8009)}</style>`,
        `<main>${tags}</main>`,
      );
    },
  },
  {
    id: "scale-two-mib-long-article",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["article-long", "footnotes"],
      removes: [".scale-long-dead-0{"],
    },
    build: () =>
      page(
        `<title>Long article</title><style>.article-long{max-width:46em;margin:0 auto;line-height:1.65}\n${unusedCss("scale-long-dead", 150, 8010)}</style>`,
        `<main class="article-long"><h1>The long article</h1>${paragraphs(7000, 8011)}<div class="footnotes"><hr><ol><li id="fn1"><p>Note.</p></li></ol></div></main>`,
      ),
  },
  {
    id: "scale-three-mib-htmlwidget-json",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["application/json", "quantum-point-999"],
      removes: [".scale-json-dead-0{"],
    },
    build: () => {
      const rand = random(8101);
      const points = repeat(45000, (i) => `{"x":${(rand() * 100).toFixed(4)},"y":${(rand() * 100).toFixed(4)},"label":"quantum-point-${i}"}`);
      const payload = `{"x":{"data":[{"type":"scatter","mode":"markers","points":[${points}]}],"layout":{},"config":{}},"evals":[],"jsHooks":[]}`;
      return page(
        `<title>Widget</title><style>${unusedCss("scale-json-dead", 22, 8012)}</style>`,
        `<main><div id="widget_1" class="html-widget" style="width:100%;height:480px"></div><script type="application/json" data-for="widget_1">${payload}</script></main>`,
      );
    },
  },
  {
    id: "scale-hundred-thousand-classes",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".cls-1{", ".cls-19000{"],
      removes: [".cls-30000{", ".cls-39999{"],
    },
    build: () => {
      const rules = repeat(40000, (i) => `.cls-${i}{color:#1a2b3c;padding-top:${(i * 37) % 29}px}`);
      const items = repeat(33334, (i) => `<p class="cls-${i * 3 % 20000} cls-${(i * 7 + 1) % 20000} cls-${(i * 11 + 2) % 20000}">item ${i}</p>`);
      return page(
        `<title>Many classes</title><style>${rules}</style>`,
        `<main>${items}</main>`,
      );
    },
  },
  {
    id: "scale-five-mib-framework-and-scripts",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".mega2-0{"],
      removes: [".mega2-9000{"],
    },
    build: () => {
      const css = frameworkRules("mega2", 30000, 8511);
      const script = `<script>${repeat(19000, (i) => `var megaScriptKeep${i}=Math.sqrt(${i * 31 % 97})+${i % 13};`)}</script>`;
      return page(
        `<title>Framework and scripts</title><style>${css}</style>`,
        `<main><p class="mega2-0 mega2-3 mega2-7">Framework plus busy script.</p></main>${script}`,
      );
    },
  },
  {
    id: "scale-six-mib-many-images",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["<img"],
      removes: [".scale-six-dead-0{"],
    },
    build: () => {
      const tags = repeat(160, (i) => `<img src="${pngDataUri(120, 76, 8700 + i, { noise: true })}" alt="tile ${i}" width="120" height="76">`);
      return page(
        `<title>Tiles</title><style>${unusedCss("scale-six-dead", 20, 8013)}</style>`,
        `<main class="gallery">${tags}</main>`,
      );
    },
  },
  {
    id: "scale-seven-mib-long-article-too-big-for-browser",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["article-seven"],
      removes: [".scale-seven-dead-0{"],
    },
    build: () =>
      page(
        `<title>Seven MiB</title><style>.article-seven{max-width:46em;margin:0 auto;line-height:1.65}\n${unusedCss("scale-seven-dead", 120, 8014)}</style>`,
        `<main class="article-seven"><h1>Seven megabytes of prose</h1>${paragraphs(20000, 8015)}</main>`,
      ),
  },
  {
    id: "scale-too-big-for-browser-ten-mib-module",
    category: "scale",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["hugeModuleMarker"],
      removes: [".scale-ten-dead-5{"],
    },
    browser: false,
    build: () => {
      const body = `var hugeModuleMarker=1;${repeat(640000, (i) => `var m${i}=${i % 89}/${(i % 13) + 1};`)}`;
      return page(
        `<title>Module</title><style>${unusedCss("scale-ten-dead", 30, 8016)}</style>`,
        `<main><p class="scale-ten-dead-0">A module Octavo will not touch.</p></main><script type="module">${body}</script>`,
      );
    },
  },
  {
    id: "scale-too-big-for-browser-eleven-mib-stylesheet",
    category: "scale",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".colossal-keep-0{"],
      removes: [".colossal-dead-8000{"],
    },
    browser: false,
    build: () => {
      const rules = repeat(37000, (i) => `.colossal-dead-${i}{display:block;color:#1a2b3c;padding:${i % 97}px;margin:0 auto;background:#f8f9fa;border-radius:${i % 31}px;letter-spacing:0;font-weight:400;text-transform:none;outline:none;border-collapse:collapse;vertical-align:middle;white-space:normal;box-sizing:border-box;list-style:none;font-style:normal}`);
      const css = [".colossal-keep-0{color:red}", rules].join("\n");
      return page(
        `<title>Colossal sheet</title><style>${css}</style>`,
        '<main><p class="colossal-keep-0">One paragraph is all this page uses.</p></main>',
      );
    },
  },
  {
    id: "scale-too-big-for-browser-twelve-mib-images",
    category: "scale",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["<img"],
      removes: [".scale-twelve-dead-0{"],
    },
    browser: false,
    build: () => {
      const tags = repeat(12, (i) => `<img src="${pngDataUri(600, 400, 8800 + i, { noise: true })}" alt="noise ${i}" width="600" height="400">`);
      return page(
        `<title>Noise</title><style>${unusedCss("scale-twelve-dead", 22, 8017)}</style>`,
        `<main>${tags}</main>`,
      );
    },
  },
  {
    id: "scale-too-big-for-browser-thirteen-mib-paragraphs",
    category: "scale",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["article-thirteen"],
      removes: [".scale-thirteen-dead-0{"],
    },
    browser: false,
    build: () =>
      page(
        `<title>Thirteen MiB</title><style>.article-thirteen{max-width:46em;margin:0 auto;line-height:1.65}\n${unusedCss("scale-thirteen-dead", 90, 8018)}</style>`,
        `<main class="article-thirteen"><h1>Thirteen megabytes of prose</h1>${paragraphs(45000, 8019)}</main>`,
      ),
  },
  {
    id: "scale-too-big-for-browser-fifteen-mib-mixed",
    category: "scale",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["article-mixed", "mixedModuleMarker"],
      removes: [".scale-fifteen-dead-0{"],
    },
    browser: false,
    build: () => {
      const images = repeat(5, (i) => `<img src="${pngDataUri(700, 460, 8900 + i, { noise: true })}" alt="mixed ${i}" width="700" height="460">`);
      const body = `var mixedModuleMarker=1;${repeat(75000, (i) => `var mm${i}=${i % 71}+${i % 17};`)}`;
      return page(
        `<title>Mixed giant</title><style>.article-mixed{max-width:46em;margin:0 auto;line-height:1.65}\n${unusedCss("scale-fifteen-dead", 70, 8020)}</style>`,
        `<main class="article-mixed"><h1>Mixed giant</h1>${paragraphs(18000, 8021)}${images}</main><script type="module">${body}</script>`,
      );
    },
  },
  {
    id: "scale-too-big-for-browser-twentyseven-mib-giant-json",
    category: "scale",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["application/json", "giant-json-entry-4199"],
      removes: [".scale-json-giant-dead-5{"],
    },
    browser: false,
    build: () => {
      const entries = repeat(160000, (i) => `{"id":${i},"title":"giant-json-entry-${i}","body":"body text of the giant dataset row ${i} with the usual shared vocabulary about octavo, quarto and documents","href":"#entry-${i}"}`);
      return page(
        `<title>Giant JSON</title><style>${unusedCss("scale-json-giant-dead", 40, 8022)}</style>`,
        `<main><p class="scale-json-giant-dead-0">The index below is huge.</p></main><script type="application/json" id="giant-search-data">[${entries}]</script>`,
      );
    },
  },
  {
    id: "scale-four-mib-paragraphs-and-images",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["article-four", "<img"],
      removes: [".scale-four-dead-0{"],
    },
    build: () => {
      const images = repeat(45, (i) => `<img src="${pngDataUri(160, 110, 9000 + i, { noise: true })}" alt="figure ${i}" width="160" height="110">`);
      return page(
        `<title>Four MiB</title><style>.article-four{max-width:46em;margin:0 auto;line-height:1.65}\n${unusedCss("scale-four-dead", 60, 8023)}</style>`,
        `<main class="article-four"><h1>Text and figures</h1>${paragraphs(4200, 8024)}${images}</main>`,
      );
    },
  },
  {
    id: "scale-one-mib-base64-image-set",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["<img"],
      removes: [".scale-set-dead-0{"],
    },
    build: () => {
      const tags = repeat(14, (i) => `<img src="${pngDataUri(200, 120, 9100 + i, { noise: true })}" alt="small ${i}" width="200" height="120">`);
      return page(
        `<title>Set</title><style>${unusedCss("scale-set-dead", 24, 8025)}</style>`,
        `<main>${tags}</main>`,
      );
    },
  },
  {
    id: "scale-three-mib-mixed-widgets",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["plotly.js", "leaflet v1.9", "data-for=\"widget_a\""],
      removes: [".scale-widgets-dead-0{"],
    },
    build: () => {
      const htmlwidgets = `<script>${"/*! htmlwidgets v1.6.4 | htmlwidgets | MIT License */"}${repeat(5000, (i) => `var hw${i}=function(e){return e};`)}window.HTMLWidgets={widgets:[]};</script>`;
      const plotly = `<script>${"/*! plotly.js v2.32.0 | (c) Plotly, Inc. | MIT License */"}${repeat(16000, (i) => `var pl${i}={t:${i}};`)}window.Plotly={};</script>`;
      const leaflet = `<script>${"/*! leaflet v1.9.4 | (c) 2010-2024 Vladimir Agafonkin | BSD-2-Clause License */"}${repeat(14000, (i) => `var ll${i}={t:${i}};`)}window.L={};</script>`;
      const payloadA = `{"x":{"points":[${repeat(70000, (i) => `{"x":${i},"y":${i * 2 % 97}}`)}]},"evals":[],"jsHooks":[]}`;
      const payloadB = `{"x":{"points":[${repeat(900, (i) => `{"lat":${(i * 0.01).toFixed(3)},"lng":${(i * 0.013).toFixed(3)}}`)}]},"evals":[],"jsHooks":[]}`;
      return page(
        `<title>Widgets</title><style>${unusedCss("scale-widgets-dead", 22, 8026)}</style>`,
        `<main><div id="widget_a" class="html-widget" style="width:100%;height:320px"></div><script type="application/json" data-for="widget_a">${payloadA}</script><div id="widget_b" class="html-widget" style="width:100%;height:320px"></div><script type="application/json" data-for="widget_b">${payloadB}</script></main>${htmlwidgets}${plotly}${leaflet}`,
      );
    },
  },
  {
    id: "scale-two-mib-code-listings",
    category: "scale",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".tk-kw{", ".listing-block{"],
      removes: [".scale-code-dead-0{"],
    },
    build: () => {
      const highlight = [
        ".tk-kw{color:#005cc5;font-weight:700}",
        ".tk-str{color:#032f62}",
        ".tk-cmt{color:#6a737d;font-style:italic}",
        ".listing-block{background:#f6f8fa;padding:.75rem;border-radius:.5rem;overflow-x:auto}",
        unusedCss("scale-code-dead", 40, 8027),
      ].join("\n");
      const rand = random(8028);
      const listings = repeat(1100, () => {
        const lines = repeat(14, (k) => `<span class="tk-kw">def</span> <span class="tk-str">f${Math.floor(rand() * 100)}</span><span class="tk-cmt"> # step ${k}</span>`);
        return `<pre class="listing-block">${lines}</pre>`;
      });
      return page(
        `<title>Listings</title><style>${highlight}</style>`,
        `<main>${listings}</main>`,
      );
    },
  },
];
