import assert from "node:assert/strict";
import { test } from "node:test";
import { featuresOf, select } from "./select.mjs";

const entry = (id, group, bytes, extra = {}) => ({
  id,
  group,
  features: { bytes, scriptBytes: 0, styleBytes: 0, imageBytes: 0, fontBytes: 0, svgs: 0, markers: [], ...extra },
});

test("selection is deterministic and returns the requested count", () => {
  const pool = Array.from({ length: 40 }, (_, at) => entry(`doc-${at}`, `g${at % 5}`, 1000 * (at + 1)));
  const first = select(pool, 12);
  assert.deepEqual(first, select([...pool].reverse(), 12));
  assert.equal(new Set(first).size, 12);
});

test("every group is represented once the count allows it", () => {
  const pool = Array.from({ length: 60 }, (_, at) => entry(`doc-${at}`, `g${at % 6}`, 5000 + (at % 3)));
  const chosen = new Set(select(pool, 6));
  assert.equal(new Set(pool.filter((item) => chosen.has(item.id)).map((item) => item.group)).size, 6);
});

test("a very different document is picked early", () => {
  const pool = [
    ...Array.from({ length: 30 }, (_, at) => entry(`plain-${at}`, "a", 10_000 + at)),
    entry("heavy", "a", 5_000_000, { imageBytes: 4_000_000, markers: ["plotly", "math"] }),
  ];
  assert.ok(select(pool, 3).includes("heavy"));
});

test("features read the weight of scripts, styles, images and fonts", () => {
  const html = '<style>a{}</style><script>1</script><img src="data:image/png;base64,AAAA"><svg></svg><p>katex</p>';
  const f = featuresOf(html);
  assert.equal(f.styleBytes, 3);
  assert.equal(f.scriptBytes, 1);
  assert.equal(f.imageBytes, 4);
  assert.equal(f.svgs, 1);
  assert.deepEqual(f.markers, ["math"]);
});
