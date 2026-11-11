import { between, document, paragraph, pick, pngDataUri, random, repeat } from "./common.mjs";

const forms = () => `<form class="settings" action="/submit" method="post">
<label class="label" for="name">Name</label>
<input class="input" type="text" id="name" name="name" value="">
<label class="label" for="level">Level</label>
<select class="select" id="level" name="level">
<option value="1">One</option>
<option value="2">Two</option>
</select>
<button class="button" type="submit">Send</button>
</form>`;

const gallery = (source, count) =>
  repeat(
    count,
    (index) =>
      `<figure class="figure"><img src="${pngDataUri(20 + index, 16 + index, (x, y) => (x * y + index) % 4 * 60)}" alt="picture ${index}"><figcaption>Caption ${index}</figcaption></figure>`,
  ).join("\n");

const table = (source, index) => {
  const rows = repeat(5, (row) => `<tr><td>${row}</td><td>${(row * index) % 13}</td></tr>`).join("");
  return `<table class="table">
<thead><tr><th>key</th><th>value</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
};

const script = (source, count) => `<script>
(function () {
  "use strict";
  var rows = document.querySelectorAll(".table tbody tr");
  for (var index = 0; index < rows.length; index += 1) {
    rows[index].setAttribute("data-row", String(index));
  }
  var counter = ${count};
  document.documentElement.setAttribute("data-counter", String(counter));
})();
</script>`;

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const sections = options.sections ?? 3;
  const title = options.title ?? "A plain document";
  const style = options.style ?? "inline";
  const features = options.features ?? ["text"];

  const head = [];
  if (style === "inline") {
    head.push(`<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#222}h1{font-size:2rem}.table{border-collapse:collapse}.table td{border:1px solid #ddd;padding:.25rem}.figure img{max-width:100%}</style>`);
  } else if (style === "linked") {
    head.push('<link rel="stylesheet" href="data:text/css;charset=utf-8,body%7Bfont-family%3Asystem-ui%3Bmargin%3A2rem%7D.table%7Bborder-collapse%3Acollapse%7D">');
  }

  const body = [];
  body.push(`<h1>${title}</h1>`);
  for (let index = 1; index <= sections; index += 1) {
    body.push(`<section class="section" id="section-${index}">`);
    body.push(`<h2>Section ${index}</h2>`);
    body.push(paragraph(source, between(source, 1, 4)));
    for (const feature of features) {
      if (feature === "form") body.push(forms());
      if (feature === "table") body.push(table(source, index));
      if (feature === "figure") body.push(gallery(source, 2));
      if (feature === "list") {
        body.push(`<ul>${repeat(4, (item) => `<li>${pick(source, ["alpha", "beta", "gamma", "delta"])}</li>`).join("")}</ul>`);
      }
      if (feature === "definition") {
        body.push(
          `<dl><dt>${pick(source, ["term", "name"])}</dt><dd>${pick(source, ["value", "answer"])}</dd></dl>`,
        );
      }
    }
    body.push("</section>");
  }
  if (features.includes("script")) body.push(script(source, sections));

  return document({ lang: "en", className: "", head: head.join("\n"), body: body.join("\n") });
};
