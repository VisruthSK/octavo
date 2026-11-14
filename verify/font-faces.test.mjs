import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser, verify } from "./verify.mjs";

after(closeBrowser);

const directory = mkdtempSync(join(tmpdir(), "octavo-faces-"));

const face = (family, weight, style) => ({
  family,
  weight,
  style,
  stretch: "normal",
  unicodeRange: "U+0-10FFFF",
  status: "loaded",
});

const page = (faces) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body><p>text</p><script>
const faces = ${JSON.stringify(faces)};
const list = Object.assign(faces.slice(), { status: "loaded", ready: Promise.resolve() });
Object.defineProperty(document, "fonts", { get: () => list, configurable: true });
</script></body></html>`;

const write = (name, faces) => {
  const file = join(directory, `${name}.html`);
  writeFileSync(file, page(faces));
  return file;
};

const fontIssues = async (original, changed) => {
  const reports = await verify(original, changed, { level: "safe", only: ["desktop-light"] });
  return reports.flatMap(({ issues }) => issues).filter((issue) => issue.startsWith("load: fonts") || issue.includes("fonts "));
};

const regular = face("Sans", "normal", "normal");
const italic = face("Sans", "normal", "italic");
const bold = face("Sans", "600", "normal");

test("the same font face declared twice counts once", async () => {
  const original = write("duplicated", [regular, italic, bold, regular, italic, bold]);
  const changed = write("merged", [regular, italic, bold]);
  assert.deepEqual(await fontIssues(original, changed), []);
});

test("a weight written as normal equals the same weight written as 400", async () => {
  const original = write("word", [regular, italic]);
  const changed = write("number", [face("Sans", "400", "normal"), face("Sans", "400", "italic")]);
  assert.deepEqual(await fontIssues(original, changed), []);
});

test("a face that is really missing is still reported", async () => {
  const original = write("all", [regular, italic, bold]);
  const changed = write("short", [regular, italic]);
  assert.equal((await fontIssues(original, changed)).length > 0, true);
});
