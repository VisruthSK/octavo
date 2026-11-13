import test from "node:test";
import assert from "node:assert/strict";
import { captureTimeout, lostConnection, worthRetrying } from "./transient.mjs";

const failure = (message) => new Error(message);

test("a lost browser connection is retried once", () => {
  for (const message of ["Target page, context or browser has been closed", "Browser disconnected", "page crashed"]) {
    assert.equal(lostConnection(failure(message)), true, message);
    assert.equal(worthRetrying(failure(message), 0), true, message);
    assert.equal(worthRetrying(failure(message), 1), false, message);
  }
});

test("a capture timeout is retried once and a second timeout is not", () => {
  const timeout = failure("capture timed out during page observation load after 300000 ms");
  assert.equal(captureTimeout(timeout), true);
  assert.equal(worthRetrying(timeout, 0), true);
  assert.equal(worthRetrying(timeout, 1), false);
});

test("an ordinary failure is never retried", () => {
  for (const message of ["comparison timed out after 660000 ms", "expected a digest", "TypeError: x is undefined"]) {
    assert.equal(worthRetrying(failure(message), 0), false, message);
  }
  assert.equal(worthRetrying(undefined, 0), false);
});
