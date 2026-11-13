import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executableFingerprint } from "./fingerprint.mjs";

const folder = mkdtempSync(join(tmpdir(), "fingerprint-"));
const file = (name, content) => {
  const path = join(folder, name);
  writeFileSync(path, content);
  return path;
};

test("equal content installed at different times has the same fingerprint", () => {
  const first = file("first", "browser-bytes");
  const second = file("second", "browser-bytes");
  utimesSync(second, new Date("2020-01-01"), new Date("2020-01-01"));
  assert.equal(executableFingerprint(first), executableFingerprint(second));
});

test("equal size with different content has a different fingerprint", () => {
  assert.notEqual(executableFingerprint(file("a", "aaaa")), executableFingerprint(file("b", "aaab")));
});

test("different size has a different fingerprint", () => {
  assert.notEqual(executableFingerprint(file("short", "aaaa")), executableFingerprint(file("long", "aaaaa")));
});

test("a missing or empty path is reported as missing", () => {
  assert.equal(executableFingerprint(join(folder, "nothing-here")), "missing");
  assert.equal(executableFingerprint(""), "missing");
});

test("a large file is hashed across several chunks", () => {
  const big = file("big", Buffer.alloc(20 * 1024 * 1024, 7));
  const changed = Buffer.alloc(20 * 1024 * 1024, 7);
  changed[19 * 1024 * 1024] = 8;
  assert.notEqual(executableFingerprint(big), executableFingerprint(file("big-changed", changed)));
});
