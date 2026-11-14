import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureKey, cachedCapture, directory, payloadOf, readCapture, writeCapture } from "./capture-cache.mjs";
import { SCENARIOS, capture } from "./capture.mjs";
import { launch } from "./engines/index.mjs";

const browser = await launch();
after(() => browser.close());

const folder = mkdtempSync(join(tmpdir(), "octavo-captures-"));
const scenario = SCENARIOS["desktop-light"];
const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>body{margin:8px;font:16px sans-serif}h1{color:rgb(10,20,30)}</style></head><body><h1>Title</h1><p>one</p><a href="#x">link</a></body></html>';
const file = join(folder, "page.html");
writeFileSync(file, html);

const parts = {
  original: readFileSync(file),
  scenario: scenario.name,
  engine: "Browser A 140.0.0.1 stamp=1",
  verifier: "a".repeat(64),
  interactions: JSON.stringify({ interact: true, linked: false, lossy: false, patient: false }),
};
const key = captureKey(parts);
const fresh = () => capture(browser, file, scenario, false, { interact: true });

test("a hit equals a fresh capture", async () => {
  assert.equal(readCapture(key, folder), null);
  const first = await cachedCapture({ key, folder, capture: fresh });
  assert.equal(first.cached, false);
  assert.ok(existsSync(join(folder, `${key}.json.br`)));
  const second = await cachedCapture({
    key,
    folder,
    capture: () => {
      throw new Error("the cache must not capture again");
    },
  });
  assert.equal(second.cached, true);
  assert.deepEqual(payloadOf(second.result), payloadOf(first.result));
  assert.equal(second.result.base.states[0], second.result.states[0]);
  assert.equal(second.result.states[0].screenshot.equals(first.result.states[0].screenshot), true);
});

test("a changed document, scenario, engine, verifier or interaction misses", () => {
  assert.notEqual(captureKey({ ...parts, original: Buffer.from(`${html}<!-- x -->`) }), key);
  assert.notEqual(captureKey({ ...parts, scenario: "mobile" }), key);
  assert.notEqual(captureKey({ ...parts, engine: "Browser A 140.0.0.1 stamp=2" }), key);
  assert.notEqual(captureKey({ ...parts, verifier: "b".repeat(64) }), key);
  assert.notEqual(captureKey({ ...parts, interactions: JSON.stringify({ interact: false }) }), key);
  assert.equal(captureKey({ ...parts, original: readFileSync(file) }), key);
});

test("a changed scenario misses and captures again", async () => {
  let calls = 0;
  const changed = captureKey({ ...parts, scenario: "tablet" });
  const outcome = await cachedCapture({
    key: changed,
    folder,
    capture: async () => {
      calls += 1;
      return fresh();
    },
  });
  assert.equal(calls, 1);
  assert.equal(outcome.cached, false);
});

test("a corrupted cache file is ignored and recaptured", async () => {
  const corrupted = join(folder, `${key}.json.br`);
  writeFileSync(corrupted, "not a capture");
  assert.equal(readCapture(key, folder), null);
  let calls = 0;
  const outcome = await cachedCapture({
    key,
    folder,
    capture: async () => {
      calls += 1;
      return fresh();
    },
  });
  assert.equal(calls, 1);
  assert.equal(outcome.cached, false);
  assert.deepEqual(readCapture(key, folder).states.length, 1);
});

test("a capture without every screenshot is not cached", async () => {
  const missing = captureKey({ ...parts, scenario: "motion" });
  let calls = 0;
  const degraded = {
    states: [{ label: "load", screenshot: null }],
    errors: [],
    requests: [],
    checks: { screenshots: { taken: 0, total: 1, limits: [] } },
  };
  const outcome = await cachedCapture({
    key: missing,
    folder,
    capture: async () => {
      calls += 1;
      return degraded;
    },
  });
  assert.equal(outcome.cached, false);
  assert.equal(readCapture(missing, folder), null);
  const again = await cachedCapture({
    key: missing,
    folder,
    capture: async () => {
      calls += 1;
      return degraded;
    },
  });
  assert.equal(again.cached, false);
  assert.equal(calls, 2);
});

test("a capture that never settled is not cached", async () => {
  const unsettled = captureKey({ ...parts, scenario: "desktop-dark" });
  const state = { label: "load", screenshot: null };
  const result = (settled) => ({ states: [state], errors: [], requests: [], checks: { settled, screenshots: { taken: 0, total: 0, limits: [] } } });
  const outcome = await cachedCapture({ key: unsettled, folder, capture: async () => result(false) });
  assert.equal(outcome.cached, false);
  assert.equal(readCapture(unsettled, folder), null);
  await cachedCapture({ key: unsettled, folder, capture: async () => result(true) });
  assert.deepEqual(readCapture(unsettled, folder).checks.settled, true);
});

test("a capture that fetched from the network is not cached", async () => {
  const remote = join(folder, "remote.html");
  writeFileSync(remote, '<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><script src="http://127.0.0.1:9/x.js"></script></head><body><p>one</p></body></html>');
  const key = captureKey({ ...parts, original: readFileSync(remote) });
  const outcome = await cachedCapture({ key, folder, capture: () => capture(browser, remote, scenario, false, { interact: true }) });
  assert.equal(outcome.cached, false);
  assert.deepEqual(outcome.result.requests, ["http://127.0.0.1:9/x.js"]);
  assert.equal(readCapture(key, folder), null);
  assert.deepEqual((await fresh()).requests, []);
});

test("a linked verification ignores the capture cache", async () => {
  process.env.OCTAVO_PAGES ??= "2";
  const { closeBrowser, verifyLevels } = await import("./verify.mjs");
  try {
    const linked = join(folder, "linked.html");
    writeFileSync(linked, html);
    const { timing } = await verifyLevels(linked, [{ level: "scripts", path: linked, only: ["desktop-light"] }], {
      captureCache: true,
      linked: true,
    });
    assert.deepEqual(timing.captureCache, { hits: 0, misses: 0 });
  } finally {
    await closeBrowser();
  }
});

test("a mismatched key in the file is ignored", async () => {
  const other = captureKey({ ...parts, scenario: "print" });
  writeCapture(other, await fresh(), folder);
  writeFileSync(join(folder, `${key}.json.br`), readFileSync(join(folder, `${other}.json.br`)));
  assert.equal(readCapture(key, folder), null);
  assert.match(directory, /corpus[\\/]\.cache[\\/]captures$/);
});
