import { page, random, repeat } from "../spec.mjs";

const witness = "<style>.witness{margin-left:1px}</style>";

const generated = (count, seed) => {
  const next = random(seed);
  return repeat(count, (index) => `.gen-${index}{margin-left:${Math.floor(next() * 100)}px}`);
};

export default [
  {
    id: "css-class-reachable-only-from-markup",
    category: "css",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: [".from-markup{margin-left:1px}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>.from-markup{margin-left:1px}.nowhere{margin-left:2px}</style>`,
        '<p class="from-markup">x</p>',
      ),
  },
  {
    id: "css-class-added-by-classlist-add",
    category: "css",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: [".added-at-runtime{margin-left:1px}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>.added-at-runtime{margin-left:1px}.nowhere{margin-left:2px}</style>`,
        "<p>x</p><script>document.body.classList.add('added-at-runtime')</script>",
      ),
  },
  {
    id: "css-class-built-by-concatenation",
    category: "css",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: [".col-md-6{margin-left:1px}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>.col-md-6{margin-left:1px}.nowhere{margin-left:2px}</style>`,
        "<p>x</p><script>document.body.className = 'col-' + 'md-6'</script>",
      ),
  },
  {
    id: "css-rule-with-an-attribute-selector-is-kept",
    category: "css",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: ["[data-marker]{margin-left:1px}"],
      removes: [".witness{"],
    },
    build: () => page(`<style>[data-marker]{margin-left:1px}</style>${witness}`, "<p>x</p>"),
  },
  {
    id: "css-media-block-survives-when-a-rule-survives",
    category: "css",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: ["@media screen{.live{margin-left:1px}}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>@media screen{.live{margin-left:1px}.nowhere{margin-left:2px}}</style>`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-empty-media-block-disappears",
    category: "css",
    tier: "smoke",
    expect: { outcome: "optimizes", removes: ["@media print", ".nowhere{"] },
    build: () => page("<style>@media print{.nowhere{margin-left:2px}}</style>", "<p>x</p>"),
  },
  {
    id: "css-custom-property-used-only-by-a-script-survives",
    category: "css",
    tier: "smoke",
    expect: {
      outcome: "optimizes",
      retains: ["--read-at-runtime:2"],
      removes: [".witness{"],
    },
    build: () =>
      page(
        `<style>:root{--read-at-runtime:2}</style>${witness}`,
        "<p>x</p><script>getComputedStyle(document.body).getPropertyValue('--read-at-runtime')</script>",
      ),
  },
  {
    id: "css-invalid-stylesheet-is-left-untouched",
    category: "css",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["@@@ {{{ not css"], removes: [".witness{"] },
    build: () => page("<style>@@@ {{{ not css</style>" + witness, "<p>x</p>"),
  },
  {
    id: "css-class-set-with-set-attribute",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".set-by-attribute{margin-left:1px}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>.set-by-attribute{margin-left:1px}.nowhere{margin-left:2px}</style>`,
        "<p>x</p><script>document.body.setAttribute('class', 'set-by-attribute')</script>",
      ),
  },
  {
    id: "css-class-named-by-a-dataset-value",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".dataset-state{margin-left:1px}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>.dataset-state{margin-left:1px}.nowhere{margin-left:2px}</style>`,
        "<p>x</p><script>document.body.dataset.state = 'dataset-state'</script>",
      ),
  },
  {
    id: "css-class-built-in-a-template-literal",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".row-7{margin-left:1px}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>.row-7{margin-left:1px}.nowhere{margin-left:2px}</style>`,
        "<p>x</p><script>document.body.className = `row-${7}`</script>",
      ),
  },
  {
    id: "css-rule-with-a-has-selector-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".live:has(.cell){margin-left:1px}"],
      removes: [".witness{"],
    },
    build: () =>
      page(
        `<style>.live:has(.cell){margin-left:1px}</style>${witness}`,
        '<p class="live"><i class="cell">x</i></p>',
      ),
  },
  {
    id: "css-rule-with-an-is-selector-keeps-a-reachable-branch",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [":is(.live,.never){margin-left:1px}"],
      removes: [".witness{"],
    },
    build: () =>
      page(`<style>:is(.live,.never){margin-left:1px}</style>${witness}`, '<p class="live">x</p>'),
  },
  {
    id: "css-rule-with-a-where-selector-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [":where(.live,.never){margin-left:1px}"],
      removes: [".witness{"],
    },
    build: () =>
      page(`<style>:where(.live,.never){margin-left:1px}</style>${witness}`, '<p class="live">x</p>'),
  },
  {
    id: "css-rule-with-a-not-selector-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [":not(.never){margin-left:1px}"],
      removes: [".witness{"],
    },
    build: () => page(`<style>:not(.never){margin-left:1px}</style>${witness}`, "<p>x</p>"),
  },
  {
    id: "css-supports-block-survives",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["@supports (display:grid){.live{margin-left:1px}}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>@supports (display:grid){.live{margin-left:1px}.nowhere{margin-left:2px}}</style>`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-empty-supports-block-disappears",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", removes: ["@supports", ".nowhere{"] },
    build: () =>
      page("<style>@supports (display:grid){.nowhere{margin-left:2px}}</style>", "<p>x</p>"),
  },
  {
    id: "css-container-query-block-survives",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["@container (width>=400px){.live{margin-left:1px}}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>@container (min-width:400px){.live{margin-left:1px}.nowhere{margin-left:2px}}</style>`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-empty-container-block-disappears",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", removes: ["@container", ".nowhere{"] },
    build: () =>
      page("<style>@container (min-width:400px){.nowhere{margin-left:2px}}</style>", "<p>x</p>"),
  },
  {
    id: "css-layer-order-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["@layer base{.live{margin-left:1px}}", "@layer theme{}"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>@layer base{.live{margin-left:1px}}@layer theme{.nowhere{margin-left:2px}}</style>`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-property-rule-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["@property --brand{"],
      removes: [".witness{"],
    },
    build: () =>
      page(
        `<style>@property --brand{syntax:"<color>";inherits:false;initial-value:#ff0000}</style>${witness}`,
        "<p>x</p>",
      ),
  },
  {
    id: "css-font-face-for-an-unused-family-is-dropped",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".live{margin-left:1px}"],
      removes: ["@font-face"],
    },
    build: () =>
      page(
        `<style>@font-face{font-family:Ghost;src:url(data:font/ttf;base64,AAAA)}.live{margin-left:1px}</style>`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-font-face-used-by-a-rule-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["@font-face{font-family:Kept", ".live{font-family:Kept}"],
      removes: [".witness{"],
    },
    build: () =>
      page(
        `<style>@font-face{font-family:Kept;src:url(data:font/ttf;base64,AAAA)}.live{font-family:Kept}</style>${witness}`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-keyframes-are-kept",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["@keyframes spin{"], removes: [".witness{"] },
    build: () =>
      page(
        `<style>@keyframes spin{from{opacity:0}to{opacity:1}}</style>${witness}`,
        "<p>x</p>",
      ),
  },
  {
    id: "css-import-of-a-data-url-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["@import", "data:text/css,"],
      removes: [".witness{"],
    },
    build: () =>
      page(
        `<style>@import url("data:text/css,.imported%7Bmargin-left%3A1px%7D");</style>${witness}`,
        '<p class="imported">x</p>',
      ),
  },
  {
    id: "css-nested-rules-are-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".live{margin-left:1px;& .cell{margin-left:2px}}"],
      removes: [".witness{"],
    },
    build: () =>
      page(
        `<style>.live{margin-left:1px;& .cell{margin-left:2px}}</style>${witness}`,
        '<p class="live"><i class="cell">x</i></p>',
      ),
  },
  {
    id: "css-custom-property-used-only-by-another-property-survives",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["--base:3", "--alias:var(--base)"],
      removes: [".witness{"],
    },
    build: () =>
      page(
        `<style>:root{--base:3;--alias:var(--base)}.live{color:var(--alias)}</style>${witness}`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-unused-custom-property-is-removed",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".live{margin-left:1px}"],
      removes: ["--never-used"],
    },
    build: () =>
      page(`<style>:root{--never-used:2}.live{margin-left:1px}</style>${witness}`, '<p class="live">x</p>'),
  },
  {
    id: "css-important-declaration-survives",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".live{margin-left:1px!important}"],
      removes: [".witness{"],
    },
    build: () =>
      page(`<style>.live{margin-left:1px !important}</style>${witness}`, '<p class="live">x</p>'),
  },
  {
    id: "css-important-custom-property-keeps-its-priority",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["--x:red!important"], removes: [".witness{"] },
    build: () =>
      page(
        `<style>.live{--x:red !important;--x:blue;color:var(--x)}</style>${witness}`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-duplicate-rule-is-merged",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".live{margin-left:9px}"],
      removes: [".live{margin-left:1px}"],
    },
    build: () =>
      page(
        `<style>.live{margin-left:1px}.live{margin-left:9px}</style>${witness}`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-legal-comment-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["/*! keep this notice */", ".live{margin-left:1px}"],
      removes: [".witness{"],
    },
    build: () =>
      page(`<style>/*! keep this notice */.live{margin-left:1px}</style>${witness}`, '<p class="live">x</p>'),
  },
  {
    id: "css-plain-comment-is-removed",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".live{margin-left:1px}"],
      removes: ["/* drop this note */", ".witness{"],
    },
    build: () =>
      page(`<style>/* drop this note */.live{margin-left:1px}</style>${witness}`, '<p class="live">x</p>'),
  },
  {
    id: "css-print-only-rule-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["@media print{.live{margin-left:1px}}"],
      removes: [".witness{"],
    },
    build: () => page(`<style>@media print{.live{margin-left:1px}}</style>${witness}`, '<p class="live">x</p>'),
  },
  {
    id: "css-huge-generated-stylesheet-is-pruned",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".kept-0{margin-left:1px}"],
      removes: [".gen-0{", ".gen-3999{"],
    },
    build: () =>
      page(
        `<style>.kept-0{margin-left:1px}${generated(4000, 20240607)}</style>${witness}`,
        '<p class="kept-0">x</p>',
      ),
  },
  {
    id: "css-unicode-escape-in-a-class-name-is-kept",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", retains: [".abc{margin-left:1px}"], removes: [".witness{"] },
    build: () => page(`<style>.a\\62 c{margin-left:1px}</style>${witness}`, '<p class="abc">x</p>'),
  },
  {
    id: "css-escaped-class-nothing-uses-is-removed",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", removes: [".x\\79 z", ".witness{"] },
    build: () => page(`<style>.x\\79 z{margin-left:1px}</style>${witness}`, "<p>x</p>"),
  },
  {
    id: "css-id-reachable-only-from-a-script-is-kept",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["#runtime-id{margin-left:1px}"], removes: [".witness{"] },
    build: () =>
      page(
        `<style>#runtime-id{margin-left:1px}</style>${witness}`,
        "<p>x</p><script>document.getElementById('runtime-id')</script>",
      ),
  },
  {
    id: "css-id-nothing-mentions-is-removed",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", removes: ["#never-mentioned", ".witness{"] },
    build: () => page(`<style>#never-mentioned{margin-left:1px}</style>${witness}`, "<p>x</p>"),
  },
  {
    id: "css-tag-selector-for-a-tag-in-the-markup-is-kept",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["aside{margin-left:1px}"], removes: [".witness{"] },
    build: () => page(`<style>aside{margin-left:1px}</style>${witness}`, "<aside>x</aside>"),
  },
  {
    id: "css-tag-selector-for-an-absent-tag-is-removed",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", removes: ["marquee{", ".witness{"] },
    build: () => page(`<style>marquee{margin-left:1px}</style>${witness}`, "<p>x</p>"),
  },
  {
    id: "css-rule-inside-an-inline-svg-is-not-pruned",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", retains: [".svg-only{fill:red}"], removes: [".witness{"] },
    build: () =>
      page(witness, `<svg><style>.svg-only{fill:red}</style><text>x</text></svg>`),
  },
  {
    id: "css-shadowed-rule-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["#live{margin-left:1px}", ".live{margin-left:9px}"],
      removes: [".witness{"],
    },
    build: () =>
      page(
        `<style>#live{margin-left:1px}.live{margin-left:9px}</style>${witness}`,
        '<p id="live" class="live">x</p>',
      ),
  },
  {
    id: "css-selector-list-keeps-only-reachable-members",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: [".live{margin-left:1px}"],
      removes: [".never{"],
    },
    build: () => page(`<style>.live,.never{margin-left:1px}</style>${witness}`, '<p class="live">x</p>'),
  },
  {
    id: "css-empty-rule-is-removed",
    category: "css",
    tier: "full",
    expect: { outcome: "optimizes", removes: [".live{}", ".witness{"] },
    build: () => page(`<style>.live{}</style>${witness}`, '<p class="live">x</p>'),
  },
  {
    id: "css-vendor-prefixed-property-is-kept",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["-webkit-transform:rotate(3deg)"],
      removes: [".nowhere{"],
    },
    build: () =>
      page(
        `<style>.live{-webkit-transform:rotate(3deg)}.nowhere{margin-left:2px}</style>`,
        '<p class="live">x</p>',
      ),
  },
  {
    id: "css-lone-webkit-backdrop-filter-stops-the-stylesheet",
    category: "css",
    tier: "full",
    expect: {
      outcome: "optimizes",
      retains: ["-webkit-backdrop-filter:blur(5px)", ".nowhere{margin-left:2px}"],
      removes: [".witness{"],
    },
    build: () =>
      page(
        `<style>.live{-webkit-backdrop-filter:blur(5px)}.nowhere{margin-left:2px}</style>${witness}`,
        '<p class="live">x</p>',
      ),
  },
];
