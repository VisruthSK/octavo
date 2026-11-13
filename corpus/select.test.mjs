import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { COST_CAP, cappedCost, costOf, hardnessOf, hardnessPerCost } from "./hardness.mjs";
import { featuresOf, select, selectSmoke, selectStratified } from "./select.mjs";
import { loadSpecs } from "./specs.mjs";

const entry = (id, group, bytes, extra = {}) => ({
  id,
  group,
  features: {
    bytes,
    scriptBytes: 0,
    styleBytes: 0,
    imageBytes: 0,
    fontBytes: 0,
    svgs: 0,
    elements: 0,
    interactive: 0,
    scripts: 0,
    inlineHandlers: 0,
    images: 0,
    dataUrls: 0,
    fonts: 0,
    fontFaces: 0,
    animations: 0,
    keyframes: 0,
    mediaQueries: 0,
    customProperties: 0,
    cssRules: 0,
    depth: 0,
    markers: [],
    ...extra,
  },
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
    entry("heavy", "a", 5_000_000, { imageBytes: 4_000_000, markers: ["slides", "math"] }),
  ];
  assert.ok(select(pool, 3).includes("heavy"));
});

test("features read the weight of scripts, styles, images and fonts", () => {
  const html =
    '<style>a{}</style><script>1</script><img src="data:image/png;base64,AAAA"><svg></svg><span class="katex"></span>';
  const f = featuresOf(html);
  assert.equal(f.styleBytes, 3);
  assert.equal(f.scriptBytes, 1);
  assert.equal(f.imageBytes, 4);
  assert.equal(f.svgs, 1);
  assert.equal(f.images, 1);
  assert.equal(f.dataUrls, 1);
  assert.equal(f.scripts, 1);
  assert.deepEqual(f.markers, ["katex"]);
});

test("hardness grows with the features that expose bugs", () => {
  const plain = featuresOf("<html><body><p>text</p></body></html>");
  const busy = featuresOf(
    [
      "<html><body>",
      '<div class="reveal"><div class="slides">',
      '<button onclick="go()">go</button><input><select></select><textarea></textarea>',
      '<img src="data:image/png;base64,AAAA"><svg><rect/></svg>',
      "<style>",
      "@font-face{font-family:X;src:url(data:font/woff2;base64,AAAA)}",
      ":root{--a:#000;--b:#fff}@media (min-width: 1px){.a{animation:spin 1s}}@keyframes spin{to{opacity:0}}",
      "body{font-family:X;color:var(--a)}",
      "</style>",
      "<script>window.go=function(){}</script><script>window.go()</script>",
      "</div></div></body></html>",
    ].join(""),
  );
  assert.ok(hardnessOf(busy) > hardnessOf(plain));
  assert.ok(hardnessOf(busy) > hardnessOf(featuresOf('<html><body><p class="katex">x</p></body></html>')));
});

test("the hardest documents take the hardness share first", () => {
  const pool = [
    entry("plain-a", "g1", 1000),
    entry("plain-b", "g2", 1000),
    entry("plain-c", "g3", 1000),
    entry("hard-a", "g4", 1000, { scripts: 5, interactive: 10 }),
    entry("hard-b", "g5", 1000, { scripts: 10, interactive: 20, customProperties: 30 }),
    entry("hard-c", "g6", 1000, { scripts: 20, interactive: 40, customProperties: 60, markers: ["slides"] }),
  ];
  const ranked = [...pool].sort(
    (a, b) => hardnessPerCost(b.features) - hardnessPerCost(a.features) || a.id.localeCompare(b.id),
  );
  assert.deepEqual(selectSmoke(pool, 5).slice(0, 3), ranked.slice(0, 3).map((item) => item.id));
});

test("pinned documents are always selected, whatever their hardness", () => {
  const pool = [
    entry("pinned", "g1", 1000),
    ...Array.from({ length: 10 }, (_, at) => entry(`busy-${at}`, `g${at % 3}`, 1000, { scripts: at + 1 })),
  ];
  assert.ok(selectSmoke(pool, 3, ["pinned"]).includes("pinned"));
  assert.deepEqual(selectSmoke(pool, 3, ["pinned"]), selectSmoke([...pool].reverse(), 3, ["pinned"]));
});

test("each format gets exactly its quota, in selection order", () => {
  const pool = [
    ...Array.from({ length: 20 }, (_, at) => ({ ...entry(`page-${at}`, "a", 1000 * (at + 1)), format: "html" })),
    ...Array.from({ length: 12 }, (_, at) => ({ ...entry(`deck-${at}`, "b", 2000 * (at + 1)), format: "slides" })),
  ];
  const picks = selectStratified(pool, { html: 4, slides: 5 });
  assert.equal(picks.filter((pick) => pick.format === "html").length, 4);
  assert.equal(picks.filter((pick) => pick.format === "slides").length, 5);
  assert.deepEqual(
    picks.filter((pick) => pick.format === "slides").map((pick) => pick.position),
    [0, 1, 2, 3, 4],
  );
});

test("pinned documents count toward their format quota", () => {
  const pool = [
    ...Array.from({ length: 20 }, (_, at) => ({ ...entry(`page-${at}`, "a", 1000 * (at + 1)), format: "html" })),
    ...Array.from({ length: 12 }, (_, at) => ({ ...entry(`deck-${at}`, "b", 2000 * (at + 1)), format: "slides" })),
  ];
  const picks = selectStratified(pool, { html: 4, slides: 5 }, ["page-19", "deck-11"]);
  assert.equal(picks.filter((pick) => pick.format === "html").length, 4);
  assert.equal(picks.filter((pick) => pick.format === "slides").length, 5);
  assert.ok(picks.some((pick) => pick.id === "page-19" && pick.format === "html"));
  assert.ok(picks.some((pick) => pick.id === "deck-11" && pick.format === "slides"));
  assert.deepEqual(picks, selectStratified([...pool].reverse(), { html: 4, slides: 5 }, ["page-19", "deck-11"]));
});

test("the cost cap stops a giant document from buying more slots", () => {
  const giant = entry("giant", "g1", 500_000_000, { elements: 10_000_000, scriptBytes: 50_000_000 });
  const small = entry("small", "g2", 100_000, { scripts: 30, interactive: 40, markers: ["slides"] });
  assert.ok(costOf(giant.features) > COST_CAP);
  assert.equal(cappedCost(giant.features), COST_CAP);
  assert.ok(hardnessPerCost(small.features) > hardnessPerCost(giant.features));
});

test("every pinned document is in the corpus and in the smoke tier", async () => {
  const pinned = JSON.parse(readFileSync(join(import.meta.dirname, "hardest.json"), "utf8"));
  const specs = await loadSpecs();
  const selection = JSON.parse(readFileSync(join(import.meta.dirname, "selection.json"), "utf8"));
  const tiers = new Map([
    ...specs.map((spec) => [spec.id, spec.tier]),
    ...selection.map((item) => [item.id, item.tier]),
  ]);
  for (const id of pinned) {
    assert.ok(tiers.has(id), `${id} is not a corpus document`);
    assert.equal(tiers.get(id), "smoke", `${id} is not in the smoke tier`);
  }
});

test("pinned documents survive a real selection", () => {
  const pinned = JSON.parse(readFileSync(join(import.meta.dirname, "hardest.json"), "utf8"));
  const selection = JSON.parse(readFileSync(join(import.meta.dirname, "selection.json"), "utf8"));
  const [source] = JSON.parse(readFileSync(join(import.meta.dirname, "sources.json"), "utf8"));
  const picks = selectStratified(selection, source.smoke, pinned);
  for (const id of pinned.filter((item) => selection.some((entry) => entry.id === item))) {
    assert.ok(picks.some((pick) => pick.id === id), `${id} was not selected`);
  }
});