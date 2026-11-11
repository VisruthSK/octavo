import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "./verify.mjs";

const directory = mkdtempSync(join(tmpdir(), "octavo-verifier-"));

const page = (style, body = '<h1>Title</h1><ul><li>one</li><li>two</li></ul><a class="link" href="#x">link</a><input placeholder="name"><div class="box"></div>') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>${style}</style></head><body>${body}</body></html>`;

const base = [
  "body{margin:8px;font:16px sans-serif}",
  ".box{width:50px;height:50px;background:rgb(10,20,30);animation:slide 2s infinite}",
  "@keyframes slide{from{margin-left:0}to{margin-left:100px}}",
  "a.link{color:rgb(0,0,200)}",
  "a.link:hover{color:rgb(200,0,0)}",
  "@media (max-width:500px){h1{font-size:12px}}",
  "@media (min-width:700px) and (max-width:900px){h1{font-size:40px}}",
  "@media (prefers-color-scheme:dark){body{background:rgb(0,0,0);color:rgb(255,255,255)}}",
  "@media print{.box{display:none}}",
  "li::marker{color:rgb(255,0,0)}",
  "input::placeholder{color:rgb(0,128,0)}",
  "@media (prefers-reduced-motion:reduce){h1{letter-spacing:2px}}",
].join("");

const write = (name, html) => {
  const file = join(directory, `${name}.html`);
  writeFileSync(file, html);
  return file;
};

const scenariosFailing = async (original, changed) =>
  (await verify(write("original", original), write("changed", changed)))
    .filter(({ issues }) => issues.length)
    .map(({ scenario }) => scenario);

test("an identical copy passes every scenario", async () => {
  assert.deepEqual(await scenariosFailing(page(base), page(base)), []);
});

const breakages = [
  ["a dropped keyframes rule", (css) => css.replace("@keyframes slide{from{margin-left:0}to{margin-left:100px}}", ""), "motion"],
  ["a changed animation duration", (css) => css.replace("2s infinite", "3s infinite"), "motion"],
  ["a dropped hover rule", (css) => css.replace("a.link:hover{color:rgb(200,0,0)}", ""), "desktop-light"],
  ["a dropped mobile media rule", (css) => css.replace("@media (max-width:500px){h1{font-size:12px}}", ""), "mobile"],
  ["a dropped tablet media rule", (css) => css.replace("@media (min-width:700px) and (max-width:900px){h1{font-size:40px}}", ""), "tablet"],
  ["a dropped dark rule", (css) => css.replace("@media (prefers-color-scheme:dark){body{background:rgb(0,0,0);color:rgb(255,255,255)}}", ""), "desktop-dark"],
  ["a dropped print rule", (css) => css.replace("@media print{.box{display:none}}", ""), "print"],
  ["a changed marker colour", (css) => css.replace("li::marker{color:rgb(255,0,0)}", "li::marker{color:rgb(255,0,1)}"), "desktop-light"],
  ["a changed placeholder colour", (css) => css.replace("input::placeholder{color:rgb(0,128,0)}", "input::placeholder{color:rgb(0,128,1)}"), "desktop-light"],
  ["a dropped reduced-motion rule", (css) => css.replace("@media (prefers-reduced-motion:reduce){h1{letter-spacing:2px}}", ""), "desktop-light"],
  ["a one-unit colour change", (css) => css.replace("rgb(10,20,30)", "rgb(10,20,31)"), "desktop-light"],
];

for (const [name, change, expected] of breakages) {
  test(`${name} is caught in ${expected}`, async () => {
    const failing = await scenariosFailing(page(base), page(change(base)));
    assert.ok(failing.includes(expected), `${failing}`);
  });
}

test("a changed text node is caught", async () => {
  const failing = await scenariosFailing(page(base), page(base, "<h1>Title!</h1>"));
  assert.ok(failing.includes("desktop-light"), `${failing}`);
});

test("a changed layout by a hundredth of a pixel is caught", async () => {
  const failing = await scenariosFailing(page(base + ".t{width:100.00px}", "<div class=t>x</div>"), page(base + ".t{width:100.02px}", "<div class=t>x</div>"));
  assert.ok(failing.length > 0);
});
