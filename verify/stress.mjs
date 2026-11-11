import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const binary = new URL(`../target/release/octavo${process.platform === "win32" ? ".exe" : ""}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "octavo-stress-"));
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const page = (head, body) => `<!DOCTYPE html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const times = (n, make) => Array.from({ length: n }, (_, i) => make(i)).join("");

const shapes = {
  paragraphs: [10_000, (n) => page("<style>.c1{color:red}.c2{color:blue}</style>", times(n, (i) => `<p class="c${i % 50}">paragraph ${i}</p>`))],
  images: [500, (n) => page("", times(n, (i) => `<img alt="${i}" src="data:image/png;base64,${PIXEL}">`))],
  scripts: [300, (n) => page(times(n, (i) => `<script>window.value${i}=Math.sqrt(${i});</script>`), "<p>x</p>")],
  stylesheets: [300, (n) => page(times(n, (i) => `<style>.rule${i}{margin:${i}px}</style>`), times(n, (i) => `<p class="rule${i}">x</p>`))],
  linked_sheets: [300, (n) => page(times(n, (i) => `<link rel="stylesheet" href="data:text/css,.l${i}%7Bpadding:${i}px%7D">`), times(n, (i) => `<p class="l${i}">x</p>`))],
  svgs: [200, (n) => page("", times(n, (i) => `<svg viewBox="0 0 10 10">${times(40, (j) => `<path d="M${i} ${j}L${j} ${i}"/>`)}</svg>`))],
  one_long_script: [20_000, (n) => page(`<script>${times(n, (i) => `window.a${i}=${i};`)}</script>`, "<p>x</p>")],
  deep_nesting: [2_000, (n) => page("", "<div>".repeat(n) + "deep" + "</div>".repeat(n))],
  many_classes: [20_000, (n) => page(`<style>.k0{color:red}</style>`, `<p class="${times(n, (i) => `k${i} `)}">x</p>`)],
  custom_properties: [2_000, (n) => page(`<style>:root{${times(n, (i) => `--v${i}:${i}px;`)}}.u{margin:var(--v1)}</style>`, '<p class="u">x</p>')],
  big_base64_text: [200_000, (n) => page("", `<p data-blob="${"QUJD".repeat(n)}">x</p>`)],
};

let outputs = 0;

const run = (name, make, n) => {
  const input = join(dir, `${name}.${n}.html`);
  writeFileSync(input, make(n));
  execFileSync(process.execPath, ["-e", "require(\"fs\").readFileSync(process.argv[1])", input]);
  const once = () => {
    const output = join(dir, `out.${outputs++}.html`);
    const started = process.hrtime.bigint();
    execFileSync(binary, ["optimize", input, output, "--level", "packed"], { stdio: "pipe", maxBuffer: 1 << 28 });
    return Number(process.hrtime.bigint() - started) / 1e6;
  };
  return Math.min(once(), once(), once());
};

let worst = 0;
console.log("shape".padEnd(20), "n".padStart(8), "ms".padStart(8), "4n".padStart(8), "ms".padStart(8), "exponent".padStart(9));
const only = process.argv.slice(2);
for (const [name, [n, make]] of Object.entries(shapes)) {
  if (only.length && !only.includes(name)) continue;
  run(name, make, Math.max(1, n / 8));
  const small = run(name, make, n);
  const large = run(name, make, n * 4);
  const exponent = Math.log(large / small) / Math.log(4);
  worst = Math.max(worst, exponent);
  const flag = exponent > 1.5 ? "  <-- superlinear" : large > 5000 ? "  <-- slow" : "";
  console.log(name.padEnd(20), String(n).padStart(8), small.toFixed(0).padStart(8), String(n * 4).padStart(8), large.toFixed(0).padStart(8), exponent.toFixed(2).padStart(9), flag);
}
process.exit(worst > 1.5 ? 1 : 0);
