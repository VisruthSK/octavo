import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixturesDirectory, loadFixtures, readSelected } from "./projects.mjs";
import { tiers } from "./spec.mjs";
import { loadSpecs } from "./specs.mjs";

const expectationKeys = ["selector", "exists", "count", "countAtMost", "class", "notClass", "attr", "computed", "text", "loaded"];
const executableChunk = /^```+\s*\{\s*(r|python|julia|bash|sh|sql|ojs|observable)\b/im;

const strings = (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry !== "");

test("every project fixture states what it expects", async () => {
  const fixtures = await loadFixtures();
  assert.ok(fixtures.length >= 6, "at least six hand-written projects");
  assert.ok(fixtures.some((fixture) => fixture.tier === "smoke"));
  for (const { id, directory, expect, tier } of fixtures) {
    assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(tiers.includes(tier), `${id}: tier`);
    assert.ok(existsSync(join(directory, "_quarto.yml")), `${id}: _quarto.yml`);
    assert.equal(typeof expect.description, "string", `${id}: description`);
    assert.ok(Number.isInteger(expect.pages) && expect.pages > 0, `${id}: pages`);
    assert.ok(strings(expect.files ?? []), `${id}: files`);
    assert.ok(strings(expect.prune?.removed ?? []) && strings(expect.prune?.kept ?? []), `${id}: prune`);
    assert.ok(strings(expect.site?.present ?? []) && strings(expect.site?.absent ?? []), `${id}: site`);
    if (expect.search) assert.ok(strings(expect.search.found) && strings(expect.search.absent), `${id}: search`);
    for (const interaction of expect.interactions ?? []) {
      assert.equal(typeof interaction.name, "string", `${id}: interaction name`);
      assert.match(interaction.page, /\.html$/, `${id}: ${interaction.name}: page`);
      assert.ok(Array.isArray(interaction.steps) && interaction.steps.every((step) => typeof step.click === "string"), `${id}: ${interaction.name}: steps`);
      assert.ok(interaction.expect.length > 0, `${id}: ${interaction.name}: expect`);
      for (const check of interaction.expect) {
        assert.equal(typeof check.selector, "string");
        assert.ok(Object.keys(check).every((key) => expectationKeys.includes(key)), `${id}: ${interaction.name}: unknown key`);
        assert.ok(Object.keys(check).length > 1, `${id}: ${interaction.name}: ${check.selector} asserts nothing`);
      }
    }
  }
});

test("the project fixtures need no engine, filter or extension", async () => {
  for (const { id, directory } of await loadFixtures()) {
    const config = readFileSync(join(directory, "_quarto.yml"), "utf8");
    assert.ok(!/^\s*(pre-render|post-render|filters|engine|jupyter|knitr)\s*:/m.test(config), `${id}: config`);
    assert.ok(!existsSync(join(directory, "_extensions")), `${id}: extensions`);
    const sources = [...config.matchAll(/[\w./-]+\.qmd/g)].map((match) => match[0]);
    for (const source of sources) {
      assert.ok(existsSync(join(directory, source)), `${id}: ${source} is listed but missing`);
      assert.ok(!executableChunk.test(readFileSync(join(directory, source), "utf8")), `${id}: ${source} runs code`);
    }
  }
});

test("the hand-written projects cover the hard cases", async () => {
  const text = (await loadFixtures()).map(({ directory }) => readFileSync(join(directory, "_quarto.yml"), "utf8")).join("\n");
  for (const feature of [/type:\s*book/, /type:\s*website/, /search:/, /sidebar:/, /navbar:/, /dark:/, /resources:/, /css:/]) {
    assert.match(text, feature);
  }
  const names = (await loadFixtures()).map((fixture) => fixture.id);
  for (const name of ["site-full", "book-appendix", "site-custom-assets", "blog-categories", "site-deep-nesting", "listing-grid-images"]) {
    assert.ok(names.includes(name), name);
  }
});

test("the selected upstream projects are valid and the smoke ones are small and local", () => {
  const selected = readSelected();
  assert.ok(selected.length >= 20, `${selected.length} selected projects`);
  assert.equal(new Set(selected.map((entry) => entry.id)).size, selected.length);
  for (const entry of selected) {
    assert.ok(tiers.includes(entry.tier), `${entry.id}: tier`);
    assert.ok(entry.pages >= 1 && entry.sources >= 3, `${entry.id}: size`);
    assert.equal(typeof entry.remote, "boolean", `${entry.id}: remote`);
  }
  const smoke = selected.filter((entry) => entry.tier === "smoke");
  assert.ok(smoke.length >= 4 && smoke.length <= 8, `${smoke.length} smoke projects`);
  for (const entry of smoke) assert.ok(!entry.remote && entry.pages <= 10, `${entry.id}: smoke projects stay local and small`);
});

test("the linking fixtures include files that ship and files that are missing", async () => {
  const linking = (await loadSpecs()).filter((spec) => spec.category === "linking");
  assert.ok(linking.filter((spec) => spec.expect.outcome === "optimizes").length >= 10);
  assert.ok(linking.filter((spec) => spec.expect.outcome === "rejects").length >= 3);
  for (const spec of linking.filter((entry) => entry.expect.outcome === "optimizes")) assert.ok(spec.linked, `${spec.id} ships its files`);
  assert.ok(linking.some((spec) => spec.tier === "smoke"));
});

test("the fixtures directory exists", () => {
  assert.ok(existsSync(fixturesDirectory));
});
