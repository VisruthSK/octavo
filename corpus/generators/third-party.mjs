import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { document, paragraph, random } from "./common.mjs";

const scriptUri = (code) =>
  `data:application/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;

const styleUri = (css) =>
  `data:text/css;base64,${Buffer.from(css, "utf8").toString("base64")}`;

const kinds = {
  css: (name, content) => `<link rel="stylesheet" href="${styleUri(content)}">`,
  js: (name, content) => `<script src="${scriptUri(content)}" type="application/javascript"></script>`,
};

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const assets = options.assets ?? {};
  const head = [];
  const body = [];
  body.push(`<h1>${options.title ?? "Third party assets"}</h1>`);
  body.push(paragraph(source, 2));
  for (const name of options.order ?? Object.keys(assets)) {
    const path = assets[name];
    if (!path) continue;
    const content = readFileSync(path, "utf8");
    const kind = name.endsWith(".js") ? "js" : "css";
    head.push(kinds[kind](name, content));
    body.push(`<section class="asset" id="asset-${name.replace(/\W+/g, "-")}">`);
    body.push(`<h2>${name}</h2>`);
    body.push(`<p>Loaded from a pinned download.</p>`);
    body.push("</section>");
  }
  body.push('<div class="container"><div class="row"><div class="col-md-6">content</div></div></div>');
  return document({ lang: "en", className: "", head: head.join("\n"), body: body.join("\n") });
};
