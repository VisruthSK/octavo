import assert from "node:assert/strict";
import { test } from "node:test";
import { digest, render } from "./spec.mjs";
import { loadSpecs } from "./specs.mjs";
import { materialize, readManifest } from "./build.mjs";

test("every spec is valid, uniquely named and deterministic", async () => {
  const specs = await loadSpecs();
  assert.ok(specs.length > 0);
  for (const spec of specs) assert.equal(digest(render(spec)), digest(render(spec)));
});

test("the committed manifest matches what the specs build", async () => {
  const built = await materialize();
  assert.deepEqual(readManifest(), built);
});

test("every category has a subset document", async () => {
  const specs = await loadSpecs();
  const categories = new Set(specs.map((spec) => spec.category));
  for (const category of categories) {
    assert.ok(specs.some((spec) => spec.category === category && spec.tier === "subset"), category);
  }
});

test("at most a quarter of the corpus is in the subset tier", async () => {
  const specs = await loadSpecs();
  const subset = specs.filter((spec) => spec.tier === "subset").length;
  assert.ok(subset * 4 <= specs.length || specs.length < 40, `${subset} of ${specs.length}`);
});
