import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { engine } from "./engines/index.mjs";
import { canonicalCssValue, canonicalFontFamily, canonicalStyle } from "./styles.mjs";

const SCREENSHOT_TOLERANCE = { lossy: 0.02 };

const excerpt = (text, at) => text.slice(Math.max(0, at - 60), at + 100);
const firstDifference = (a, b) => {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return i;
  }
  return a.length !== b.length ? len : -1;
};
const closing = (text, open) => {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === "(") depth += 1;
    else if (text[at] === ")" && --depth === 0) return at;
  }
  return -1;
};

const splitArguments = (text) => {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "(") depth += 1;
    else if (text[at] === ")") depth -= 1;
    else if (text[at] === "," && depth === 0) {
      parts.push(text.slice(from, at).trim());
      from = at + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts;
};

const trimmed = (number) => String(Number(number.toFixed(4)));

function canonicalGradient(body) {
  const parts = splitArguments(body);
  const direction = /^-?[\d.]+deg$/.test(parts[0]) ? parts.shift() : null;
  const angle = (((direction ? parseFloat(direction) : 180) % 360) + 360) % 360;
  const stops = parts.map((part) => part.match(/^(.*\S)\s+(-?[\d.]+)%$/));
  if (stops.some((stop) => !stop) || (angle !== 0 && angle !== 180)) return null;
  const placed = stops.map(([, color, position]) => [color, parseFloat(position)]);
  const upright = angle === 0 ? placed.map(([color, position]) => [color, 100 - position]).reverse() : placed;
  return `linear-gradient(180deg,${upright.map(([color, position]) => `${color} ${trimmed(position)}%`).join(",")})`;
}

const unquotedFamilies = (declaration) =>
  declaration.replace(/font-family:(.*)$/, (_, value) => `font-family:${value.split(",").map(canonicalFontFamily).join(", ")}`);

const canonical = (declaration) => {
  let text = unquotedFamilies(declaration);
  const marker = "linear-gradient(";
  const start = text.indexOf(marker);
  if (start >= 0) {
    const open = start + marker.length - 1;
    const end = closing(text, open);
    if (end >= 0) {
      const replaced = canonicalGradient(text.slice(open + 1, end));
      if (replaced) text = text.slice(0, start) + replaced + text.slice(end + 1);
    }
  }
  const pseudo = ["::before", "::after", "::marker", "::placeholder"].find((prefix) => text.startsWith(prefix)) ?? "";
  const colon = text.indexOf(":", pseudo ? 2 : 0);
  if (colon < 0 || text.slice(pseudo.length, colon) === "font-family") return text;
  return `${text.slice(0, colon + 1)}${canonicalCssValue(text.slice(colon + 1))}`;
};

export const sameStyle = (left, right = "") =>
  left === right || (missingFrom(left, right).length === 0 && missingFrom(right, left).length === 0);

export const missingFrom = (reference, candidate = "") => {
  const present = new Set(candidate.split(";").map(canonical));
  return reference.split(";").filter((declaration) => !present.has(canonical(declaration)));
};

export function differences(left, right, tolerance = engine.pixel) {
  if (Buffer.from(left.data.buffer, left.data.byteOffset, left.data.byteLength).equals(Buffer.from(right.data.buffer, right.data.byteOffset, right.data.byteLength))) {
    return { count: 0, rounded: 0, different: 0, max: 0, box: [Infinity, Infinity, -1, -1], anyBox: [Infinity, Infinity, -1, -1], where: "" };
  }
  const rounding = tolerance.channel;
  const faintLevels = tolerance.faint;
  const budget = tolerance.budget;
  let count = 0;
  let rounded = 0;
  let different = 0;
  let max = 0;
  const faint = [];
  let [anyMinX, anyMinY, anyMaxX, anyMaxY] = [Infinity, Infinity, -1, -1];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -1, -1];
  let first = "";
  for (let y = 0; y < left.height; y++) {
    for (let x = 0; x < left.width; x++) {
      const at = (y * left.width + x) * 4;
      const worst = Math.max(
        Math.abs(left.data[at] - right.data[at]),
        Math.abs(left.data[at + 1] - right.data[at + 1]),
        Math.abs(left.data[at + 2] - right.data[at + 2]),
        Math.abs(left.data[at + 3] - right.data[at + 3]),
      );
      if (worst > 0) {
        different += 1;
        max = Math.max(max, worst);
        [anyMinX, anyMinY, anyMaxX, anyMaxY] = [Math.min(anyMinX, x), Math.min(anyMinY, y), Math.max(anyMaxX, x), Math.max(anyMaxY, y)];
      }
      if (worst <= rounding) {
        if (worst > 0) rounded += 1;
        continue;
      }
      if (worst <= faintLevels) {
        faint.push([x, y, at]);
        continue;
      }
      count += 1;
      first ||= `(${x},${y}) rgba(${left.data.subarray(at, at + 4).join(",")}) vs rgba(${right.data.subarray(at, at + 4).join(",")})`;
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  const spread = count > 0 || faint.length > budget;
  if (!spread) rounded += faint.length;
  else for (const [x, y, at] of faint) {
    count += 1;
    first ||= `(${x},${y}) rgba(${left.data.subarray(at, at + 4).join(",")}) vs rgba(${right.data.subarray(at, at + 4).join(",")})`;
    [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
  }
  return { count, rounded, different, max, box: [minX, minY, maxX, maxY], anyBox: [anyMinX, anyMinY, anyMaxX, anyMaxY], where: count ? `, within x ${minX}-${maxX} y ${minY}-${maxY}, first ${first}` : "" };
}

const decodedPng = new WeakMap();
const getPng = (buf) => {
  let png = decodedPng.get(buf);
  if (!png) {
    png = PNG.sync.read(buf);
    decodedPng.set(buf, png);
  }
  return png;
};

function compareImageBytes(a, b, lossy, stats) {
  if (a.equals(b)) return [];
  const left = getPng(a);
  const right = getPng(b);
  if (left.width !== right.width || left.height !== right.height) {
    return [`screenshot size ${left.width}x${left.height} vs ${right.width}x${right.height}`];
  }
  if (lossy) {
    const differing = pixelmatch(left.data, right.data, null, left.width, left.height, { threshold: 0.1 });
    return differing / (left.width * left.height) > SCREENSHOT_TOLERANCE.lossy ? [`screenshot: ${differing} pixels differ`] : [];
  }
  const { count, rounded, where } = differences(left, right);
  if (stats) stats.roundedPixels += rounded;
  return count ? [`screenshot: ${count} pixels differ by more than ${engine.pixel.channel}${where}`] : [];
}

const screenshotLimit = (screenshot) => screenshot?.kind === "limit";
const limitDescription = (screenshot) => `${screenshot.width}x${screenshot.height} at ${screenshot.limit} pixels`;

function compareScreenshots(a, b, lossy, stats) {
  if (screenshotLimit(a) || screenshotLimit(b)) {
    if (!screenshotLimit(a) || !screenshotLimit(b)) {
      const limited = screenshotLimit(a) ? "original" : "optimized";
      const screenshot = screenshotLimit(a) ? a : b;
      return [`page too large for screenshots limit on ${limited}: ${limitDescription(screenshot)}`];
    }
    return a.width === b.width && a.height === b.height && a.limit === b.limit
      ? []
      : [`page too large for screenshots limit differs: original ${limitDescription(a)}, optimized ${limitDescription(b)}`];
  }
  if (a.kind !== "tiles" && b.kind !== "tiles") return compareImageBytes(a, b, lossy, stats);
  if (a.kind !== "tiles" || b.kind !== "tiles") return ["screenshot tile coverage differs"];
  if (a.width !== b.width || a.height !== b.height) return [`screenshot size ${a.width}x${a.height} vs ${b.width}x${b.height}`];
  if (a.tiles.length !== b.tiles.length) return [`screenshot tile count ${a.tiles.length} vs ${b.tiles.length}`];
  const issues = [];
  for (const [index, left] of a.tiles.entries()) {
    const right = b.tiles[index];
    if (left.x !== right.x || left.y !== right.y || left.width !== right.width || left.height !== right.height) {
      issues.push(`screenshot tile ${index} region differs: ${left.x},${left.y} ${left.width}x${left.height} vs ${right.x},${right.y} ${right.width}x${right.height}`);
      continue;
    }
    issues.push(...compareImageBytes(left.png, right.png, lossy, stats).map((issue) => `tile at ${left.x},${left.y}: ${issue}`));
  }
  return issues;
}

function compareState(a, b, lossy, stats) {
  const issues = [];
  if (a.unchanged || b.unchanged) {
    if (a.digest !== b.digest) issues.push("the page changed differently after this interaction");
    return issues;
  }
  if (a.title !== b.title) issues.push(`title [${a.title}] vs [${b.title}]`);
  if (a.accessibility !== b.accessibility) issues.push("accessibility tree differs");
  for (const [i, [name, expected]] of (a.forced ?? []).entries()) {
    const actual = b.forced?.[i]?.[1] ?? "";
    if (!sameStyle(expected, actual)) issues.push(`forced ${name}: ${missingFrom(expected, actual).slice(0, 3).join(" | ")}`);
  }
  if (a.dom !== b.dom) {
    const at = firstDifference(a.dom, b.dom);
    issues.push(`dom differs at ${at}: [${excerpt(a.dom, at)}] vs [${excerpt(b.dom, at)}]`);
  }
  if (a.fonts.join() !== b.fonts.join()) issues.push(`fonts ${a.fonts} vs ${b.fonts}`);
  if (a.animations.join("\n") !== b.animations.join("\n")) {
    const present = new Set(b.animations);
    const missing = a.animations.filter((animation) => !present.has(animation));
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
  const beforeStyles = a.styles ?? [];
  const afterStyles = b.styles ?? [];
  if (beforeStyles.length !== afterStyles.length) issues.push(`style count ${beforeStyles.length} vs ${afterStyles.length}`);
  const differing = Array.from({ length: Math.max(beforeStyles.length, afterStyles.length) }, (_, i) => i).filter((i) =>
    !sameStyle(canonicalStyle(beforeStyles[i] ?? "", a.writingModes?.[i]), canonicalStyle(afterStyles[i] ?? "", b.writingModes?.[i])),
  );
  if (differing.length) {
    const [first] = differing;
    const before = beforeStyles[first] ?? "";
    const after = afterStyles[first] ?? "";
    const lost = missingFrom(before, after).slice(0, 3);
    const gained = missingFrom(after, before).slice(0, 3);
    issues.push(`${differing.length} elements with different computed style, e.g. ${a.labels[first] ?? ""}: lost ${JSON.stringify(lost)} gained ${JSON.stringify(gained)}`);
  }
  if (!a.screenshot || !b.screenshot) {
    const missing = [!a.screenshot && "original", !b.screenshot && "optimized"].filter(Boolean);
    issues.push(`screenshot missing in ${missing.join(" and ")} capture`);
  } else {
    issues.push(...compareScreenshots(a.screenshot, b.screenshot, lossy, stats));
  }
  return issues;
}

export function compare(before, after, lossy, stats) {
  if (before.crashed || after.crashed) return [`crashed: original=${before.crashed ?? "no"} optimized=${after.crashed ?? "no"}`];
  const issues = [];
  if (!before.states.length) issues.push("original produced no states");
  if (JSON.stringify(before.errors) !== JSON.stringify(after.errors)) {
    issues.push(`console errors: ${JSON.stringify(before.errors)} vs ${JSON.stringify(after.errors)}`);
  }
  if (before.requests.join() !== after.requests.join()) issues.push(`requests: ${before.requests} vs ${after.requests}`);
  if (before.states.length !== after.states.length) issues.push(`state count ${before.states.length} vs ${after.states.length}`);
  for (const [i, state] of before.states.entries()) {
    if (after.states[i]) issues.push(...compareState(state, after.states[i], lossy, stats).map((issue) => `${state.label}: ${issue}`));
  }
  return issues;
}

export const signature = (issue) => issue.replace(/[0-9.]+/g, "#").replace(/\[[^\]]*\]/g, "[]").slice(0, 60);
