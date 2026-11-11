import { page, repeat } from "../spec.mjs";

const used = ".shown{color:#036}";
const unused = repeat(40, (i) => `.gone${i}{margin-left:${i}px}`);

export default [
  {
    id: "unused-rules-are-pruned",
    category: "css",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: [".shown{"], removes: [".gone0{", ".gone39{"] },
    build: () => page(`<style>${used}${unused}</style>`, '<p class="shown">kept</p>'),
  },
  {
    id: "runtime-built-class-names-survive",
    category: "css",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: [".built-3{"], removes: [".gone0{"] },
    build: () =>
      page(
        `<style>.built-3{color:red}${unused}</style><script>document.body.className="built-"+(1+2);</script>`,
        "<p>x</p>",
      ),
  },
  {
    id: "script-text-inside-a-comment-is-left-alone",
    category: "parsing",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["<!-- <script>not code</script> -->"] },
    build: () =>
      page(`<style>${unused}</style>`, "<!-- <script>not code</script> -->\n<p>text</p>"),
  },
  {
    id: "textarea-content-is-not-markup",
    category: "parsing",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["<textarea><script>if (a < b) {}</script></textarea>"] },
    build: () =>
      page(`<style>${unused}</style>`, "<textarea><script>if (a < b) {}</script></textarea>"),
  },
  {
    id: "nothing-to-gain",
    category: "parsing",
    tier: "smoke",
    expect: { outcome: "keeps" },
    build: () => "<!DOCTYPE html><html><head></head><body><p>hello</p></body></html>",
  },
  {
    id: "plain-text-is-rejected",
    category: "validation",
    tier: "smoke",
    expect: { outcome: "rejects", error: "not-html" },
    build: () => "just some words, no markup at all",
  },
  {
    id: "linked-stylesheet-is-rejected",
    category: "validation",
    tier: "smoke",
    expect: { outcome: "rejects", error: "not-self-contained" },
    build: () => page('<link rel="stylesheet" href="style.css">', "<p>x</p>"),
  },
  {
    id: "twenty-thousand-paragraphs",
    category: "scale",
    tier: "smoke",
    expect: { outcome: "optimizes" },
    build: () =>
      page(`<style>${unused}</style>`, repeat(20000, (i) => `<p class="c${i % 7}">paragraph ${i}</p>\n`)),
  },
];
