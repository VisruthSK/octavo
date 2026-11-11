import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync, brotliCompressSync } from "node:zlib";
import { randomBytes } from "node:crypto";

const loader = readFileSync(new URL("../crates/octavo/loader/loader.js", import.meta.url), "utf8");
const brotliDecoder = readFileSync(new URL("../crates/octavo/loader/brotli.js", import.meta.url), "utf8");
function unpack(texts, codec) {
  const all = texts.join("");
  const bytes = Buffer.from(all, "utf8");
  const payload = `new Uint8Array(${JSON.stringify([...(codec === "brotli" ? brotliCompressSync(bytes) : deflateRawSync(bytes, { level: codec }))])})`;
  const unpackExpression =
    codec === "brotli"
      ? `new Function(${JSON.stringify(brotliDecoder)} + ";return BR.default")()(${payload})`
      : `inflate(${payload}, ${bytes.length})`;
  const source = loader
    .replace("SIZES", () => JSON.stringify(texts.map((t) => t.length)))
    .replace("ALPHABET", () => JSON.stringify("x".repeat(91)))
    .replace("UNPACK", () => unpackExpression);
  const placed = [];
  const written = [];
  const document = {
    currentScript: {
      replaceWith: (e) => placed.push(e),
      remove() {},
      set outerHTML(html) {
        placed.push({ fragment: html });
      },
    },
    createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    write: (html) => written.push(html),
  };
  new Function("self", "document", "TextDecoder", source)(globalThis, document, TextDecoder);
  return (index, kind, attrs) => {
    globalThis.$o(index, kind, attrs);
    return kind === 2 ? written.at(-1) : placed.at(-1);
  };
}

const samples = {
  ascii: "function f(){return 42}\n".repeat(500),
  unicode: "héllo wörld — ✓ 日本語 ".repeat(200),
  astral: "emoji 😀🎉 and 𝒳 math ".repeat(150),
  random: randomBytes(3000).toString("latin1"),
  empty: "",
  short: "x",
};

for (const codec of [0, 1, 6, 9, "brotli"]) {
  test(`restores every blob with codec ${codec}`, () => {
    const texts = Object.values(samples);
    const restore = unpack(texts, codec);
    texts.forEach((expected, i) => {
      const element = restore(i, 0);
      assert.equal(element.textContent, expected, `blob ${i}`);
      assert.equal(element.tag, "script");
    });
  });
}

test("builds style elements with attributes", () => {
  const restore = unpack([".a{color:red}"], 9);
  const style = restore(0, 1, { media: "print" });
  assert.deepEqual([style.tag, style.attrs, style.textContent], ["style", { media: "print" }, ".a{color:red}"]);
});

test("writes stylesheet links as parser-inserted markup with escaped attributes", () => {
  const restore = unpack([".b{color:blue}"], 9);
  const html = restore(0, 2, { rel: "stylesheet", id: 'say "x"' });
  assert.ok(html.startsWith('<link rel="stylesheet" id="say &quot;x&quot;" href="data:text/css;charset=utf-8,'));
  assert.equal(decodeURIComponent(html.split(",")[1].replace(/">$/, "")), ".b{color:blue}");
});

test("restores fragments through outerHTML", () => {
  const svg = '<svg><circle r="1"/></svg>';
  assert.deepEqual(unpack([svg], 9)(0, 3), { fragment: svg });
});

test("a leading byte order mark is preserved so later blobs stay aligned", () => {
  const texts = ["﻿.a{top:0}", "second"];
  const restore = unpack(texts, 9);
  assert.equal(restore(0, 0).textContent, texts[0]);
  assert.equal(restore(1, 0).textContent, "second");
});

test("handles a large mixed payload", () => {
  const big = Array.from({ length: 200000 }, (_, i) => String.fromCharCode(97 + ((i * i) % 26))).join("");
  const restore = unpack([big, samples.unicode], 9);
  assert.equal(restore(0, 0).textContent, big);
  assert.equal(restore(1, 0).textContent, samples.unicode);
});
