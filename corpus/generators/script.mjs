import { between, document, paragraph, pick, random, repeat } from "./common.mjs";

const classic = () => `<script>
(function () {
  "use strict";
  var pattern = /a\\/b<c>/g;
  var quoted = /["'\\u0027]/g;
  var text = "a/b<c> and 'quotes'";
  var matches = text.match(pattern) || [];
  var pairs = Array.from(text.matchAll(quoted)).map(function (match) { return match[0]; });
  var template = \`line one \\\${matches.length} pairs \\\${pairs.length}\`;
  var object = { alpha: 1, beta: 2, nested: { gamma: [1, 2, 3] } };
  var spread = Object.assign({}, object, { delta: 4 });
  var optional = object?.nested?.gamma?.length ?? 0;
  window.scriptReport = {
    matches: matches.length,
    pairs: pairs.length,
    template: template,
    keys: Object.keys(spread).sort(),
    optional: optional
  };
})();
</script>`;

const escaping = () => `<script>
(function () {
  "use strict";
  var close = "<\\/script>";
  var literal = "<\\/script>";
  var combined = "prefix" + close + "suffix";
  window.escaping = { close: close.length, literal: literal.length, combined: combined.length };
})();
</script>`;

const truncated = () => `<script>
(function () {
  "use strict";
  var broken = "the script ends here";
  window.truncated = broken;
})();
</script>`;

const modern = () => `<script>
(async function () {
  "use strict";
  class Counter {
    constructor(start) { this.value = start; }
    async next() { this.value += 1; return this.value; }
    *steps(count) { for (var index = 0; index < count; index += 1) yield this.value + index; }
  }
  var counter = new Counter(1);
  var results = [];
  for await (var value of [counter.next(), Promise.resolve(3)]) results.push(value);
  window.modern = { results: results, steps: Array.from(counter.steps(3)) };
})();
</script>`;

const module = () => `<script type="module">
export const answer = 42;
export function describe(value) {
  return "value " + value;
}
window.moduleLoaded = true;
</script>`;

const importMap = () => `<script type="importmap">
{
  "imports": {
    "helper": "data:application/javascript;base64,ZXhwb3J0IGNvbnN0IGhlbHBlciA9IHRydWU7"
  }
}
</script>`;

const dataBlock = () => `<script type="application/json" id="dataset">
{
  "rows": [
    { "name": "alpha", "value": 1 },
    { "name": "beta", "value": 2 }
  ],
  "generated": "deterministic"
}
</script>`;

const reader = () => `<script>
(function () {
  "use strict";
  var read = function () {
    var node = document.getElementById("dataset");
    if (!node) return null;
    try {
      return JSON.parse(node.textContent);
    } catch (error) {
      return { error: String(error) };
    }
  };
  window.dataset = read();
})();
</script>`;

export const generate = (options) => {
  const source = random(options.seed ?? 1);
  const features = options.features ?? ["classic"];
  const title = options.title ?? "Script features";

  const head = [];
  head.push(`<title>${title}</title>`);
  const body = [];
  body.push(`<h1>${title}</h1>`);
  body.push(paragraph(source, between(source, 1, 3)));
  body.push('<div class="output" id="output">output</div>');

  for (const feature of features) {
    if (feature === "classic") body.push(classic());
    if (feature === "escaping") body.push(escaping());
    if (feature === "truncated") body.push(truncated());
    if (feature === "modern") body.push(modern());
    if (feature === "module") body.push(module());
    if (feature === "importmap") body.push(importMap());
    if (feature === "data") body.push(dataBlock());
    if (feature === "reader") body.push(reader());
  }

  body.push(
    `<ul>${repeat(3, (index) => `<li class="item-${index}">${pick(source, ["first", "second", "third"])}</li>`).join("")}</ul>`,
  );

  return document({ lang: "en", className: "", head: head.join("\n"), body: body.join("\n") });
};
