import { Buffer } from "node:buffer";
import { between, document, paragraph, pick, random, repeat } from "./common.mjs";
import { mathjaxJs } from "./scripts.mjs";

const dataScript = (code) =>
  `<script src="data:application/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}"></script>`;

const fontFace = (family, seed) => {
  const bytes = Buffer.alloc(2048);
  let state = seed >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    bytes[index] = (state >>> 16) & 0xff;
  }
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,${bytes.toString(
    "base64",
  )}) format("woff2")}`;
};

const katexCss = () =>
  [
    ".katex{font:normal 1.21em KaTeX_Main,serif;line-height:1.2;text-indent:0;text-rendering:auto}",
    ".katex-display{display:block;margin:1em 0;text-align:center}",
    ".katex .base{position:relative;white-space:nowrap;width:min-content}",
    ".katex .mord .frac-line{display:inline-block;width:100%;border-bottom-style:solid;height:1px}",
    ".katex .sqrt>svg{fill:currentColor;stroke:currentColor;stroke-width:0.04em}",
    ".katex .sqrt .root-shape{stroke:none}",
    ".katex .overline .overline-line{position:relative;top:-1.1em;display:inline-block}",
    ".katex .mspace{display:inline-block}",
    ".katex .vlist-t{display:inline-table;table-layout:fixed;border-collapse:collapse}",
    ".katex .vlist-r{display:table-row}",
    ".katex .vlist{display:table-cell;vertical-align:bottom;position:relative}",
    ".katex .hbox{display:inline-block;white-space:nowrap}",
    ".katex .mfrac>span>span{text-align:center}",
    ".katex .boldsymbol{bold-style:italic}",
  ].join("\n");

const formulas = [
  "\\int_0^\\infty e^{-x^2}\\,dx=\\frac{\\sqrt{\\pi}}{2}",
  "\\sum_{i=1}^{n} i^2=\\frac{n(n+1)(2n+1)}{6}",
  "\\frac{\\partial^2 u}{\\partial t^2}=c^2\\nabla^2 u",
  "\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^n=e",
];

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const count = options.formulas ?? 5;
  const title = options.title ?? "Mathematical notes";
  const engine = options.engine ?? "katex";
  const withFonts = options.fonts ?? true;

  const head = [];
  head.push(`<title>${title}</title>`);
  if (engine === "katex") {
    const css = [katexCss()];
    if (withFonts) {
      css.push(fontFace("KaTeX_Main", options.seed ?? 1));
      css.push(fontFace("KaTeX_Math", (options.seed ?? 1) + 17));
    }
    head.push(`<style>${css.join("\n")}</style>`);
  }
  head.push(dataScript(mathjaxJs()));
  head.push(
    '<script>window.MathJax = { tex: { inlineMath: [["\\\\(", "\\\\)"]], displayMath: [["\\\\[", "\\\\]"]] }, options: { skipHtmlTags: ["script", "noscript", "style", "textarea", "pre"] } };</script>',
  );

  const body = [];
  body.push(`<h1>${title}</h1>`);
  body.push(paragraph(source, 2));
  for (let index = 1; index <= count; index += 1) {
    const formula = formulas[index % formulas.length];
    body.push(`<p class="math inline">\\(${formula}\\)</p>`);
    body.push(`<div class="math display">\\[${formula}\\]</div>`);
    body.push(`<p>${pick(source, ["where", "and", "so"])} \\(x = ${index}\\) ${pick(source, ["holds", "follows"])}.</p>`);
  }
  body.push(
    `<div class="equation">${repeat(2, (index) => `<p class="math display">\\[${formulas[index % formulas.length]}\\]</p>`).join("")}</div>`,
  );

  return document({
    lang: "en",
    className: "",
    head: head.join("\n"),
    body: body.join("\n"),
  });
};
