import test from "node:test";
import assert from "node:assert/strict";
import { isLinkedFileLoadFailure } from "./linked-artifacts.mjs";

test("a module script blocked by CORS on a file page is an artifact", () => {
  assert.ok(isLinkedFileLoadFailure("Access to script at 'file:///tmp/site/libs/a.js' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: http.", {}));
});

test("a file resource that failed to load is an artifact on both known error codes", () => {
  const location = { url: "file:///tmp/site/libs/a.js" };
  assert.ok(isLinkedFileLoadFailure("Failed to load resource: net::ERR_FAILED", location));
  assert.ok(isLinkedFileLoadFailure("Failed to load resource: net::ERR_FILE_NOT_FOUND", location));
});

test("a failed load of a web resource is not an artifact", () => {
  assert.equal(isLinkedFileLoadFailure("Failed to load resource: net::ERR_FAILED", { url: "https://example.com/a.js" }), false);
  assert.equal(isLinkedFileLoadFailure("Failed to load resource: net::ERR_FAILED", {}), false);
});

test("other console errors are never artifacts", () => {
  assert.equal(isLinkedFileLoadFailure("Uncaught TypeError: x is undefined", { url: "file:///tmp/a.js" }), false);
  assert.equal(isLinkedFileLoadFailure("Failed to load resource: the server responded with a status of 404", { url: "file:///tmp/a.js" }), false);
});
