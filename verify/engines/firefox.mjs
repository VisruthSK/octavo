import { firefox as launcher } from "playwright-core";
import { existsSync, statSync } from "node:fs";

export { focus, forcedStates } from "./pointer.mjs";

export const name = "firefox";
export const label = "Firefox";
export const tag = `[${name}] `;
export const isolated = true;
export const contextOptions = {};
export const pixel = { channel: 1, faint: 8, budget: 12 };
export const noise = { pixels: 10383312, differing: 0, max: 0 };

export const launch = ({ args, ...options } = {}) => launcher.launch(options);

export const identity = (browser, { channel = "" } = {}) => {
  const path = launcher.executablePath();
  const stamp = existsSync(path) ? `${statSync(path).size}-${statSync(path).mtimeMs}` : "missing";
  return `${label} ${browser.version()} ${path} ${stamp} channel=${channel} args=[]`;
};
export const settle = (page, settlePage, options) => settlePage(page, options);
export const normalizeError = (message) => message;
