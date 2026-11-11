import { Buffer } from "node:buffer";
import { between, document, paragraph, pick, random, repeat } from "./common.mjs";
import { dygraphJs, leafletJs, plotlyJs } from "./scripts.mjs";

const dataScript = (code) =>
  `<script src="data:application/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}"></script>`;

const payload = (source, kind) => {
  const values = repeat(10, () => between(source, 1, 90));
  if (kind === "plotly") return { values, layout: { title: "Plot", margin: { l: 10, r: 10, t: 10, b: 10 } } };
  if (kind === "leaflet") return { center: [51.5, -0.12], zoom: 11, tiles: "none" };
  return { values, labels: repeat(10, (index) => `p${index}`) };
};

const binding = (source, kind, id) => `<script type="application/json" data-for="${id}">${JSON.stringify(
  payload(source, kind),
)}</script>`;

const chart = (source, kind, index) => {
  const id = `${kind}-${index}`;
  const markup = {
    plotly: `<div id="${id}" class="plotly html-widget" style="width:320px;height:200px;"></div>`,
    leaflet: `<div id="${id}" class="leaflet html-widget" style="width:320px;height:200px;"></div>`,
    dygraph: `<div id="${id}" class="dygraph html-widget" style="width:320px;height:180px;"></div>`,
  }[kind];
  return `<div class="widget-container">
${markup}
${binding(source, kind, id)}
</div>`;
};

const bootstrap = (source) => `<script>
(function () {
  "use strict";
  var render = function () {
    var plotly = document.querySelectorAll(".plotly.html-widget");
    for (var index = 0; index < plotly.length; index += 1) {
      var holder = plotly[index];
      var data = JSON.parse(document.querySelector('[data-for="' + holder.id + '"]').textContent);
      window.Plotly.newPlot(holder, data);
    }
    var maps = document.querySelectorAll(".leaflet.html-widget");
    for (var position = 0; position < maps.length; position += 1) {
      var map = maps[position];
      var info = JSON.parse(document.querySelector('[data-for="' + map.id + '"]').textContent);
      window.L.map(map, { zoom: info.zoom });
    }
    var lines = document.querySelectorAll(".dygraph.html-widget");
    for (var line = 0; line < lines.length; line += 1) {
      var chart = lines[line];
      var series = JSON.parse(document.querySelector('[data-for="' + chart.id + '"]').textContent);
      window.dygraph(chart, series);
    }
  };
  if (document.readyState !== "loading") render();
  else document.addEventListener("DOMContentLoaded", render);
})();
</script>`;

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const count = options.widgets ?? 3;
  const kinds = options.kinds ?? ["plotly", "leaflet", "dygraph"];
  const title = options.title ?? "Widget report";

  const head = [];
  head.push(`<title>${title}</title>`);
  head.push(
    '<style>.widget-container{margin:1rem 0}.html-widget{display:block;border:1px solid #e5e5e5;background:#fbfbfb}.dygraph path{stroke-width:2}</style>',
  );
  if (kinds.includes("plotly")) head.push(dataScript(plotlyJs()));
  if (kinds.includes("leaflet")) head.push(dataScript(leafletJs()));
  if (kinds.includes("dygraph")) head.push(dataScript(dygraphJs()));
  head.push(bootstrap(source));

  const body = [];
  body.push(`<h1>${title}</h1>`);
  body.push(paragraph(source, 2));
  for (let index = 1; index <= count; index += 1) {
    const kind = kinds[index % kinds.length];
    body.push(`<h2>${pick(source, ["Trend", "Distribution", "Coverage", "Latency"])} ${index}</h2>`);
    body.push(chart(source, kind, index));
    body.push(paragraph(source, 1));
  }

  return document({ lang: "en", className: "", head: head.join("\n"), body: body.join("\n") });
};
