import { webkit as launcher } from "playwright-core";
import { executableFingerprint } from "./fingerprint.mjs";

export { focus, forcedStates } from "./pointer.mjs";

export const name = "webkit";
export const label = "WebKit";
export const tag = `[${name}] `;
export const isolated = false;
export const contextOptions = {};
export const placeholderStyle = false;
export const pixel = { channel: 1, faint: 8, budget: 12 };
export const noise = { pixels: 10383312, differing: 0, max: 0 };

export const launch = ({ args, ...options } = {}) => launcher.launch(options);

export const identity = (browser, { channel = "" } = {}) => {
  const path = launcher.executablePath();
  const stamp = executableFingerprint(path);
  return `${label} ${browser.version()} ${path} ${stamp} channel=${channel} args=[]`;
};
export const settle = (page, settlePage, options) => settlePage(page, options);
const MISSING_VALUE_EXPRESSION = /\b(null|undefined) is not an object \(evaluating '[^']*'\)/g;

export const normalizeError = (message) => message.replace(MISSING_VALUE_EXPRESSION, "$1 is not an object");
