import test from "node:test";
import assert from "node:assert/strict";
import { compare, differences, missingFrom } from "./compare.mjs";

const image = (width, height, fill = 200) => ({ width, height, data: new Uint8Array(width * height * 4).fill(fill) });

const nudged = (base, pixels, by) => {
  const copy = { ...base, data: Uint8Array.from(base.data) };
  for (const [x, y] of pixels) for (let c = 0; c < 3; c++) copy.data[(y * base.width + x) * 4 + c] += by;
  return copy;
};

const block = (count) => Array.from({ length: count }, (_, i) => [i, 0]);

test("a difference of one level is rounding and counts as nothing", () => {
  const base = image(40, 4);
  const result = differences(base, nudged(base, block(30), 1));
  assert.equal(result.count, 0);
  assert.equal(result.rounded, 30);
});

test("a few faint pixels are tolerated and still counted", () => {
  const base = image(40, 4);
  const result = differences(base, nudged(base, block(12), 8));
  assert.equal(result.count, 0);
  assert.equal(result.rounded, 12);
});

test("faint pixels beyond the budget fail", () => {
  const base = image(40, 4);
  assert.equal(differences(base, nudged(base, block(13), 8)).count, 13);
});

test("one pixel off by more than eight levels fails", () => {
  const base = image(40, 4);
  assert.equal(differences(base, nudged(base, [[5, 2]], 9)).count, 1);
});

test("a visible difference takes the faint pixels with it", () => {
  const base = image(40, 4);
  const changed = nudged(nudged(base, [[5, 2]], 40), block(3), 2);
  assert.equal(differences(base, changed).count, 4);
});

const up = "background-image:linear-gradient(0deg, rgb(255, 255, 255) 88%, rgb(115, 133, 159) 100%)";
const down = "background-image:linear-gradient(rgb(115, 133, 159) 0%, rgb(255, 255, 255) 12%)";

test("a linear gradient and its mirror image are the same style", () => {
  assert.deepEqual(missingFrom(up, `color:red;${down}`), []);
  assert.deepEqual(missingFrom(down, up), []);
});

test("a gradient with different colours is a difference", () => {
  const other = "background-image:linear-gradient(rgb(115, 133, 159) 0%, rgb(250, 255, 255) 12%)";
  assert.deepEqual(missingFrom(up, other), [up]);
});

test("a gradient mirrored with the wrong stop positions is a difference", () => {
  const wrong = "background-image:linear-gradient(rgb(115, 133, 159) 0%, rgb(255, 255, 255) 20%)";
  assert.deepEqual(missingFrom(up, wrong), [up]);
});

test("a diagonal gradient is compared as written", () => {
  const diagonal = "background-image:linear-gradient(45deg, red 0%, blue 100%)";
  assert.deepEqual(missingFrom(diagonal, diagonal), []);
  assert.deepEqual(missingFrom(diagonal, "background-image:linear-gradient(225deg, blue 0%, red 100%)"), [diagonal]);
});

test("declarations without gradients still compare exactly", () => {
  assert.deepEqual(missingFrom("color:red;width:10px", "width:10px"), ["color:red"]);
});

test("a mirrored gradient makes two style strings the same, an extra declaration does not", async () => {
  const { sameStyle } = await import("./compare.mjs");
  assert.equal(sameStyle(`color:red;${up}`, `${down};color:red`), true);
  assert.equal(sameStyle(`color:red;${up}`, `${down};color:red;width:1px`), false);
});

const state = () => ({ title: "t", accessibility: "a", dom: "d", fonts: [], animations: [], sheets: 1, scroll: [0, 0], labels: [], rects: [], styles: [] });
const captureOf = (requests, errors = []) => ({ states: [state()], errors, requests });
const requestsIssue = (issues) => issues.find((issue) => issue.startsWith("requests:"));

test("requests in a different order do not fail", () => {
  const before = captureOf(["https://a.test/font.woff2", "https://a.test/site.css"]);
  const after = captureOf(["https://a.test/site.css", "https://a.test/font.woff2"]);
  assert.deepEqual(compare(before, after, false), []);
});

test("duplicate requests in a different order do not fail", () => {
  const before = captureOf(["https://a.test/lib.js", "https://a.test/style.css", "https://a.test/lib.js"]);
  const after = captureOf(["https://a.test/lib.js", "https://a.test/lib.js", "https://a.test/style.css"]);
  assert.deepEqual(compare(before, after, false), []);
});

test("a missing request fails even when the order would sort the same", () => {
  const before = captureOf(["https://a.test/a.png", "https://a.test/b.png"]);
  const after = captureOf(["https://a.test/b.png"]);
  assert.ok(requestsIssue(compare(before, after, false)));
});

test("a swapped count of duplicate requests fails", () => {
  const before = captureOf(["https://a.test/lib.js", "https://a.test/lib.js", "https://a.test/style.css"]);
  const after = captureOf(["https://a.test/lib.js", "https://a.test/style.css", "https://a.test/style.css"]);
  assert.ok(requestsIssue(compare(before, after, false)));
});

test("URLs containing commas are compared as whole strings", () => {
  const before = captureOf(["https://a.test/x,y", "https://a.test/z"]);
  const after = captureOf(["https://a.test/x", "https://a.test/y,z"]);
  assert.ok(requestsIssue(compare(before, after, false)));
});

test("an aborted resource in both pages is not a difference", () => {
  const before = captureOf([], ["Failed to load resource: net::ERR_FAILED", "Failed to load resource: net::ERR_FAILED"]);
  const after = captureOf([], []);
  assert.deepEqual(compare(before, after, false), []);
});

test("an extra aborted resource in the optimized page is not a difference", () => {
  const before = captureOf([], ["Failed to load resource: net::ERR_FAILED"]);
  const after = captureOf([], ["Failed to load resource: net::ERR_FAILED", "Failed to load resource: net::ERR_FAILED"]);
  assert.deepEqual(compare(before, after, false), []);
});

test("a real console error still fails alongside an aborted resource", () => {
  const before = captureOf([], ["Failed to load resource: net::ERR_FAILED"]);
  const after = captureOf([], ["Uncaught TypeError: foo is not a function"]);
  assert.ok(compare(before, after, false).some((issue) => issue.startsWith("console errors")));
});

test("a pageerror still fails", () => {
  const before = captureOf([], []);
  const after = captureOf([], ["interaction 3: clicking x failed"]);
  assert.ok(compare(before, after, false).some((issue) => issue.startsWith("console errors")));
});
