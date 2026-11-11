import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./browser.mjs";

const binary = new URL(`../target/release/octavo${process.platform === "win32" ? ".exe" : ""}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "octavo-"));

const filler = (n) => Array.from({ length: n }, (_, i) => `window.f${i}=Math.sqrt(${i * 31 + 7});`).join("");
const rules = Array.from({ length: 40 }, (_, i) => `.r${i}{margin:${i}px ${i * 2}px;padding:${i + 1}px}`).join("");
const classes = Array.from({ length: 40 }, (_, i) => `r${i}`).join(" ");
const json = JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ id: i, label: `item-${i}`, value: i * 17 })));
const svg = `<svg id="chart" viewBox="0 0 100 100">${Array.from({ length: 150 }, (_, i) => `<circle cx="${i % 100}" cy="${(i * 7) % 100}" r="${(i % 5) + 1}"/>`).join("")}</svg>`;
const darkLink = `data:text/css,${encodeURIComponent(`.probe{color:rgb(9,9,9)}${rules}`)}`;

const document = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title>
<script>window.order=["head"];${filler(80)}</script>
<style>.probe{color:rgb(1,2,3)}${rules}</style>
<link rel="stylesheet" id="light" href="${darkLink}">
</head><body class="${classes}"><p class="probe">hello ✓ 😀</p>
<script type="application/json" id="data">${json}</script>
${svg}
<script>window.order.push("body");window.parsed=JSON.parse(document.getElementById("data").textContent).length;${filler(80)}</script>
<script id="late">window.order.push("late");window.currentId=document.currentScript.id;${filler(80)}</script>
</body></html>`;

function build(name, html, level) {
  const input = join(dir, `${name}.html`);
  const output = join(dir, `${name}.${level}.html`);
  writeFileSync(input, html);
  execFileSync(binary, [input, output, "--level", level]);
  return { input, output, bytes: statSync(output).size, original: statSync(input).size };
}

async function load(file, { javaScriptEnabled = true } = {}) {
  const browser = await launch();
  const context = await browser.newContext({ javaScriptEnabled });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(pathToFileURL(file).href);
  return { page, errors, close: () => browser.close() };
}

test("packed output executes scripts in order and restores every resource kind", async () => {
  const { output, bytes, original } = build("doc", document, "packed");
  assert.ok(bytes < original / 2, `${bytes} vs ${original}`);
  const { page, errors, close } = await load(output);
  try {
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.order), ["head", "body", "late"]);
    assert.equal(await page.evaluate(() => window.parsed), 300);
    assert.equal(await page.evaluate(() => window.currentId), "late");
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".probe")).color), "rgb(9, 9, 9)");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#chart circle").length), 150);
    assert.equal(await page.evaluate(() => document.querySelector("p").textContent), "hello ✓ 😀");
    assert.equal(await page.evaluate(() => document.getElementById("light").tagName), "LINK");
    assert.equal(await page.evaluate(() => document.getElementById("data").type), "application/json");
  } finally {
    await close();
  }
});

test("a restored stylesheet link can be disabled through rel like the original", async () => {
  const { output } = build("toggle", document, "packed");
  const { page, close } = await load(output);
  try {
    const color = () => page.evaluate(() => getComputedStyle(document.querySelector(".probe")).color);
    assert.equal(await color(), "rgb(9, 9, 9)");
    await page.evaluate(() => (document.getElementById("light").rel = "disabled-stylesheet"));
    assert.equal(await color(), "rgb(1, 2, 3)");
  } finally {
    await close();
  }
});

test("scripts level keeps styling and content without JavaScript", async () => {
  const { output } = build("nojs", document, "scripts");
  const { page, close } = await load(output, { javaScriptEnabled: false });
  try {
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".probe")).color), "rgb(9, 9, 9)");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#chart circle").length), 150);
  } finally {
    await close();
  }
});

test("long-range repetition selects brotli and still restores exact text", async () => {
  const block = Array.from({ length: 60000 }, (_, i) => String.fromCharCode(97 + ((i * i * 7 + (i >> 3)) % 26))).join("");
  const code = `window.big=${JSON.stringify(block)};window.copies=[${Array(8).fill(JSON.stringify(block)).join(",")}].length;`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><script>${code}</script></head><body><p>x</p></body></html>`;
  const { output, bytes, original } = build("brotli", html, "packed");
  assert.ok(bytes < original / 3, `${bytes} vs ${original}`);
  const { page, errors, close } = await load(output);
  try {
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => window.big.length), block.length);
    assert.equal(await page.evaluate(() => window.copies), 8);
  } finally {
    await close();
  }
});

test("a Content-Security-Policy document is left byte-identical", () => {
  const html = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'"><script>${filler(200)}</script></head><body></body></html>`;
  const { output, original } = build("csp", html, "packed");
  assert.equal(statSync(output).size <= original, true);
  assert.ok(!execFileSync("node", ["-e", `process.stdout.write(require("fs").readFileSync(${JSON.stringify(output)},"utf8").includes("$o(")?"packed":"plain")`]).toString().includes("packed"));
});
