import assert from "node:assert/strict";
import { test } from "node:test";
import { accountFor, captureDifference, excludedText, parseExcluded } from "./excluded.mjs";

const capture = (states = [], extra = {}) => ({ states, errors: [], requests: [], ...extra });
const state = (overrides = {}) => ({
  label: "load",
  title: "Document",
  dom: "<html><body></body></html>",
  rects: [[1, 2, 3, 4]],
  styles: ["color:red;"],
  labels: ["body"],
  fonts: [],
  animations: [],
  sheets: 1,
  scroll: [100, 200],
  screenshot: Buffer.from("image"),
  ...overrides,
});

test("a capture does not differ from itself", () => {
  assert.equal(captureDifference(capture([state()]), capture([state()])), null);
});

test("a changed layout is reported with its state", () => {
  const difference = captureDifference(capture([state()]), capture([state({ rects: [[1, 2, 3, 5]] })]));
  assert.match(difference, /^load: rects differs/);
});

test("a changed screenshot and a changed state count are reported", () => {
  assert.match(captureDifference(capture([state()]), capture([state({ screenshot: Buffer.from("other") })])), /screenshot differs/);
  assert.match(captureDifference(capture([state()]), capture([state(), state({ label: "interaction 0" })])), /1 states vs 2/);
});

test("different requests and console errors are reported", () => {
  assert.match(captureDifference(capture(), capture([], { requests: ["https://example.com/a.js"] })), /requests/);
  assert.match(captureDifference(capture(), capture([], { errors: ["boom"] })), /console errors/);
});

test("excluded.json is sorted and rejects incomplete or duplicate entries", () => {
  const entries = parseExcluded('[{"id":"b","reason":"needs the network"},{"id":"a","reason":"not self-contained"}]');
  assert.deepEqual(entries.map((entry) => entry.id), ["a", "b"]);
  assert.equal(excludedText(entries), '[\n  {\n    "id": "a",\n    "reason": "not self-contained"\n  },\n  {\n    "id": "b",\n    "reason": "needs the network"\n  }\n]\n');
  assert.throws(() => parseExcluded("{}"), /must be an array/);
  assert.throws(() => parseExcluded('[{"id":"a"}]'), /need an id and a reason/);
  assert.throws(() => parseExcluded('[{"id":"a","reason":"x"},{"id":"a","reason":"y"}]'), /lists a twice/);
});

test("a selected document must be rendered, and cannot also be excluded", () => {
  assert.deepEqual(accountFor(["a", "b"], ["a"], []), { conflicts: [], missing: ["b"] });
  assert.deepEqual(accountFor(["a"], ["a"], ["a"]), { conflicts: ["a"], missing: [] });
  assert.deepEqual(accountFor(["a"], ["a"], ["b"]), { conflicts: [], missing: [] });
});
