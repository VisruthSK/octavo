import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { engine } from "./engines/index.mjs";
import { scrollbarPseudo } from "./engines/pseudos.mjs";
import { boundMap, canonicalCssValue, canonicalFontFamily, canonicalStyle } from "./styles.mjs";
import { validStyles } from "./style-storage.mjs";

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

const canonicalCache = boundMap(new Map());
const canonical = (declaration) => {
  let cached = canonicalCache.get(declaration);
  if (cached !== undefined) return cached;
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
  const pseudo = ["::before", "::after", "::marker", "::placeholder", "::selection", scrollbarPseudo].find((prefix) => text.startsWith(prefix)) ?? "";
  const colon = text.indexOf(":", pseudo ? 2 : 0);
  if (colon < 0 || text.slice(pseudo.length, colon) === "font-family") {
    canonicalCache.set(declaration, text);
    return text;
  }
  const result = `${text.slice(0, colon + 1)}${canonicalCssValue(text.slice(colon + 1))}`;
  canonicalCache.set(declaration, result);
  return result;
};

export const USED_SIZE_ROUNDING = 1e-4;
const USED_SIZE = /^((?:::?[a-z-]+)?(?:width|height|inline-size|block-size)):(-?\d*\.?\d+)px$/;

const usedSize = (declaration) => {
  const match = declaration.match(USED_SIZE);
  return match ? [match[1], Number(match[2])] : null;
};

const candidateCache = boundMap(new Map());
const getCandidateData = (candidate) => {
  let data = candidateCache.get(candidate);
  if (!data) {
    const declarations = candidate.split(";");
    const present = new Set(declarations.map(canonical));
    const sizes = new Map();
    for (const declaration of declarations) {
      const size = usedSize(declaration);
      if (size) {
        let list = sizes.get(size[0]);
        if (!list) {
          list = [];
          sizes.set(size[0], list);
        }
        list.push(size[1]);
      }
    }
    data = { present, sizes };
    candidateCache.set(candidate, data);
  }
  return data;
};

export const missingFrom = (reference, candidate = "") => {
  if (reference === candidate) return [];
  const { present, sizes } = getCandidateData(candidate);
  return reference.split(";").filter((declaration) => {
    if (present.has(canonical(declaration))) return false;
    const size = usedSize(declaration);
    return !size || !(sizes.get(size[0]) ?? []).some((value) => Math.abs(value - size[1]) < USED_SIZE_ROUNDING);
  });
};

const sameStyleCache = boundMap(new Map());
export const sameStyle = (left, right = "") => {
  if (left === right) return true;
  const key = left < right ? `${left}\0${right}` : `${right}\0${left}`;
  let cached = sameStyleCache.get(key);
  if (cached !== undefined) return cached;
  const result = missingFrom(left, right).length === 0 && missingFrom(right, left).length === 0;
  sameStyleCache.set(key, result);
  return result;
};

export function differences(left, right, tolerance = engine.pixel) {
  if (left === right || left.data === right.data) {
    return { count: 0, rounded: 0, different: 0, max: 0, box: [Infinity, Infinity, -1, -1], anyBox: [Infinity, Infinity, -1, -1], where: "" };
  }
  const leftBuf = Buffer.isBuffer(left.data) ? left.data : Buffer.from(left.data.buffer, left.data.byteOffset, left.data.byteLength);
  const rightBuf = Buffer.isBuffer(right.data) ? right.data : Buffer.from(right.data.buffer, right.data.byteOffset, right.data.byteLength);
  if (leftBuf.equals(rightBuf)) {
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
  let anyMinX = Infinity, anyMinY = Infinity, anyMaxX = -1, anyMaxY = -1;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  let first = "";
  const leftData = left.data;
  const rightData = right.data;
  const width = left.width;
  const height = left.height;
  const canUse32 = left.data.byteOffset % 4 === 0 && right.data.byteOffset % 4 === 0;
  const left32 = canUse32 ? new Uint32Array(left.data.buffer, left.data.byteOffset, width * height) : null;
  const right32 = canUse32 ? new Uint32Array(right.data.buffer, right.data.byteOffset, width * height) : null;
  let at = 0;
  let pixelIndex = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, at += 4, pixelIndex++) {
      if (canUse32 ? left32[pixelIndex] === right32[pixelIndex] : (
        leftData[at] === rightData[at] &&
        leftData[at + 1] === rightData[at + 1] &&
        leftData[at + 2] === rightData[at + 2] &&
        leftData[at + 3] === rightData[at + 3]
      )) {
        continue;
      }
      const d0 = Math.abs(leftData[at] - rightData[at]);
      const d1 = Math.abs(leftData[at + 1] - rightData[at + 1]);
      const d2 = Math.abs(leftData[at + 2] - rightData[at + 2]);
      const d3 = Math.abs(leftData[at + 3] - rightData[at + 3]);
      const worst = Math.max(d0, d1, d2, d3);
      if (worst > 0) {
        different += 1;
        if (worst > max) max = worst;
        if (x < anyMinX) anyMinX = x;
        if (y < anyMinY) anyMinY = y;
        if (x > anyMaxX) anyMaxX = x;
        if (y > anyMaxY) anyMaxY = y;
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
      if (!first) first = `(${x},${y}) rgba(${leftData[at]},${leftData[at + 1]},${leftData[at + 2]},${leftData[at + 3]}) vs rgba(${rightData[at]},${rightData[at + 1]},${rightData[at + 2]},${rightData[at + 3]})`;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const spread = count > 0 || faint.length > budget;
  if (!spread) rounded += faint.length;
  else for (const [x, y, at] of faint) {
    count += 1;
    if (!first) first = `(${x},${y}) rgba(${leftData[at]},${leftData[at + 1]},${leftData[at + 2]},${leftData[at + 3]}) vs rgba(${rightData[at]},${rightData[at + 1]},${rightData[at + 2]},${rightData[at + 3]})`;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
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

function compareImageBytes(a, b, lossy, stats, cache = true) {
  if (a === b || a.equals(b)) return [];
  const left = cache ? getPng(a) : PNG.sync.read(a);
  const right = cache ? getPng(b) : PNG.sync.read(b);
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
const limitDescription = (screenshot) => `${screenshot.width}x${screenshot.height}, ${screenshot.reason ?? "pixels"} limit ${screenshot.limit}`;

function compareScreenshots(a, b, lossy, stats) {
  if (a === b) return [];
  if (screenshotLimit(a) || screenshotLimit(b)) {
    if (!screenshotLimit(a) || !screenshotLimit(b)) {
      const limited = screenshotLimit(a) ? "original" : "optimized";
      const screenshot = screenshotLimit(a) ? a : b;
      return [`page too large for screenshots limit on ${limited}: ${limitDescription(screenshot)}`];
    }
    return a.width === b.width && a.height === b.height && a.limit === b.limit
      ? [`check incomplete: screenshot pixels not compared for page too large for screenshots limit: ${limitDescription(a)}`]
      : [`page too large for screenshots limit differs: original ${limitDescription(a)}, optimized ${limitDescription(b)}`];
  }
  if (a.kind !== "tiles" && b.kind !== "tiles") return compareImageBytes(a, b, lossy, stats);
  if (a.kind !== "tiles" || b.kind !== "tiles") return ["screenshot tile coverage differs"];
  if (a.width !== b.width || a.height !== b.height) return [`screenshot size ${a.width}x${a.height} vs ${b.width}x${b.height}`];
  if (a.tiles.length !== b.tiles.length) return [`screenshot tile count ${a.tiles.length} vs ${b.tiles.length}`];
  if (a.tiles === b.tiles) return [];
  const issues = [];
  for (const [index, left] of a.tiles.entries()) {
    const right = b.tiles[index];
    if (left.x !== right.x || left.y !== right.y || left.width !== right.width || left.height !== right.height) {
      issues.push(`screenshot tile ${index} region differs: ${left.x},${left.y} ${left.width}x${left.height} vs ${right.x},${right.y} ${right.width}x${right.height}`);
      continue;
    }
    if (left.png === right.png || left.png.equals(right.png)) continue;
    issues.push(...compareImageBytes(left.png, right.png, lossy, stats, false).map((issue) => `tile at ${left.x},${left.y}: ${issue}`));
  }
  return issues;
}

function compareState(a, b, lossy, stats) {
  if (a === b) return [];
  if (!validStyles(a) || !validStyles(b)) throw new Error("invalid computed style storage");
  const issues = [];
  if (a.unchanged || b.unchanged) {
    if (a.digest !== b.digest) issues.push("the page changed differently after this interaction");
    return issues;
  }
  if (a.title !== b.title) issues.push(`title [${a.title}] vs [${b.title}]`);
  if (a.accessibility !== b.accessibility) issues.push("accessibility tree differs");
  for (const [i, [name, expected]] of (a.forced ?? []).entries()) {
    const actual = b.forced?.[i]?.[1] ?? "";
    if (!sameStyle(expected, actual)) {
      issues.push(`forced ${name}: ${missingFrom(expected, actual).slice(0, 3).join(" | ")} vs ${missingFrom(actual, expected).slice(0, 3).join(" | ")}`);
    }
  }
  if (a.dom !== b.dom) {
    const at = firstDifference(a.dom, b.dom);
    issues.push(`dom differs at ${at}: [${excerpt(a.dom, at)}] vs [${excerpt(b.dom, at)}]`);
  }
  const fontsA = stableFonts(a.fonts);
  const fontsB = stableFonts(b.fonts);
  if (fontsA.join() !== fontsB.join()) issues.push(`fonts ${fontsA} vs ${fontsB}`);
  if (a.animations.join("\n") !== b.animations.join("\n")) {
    const present = new Set(b.animations);
    const missing = a.animations.filter((animation) => !present.has(animation));
    issues.push(`animations ${a.animations.length} vs ${b.animations.length}, e.g. ${(missing[0] ?? "extra in optimized").slice(0, 160)}`);
  }
  if (a.sheets !== b.sheets) issues.push(`style sheets ${a.sheets} vs ${b.sheets}`);
  if (a.scroll.join() !== b.scroll.join()) issues.push(`scroll size ${a.scroll} vs ${b.scroll}`);
  if (a.labels.length !== b.labels.length) issues.push(`element count ${a.labels.length} vs ${b.labels.length}`);
  const tolerance = lossy ? 1 : 0.01;
  const moved = [];
  if (a.rects !== b.rects) {
    for (let i = 0; i < a.rects.length; i++) {
      const rect = a.rects[i];
      const target = b.rects[i];
      if (!target || !rect.every((n, k) => Math.abs(n - (target[k] ?? Infinity)) <= tolerance)) {
        moved.push(i);
      }
    }
  }
  if (moved.length) {
    const [first] = moved;
    issues.push(`${moved.length} elements laid out differently, e.g. ${a.labels[first]}: [${a.rects[first]}] vs [${b.rects[first]}]`);
  }
  const beforeStyles = a.styles ?? [];
  const afterStyles = b.styles ?? [];
  const styleAt = (state, styles, index) => index >= styles.length ? "" : state.styleValues === undefined ? styles[index] : state.styleValues[styles[index]];
  if (beforeStyles.length !== afterStyles.length) issues.push(`style count ${beforeStyles.length} vs ${afterStyles.length}`);
  const maxStyleLen = Math.max(beforeStyles.length, afterStyles.length);
  const differing = [];
  for (let i = 0; i < maxStyleLen; i++) {
    const before = styleAt(a, beforeStyles, i);
    const after = styleAt(b, afterStyles, i);
    if (before === after && a.writingModes?.[i] === b.writingModes?.[i]) continue;
    if (!sameStyle(canonicalStyle(before, a.writingModes?.[i]), canonicalStyle(after, b.writingModes?.[i]))) {
      differing.push(i);
    }
  }
  if (differing.length) {
    const [first] = differing;
    const before = styleAt(a, beforeStyles, first);
    const after = styleAt(b, afterStyles, first);
    const lost = missingFrom(before, after).slice(0, 3);
    const gained = missingFrom(after, before).slice(0, 3);
    issues.push(`${differing.length} elements with different computed style, e.g. ${a.labels[first] ?? ""}: lost ${JSON.stringify(lost)} gained ${JSON.stringify(gained)}`);
  }
  if (!a.screenshot || !b.screenshot) {
    const missing = [!a.screenshot && "original", !b.screenshot && "optimized"].filter(Boolean);
    const details = [!a.screenshot && a.screenshotError && `original: ${a.screenshotError}`, !b.screenshot && b.screenshotError && `optimized: ${b.screenshotError}`].filter(Boolean);
    issues.push(`screenshot missing in ${missing.join(" and ")} capture${details.length ? ` (${details.join("; ")})` : ""}`);
  } else {
    issues.push(...compareScreenshots(a.screenshot, b.screenshot, lossy, stats));
  }
  return issues;
}

export function compare(before, after, lossy, stats) {
  if (before === after) return [];
  if (before.crashed || after.crashed) return [`crashed: original=${before.crashed ?? "no"} optimized=${after.crashed ?? "no"}`];
  const issues = [];
  if (!before.states.length) issues.push("original produced no states");
  const linked = before.checks?.missingFiles !== undefined || after.checks?.missingFiles !== undefined;
  const countedElsewhere = (error) => linked && MISSING_FILE_ERROR.test(error);
  const beforeErrors = before.errors.filter((error) => !countedElsewhere(error)).sort();
  const afterErrors = after.errors.filter((error) => !countedElsewhere(error)).sort();
  if (JSON.stringify(beforeErrors) !== JSON.stringify(afterErrors)) {
    issues.push(`console errors: ${JSON.stringify(beforeErrors)} vs ${JSON.stringify(afterErrors)}`);
  }
  if (linked) {
    const beforeCount = before.checks?.missingFiles ?? 0;
    const afterCount = after.checks?.missingFiles ?? 0;
    if (afterCount > beforeCount) {
      issues.push(`${afterCount - beforeCount} more missing files on the optimized page`);
    }
  }
  const requestsBefore = significantRequests(before.requests);
  const requestsAfter = significantRequests(after.requests);
  if (requestsBefore.join() !== requestsAfter.join()) issues.push(`requests: ${requestsBefore} vs ${requestsAfter}`);
  if (before.states.length !== after.states.length) issues.push(`state count ${before.states.length} vs ${after.states.length}`);
  for (const [i, state] of before.states.entries()) {
    if (after.states[i]) {
      const found = compareState(state, after.states[i], lossy, stats);
      const popovers = `popovers ${JSON.stringify(state.popovers ?? [])} vs ${JSON.stringify(after.states[i].popovers ?? [])}`;
      issues.push(...found.map((issue) => `${state.label}: ${issue} (${popovers})`));
    }
  }
  return issues;
}

const LAZY_RENDERER_FONT = /^(?:MathJax|KaTeX)_/;

const MISSING_FILE_ERROR = /^Failed to load resource: (?:the server responded with a status of 404|net::ERR_FILE_NOT_FOUND)/;

const stableFonts = (fonts) => fonts.filter((family) => !LAZY_RENDERER_FONT.test(family));

const FONT_FILE = /.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i;

const significantRequests = (requests) => [...new Set(requests.filter((url) => !FONT_FILE.test(url)))].sort();

export const signature = (issue) => issue.replace(/[0-9.]+/g, "#").replace(/\[[^\]]*\]/g, "[]").slice(0, 60);

export { boundMap };
