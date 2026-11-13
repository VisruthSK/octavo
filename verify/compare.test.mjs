import test from "node:test";
import assert from "node:assert/strict";
import { differences, missingFrom } from "./compare.mjs";
import { canonicalFontFamily, canonicalStyle } from "./styles.mjs";

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

test("a font family with its quotes removed is the same style", () => {
  const quoted = "font-family:SFMono-Regular, Menlo, \"Liberation Mono\", \"Courier New\", monospace";
  const bare = "font-family:SFMono-Regular, Menlo, Liberation Mono, Courier New, monospace";
  assert.deepEqual(missingFrom(quoted, bare), []);
  assert.deepEqual(missingFrom(bare, quoted), []);
  assert.deepEqual(missingFrom("font-family:Menlo, monospace", "font-family:monospace"), ["font-family:Menlo, monospace"]);
});

test("a quoted keyword or a name that needs its quotes is not the unquoted one", () => {
  assert.deepEqual(missingFrom('font-family:"serif"', "font-family:serif"), ['font-family:"serif"']);
  assert.deepEqual(missingFrom('font-family:"Monospace", Menlo', "font-family:monospace, Menlo"), ['font-family:"Monospace", Menlo']);
  assert.deepEqual(missingFrom('font-family:"1Face"', "font-family:1Face"), ['font-family:"1Face"']);
  assert.deepEqual(missingFrom("font-family:'Fira Sans', serif", 'font-family:"Fira Sans", serif'), []);
});

test("font fallback order remains significant", () => {
  assert.deepEqual(missingFrom("font-family:Arial, serif", "font-family:serif, Arial"), ["font-family:Arial, serif"]);
});

test("loaded font-family serialization normalizes only syntactic quotes and keeps case", () => {
  assert.equal(canonicalFontFamily('"Source Sans Pro"'), "Source Sans Pro");
  assert.equal(canonicalFontFamily('"serif"'), '"serif"');
  assert.notEqual(canonicalFontFamily('"Arial"'), canonicalFontFamily("arial"));
});

test("horizontal inline size matches width only at the same resolved value", () => {
  assert.deepEqual(missingFrom(canonicalStyle("inline-size:33.333332%"), canonicalStyle("width:33.333332%")), []);
  assert.deepEqual(missingFrom(canonicalStyle("inline-size:33.333332%"), canonicalStyle("width:34%")), ["width:33.333332%"]);
  assert.deepEqual(missingFrom("width:33.333332%", canonicalStyle(undefined)), ["width:33.333332%"]);
  assert.deepEqual(
    missingFrom(canonicalStyle("width:33.333332%;inline-size:33.333328%"), canonicalStyle("width:33.333332%")),
    [],
  );
});

test("vertical inline size resolves to height and remains distinct from width", () => {
  const inline = canonicalStyle("inline-size:40px", "vertical-rl");
  assert.deepEqual(missingFrom(inline, canonicalStyle("height:40px", "vertical-rl")), []);
  assert.deepEqual(missingFrom(inline, canonicalStyle("width:40px", "vertical-rl")), ["height:40px"]);
});

test("quotes elsewhere in a declaration still matter", () => {
  assert.deepEqual(missingFrom('content:"a"', "content:a"), ['content:"a"']);
});

test("declarations without gradients still compare exactly", () => {
  assert.deepEqual(missingFrom("color:red;width:10px", "width:10px"), ["color:red"]);
});

test("a mirrored gradient makes two style strings the same, an extra declaration does not", async () => {
  const { sameStyle } = await import("./compare.mjs");
  assert.equal(sameStyle(`color:red;${up}`, `${down};color:red`), true);
  assert.equal(sameStyle(`color:red;${up}`, `${down};color:red;width:1px`), false);
});
