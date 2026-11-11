import { createHash } from "node:crypto";

export const tiers = ["smoke", "full"];
export const outcomes = ["optimizes", "keeps", "rejects"];
export const rejections = {
  "not-html": "this is not an HTML document",
  "not-self-contained": "the document links to files instead of containing them",
};

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const page = (head = "", body = "") =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Document</title>${head}</head><body>${body}</body></html>`;

export const repeat = (count, make) => Array.from({ length: count }, (_, index) => make(index)).join("");

export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export const digest = (text) => createHash("sha256").update(text).digest("hex");

const fail = (id, message) => {
  throw new Error(`${id}: ${message}`);
};

const checkExpectation = (id, expect) => {
  if (!outcomes.includes(expect?.outcome)) fail(id, `expect.outcome must be one of ${outcomes.join(", ")}`);
  if (expect.outcome === "rejects" && !(expect.error in rejections)) {
    fail(id, `expect.error must be one of ${Object.keys(rejections).join(", ")}`);
  }
  for (const key of ["retains", "removes"]) {
    const values = expect[key] ?? [];
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value === "")) {
      fail(id, `expect.${key} must be a list of non-empty strings`);
    }
    if (values.length && expect.outcome !== "optimizes") fail(id, `expect.${key} only applies to optimizing documents`);
  }
};

export function define(spec) {
  const { id, category, tier, expect, build } = spec;
  if (!identifier.test(id ?? "")) fail(id, "id must be lowercase words joined by hyphens");
  if (!identifier.test(category ?? "")) fail(id, "category must be lowercase words joined by hyphens");
  if (!tiers.includes(tier)) fail(id, `tier must be one of ${tiers.join(", ")}`);
  if (typeof build !== "function") fail(id, "build must be a function returning the document text");
  checkExpectation(id, expect);
  return Object.freeze({ browser: expect.outcome === "optimizes", ...spec });
}

export function render(spec) {
  const html = spec.build();
  if (typeof html !== "string") fail(spec.id, "build must return a string");
  if (digest(spec.build()) !== digest(html)) fail(spec.id, "build is not deterministic");
  return html;
}
