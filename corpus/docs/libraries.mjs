import { page, repeat, random } from "../spec.mjs";

const fakeLib = ({ banner, global, size, seed, api = "" }) => {
  const rand = random(seed);
  let out = banner;
  out += `(function(g){'use strict';function ${global}(){this._v='${seed}'};${api}`;
  let body = "";
  let i = 0;
  while (out.length + body.length < size) {
    const term = Math.floor(rand() * 89) + 5;
    body += `var s${i}=function(e){var t=${term};return e==null?t:e+t};${global}.s${i}=s${i};`;
    i += 1;
  }
  out += `${body}g.${global}=${global};})(this);`;
  return out;
};

const banner = (name, version, license, extra) =>
  `/*! ${name} v${version}${extra ? ` | ${extra}` : ""} | ${license} */`;

const FONT_DATA = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const fakeLibs = {
  jquery: {
    banner: banner("jQuery", "3.7.1", "MIT License <https://jquery.org/license>", "(c) OpenJS Foundation and other contributors"),
    global: "jQuery",
    size: 90000,
    seed: 7101,
  },
  lodash: {
    banner: banner("lodash", "4.17.21", "MIT License <https://lodash.com/license>", "(c) JS Foundation and other contributors"),
    global: "_",
    size: 75000,
    seed: 7102,
  },
  d3: {
    banner: banner("d3", "7.9.0", "MIT License <https://github.com/d3/d3/blob/main/LICENSE>", "(c) Mike Bostock"),
    global: "d3",
    size: 110000,
    seed: 7103,
    api: 'var axis="x axis",scale="y scale",tick="tick";',
  },
  three: {
    banner: "/*! three r160 | (c) 2010-2024 Three.js authors | MIT License <https://github.com/mrdoob/three.js/blob/master/LICENSE> */",
    global: "THREE",
    size: 130000,
    seed: 7104,
  },
  chartjs: {
    banner: banner("Chart.js", "4.4.3", "MIT License <https://www.chartjs.org/docs/latest/>", "(c) 2014-2024 Chart.js contributors"),
    global: "Chart",
    size: 70000,
    seed: 7105,
  },
  moment: {
    banner: banner("Moment.js", "2.30.1", "MIT License <https://github.com/moment/moment/blob/develop/LICENSE>", "(c) JS Foundation and other contributors"),
    global: "moment",
    size: 65000,
    seed: 7106,
  },
  luxon: {
    banner: banner("Luxon", "3.4.4", "MIT License <https://github.com/moment/luxon/blob/master/LICENSE>", "(c) JS Foundation and other contributors"),
    global: "luxon",
    size: 55000,
    seed: 7107,
  },
  underscore: {
    banner: banner("Underscore.js", "1.13.6", "MIT License <https://github.com/jashkenas/underscore/blob/master/LICENSE>", "(c) 2009-2024 Jeremy Ashkenas"),
    global: "_",
    size: 30000,
    seed: 7108,
  },
  handlebars: {
    banner: banner("Handlebars", "4.7.8", "MIT License <https://github.com/handlebars-lang/handlebars.js/blob/main/LICENSE>", "(c) 2011-2024 Yehuda Katz"),
    global: "Handlebars",
    size: 45000,
    seed: 7109,
  },
  vue: {
    banner: banner("Vue.js", "3.4.27", "MIT License <https://github.com/vuejs/core/blob/main/LICENSE>", "(c) 2014-2024 Evan You & Vue contributors"),
    global: "Vue",
    size: 105000,
    seed: 7110,
  },
  corejs: {
    banner: banner("core-js", "3.37.1", "MIT License <https://github.com/zloirock/core-js/tree/master/LICENSE>", "(c) 2014-2024 Denis Pushkarev"),
    global: "core",
    size: 60000,
    seed: 7111,
  },
  reveal: {
    banner: banner("Reveal.js", "4.6.1", "MIT License <https://github.com/hakimel/reveal.js/blob/master/LICENSE>", "(c) 2011-2024 Hakim El Hattab"),
    global: "Reveal",
    size: 110000,
    seed: 7112,
    api: 'var progress="progress",controls="controls",fragment="fragment",slides="slides";Reveal.initialize=function(){};',
  },
  revealNotes: {
    banner: banner("reveal.js notes plugin", "4.6.1", "MIT License"),
    global: "RevealNotes",
    size: 9000,
    seed: 7113,
  },
  prism: {
    banner: banner("Prism", "1.29.0", "MIT License <https://github.com/PrismJS/prism/blob/master/LICENSE>", "(c) 2012-2024 Lea Verou"),
    global: "Prism",
    size: 50000,
    seed: 7114,
  },
  datatables: {
    banner: banner("DataTables", "2.0.8", "MIT License <https://datatables.net/license>", "(c) 2008-2024 SpryMedia Ltd"),
    global: "DataTable",
    size: 85000,
    seed: 7115,
  },
  countdown: {
    banner: banner("jquery.countdown", "2.2.0", "MIT License <https://github.com/hilios/jQuery.countdown>", "(c) 2013-2024 Hilios"),
    global: "jQuery",
    size: 6000,
    seed: 7116,
  },
};

const libScript = (name) => `<script>${fakeLib(fakeLibs[name])}</script>`;

const unusedCss = (prefix, count, seed) => {
  const rand = random(seed);
  return repeat(count, (i) => {
    const shade = Math.floor(rand() * 0xffffff).toString(16).padStart(6, "0");
    return `.${prefix}-${i}{color:#${shade};margin-top:${i % 19}px;border-bottom:1px solid #fff}`;
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

export default [
  {
    id: "libs-jquery",
    category: "libraries",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: ["jQuery v3.7.1", ".jquery-keep{"],
      removes: [".jquery-dead-0{"],
    },
    build: () =>
      page(
        `<title>jQuery</title><style>.jquery-keep{color:#036}\n${unusedCss("jquery-dead", 30, 7201)}</style>`,
        `<main><p class="jquery-keep">A snippet of script drives this page.</p></main>${libScript("jquery")}`,
      ),
  },
  {
    id: "libs-lodash",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["lodash v4.17.21", ".lodash-keep{"],
      removes: [".lodash-dead-0{"],
    },
    build: () =>
      page(
        `<title>lodash</title><style>.lodash-keep{margin:0}\n${unusedCss("lodash-dead", 30, 7211)}</style>`,
        `<main><p class="lodash-keep">Utility belt.</p></main>${libScript("lodash")}`,
      ),
  },
  {
    id: "libs-d3-chart",
    category: "libraries",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: ["d3 v7.9.0", ".axis{", ".scale{"],
      removes: [".d3-dead-0{"],
    },
    build: () =>
      page(
        `<title>d3</title><style>.axis{stroke:#333}.scale{fill:#333}\n${unusedCss("d3-dead", 30, 7221)}</style>`,
        `<main><svg width="400" height="200" role="img"><g class="axis"></g><g class="scale"></g></svg></main>${libScript("d3")}`,
      ),
  },
  {
    id: "libs-three",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["three r160", "three-keep{"],
      removes: [".three-dead-0{"],
    },
    build: () =>
      page(
        `<title>three</title><style>.three-keep{display:block}\n${unusedCss("three-dead", 30, 7231)}</style>`,
        `<main><canvas class="three-keep" width="640" height="360"></canvas></main>${libScript("three")}`,
      ),
  },
  {
    id: "libs-chartjs",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Chart.js v4.4.3", "chartjs-keep{"],
      removes: [".chartjs-dead-0{"],
    },
    build: () =>
      page(
        `<title>Chart.js</title><style>.chartjs-keep{width:100%}\n${unusedCss("chartjs-dead", 30, 7241)}</style>`,
        `<main><canvas class="chartjs-keep" width="600" height="300" aria-label="Chart"></canvas></main>${libScript("chartjs")}`,
      ),
  },
  {
    id: "libs-moment",
    category: "libraries",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: ["Moment.js v2.30.1", ".moment-keep{"],
      removes: [".moment-dead-0{"],
    },
    build: () =>
      page(
        `<title>Moment</title><style>.moment-keep{font-variant-numeric:tabular-nums}\n${unusedCss("moment-dead", 30, 7251)}</style>`,
        `<main><p class="moment-keep">Friday, 27 March 2026</p></main>${libScript("moment")}`,
      ),
  },
  {
    id: "libs-luxon",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Luxon v3.4.4", ".luxon-keep{"],
      removes: [".luxon-dead-0{"],
    },
    build: () =>
      page(
        `<title>Luxon</title><style>.luxon-keep{font-family:monospace}\n${unusedCss("luxon-dead", 30, 7261)}</style>`,
        `<main><p class="luxon-keep">2026-03-27T08:00:00Z</p></main>${libScript("luxon")}`,
      ),
  },
  {
    id: "libs-underscore",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Underscore.js v1.13.6", ".underscore-keep{"],
      removes: [".underscore-dead-0{"],
    },
    build: () =>
      page(
        `<title>Underscore</title><style>.underscore-keep{color:#333}\n${unusedCss("underscore-dead", 30, 7271)}</style>`,
        `<main><p class="underscore-keep">_.map, _.filter, _.reduce.</p></main>${libScript("underscore")}`,
      ),
  },
  {
    id: "libs-handlebars",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Handlebars v4.7.8", ".handlebars-keep{"],
      removes: [".handlebars-dead-0{"],
    },
    build: () =>
      page(
        `<title>Handlebars</title><style>.handlebars-keep{background:#eee}\n${unusedCss("handlebars-dead", 30, 7281)}</style>`,
        `<main><div class="handlebars-keep">{{title}}</div></main>${libScript("handlebars")}`,
      ),
  },
  {
    id: "libs-vue",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Vue.js v3.4.27", ".vue-keep{"],
      removes: [".vue-dead-0{"],
    },
    build: () =>
      page(
        `<title>Vue</title><style>.vue-keep{color:#35495e}\n${unusedCss("vue-dead", 30, 7291)}</style>`,
        `<main><div class="vue-keep" id="app">Count: 0</div></main>${libScript("vue")}`,
      ),
  },
  {
    id: "libs-core-js-polyfill",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["core-js v3.37.1", ".corejs-keep{"],
      removes: [".corejs-dead-0{"],
    },
    build: () =>
      page(
        `<title>core-js</title><style>.corejs-keep{color:#333}\n${unusedCss("corejs-dead", 30, 7301)}</style>`,
        `<main><p class="corejs-keep">Polyfills first, then the app.</p></main>${libScript("corejs")}`,
      ),
  },
  {
    id: "libs-bootstrap-css-framework",
    category: "libraries",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Bootstrap v5.3.3", ".btn{", ".container{"],
      removes: [".bs-dead-0{"],
    },
    build: () => {
      const framework = [
        "/*! Bootstrap v5.3.3 (https://getbootstrap.com/) | Copyright 2011-2024 The Bootstrap Authors | Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE) */",
        ".container{width:100%;padding-right:.75rem;padding-left:.75rem;margin-right:auto;margin-left:auto}",
        ".row{display:flex;flex-wrap:wrap;margin-right:-.75rem;margin-left:-.75rem}",
        ".col{flex:1 0 0%;max-width:100%;padding-right:.75rem;padding-left:.75rem}",
        ".col-md-6{flex:0 0 auto;width:50%}",
        ".btn{display:inline-block;font-weight:400;text-align:center;vertical-align:middle;cursor:pointer;border:1px solid transparent;padding:.375rem .75rem;font-size:1rem;line-height:1.5;border-radius:.375rem}",
        ".btn-primary{color:#fff;background:#0d6efd;border-color:#0d6efd}",
        ".btn-outline-secondary{color:#6c757d;border-color:#6c757d}",
        ".alert{position:relative;padding:.75rem 1rem;margin-bottom:1rem;border:1px solid transparent;border-radius:.375rem}",
        ".alert-info{color:#055160;background:#cff4fc;border-color:#b6effb}",
        ".card{position:relative;display:flex;flex-direction:column;background:#fff;border:1px solid rgba(0,0,0,.125);border-radius:.375rem}",
        ".card-body{flex:1 1 auto;padding:1rem}",
        ".table{width:100%;margin-bottom:1rem;vertical-align:top;border-collapse:collapse}",
        ".table>tbody>tr>td{padding:.5rem;border-bottom:1px solid #dee2e6}",
        ".form-control{display:block;width:100%;padding:.375rem .75rem;border:1px solid #dee2e6;border-radius:.375rem}",
        ".nav{display:flex;flex-wrap:wrap;padding-left:0;margin-bottom:0;list-style:none}",
        frameworkRules("bs-dead", 650, 7311),
      ].join("\n");
      return page(
        `<title>Bootstrap</title><style>${framework}</style>`,
        '<main><div class="container"><div class="row"><div class="col-md-6"><button class="btn btn-primary">Save</button></div><div class="col-md-6"><div class="alert alert-info">Saved</div></div></div></div></main>',
      );
    },
  },
  {
    id: "libs-bootstrap-license-first",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Licensed under MIT", ".btn{"],
      removes: [".bslic-dead-0{"],
    },
    build: () =>
      page(
        `<title>Bootstrap license</title><style>/*! Bootstrap v5.3.3 | Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE) */\n.btn{display:inline-block;padding:.375rem .75rem;border-radius:.375rem}\n${unusedCss("bslic-dead", 25, 7321)}</style>`,
        '<main><button class="btn">OK</button></main>',
      ),
  },
  {
    id: "libs-tailwind-utilities",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".tw-m-3{", ".tw-pad-8{"],
      removes: [".tw-m-421{", ".tw-pad-913{"],
    },
    build: () => {
      const utilities = [
        repeat(600, (i) => `.tw-m-${i}{margin:${i}px}`),
        repeat(1000, (i) => `.tw-pad-${i}{padding:${i}px}`),
        repeat(400, (i) => `.tw-text-${i}{font-size:${10 + (i % 60)}px}`),
      ].join("\n");
      return page(
        `<title>Tailwind-like</title><style>${utilities}</style>`,
        '<main><p class="tw-m-3 tw-pad-8 tw-text-14">Utility classes keep things small.</p></main>',
      );
    },
  },
  {
    id: "libs-tailwind-media-queries-pruned",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".bp-base{"],
      removes: ["@media", ".bp-md-1{", ".bp-sm-1{"],
    },
    build: () =>
      page(
        `<title>Breakpoints</title><style>.bp-base{display:block}\n@media (min-width:768px){.bp-md-1{flex-direction:row}.bp-md-2{gap:1rem}}\n@media (max-width:480px){.bp-sm-1{padding:1rem}.bp-sm-2{margin:0}}</style>`,
        '<main><p class="bp-base">The breakpoints are unused, so the media blocks go.</p></main>',
      ),
  },
  {
    id: "libs-bulma-framework",
    category: "libraries",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: [".button{", ".column{"],
      removes: [".bulma-dead-0{"],
    },
    build: () => {
      const bulma = [
        ".button{display:inline-flex;align-items:center;justify-content:center;padding-left:.75em;padding-right:.75em;height:2.5em;border:none;border-radius:.375em;cursor:pointer}",
        ".is-primary{background:#00d1b2;color:#fff}",
        ".columns{display:flex;margin-left:-.75rem}",
        ".column{flex:1;padding:.75rem}",
        ".title{color:hsl(0,0%,21%);font-size:2rem;font-weight:600}",
        ".subtitle{color:hsl(0,0%,48%);font-size:1.25rem}",
        ".field{margin-bottom:1rem}",
        ".input{box-shadow:inset 0 .0625em .125em rgba(10,10,10,.05);max-width:100%;width:100%;padding-left:.625em;padding-right:.625em;height:2.5em}",
        frameworkRules("bulma-dead", 420, 7331),
      ].join("\n");
      return page(
        `<title>Bulma</title><style>${bulma}</style>`,
        '<main><div class="columns"><div class="column"><button class="button is-primary">Go</button></div></div></main>',
      );
    },
  },
  {
    id: "libs-bulma-helpers-used",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".is-flex{", ".has-text-weight-bold{"],
      removes: [".is-family-monospace{", ".is-italic{"],
    },
    build: () =>
      page(
        `<title>Helpers</title><style>.is-flex{display:flex}.has-text-weight-bold{font-weight:700}.is-family-monospace{font-family:monospace}.is-italic{font-style:italic}\n${unusedCss("helper-dead", 25, 7341)}</style>`,
        '<main><p class="is-flex has-text-weight-bold">Two helpers in use.</p></main>',
      ),
  },
  {
    id: "libs-framework-grid-retained",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".row{", ".col-md-6{"],
      removes: [".carousel{", ".toast{"],
    },
    build: () =>
      page(
        `<title>Grid</title><style>.row{display:flex;flex-wrap:wrap}.col-md-6{flex:0 0 auto;width:50%}.carousel{position:relative}.toast{position:fixed}\n${unusedCss("grid-dead", 25, 7351)}</style>`,
        '<main><div class="row"><div class="col-md-6">Left</div><div class="col-md-6">Right</div></div></main>',
      ),
  },
  {
    id: "libs-big-framework-5000-rules",
    category: "libraries",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: [".fw-0{", ".fw-19{"],
      removes: [".fw-4999{", ".fw-3211{"],
    },
    build: () => {
      const css = frameworkRules("fw", 5000, 7361);
      const used = repeat(20, (i) => `<span class="fw-${i}">cell ${i}</span>`);
      return page(
        `<title>Big framework</title><style>${css}</style>`,
        `<main><div class="grid">${used}</div></main>`,
      );
    },
  },
  {
    id: "libs-css-custom-properties-framework",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["--fw-primary:#0d6efd", "--fw-radius:6px", ".fw-btn{"],
      removes: ["--fw-orphan"],
    },
    build: () =>
      page(
        `<title>Variables</title><style>:root{--fw-primary:#0d6efd;--fw-radius:6px;--fw-orphan:#123123}\n.fw-btn{border-radius:var(--fw-radius);color:var(--fw-primary);padding:4px}\n${unusedCss("var-dead", 20, 7371)}</style>`,
        '<main><button class="fw-btn">Themed</button></main>',
      ),
  },
  {
    id: "libs-modal-component-used",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".modal{", ".modal-dialog{", ".modal-body{"],
      removes: [".carousel{", ".toast{", ".accordion{"],
    },
    build: () =>
      page(
        `<title>Modal</title><style>.modal{position:fixed;top:0;left:0;z-index:1055;width:100%;height:100%;overflow:hidden}\n.modal-dialog{position:relative;width:auto;margin:.5rem}\n.modal-body{position:relative;flex:1 1 auto;padding:1rem}\n.carousel{position:relative;overflow:hidden}\n.toast{position:fixed;z-index:1090}\n.accordion{display:block}\n${unusedCss("modal-dead", 25, 7381)}</style>`,
        '<main><div class="modal" id="m"><div class="modal-dialog"><div class="modal-body">Body</div></div></div></main>',
      ),
  },
  {
    id: "libs-svg-sprite-icons",
    category: "libraries",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["<symbol", "ic-sprite"],
      removes: [".sprite-dead-0{"],
    },
    build: () => {
      const symbols = repeat(24, (i) => `<symbol id="ic-sprite-${i}" viewBox="0 0 16 16"><path d="M${i} 2 L${i + 8} 9 2 ${i + 4}"/></symbol>`);
      const sprite = `<svg style="display:none" aria-hidden="true">${symbols}</svg>`;
      return page(
        `<title>Sprite</title><style>.ic-sprite{width:1em;height:1em;fill:currentColor}\n.sprite-dead-0{color:#123456}\n${unusedCss("sprite-dead", 20, 7391)}</style>`,
        `<main>${sprite}<p>Icons come from the sprite: <svg class="ic-sprite"><use href="#ic-sprite-3"/></svg> <svg class="ic-sprite"><use href="#ic-sprite-7"/></svg></p></main>`,
      );
    },
  },
  {
    id: "libs-big-icon-set-3000-classes",
    category: "libraries",
    tier: "full",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["@font-face", ".ic-g-1{"],
      removes: [".ic-g-2999{", ".ic-g-1002{"],
    },
    build: () => {
      const iconCss = [
        "/*! Gilding icons v2.4.1 | (c) 2018-2024 Gilding project | MIT License */",
        `@font-face{font-family:Gilding;src:url(data:font/woff2;base64,${FONT_DATA}) format('woff2');font-weight:400;font-style:normal}`,
        repeat(3000, (i) => `.ic-g-${i}{font-family:Gilding;padding:${i % 9}px}`),
      ].join("\n");
      const used = repeat(5, (i) => `<span class="ic-g-${i}"></span>`);
      return page(
        `<title>3000 icons</title><style>${iconCss}</style>`,
        `<main>${used}</main>`,
      );
    },
  },
  {
    id: "libs-icon-font-used-via-classes",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["@font-face", "Iconic", ".iconic-home{"],
      removes: [".iconic-dead-0{"],
    },
    build: () =>
      page(
        `<title>Iconic</title><style>/*! Iconic (MIT) */\n@font-face{font-family:Iconic;src:url(data:font/woff2;base64,${FONT_DATA}) format('woff2')}\n.iconic{font-family:Iconic;font-style:normal}\n.iconic-home{content:"\\e001"}\n.iconic-search{content:"\\e002"}\n.iconic-cog{content:"\\e003"}\n${unusedCss("iconic-dead", 20, 7411)}</style>`,
        '<main><span class="iconic iconic-home"></span><span class="iconic iconic-search"></span></main>',
      ),
  },
  {
    id: "libs-icon-font-unused-dropped",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".keep-iconic{"],
      removes: ["@font-face", ".iconic-unused-0{"],
    },
    build: () =>
      page(
        `<title>Iconic unused</title><style>@font-face{font-family:Iconic;src:url(data:font/woff2;base64,${FONT_DATA}) format('woff2')}\n.iconic-unused-0{color:#123456}\n.iconic-unused-1{content:"\\e010"}\n.keep-iconic{color:#036}</style>`,
        '<main><p class="keep-iconic">No icons in use anywhere on this page.</p></main>',
      ),
  },
  {
    id: "libs-icon-font-pseudo-before",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Pictonic", ".pi:before{"],
      removes: [".pictonic-dead-0{"],
    },
    build: () =>
      page(
        `<title>Pictonic</title><style>@font-face{font-family:Pictonic;src:url(data:font/woff2;base64,${FONT_DATA}) format('woff2')}\n.pi:before{content:"\\e100";font-family:Pictonic}\n${unusedCss("pictonic-dead", 20, 7421)}</style>`,
        '<main><span class="pi" aria-hidden="true"></span></main>',
      ),
  },
  {
    id: "libs-icon-font-class-from-script",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["font-family:Iconic", "ic-trash"],
      removes: [".script-dead-0{"],
    },
    build: () =>
      page(
        `<title>Generated icons</title><style>.ic-home{font-family:Iconic}.ic-search{font-family:Iconic}.ic-cog{font-family:Iconic}.ic-trash{font-family:Iconic}\n${unusedCss("script-dead", 20, 7431)}</style>`,
        '<main><p>Icons are created at runtime.</p></main><script>["home","search","cog"].forEach(function(n){var i=document.createElement("i");i.className="ic-"+n;document.body.appendChild(i)});</script>',
      ),
  },
  {
    id: "libs-revealjs-deck-like",
    category: "libraries",
    tier: "smoke",
    browser: false,
    expect: {
      outcome: "optimizes",
      retains: ["Reveal.js v4.6.1", ".fragment{", ".reveal{"],
      removes: [".reveal-dead-0{"],
    },
    build: () => {
      const revealCss = [
        ".reveal{overflow:auto;position:relative;width:100%;height:100vh}",
        ".reveal .slides{position:relative;text-align:center}",
        ".reveal .slides section{padding:1em;display:block}",
        ".reveal .progress{position:absolute;bottom:0;left:0;height:.2em;background:#000;width:0}",
        ".reveal .controls{display:grid;gap:.5rem}",
        ".reveal h1{font-size:2.5em}",
        ".reveal h2{font-size:1.75em}",
        ".reveal ul{display:block}",
        ".fragment{opacity:0;visibility:hidden}",
        ".fragment.visible{opacity:1;visibility:visible}",
        frameworkRules("reveal-dead", 350, 7441),
      ].join("\n");
      const deck = `<div class="reveal"><div class="slides"><section><h2>Title</h2></section><section><h2>Steps</h2><ul><li class="fragment">One</li><li class="fragment">Two</li></ul></section></div></div>`;
      return page(
        `<title>Deck</title><style>${revealCss}</style>`,
        `${deck}${libScript("reveal")}<script>window.Reveal.initialize({hash:true});</script>`,
      );
    },
  },
  {
    id: "libs-revealjs-notes-plugin",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Reveal.js v4.6.1", "reveal.js notes plugin v4.6.1"],
      removes: [".deck-dead-0{"],
    },
    build: () =>
      page(
        `<title>Deck notes</title><style>${unusedCss("deck-dead", 30, 7451)}</style>`,
        `<div class="reveal"><div class="slides"><section><h2>Slide</h2></section></div></div>${libScript("reveal")}${libScript("revealNotes")}<script>window.Reveal.initialize({hash:true,plugins:[]});</script>`,
      ),
  },
  {
    id: "libs-prism-highlight",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Prism v1.29.0", ".token.keyword{", ".token.string{"],
      removes: [".token.boolean{", ".token.entity{"],
    },
    build: () =>
      page(
        `<title>Prism</title><style>.token.keyword{color:#07a}.token.string{color:#690}.token.comment{color:#999}.token.boolean{color:#905}.token.entity{color:#905}\n${unusedCss("prism-dead", 20, 7461)}</style>`,
        `<main><pre><code class="language-python"><span class="token keyword">def</span> <span class="token function">f</span>():\n    <span class="token string">"return"</span></code></pre></main>${libScript("prism")}`,
      ),
  },
  {
    id: "libs-datatables-with-jquery",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["DataTables v2.0.8", "jQuery v3.7.1", ".dataTable{"],
      removes: [".dt-dead-0{"],
    },
    build: () =>
      page(
        `<title>DataTables</title><style>.dataTable{width:100%;border-collapse:collapse}.dataTable th{text-align:left;border-bottom:2px solid #e0e0e0}\n${unusedCss("dt-dead", 25, 7471)}</style>`,
        `<main><table class="dataTable display"><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Widgets</td><td>4</td></tr></tbody></table></main>${libScript("jquery")}${libScript("datatables")}`,
      ),
  },
  {
    id: "libs-jquery-plugin-countdown",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["jQuery v3.7.1", "jquery.countdown v2.2.0"],
      removes: [".countdown-dead-0{"],
    },
    build: () =>
      page(
        `<title>Countdown</title><style>.countdown-keep{font-variant-numeric:tabular-nums}\n${unusedCss("countdown-dead", 25, 7481)}</style>`,
        `<main><p class="countdown-keep">Launch in 300 days.</p></main>${libScript("jquery")}${libScript("countdown")}`,
      ),
  },
  {
    id: "libs-license-banners-all-kept",
    category: "libraries",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: [
        "jQuery v3.7.1",
        "lodash v4.17.21",
        "Bootstrap v5.3.3",
        "Chart.js v4.4.3",
        "three r160",
      ],
      removes: [".banners-dead-0{"],
    },
    build: () =>
      page(
        `<title>Licenses</title><style>/*! Bootstrap v5.3.3 (https://getbootstrap.com/) | Copyright 2011-2024 The Bootstrap Authors | Licensed under MIT (https://github.com/twbs/bootstrap/blob/main/LICENSE) */\n.banners-keep{display:block}\n${unusedCss("banners-dead", 25, 7491)}</style>`,
        `<main><p class="banners-keep">Five notices, all preserved.</p></main>${libScript("jquery")}${libScript("lodash")}${libScript("chartjs")}${libScript("three")}`,
      ),
  },
  {
    id: "libs-d3-and-three-together",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["d3 v7.9.0", "three r160"],
      removes: [".combo-dead-0{"],
    },
    build: () =>
      page(
        `<title>d3 and three</title><style>${unusedCss("combo-dead", 30, 7501)}</style>`,
        `<main><canvas id="scene" width="400" height="300"></canvas><svg id="overlay" width="400" height="300"></svg></main>${libScript("d3")}${libScript("three")}`,
      ),
  },
  {
    id: "libs-nonminified-legal-comment-kept",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["MIT License", "WidgetToolkit"],
      removes: [".legal-dead-5{"],
    },
    build: () =>
      page(
        `<title>Legal</title><style>${unusedCss("legal-dead", 25, 7511)}</style><script>/*! WidgetToolkit v1.2.3 | MIT License <https://example.com/toolkit/license> */\n(function (global) {\n  var VERSION = '1.2.3';\n  function noop() { return null; }\n  global.WidgetToolkit = { version: VERSION, noop: noop };\n})(window);</script>`,
        '<main><p class="legal-dead-0">Written by hand, kept readable.</p></main>',
      ),
  },
  {
    id: "libs-scripts-only-accepted",
    category: "libraries",
    tier: "full",
    expect: { outcome: "accepts" },
    build: () =>
      page(
        "<title>Scripts only</title>",
        `<main><p>No stylesheets here; Octavo leaves the scripts, then packs what it can.</p></main>${libScript("jquery")}${libScript("lodash")}`,
      ),
  },
  {
    id: "libs-webfont-awesome-layout",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["FontAwesome", "@font-face", "fa-check", "fa-times"],
      removes: [".fa-bell{", ".fa-trash{"],
    },
    build: () =>
      page(
        `<title>Awesome</title><style>/*! Font Awesome Free 6.5.2 | (Icons - CC BY 4.0, Fonts - SIL OFL 1.1) */\n@font-face{font-family:FontAwesome;src:url(data:font/woff2;base64,${FONT_DATA}) format('woff2')}\n.fa{font-family:FontAwesome;font-style:normal}\n.fa-check:before{content:"\\e005"}\n.fa-times:before{content:"\\e006"}\n.fa-bell:before{content:"\\e101"}\n.fa-trash:before{content:"\\e102"}\n${unusedCss("fa-dead", 16, 7521)}</style>`,
        '<main><i class="fa fa-check"></i><i class="fa fa-times"></i></main>',
      ),
  },
  {
    id: "libs-webfont-octicons",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["Octicons v8.5.0", "@font-face"],
      removes: [".octicon-dead-0{"],
    },
    build: () =>
      page(
        `<title>Octicons</title><style>/*! Octicons v8.5.0 | (c) GitHub, Inc. | MIT License */\n@font-face{font-family:Octicons;src:url(data:font/woff2;base64,${FONT_DATA}) format('woff2')}\n.octicon{font-family:Octicons;font-style:normal}\n.octicon-flame:before{content:"\\e201"}\n${unusedCss("octicon-dead", 16, 7531)}</style>`,
        '<main><span class="octicon octicon-flame"></span></main>',
      ),
  },
  {
    id: "libs-text-webfont-layout",
    category: "libraries",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["SourceSans", "@font-face", ".text-font-keep{"],
      removes: [".text-font-dead-0{"],
    },
    build: () =>
      page(
        `<title>Source Sans</title><style>@font-face{font-family:SourceSans;src:url(data:font/woff2;base64,${FONT_DATA}) format('woff2');font-weight:400}\nbody{font-family:SourceSans,system-ui,sans-serif}\n.text-font-keep{color:#222}\n${unusedCss("text-font-dead", 16, 7541)}</style>`,
        '<main><p class="text-font-keep">Text set in Source Sans.</p></main>',
      ),
  },
  {
    id: "libs-xml-document-rejected",
    category: "libraries",
    tier: "full",
    expect: { outcome: "rejects", error: "not-html" },
    build: () =>
      '<?xml version="1.0" encoding="UTF-8"?><catalog><book id="1"><title>XML catalog</title></book></catalog>',
  },
];
