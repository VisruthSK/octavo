import { document, paragraph, pngDataUri, random, repeat } from "./common.mjs";

const page = (head, body) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Scale</title>${head}</head><body>${body}</body></html>`;

const shapes = {
  paragraphs: (source, count) =>
    page(
      `<style>.c1{color:red}.c2{color:blue}</style>`,
      repeat(count, (index) => `<p class="c${index % 50}">paragraph ${index}</p>`).join(""),
    ),
  images: (source, count) =>
    page(
      "",
      repeat(count, (index) => `<img alt="${index}" src="${pngDataUri(16, 16, () => (index * 37) % 4 * 60)}">`).join(""),
    ),
  scripts: (source, count) =>
    page(
      repeat(count, (index) => `<script>window.value${index}=Math.sqrt(${index});</script>`).join(""),
      `<p>x</p>`,
    ),
  stylesheets: (source, count) =>
    page(
      repeat(count, (index) => `<style>.rule${index}{margin:${index}px}</style>`).join(""),
      repeat(count, (index) => `<p class="rule${index}">x</p>`).join(""),
    ),
  linkedSheets: (source, count) =>
    page(
      repeat(
        count,
        (index) =>
          `<link rel="stylesheet" href="data:text/css,.l${index}%7Bpadding:${index}px%7D">`,
      ).join(""),
      repeat(count, (index) => `<p class="l${index}">x</p>`).join(""),
    ),
  svgs: (source, count) =>
    page(
      "",
      repeat(
        count,
        (index) =>
          `<svg viewBox="0 0 10 10">${repeat(40, (part) => `<path d="M${index} ${part}L${part} ${index}"/>`).join("")}</svg>`,
      ).join(""),
    ),
  longScript: (source, count) =>
    page(
      `<script>${repeat(count, (index) => `window.a${index}=${index};`).join("")}</script>`,
      `<p>x</p>`,
    ),
  deepNesting: (source, count) =>
    page("", `<div>`.repeat(count) + "deep" + `</div>`.repeat(count)),
  manyClasses: (source, count) =>
    page(
      `<style>.k0{color:red}</style>`,
      `<p class="${repeat(count, (index) => `k${index} `).join("")}">x</p>`,
    ),
  customProperties: (source, count) =>
    page(
      `<style>:root{${repeat(count, (index) => `--v${index}:${index}px;`).join("")}}.u{margin:var(--v1)}</style>`,
      `<p class="u">x</p>`,
    ),
  wideTable: (source, count) =>
    page(
      `<style>table{border-collapse:collapse}td{border:1px solid #ddd}</style>`,
      `<table><tbody>${repeat(
        count,
        (index) => `<tr><td>${index}</td><td>${index * 2}</td><td>${index * 3}</td></tr>`,
      ).join("")}</tbody></table>`,
    ),
  longText: (source, count) =>
    page(
      `<style>.body-text{line-height:1.6}</style>`,
      `<div class="body-text">${paragraph(source, count)}</div>`,
    ),
};

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const shape = shapes[options.shape];
  if (!shape) throw new Error(`unknown shape: ${options.shape}`);
  return shape(source, options.count ?? 1000);
};

export const names = Object.keys(shapes);
