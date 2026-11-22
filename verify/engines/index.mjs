import * as chromium from "./chromium.mjs";
import * as firefox from "./firefox.mjs";
import * as webkit from "./webkit.mjs";

const engines = { chromium, firefox, webkit };

export const engineNames = Object.keys(engines);

export const engineName = (env = process.env) => {
  const name = env.OCTAVO_BROWSER || "chromium";
  if (!Object.hasOwn(engines, name)) throw new Error(`OCTAVO_BROWSER must be ${engineNames.join(", ")}, not ${name}`);
  return name;
};

export const engine = engines[engineName()];

export const engineNotice = () => `${engine.label} (${engine.name})`;

export const launch = (options = {}) => engine.launch(options);

export const checksOf = (checks) => {
  if (!checks) return [];
  const missing = [];
  for (const state of ["hover", "focus", "focusVisible", "active"]) {
    const applied = checks[state] ?? 0;
    const expected = checks.expected?.[state] ?? checks.elements;
    if (applied < expected) {
      const details = checks.details?.[state] ?? [];
      missing.push(`${state} on ${expected - applied} of ${expected} elements${details.length ? `: ${details.join("; ")}` : ""}`);
    }
  }
  if (checks.unreadable?.length) missing.push(`${checks.unreadable.length} stylesheets could not be read, so their state rules were not forced: ${checks.unreadable.slice(0, 3).join("; ")}`);
  if (checks.unmirrored) missing.push(`${checks.unmirrored} state rules could not be mirrored: ${(checks.unmirroredRules ?? []).join(" | ")}`);
  const shots = checks.screenshots;
  if (shots && shots.taken < shots.total) missing.push(`screenshot on ${shots.total - shots.taken} of ${shots.total} states`);
  for (const limit of shots?.limits ?? []) missing.push(`screenshot pixels not compared on ${limit.label}: ${limit.width}x${limit.height}, ${limit.reason ?? "pixels"} limit ${limit.limit}`);
  return missing;
};

export const incompleteChecks = (checks) => checksOf(checks).map((text) => `check incomplete: ${text}`);

export const withIncompleteCheckIssues = (issues, ...checks) => [
  ...issues,
  ...checks.flatMap(incompleteChecks),
];
