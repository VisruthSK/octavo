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

const sumLengths = (html, pattern) => [...html.matchAll(pattern)].reduce((total, match) => total + (match[1]?.length ?? 0), 0);

export function featuresOf(html) {
  return {
    bytes: Buffer.byteLength(html),
    scriptBytes: sumLengths(html, /<script\b[^>]*>([\s\S]*?)<\/script>/gi),
    styleBytes: sumLengths(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi),
    imageBytes: sumLengths(html, /data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)/gi),
    fontBytes: sumLengths(html, /data:(?:application\/(?:x-)?font-?[a-z0-9-]*|font\/[a-z0-9-]+);base64,([A-Za-z0-9+/=]+)/gi),
    svgs: (html.match(/<svg\b/gi) ?? []).length,
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
  let next = order.reduce((best, at) => (distance(points[at], centroid) < distance(points[best], centroid) ? at : best), order[0]);
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

export function selectStratified(pool, quotas) {
  return Object.entries(quotas).flatMap(([format, count]) =>
    select(
      pool.filter((entry) => entry.format === format),
      count,
    ).map((id, position) => ({ id, format, position })),
  );
}
