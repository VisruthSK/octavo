import test from "node:test";
import assert from "node:assert/strict";
import { differences } from "./compare.mjs";

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
  const result = differences(base, nudged(base, block(8), 3));
  assert.equal(result.count, 0);
  assert.equal(result.rounded, 8);
});

test("faint pixels beyond the budget fail", () => {
  const base = image(40, 4);
  assert.equal(differences(base, nudged(base, block(9), 3)).count, 9);
});

test("one pixel off by more than three levels fails", () => {
  const base = image(40, 4);
  assert.equal(differences(base, nudged(base, [[5, 2]], 4)).count, 1);
});

test("a visible difference takes the faint pixels with it", () => {
  const base = image(40, 4);
  const changed = nudged(nudged(base, [[5, 2]], 40), block(3), 2);
  assert.equal(differences(base, changed).count, 4);
});
