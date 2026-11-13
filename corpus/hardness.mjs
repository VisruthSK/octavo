const runtimeMarkers = new Set([
  "slides",
  "dashboard",
  "mermaid",
  "mathjax",
  "katex",
  "lightbox",
  "tabset",
  "listing",
  "video",
  "iframe",
  "search",
]);

export const HARDNESS_WEIGHTS = {
  interactive: { weight: 4, scale: 40 },
  scripts: { weight: 4, scale: 30 },
  scriptBytes: { weight: 5, scale: 400_000 },
  inlineHandlers: { weight: 4, scale: 20 },
  images: { weight: 2, scale: 80 },
  imageBytes: { weight: 4, scale: 2_000_000 },
  dataUrls: { weight: 3, scale: 60 },
  fonts: { weight: 2, scale: 10 },
  fontFaces: { weight: 3, scale: 12 },
  fontBytes: { weight: 3, scale: 1_000_000 },
  svgs: { weight: 2, scale: 60 },
  animations: { weight: 3, scale: 40 },
  keyframes: { weight: 2, scale: 20 },
  mediaQueries: { weight: 2, scale: 40 },
  customProperties: { weight: 2, scale: 80 },
  depth: { weight: 3, scale: 32 },
  runtimes: { weight: 6, scale: 3 },
  bytes: { weight: 4, scale: 3_000_000 },
  cssRules: { weight: 3, scale: 4_000 },
};

const featureValue = (features, key) =>
  key === "runtimes"
    ? (features.markers ?? []).filter((marker) => runtimeMarkers.has(marker)).length
    : Number(features[key] ?? 0);

export function hardnessOf(features) {
  return Object.entries(HARDNESS_WEIGHTS).reduce((total, [key, { weight, scale }]) => {
    const measure = Math.min(1, Math.log2(1 + featureValue(features, key)) / Math.log2(1 + scale));
    return total + weight * measure;
  }, 0);
}

export const COST_CAP = 4_000_000;

export const costOf = (features) =>
  Number(features.bytes ?? 0) + 64 * Number(features.elements ?? 0) + 2 * Number(features.scriptBytes ?? 0);

export const cappedCost = (features) => Math.min(costOf(features), COST_CAP);

export const hardnessPerCost = (features) => hardnessOf(features) / Math.max(1, cappedCost(features));