import { hardnessPerCost } from "./hardness.mjs";

const markers = {
  slides: /<div class="reveal"|Reveal\.initialize/,
  dashboard: /class="[^"]*quarto-dashboard/,
  mermaid: /class="[^"]*\bmermaid\b[^"]*"/,
  mathjax: /MathJax\.Hub|MathJax-script|window\.MathJax/,
  katex: /class="katex/,
  math: /class="math (?:inline|display)"/,
  navbar: /class="navbar/,
  sidebar: /id="quarto-sidebar/,
  darkToggle: /quarto-color-scheme-toggle|bootstrap-dark/,
  crossRefs: /class="quarto-xref|href="#(?:fig|tbl|sec|eq)-/,
  tabset: /class="panel-tabset/,
  callout: /class="callout/,
  listing: /class="[^"]*quarto-listing/,
  lightbox: /GLightbox|class="[^"]*lightbox/,
  video: /<video\b/,
  iframe: /<iframe\b/,
  search: /id="quarto-search-results|quarto-search-data/,
  citations: /class="citation"|data-cites=/,
  footnotes: /class="footnote-ref|id="fn1/,
  table: /<table\b/,
  toc: /id="TOC"|class="[^"]*toc-/,
};

const sumLengths = (html, pattern) =>
  [...html.matchAll(pattern)].reduce((total, match) => total + (match[1]?.length ?? 0), 0);

const countOf = (text, pattern) => (text.match(pattern) ?? []).length;

const styleText = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");

const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const nestingDepth = (html) => {
  let depth = 0;
  let deepest = 0;
  for (const match of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    if (match[0].startsWith("</")) {
      depth = Math.max(0, depth - 1);
    } else if (!voidElements.has(match[1].toLowerCase()) && !match[0].endsWith("/>")) {
      depth += 1;
      deepest = Math.max(deepest, depth);
    }
  }
  return deepest;
};

export function featuresOf(html) {
  const css = styleText(html);
  return {
    bytes: Buffer.byteLength(html),
    scriptBytes: sumLengths(html, /<script\b[^>]*>([\s\S]*?)<\/script>/gi),
    styleBytes: sumLengths(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi),
    imageBytes: sumLengths(html, /data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)/gi),
    fontBytes: sumLengths(html, /data:(?:application\/(?:x-)?font-?[a-z0-9-]*|font\/[a-z0-9-]+);base64,([A-Za-z0-9+/=]+)/gi),
    svgs: countOf(html, /<svg\b/gi),
    elements: countOf(html, /<[a-z][a-z0-9-]*\b/gi),
    interactive: countOf(html, /<(?:button|input|select|textarea|details|summary|video|audio|canvas)\b/gi),
    scripts: countOf(html, /<script\b/gi),
    inlineHandlers: countOf(html, /\son[a-z]+\s*=/gi),
    images: countOf(html, /<img\b/gi),
    dataUrls: countOf(html, /data:[a-z0-9.+-]+\/[a-z0-9.+-]+/gi),
    fonts: countOf(css, /font-family\s*:/gi),
    fontFaces: countOf(css, /@font-face\b/gi),
    animations: countOf(css, /\banimation(?:-name)?\s*:/gi),
    keyframes: countOf(css, /@(?:-webkit-)?keyframes\b/gi),
    mediaQueries: countOf(css, /@media\b/gi),
    customProperties: countOf(css, /--[a-z0-9-]+\s*:/gi),
    cssRules: countOf(css, /\{/g),
    depth: nestingDepth(html),
    markers: Object.keys(markers).filter((name) => markers[name].test(html)),
  };
}

const dimensions = [
  (f) => Math.log2(1 + f.bytes),
  (f) => Math.log2(1 + f.scriptBytes),
  (f) => Math.log2(1 + f.styleBytes),
  (f) => Math.log2(1 + f.imageBytes),
  (f) => Math.log2(1 + f.fontBytes),
  (f) => Math.log2(1 + f.svgs),
  ...Object.keys(markers).map((name) => (f) => (f.markers.includes(name) ? 4 : 0)),
];

const NEW_GROUP_BONUS = 0.5;
const HARDNESS_SHARE = 0.6;

const byId = (a, b) => a.id.localeCompare(b.id);

export function select(pool, count) {
  if (count >= pool.length) return pool.map((entry) => entry.id).sort();
  const raw = pool.map((entry) => dimensions.map((measure) => measure(entry.features)));
  const scale = dimensions.map((_, at) => Math.max(...raw.map((row) => row[at])) || 1);
  const points = raw.map((row) => row.map((value, at) => value / scale[at]));
  const distance = (a, b) => Math.hypot(...a.map((value, at) => value - b[at]));
  const centroid = points[0].map((_, at) => points.reduce((total, row) => total + row[at], 0) / points.length);
  const order = pool.map((_, at) => at).sort((a, b) => pool[a].id.localeCompare(pool[b].id));
  const nearest = new Array(pool.length).fill(Infinity);
  const groups = new Set();
  const chosen = [];
  let next = order.reduce(
    (best, at) => (distance(points[at], centroid) < distance(points[best], centroid) ? at : best),
    order[0],
  );
  while (chosen.length < count) {
    chosen.push(next);
    groups.add(pool[next].group);
    for (const at of order) nearest[at] = Math.min(nearest[at], distance(points[at], points[next]));
    next = -1;
    let best = -Infinity;
    for (const at of order) {
      if (chosen.includes(at)) continue;
      const score = nearest[at] + (groups.has(pool[at].group) ? 0 : NEW_GROUP_BONUS);
      if (score > best) {
        best = score;
        next = at;
      }
    }
  }
  return chosen.map((at) => pool[at].id);
}

export function selectSmoke(pool, count, pinned = []) {
  const pinnedIds = new Set(pinned);
  const fixed = pool.filter((entry) => pinnedIds.has(entry.id)).sort(byId).slice(0, count);
  const open = pool.filter((entry) => !pinnedIds.has(entry.id));
  const remaining = count - fixed.length;
  if (remaining <= 0) return fixed.map((entry) => entry.id);
  const hardnessSlots = Math.max(0, Math.min(remaining, Math.round(count * HARDNESS_SHARE) - fixed.length));
  const ranked = [...open].sort(
    (a, b) => hardnessPerCost(b.features) - hardnessPerCost(a.features) || byId(a, b),
  );
  const hardest = ranked.slice(0, hardnessSlots);
  const chosen = new Set([...fixed, ...hardest].map((entry) => entry.id));
  const rest = open.filter((entry) => !chosen.has(entry.id));
  return [
    ...fixed.map((entry) => entry.id),
    ...hardest.map((entry) => entry.id),
    ...select(rest, remaining - hardest.length),
  ];
}

export function selectStratified(pool, quotas, pinned = []) {
  return Object.entries(quotas).flatMap(([format, count]) =>
    selectSmoke(
      pool.filter((entry) => entry.format === format),
      count,
      pinned,
    ).map((id, position) => ({ id, format, position })),
  );
}