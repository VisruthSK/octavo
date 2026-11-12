import { readFileSync } from "node:fs";
import { join } from "node:path";
import { page } from "../spec.mjs";
import { png } from "./assets.mjs";

const category = "linking";
const dot = () => png({ width: 48, height: 48 });
const pad = (bytes) => `/* ${"padding ".repeat(Math.ceil(bytes / 8))} */\n`;
const firaPath = join(import.meta.dirname, "..", ".cache", "fonts", "fira-sans.ttf");

export default [
  {
    id: "linked-stylesheet-is-embedded-and-pruned",
    category,
    tier: "smoke",
    expect: { outcome: "optimizes", retains: [".shown{"], removes: [".gone0", "style.css"] },
    build: () => page('<link rel="stylesheet" href="style.css">', '<p class="shown">text</p>'),
    files: () => ({ "style.css": ".shown{color:red}\n.gone0{color:blue}\n.gone1 .gone2{margin:0}\n" }),
  },
  {
    id: "linked-script-is-inlined",
    category,
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["__linkedRan"], removes: ['src="app.js"'] },
    build: () => page('<script src="app.js"></script>', '<p id="out"></p>'),
    files: () => ({ "app.js": 'window.__linkedRan = true;\ndocument.getElementById("out").textContent = "ran";\n' }),
  },
  {
    id: "linked-image-is-embedded",
    category,
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["data:image/"], removes: ["img/dot.png"] },
    build: () => page("", '<img src="img/dot.png" alt="dot" width="48" height="48">'),
    files: () => ({ "img/dot.png": dot() }),
  },
  {
    id: "linked-stylesheet-imports-another-that-uses-urls",
    category,
    tier: "smoke",
    expect: { outcome: "optimizes", retains: [".used{"], removes: ["@import", ".unused", "img/dot.png"] },
    build: () => page('<link rel="stylesheet" href="style.css">', '<div class="used">text</div>'),
    files: () => ({
      "style.css": '@import "theme/base.css";\n.page{margin:0}\n',
      "theme/base.css": `.used{background:url(../img/dot.png) no-repeat;width:48px;height:48px}\n.unused{padding:9px}\n${pad(2500)}`,
      "img/dot.png": dot(),
    }),
  },
  {
    id: "linked-module-imports-other-modules",
    category,
    tier: "smoke",
    expect: { outcome: "optimizes", grows: true, retains: ['type="module"'], removes: ["./lib/a.js", "./lib/b.js"] },
    build: () => page('<script type="module" src="main.js"></script>', '<p id="out">waiting</p>'),
    files: () => ({
      "main.js": 'import { a } from "./lib/a.js";\nimport "./lib/b.js";\ndocument.getElementById("out").textContent = a();\n',
      "lib/a.js": `${pad(1500)}export const a = () => 'from a';\n`,
      "lib/b.js": `${pad(1500)}document.documentElement.dataset.b = 'ran';\n`,
    }),
  },
  {
    id: "linked-root-relative-site-libs",
    category,
    tier: "smoke",
    browser: false,
    expect: { outcome: "optimizes", retains: [".lib{"], removes: ["/site_libs/"] },
    build: () => page('<link rel="stylesheet" href="/site_libs/lib/lib.css">', '<p class="lib">text</p>'),
    files: () => ({ "site_libs/lib/lib.css": ".lib{color:green}\n.other{color:red}\n" }),
  },
  {
    id: "linked-quarto-files-directory",
    category,
    tier: "full",
    expect: { outcome: "optimizes", retains: [".fig{"], removes: ["report_files"] },
    build: () => page('<link rel="stylesheet" href="report_files/libs/fig.css">', '<p class="fig">text</p>'),
    files: () => ({ "report_files/libs/fig.css": ".fig{color:navy}\n.nope{color:red}\n" }),
  },
  {
    id: "linked-deferred-script-keeps-its-order",
    category,
    tier: "full",
    expect: { outcome: "optimizes", grows: true, retains: ["defer"], removes: ['src="late.js"'] },
    build: () =>
      page(
        '<script defer src="late.js"></script>',
        '<p id="out">before</p><script>document.documentElement.dataset.inline = document.getElementById("out") ? "seen" : "missing";</script>',
      ),
    files: () => ({ "late.js": `${pad(2000)}document.getElementById("out").textContent = "after";\n` }),
  },
  {
    id: "linked-font-face-in-a-stylesheet",
    category,
    tier: "full",
    expect: { outcome: "optimizes", retains: [".face{"], removes: ["fira.ttf"] },
    build: () => page('<link rel="stylesheet" href="fonts.css">', '<p class="face">Linked font text</p>'),
    files: () => ({
      "fonts.css": '@font-face{font-family:"Linked Fira";src:url(fira.ttf) format("truetype")}\n.face{font-family:"Linked Fira",serif;font-size:28px}\n',
      "fira.ttf": readFileSync(firaPath),
    }),
  },
  {
    id: "linked-query-and-fragment-are-ignored-when-reading",
    category,
    tier: "full",
    expect: { outcome: "optimizes", retains: [".q{"], removes: ["style.css"] },
    build: () => page('<link rel="stylesheet" href="style.css?v=3#top">', '<p class="q">text</p>'),
    files: () => ({ "style.css": ".q{color:purple}\n.r{color:red}\n" }),
  },
  {
    id: "linked-percent-encoded-file-name",
    category,
    tier: "full",
    expect: { outcome: "optimizes", retains: [".space{"], removes: ["my%20style.css"] },
    build: () => page('<link rel="stylesheet" href="my%20style.css">', '<p class="space">text</p>'),
    files: () => ({ "my style.css": ".space{color:teal}\n.other{color:red}\n" }),
  },
  {
    id: "linked-icon-and-stylesheet-together",
    category,
    tier: "full",
    expect: { outcome: "optimizes", retains: [".both{"], removes: ["icon.png", "both.css"] },
    build: () => page('<link rel="icon" href="icon.png"><link rel="stylesheet" href="both.css">', '<p class="both">text</p>'),
    files: () => ({ "icon.png": dot(), "both.css": `.both{color:maroon}\n.never{color:red}\n${pad(2500)}` }),
  },
  {
    id: "linked-stylesheet-is-missing",
    category,
    tier: "smoke",
    expect: { outcome: "rejects", error: "not-self-contained" },
    build: () => page('<link rel="stylesheet" href="absent.css">', "<p>text</p>"),
  },
  {
    id: "linked-one-of-two-scripts-is-missing",
    category,
    tier: "smoke",
    expect: { outcome: "rejects", error: "not-self-contained" },
    build: () => page('<script src="present.js"></script><script src="absent.js"></script>', "<p>text</p>"),
    files: () => ({ "present.js": "window.__present = true;\n" }),
  },
  {
    id: "linked-image-is-missing",
    category,
    tier: "full",
    expect: { outcome: "rejects", error: "not-self-contained" },
    build: () => page("", '<img src="img/absent.png" alt="absent">'),
    files: () => ({ "img/other.png": dot() }),
  },
  {
    id: "linked-stylesheet-outside-the-search-path-is-missing",
    category,
    tier: "full",
    expect: { outcome: "rejects", error: "not-self-contained" },
    build: () => page('<link rel="stylesheet" href="../../../../outside/never-here.css">', "<p>text</p>"),
  },
];
