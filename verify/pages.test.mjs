import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const load = (pages) =>
  spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("./verify.mjs")'], {
    cwd: import.meta.dirname,
    env: { ...process.env, OCTAVO_PAGES: pages },
    encoding: "utf8",
  });

for (const pages of ["", "0", "-1", "two", "1.5"]) {
  test(`OCTAVO_PAGES="${pages}" is rejected instead of starting an empty pool`, () => {
    const result = load(pages);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /OCTAVO_PAGES must be a positive integer/);
  });
}

test("a positive integer is accepted", () => {
  assert.equal(load("2").status, 0);
});
