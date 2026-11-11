import { Buffer } from "node:buffer";
import { between, document, paragraph, pick, pngDataUri, random, repeat } from "./common.mjs";

const svgFigure = (source, index) => {
  const bars = repeat(12, (bar) => {
    const height = between(source, 4, 90);
    return `<rect x="${bar * 18 + 4}" y="${100 - height}" width="12" height="${height}" fill="#4c78a8"></rect>`;
  }).join("");
  const points = repeat(10, (point) => `${point * 20},${between(source, 10, 90)}`).join(" ");
  return `<svg class="figure-svg" id="figure-${index}" viewBox="0 0 240 110" width="240" height="110" xmlns="http://www.w3.org/2000/svg">
<title>Figure ${index}</title>
<rect x="0" y="0" width="240" height="110" fill="#f7f7f7"></rect>
${bars}
<polyline points="${points}" fill="none" stroke="#e45756" stroke-width="2"></polyline>
</svg>`;
};

const fontFace = (family, seed) => {
  const bytes = Buffer.alloc(1024);
  let state = seed >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    bytes[index] = (state >>> 16) & 0xff;
  }
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${bytes.toString(
    "base64",
  )}) format("woff2")}`;
};

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const images = options.images ?? 6;
  const figures = options.figures ?? 3;
  const title = options.title ?? "Media heavy document";
  const fonts = options.fonts ?? 2;
  const useSvg = options.svg ?? true;

  const head = [];
  head.push(`<title>${title}</title>`);
  const styles = [
    "body{font-family:system-ui,sans-serif;margin:2rem}",
    ".gallery{display:flex;flex-wrap:wrap;gap:1rem}",
    ".gallery img{width:120px;height:auto;border:1px solid #eee}",
    ".figure-svg{border:1px solid #eee;background:#fff}",
  ];
  for (let index = 1; index <= fonts; index += 1) {
    styles.push(fontFace(`MediaFont${index}`, (options.seed ?? 1) + index));
  }
  styles.push(".styled{font-family:MediaFont1,system-ui,sans-serif}");
  head.push(`<style>${styles.join("\n")}</style>`);

  const body = [];
  body.push(`<h1>${title}</h1>`);
  body.push(paragraph(source, 2));
  body.push('<div class="gallery">');
  for (let index = 1; index <= images; index += 1) {
    const width = between(source, 24, 80);
    const height = between(source, 16, 60);
    body.push(
      `<img src="${pngDataUri(width, height, (x, y) => ((x * 7 + y * 3 + index) % 4) * 60)}" alt="image ${index}" loading="lazy">`,
    );
  }
  body.push("</div>");
  for (let index = 1; index <= figures; index += 1) {
    body.push(`<figure class="figure">`);
    if (useSvg) body.push(svgFigure(source, index));
    body.push(`<figcaption>Figure ${index}: ${pick(source, ["a chart", "a diagram", "a sketch"])}</figcaption>`);
    body.push("</figure>");
  }
  body.push(`<p class="styled">${pick(source, ["Text in a custom face", "Another styled line"])}</p>`);

  return document({ lang: "en", className: "", head: head.join("\n"), body: body.join("\n") });
};
