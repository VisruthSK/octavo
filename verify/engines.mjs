export const engineNames = ["chromium", "firefox", "webkit"];

const table = {
  chromium: {
    label: "Chromium",
    states: "protocol",
    focusVisible: true,
    subtle: true,
    pixel: { channel: 1, faint: 8, budget: 12 },
  },
  firefox: {
    label: "Firefox",
    states: "pointer",
    focusVisible: true,
    subtle: true,
    pixel: { channel: 1, faint: 8, budget: 12 },
  },
  webkit: {
    label: "WebKit",
    states: "pointer",
    focusVisible: true,
    subtle: true,
    pixel: { channel: 1, faint: 8, budget: 12 },
  },
};

export const engineName = (env = process.env) => {
  const name = env.OCTAVO_BROWSER || "chromium";
  if (!Object.hasOwn(table, name)) throw new Error(`OCTAVO_BROWSER must be ${engineNames.join(", ")}, not ${name}`);
  return name;
};

export const capabilities = (name = engineName()) => table[name];

export const engineNotice = (name = engineName()) => `${capabilities(name).label} (${name})`;

export const pixelTolerance = (name = engineName()) => capabilities(name).pixel;

export const forcedStates = (name = engineName()) => capabilities(name).states;

export const focusVisible = (name = engineName()) => capabilities(name).focusVisible;

export const subtleCrypto = (name = engineName()) => capabilities(name).subtle;

export const checksOf = (checks) => {
  if (!checks) return [];
  const missing = [];
  for (const state of ["hover", "focus", "focusVisible", "active"]) {
    const applied = checks[state] ?? 0;
    if (applied < checks.elements) missing.push(`${state} on ${checks.elements - applied} of ${checks.elements} elements`);
  }
  return missing;
};
