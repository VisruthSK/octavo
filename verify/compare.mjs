import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const SCREENSHOT_TOLERANCE = { exact: 0, lossy: 0.02 };

const excerpt = (text, at) => text.slice(Math.max(0, at - 60), at + 100);
const firstDifference = (a, b) => [...a].findIndex((char, i) => char !== b[i]);
const missingFrom = (reference, candidate = "") => {
  const present = new Set(candidate.split(";"));
  return reference.split(";").filter((declaration) => !present.has(declaration));
};

function compareScreenshots(a, b, lossy) {
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) {
    return [`screenshot size ${left.width}x${left.height} vs ${right.width}x${right.height}`];
  }
  const differing = pixelmatch(left.data, right.data, null, left.width, left.height, {
    threshold: lossy ? 0.1 : 0,
    includeAA: !lossy,
  });
  const limit = lossy ? SCREENSHOT_TOLERANCE.lossy : SCREENSHOT_TOLERANCE.exact;
  return differing / (left.width * left.height) > limit ? [`screenshot: ${differing} pixels differ`] : [];
}

function compareState(a, b, lossy) {
  const issues = [];
  if (a.title !== b.title) issues.push(`title [${a.title}] vs [${b.title}]`);
  if (a.accessibility !== b.accessibility) issues.push("accessibility tree differs");
  for (const [i, [name, expected]] of (a.forced ?? []).entries()) {
    const actual = b.forced?.[i]?.[1] ?? "";
    if (expected !== actual) issues.push(`forced ${name}: ${missingFrom(expected, actual).slice(0, 3).join(" | ")}`);
  }
  if (a.dom !== b.dom) {
    const at = firstDifference(a.dom, b.dom);
    issues.push(`dom differs at ${at}: [${excerpt(a.dom, at)}] vs [${excerpt(b.dom, at)}]`);
  }
  if (a.fonts.join() !== b.fonts.join()) issues.push(`fonts ${a.fonts} vs ${b.fonts}`);
  if (a.animations.join("\n") !== b.animations.join("\n")) {
    const missing = a.animations.filter((animation) => !b.animations.includes(animation));
    issues.push(`animations ${a.animations.length} vs ${b.animations.length}, e.g. ${(missing[0] ?? "extra in optimized").slice(0, 160)}`);
  }
  if (a.sheets !== b.sheets) issues.push(`style sheets ${a.sheets} vs ${b.sheets}`);
  if (a.scroll.join() !== b.scroll.join()) issues.push(`scroll size ${a.scroll} vs ${b.scroll}`);
  if (a.labels.length !== b.labels.length) issues.push(`element count ${a.labels.length} vs ${b.labels.length}`);
  const tolerance = lossy ? 1 : 0.01;
  const moved = a.rects.flatMap((rect, i) =>
    rect.every((n, k) => Math.abs(n - (b.rects[i]?.[k] ?? Infinity)) <= tolerance) ? [] : [i],
  );
  if (moved.length) {
    const [first] = moved;
    issues.push(`${moved.length} elements laid out differently, e.g. ${a.labels[first]}: [${a.rects[first]}] vs [${b.rects[first]}]`);
  }
  const differing = a.styles.flatMap((style, i) => (style === b.styles[i] ? [] : [i]));
  if (differing.length) {
    const [first] = differing;
    const lost = missingFrom(a.styles[first], b.styles[first]).slice(0, 3);
    issues.push(`${differing.length} elements with different computed style, e.g. ${a.labels[first]}: ${lost.join(" | ")}`);
  }
  if (a.screenshot && b.screenshot) issues.push(...compareScreenshots(a.screenshot, b.screenshot, lossy));
  return issues;
}

export function compare(before, after, lossy) {
  if (before.crashed || after.crashed) return [`crashed: original=${before.crashed ?? "no"} optimized=${after.crashed ?? "no"}`];
  const issues = [];
  if (!before.states.length) issues.push("original produced no states");
  if (JSON.stringify(before.errors) !== JSON.stringify(after.errors)) {
    issues.push(`console errors: ${JSON.stringify(before.errors)} vs ${JSON.stringify(after.errors)}`);
  }
  if (before.requests.join() !== after.requests.join()) issues.push(`requests: ${before.requests} vs ${after.requests}`);
  if (before.states.length !== after.states.length) issues.push(`state count ${before.states.length} vs ${after.states.length}`);
  for (const [i, state] of before.states.entries()) {
    if (after.states[i]) issues.push(...compareState(state, after.states[i], lossy).map((issue) => `${state.label}: ${issue}`));
  }
  return issues;
}

export const signature = (issue) => issue.replace(/[0-9.]+/g, "#").replace(/\[[^\]]*\]/g, "[]").slice(0, 60);
