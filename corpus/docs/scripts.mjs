import { page, random, repeat } from "../spec.mjs";

const slack = `<style>.shown { color : #036 ; }</style>`;
const markup = `<p class="shown">text</p>`;

const pageWith = (body, head = "") => page(`${slack}${head}`, body);
const scriptPage = (code, head = "") => pageWith(`${markup}\n<script>${code}</script>`, head);

export default [
  {
    id: "scripts-regex-literal-keeps-its-pattern",
    category: "javascript",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["/\\d{4}-\\d{2}-\\d{2}/"] },
    build: () =>
      scriptPage(`const stamp = /\\d{4}-\\d{2}-\\d{2}/;
const link = /<a href="\\/([^"]+)\\/?">/g;
document.body.dataset.stamp = stamp.test("2024-05-06") ? "scripts-regex-ok" : "scripts-regex-bad";`),
  },
  {
    id: "scripts-template-literal-with-a-closing-script-tag",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["<\\/script>"] },
    build: () =>
      scriptPage(`const markup = \`<p class="shown">a</p><\\/script>\`;
document.body.dataset.markup = markup;`),
  },
  {
    id: "scripts-automatic-semicolon-insertion",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["scripts-asi-guard"] },
    build: () =>
      scriptPage(`const marker = "scripts-asi-guard"
const values = [1, 2, 3]
values.forEach((value) => { document.body.dataset.marker = marker + value })`),
  },
  {
    id: "scripts-unicode-identifiers-and-strings",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["scripts-unicode-ok"] },
    build: () =>
      scriptPage(`const café = "scripts-unicode-ok"
const 日本語 = café
document.body.dataset.unicode = 日本語 + " ✓"`),
  },
  {
    id: "scripts-object-accessors-are-kept",
    category: "javascript",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["get value", "set value"] },
    build: () =>
      scriptPage(`const store = { _raw : 2, get value() { return this._raw }, set value(next) { this._raw = next * 3 } }
store.value = 5
document.body.dataset.value = store.value`),
  },
  {
    id: "scripts-class-private-fields",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["#count", "static make"] },
    build: () =>
      scriptPage(`class Counter { #count = 0 ; increment() { this.#count += 1 ; return this.#count } static make() { return new Counter() } }
document.body.dataset.count = Counter.make().increment()`),
  },
  {
    id: "scripts-async-function-and-await",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["async function", "await "] },
    build: () =>
      scriptPage(`async function load() { const value = await Promise.resolve(41) ; document.body.dataset.value = value + 1 }
load()`),
  },
  {
    id: "scripts-optional-chaining-and-nullish-coalescing",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["?.", "??"] },
    build: () =>
      scriptPage(`const node = document.body
const value = node.dataset.value?.trim() ?? "scripts-optional-fallback"
document.body.dataset.optional = value`),
  },
  {
    id: "scripts-use-strict-directive",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["\"use strict\""] },
    build: () =>
      scriptPage(`"use strict"
try { scriptsUndeclared = 1 ; document.body.dataset.strict = "loose" } catch (error) { document.body.dataset.strict = "strict" }`),
  },
  {
    id: "scripts-generator-function",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["function*"] },
    build: () =>
      scriptPage(`function* counter(limit) { for (let index = 0 ; index < limit ; index++) yield index }
document.body.dataset.generated = [...counter(3)].join("-")`),
  },
  {
    id: "scripts-destructuring-and-spread",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["..."] },
    build: () =>
      scriptPage(`const { first, ...rest } = { first : 1, second : 2 , third : 3 }
const merged = { ...rest, first : first + 1 }
document.body.dataset.spread = Object.keys(merged).length`),
  },
  {
    id: "scripts-labeled-statement",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["outer:", "scripts-label-ok"] },
    build: () =>
      scriptPage(`let result = "none"
outer: for (let index = 0 ; index < 3 ; index++) { if (index === 1) continue outer ; result = "scripts-label-ok" }
document.body.dataset.label = result`),
  },
  {
    id: "scripts-eval-built-code",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["eval("] },
    build: () =>
      scriptPage(`const value = eval("document.body.dataset.evaluated = 'scripts-eval-' + (2 + 3)")
document.body.dataset.evaluated = value`),
  },
  {
    id: "scripts-function-constructor",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["Function("] },
    build: () =>
      scriptPage(`const factory = new Function("return 'scripts-function-' + 7")
document.body.dataset.built = factory()`),
  },
  {
    id: "scripts-already-minified-script-is-left-alone",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["window.scriptsMinified=1"] },
    build: () =>
      scriptPage(`window.scriptsMinified=1;${"window.scriptsNoise=(window.scriptsNoise||0)+1;".repeat(120)}`),
  },
  {
    id: "scripts-unparseable-script-is-left-unchanged",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["function scriptsBroken( {"] },
    build: () => scriptPage(`function scriptsBroken( { return 1 ; }`),
  },
  {
    id: "scripts-large-script-is-minified",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["scripts-large-ok"] },
    build: () => {
      const next = random(20240117);
      const lines = [];
      for (let index = 0; index < 1500; index++) {
        const value = Math.floor(next() * 1000);
        lines.push(`const scriptsValue${index} = ${value} + ${index} ;`);
      }
      lines.push(`document.body.dataset.large = "scripts-large-ok" ;`);
      return scriptPage(lines.join("\n"));
    },
  },
  {
    id: "scripts-many-tiny-scripts",
    category: "javascript",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["window.scriptsTiny"] },
    build: () =>
      pageWith(
        repeat(60, (index) => `<script>window.scriptsTiny${index} = ${index} ;</script>`),
      ),
  },
  {
    id: "scripts-json-data-block-is-left-alone",
    category: "modules",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ['{"items":[1,2,3],"label":"scripts-json"}'] },
    build: () =>
      pageWith(
        `<script type="application/json" id="scripts-json">{"items":[1,2,3],"label":"scripts-json"}</script>`,
      ),
  },
  {
    id: "scripts-importmap-is-left-alone",
    category: "modules",
    tier: "full",
    expect: { outcome: "optimizes", retains: ['{"imports":{"lib":"./lib.js"}}'] },
    build: () =>
      pageWith(`<script type="importmap">{"imports":{"lib":"./lib.js"}}</script>`),
  },
  {
    id: "scripts-module-script-is-minified",
    category: "modules",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["export", "scripts-module"] },
    build: () =>
      pageWith(
        `<script type="module">const label = "scripts-module" ;
export function greet() { return label }
document.body.dataset.module = greet()</script>`,
      ),
  },
  {
    id: "scripts-module-with-top-level-await",
    category: "modules",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["await"] },
    build: () =>
      pageWith(
        `<script type="module">const value = await Promise.resolve("scripts-tla") ;
document.body.dataset.tla = value</script>`,
      ),
  },
  {
    id: "scripts-data-uri-module-is-inlined",
    category: "modules",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["type=\"module\""], removes: ["data:text/javascript"] },
    build: () =>
      pageWith(
        `<script type="module" src="data:text/javascript,window.scriptsDataModule=1"></script>`,
      ),
  },
  {
    id: "scripts-duplicate-data-uri-module-is-not-inlined",
    category: "modules",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:text/javascript"] },
    build: () =>
      pageWith(
        `<script type="module" src="data:text/javascript,window.scriptsTwice=1"></script>` +
          `<script type="module" src="data:text/javascript,window.scriptsTwice=1"></script>`,
      ),
  },
  {
    id: "scripts-inline-event-handler-is-kept",
    category: "script-tags",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["onclick=\"scriptsHandler(1)\""] },
    build: () => pageWith(`<button onclick="scriptsHandler(1)">press</button>`),
  },
  {
    id: "scripts-document-write-of-markup",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["document.write"] },
    build: () =>
      pageWith(
        `<p class="shown">before</p><script>document.write("<p class=\\"written\\">written</p>")</script>`,
      ),
  },
  {
    id: "scripts-reading-its-own-source",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["scripts-self-source"] },
    build: () =>
      scriptPage(`const source = document.currentScript.textContent
document.body.dataset.self = source.includes("scripts-self-source") ? "scripts-self-ok" : "scripts-self-bad"`),
  },
  {
    id: "scripts-reading-location-hash",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["location.hash"] },
    build: () =>
      scriptPage(`const hash = location.hash
document.body.dataset.hash = hash === "" ? "scripts-hash-empty" : hash`),
  },
  {
    id: "scripts-license-banner-is-kept",
    category: "script-tags",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["MIT License"], removes: ["// an ordinary comment"] },
    build: () =>
      scriptPage(`/*! Corpus Library 1.0 | MIT License */
const banner = "scripts-license-ok"
// an ordinary comment
document.body.dataset.license = banner`),
  },
  {
    id: "scripts-source-map-comment",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", removes: ["sourceMappingURL"] },
    build: () =>
      scriptPage(`const mapped = "scripts-sourcemap-ok"
document.body.dataset.mapped = mapped
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic291cmNlbWFwLmpzIiwic291cmNlc0NvbnRlbnQiOiJzeXN0ZW1zLmpzIn0=`),
  },
  {
    id: "scripts-quarto-runtime-stub-replaces-a-dead-library",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["window.ClipboardJS="], removes: ["clipboard.js v2.0.11"] },
    build: () =>
      pageWith(
        `<script>/*! clipboard.js v2.0.11 */${repeat(400, () => "var q = 1 ;")}</script>` +
          `<script id="quarto-html-after-body">window.addEventListener("x", () => { new window.ClipboardJS(".code-copy-button") })</script>`,
      ),
  },
  {
    id: "scripts-quarto-library-stays-when-the-markup-uses-it",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["clipboard.js v2.0.11"] },
    build: () =>
      pageWith(
        `<button class="code-copy-button">copy</button>` +
          `<script>/*! clipboard.js v2.0.11 */${repeat(400, () => "var q = 1 ;")}</script>`,
      ),
  },
  {
    id: "scripts-library-stays-when-another-script-mentions-it",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["clipboard.js v2.0.11"] },
    build: () =>
      pageWith(
        `<script>/*! clipboard.js v2.0.11 */${repeat(400, () => "var q = 1 ;")}</script>` +
          `<script>window.ClipboardJS = null</script>`,
      ),
  },
  {
    id: "scripts-order-dependence-between-scripts",
    category: "script-tags",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["scripts-order-ok"] },
    build: () =>
      pageWith(
        `<script>window.scriptsOrder = "scripts-order-ok"</script>` +
          `<script>window.scriptsOrder += "-second" ; document.body.dataset.order = window.scriptsOrder</script>`,
      ),
  },
  {
    id: "scripts-script-inside-an-inline-svg-is-left-alone",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["window.scriptsSvg = 1"] },
    build: () =>
      pageWith(
        `<svg viewBox="0 0 10 10"><script>window.scriptsSvg = 1</script><rect width="4" height="4"/></svg>`,
      ),
  },
  {
    id: "scripts-element-with-entities-in-attributes",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data-note=\"x &amp; y\""] },
    build: () =>
      pageWith(
        `<script data-note="x &amp; y">const noted = "scripts-entities-ok" ; document.body.dataset.noted = noted</script>`,
      ),
  },
  {
    id: "scripts-script-inside-noscript-is-left-alone",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["window.scriptsNoscript = 1"] },
    build: () =>
      pageWith(`<noscript><script>window.scriptsNoscript = 1</script></noscript>`),
  },
  {
    id: "scripts-defer-and-async-attributes-are-kept",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["defer", "async"] },
    build: () =>
      pageWith(
        `<script defer>window.scriptsDeferred = "scripts-defer-ok"</script>` +
          `<script async>window.scriptsAsync = "scripts-async-ok"</script>`,
      ),
  },
  {
    id: "scripts-script-type-that-is-not-javascript",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", retains: ['{"label":"scripts-template"}'] },
    build: () =>
      pageWith(`<script type="text/x-template">{"label":"scripts-template"}</script>`),
  },
  {
    id: "scripts-html-comment-inside-a-script",
    category: "script-tags",
    tier: "full",
    expect: { outcome: "optimizes", removes: ["legacy marker"] },
    build: () =>
      scriptPage(`const legacy = 1 ;
<!-- legacy marker
document.body.dataset.legacy = legacy`),
  },
];
