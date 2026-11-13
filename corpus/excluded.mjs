import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const excludedPath = join(import.meta.dirname, "excluded.json");

const isEntry = (entry) => entry && typeof entry.id === "string" && entry.id !== "" && typeof entry.reason === "string" && entry.reason !== "";

export function parseExcluded(text) {
  const entries = JSON.parse(text);
  if (!Array.isArray(entries)) throw new Error("excluded.json must be an array");
  const seen = new Set();
  for (const entry of entries) {
    if (!isEntry(entry)) throw new Error("excluded.json entries need an id and a reason");
    if (seen.has(entry.id)) throw new Error(`excluded.json lists ${entry.id} twice`);
    seen.add(entry.id);
  }
  return [...entries].sort((a, b) => a.id.localeCompare(b.id));
}

export const readExcluded = (path = excludedPath) => (existsSync(path) ? parseExcluded(readFileSync(path, "utf8")) : []);

export const excludedText = (entries) => `${JSON.stringify([...entries].sort((a, b) => a.id.localeCompare(b.id)), null, 2)}\n`;

export const writeExcluded = (entries, path = excludedPath) => writeFileSync(path, excludedText(entries));

const same = (left, right) => {
  if (Buffer.isBuffer(left) || Buffer.isBuffer(right)) return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right);
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, at) => same(value, right[at]));
  if (left && right && typeof left === "object" && typeof right === "object") {
    const names = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...names].every((name) => same(left[name], right[name]));
  }
  return Object.is(left, right);
};

export function captureDifference(before, after) {
  if (before.crashed || after.crashed) return `crashed: ${before.crashed ?? "no"} vs ${after.crashed ?? "no"}`;
  if (!same(before.errors, after.errors)) return `console errors ${JSON.stringify(before.errors)} vs ${JSON.stringify(after.errors)}`;
  if (!same(before.requests, after.requests)) return `requests ${JSON.stringify(before.requests)} vs ${JSON.stringify(after.requests)}`;
  if (before.states.length !== after.states.length) return `${before.states.length} states vs ${after.states.length}`;
  for (const [at, state] of before.states.entries()) {
    const other = after.states[at];
    if (state.label !== other.label) return `state ${at} is ${state.label} vs ${other.label}`;
    const names = new Set([...Object.keys(state), ...Object.keys(other)]);
    for (const name of names) if (name !== "label" && !same(state[name], other[name])) return `${state.label}: ${name} differs`;
  }
  return null;
}

export function accountFor(selection, rendered, excluded) {
  const selected = new Set(selection);
  const written = new Set(rendered);
  const dropped = new Set(excluded);
  return {
    conflicts: [...selected].filter((id) => dropped.has(id)).sort(),
    missing: [...selected].filter((id) => !written.has(id) && !dropped.has(id)).sort(),
  };
}
