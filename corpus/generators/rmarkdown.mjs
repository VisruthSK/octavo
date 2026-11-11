import { Buffer } from "node:buffer";
import { between, document, paragraph, pick, pngDataUri, random, repeat } from "./common.mjs";
import { bootstrapCss, highlightCss } from "./styles.mjs";
import { highlightJs, jqueryJs } from "./scripts.mjs";

const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const inlineScript = (code) => `<script>${code}</script>`;

const dataScript = (code) =>
  `<script src="data:application/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}"></script>`;

const chunk = (source, index) => {
  const code = [
    "library(ggplot2)",
    `df <- data.frame(x = 1:${index + 3}, y = rnorm(${index + 3}))`,
    "ggplot(df, aes(x, y)) + geom_point()",
  ]
    .map((line) => escapeHtml(line))
    .join("\n");
  return `<div class="chunk">
<div class="chunk-input">
<pre class="hljs"><code>${code}
</code></pre>
</div>
<div class="chunk-output">
<pre><code>## [1] 42
</code></pre>
</div>
</div>`;
};

const plot = (source, index) => {
  const width = between(source, 30, 70);
  const height = between(source, 20, 50);
  const uri = pngDataUri(width, height, (x, y) => ((x * 3 + y + index) % 4) * 55 + 30);
  return `<p><img src="${uri}" alt="plot ${index}" width="${width}" height="${height}" /></p>`;
};

const table = (source, index) => {
  const rows = repeat(4, (row) => `<tr><td>${row}</td><td>${(row * index) % 11}</td></tr>`).join("");
  return `<table class="table table-striped table-condensed">
<caption>Table ${index}</caption>
<thead><tr><th>name</th><th>value</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
};

const widget = (source) => {
  const values = repeat(6, () => between(source, 1, 50));
  return `<div id="htmlwidget-${between(source, 100, 999)}" class="html-widget html-widget-static-bound">
<script type="application/json" data-for="htmlwidget-abc">${JSON.stringify({ x: values })}</script>
</div>`;
};

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const sections = options.sections ?? 4;
  const title = options.title ?? "An R Markdown document";
  const density = options.density ?? 1;
  const features = options.features ?? ["text"];

  const head = [];
  head.push("<title>" + title + "</title>");
  head.push(`<style type="text/css">${bootstrapCss({ density })}</style>`);
  head.push(`<style type="text/css">${highlightCss()}</style>`);
  head.push(
    '<style type="text/css">body{font-family:Helvetica,Arial,sans-serif;margin:0;padding:2rem;background:#fff;color:#222}h1{font-weight:700}h2{border-bottom:1px solid #eee}.main-container{max-width:960px;margin:0 auto}.chunk{margin:1rem 0}.chunk-output pre{background:#f7f7f7;padding:.5rem}</style>',
  );
  head.push(inlineScript(jqueryJs()));
  head.push(dataScript(highlightJs()));

  const body = [];
  body.push('<div class="container-fluid main-container">');
  body.push('<div class="row">');
  body.push('<div class="col-sm-12">');
  body.push('<div id="header">');
  body.push(`<h1 class="title">${title}</h1>`);
  body.push('<h2 class="subtitle">Rendered with rmarkdown</h2>');
  body.push('<p class="author">R Author</p>');
  body.push('<p class="date">2024-01-01</p>');
  body.push("</div>");
  for (let index = 1; index <= sections; index += 1) {
    body.push(`<div id="section-${index}" class="section level2">`);
    body.push(`<h2>Section ${index}</h2>`);
    body.push(paragraph(source, between(source, 1, 3)));
    for (const feature of features) {
      if (feature === "code") body.push(chunk(source, index));
      if (feature === "figure") body.push(plot(source, index));
      if (feature === "table") body.push(table(source, index));
      if (feature === "widget") body.push(widget(source));
      if (feature === "list") {
        body.push(
          `<ul>${repeat(3, (item) => `<li>${pick(source, ["one", "two", "three"])} ${item}</li>`).join("")}</ul>`,
        );
      }
    }
    body.push("</div>");
  }
  body.push('<div id="footer"><p>Generated document</p></div>');
  body.push("</div>");
  body.push("</div>");
  body.push("</div>");
  body.push(inlineScript('$(document).ready(function () { $("h1").addClass("title-ready"); });'));

  return document({ lang: "en", className: "", head: head.join("\n"), body: body.join("\n") });
};
