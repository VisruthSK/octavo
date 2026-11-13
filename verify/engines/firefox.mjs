import { firefox as launcher } from "playwright-core";

export { focus, forcedStates } from "./pointer.mjs";

export const name = "firefox";
export const label = "Firefox";
export const tag = `[${name}] `;
export const isolated = true;
export const contextOptions = {};
export const pixel = { channel: 1, faint: 8, budget: 12 };
export const noise = { pixels: 10383312, differing: 0, max: 0 };

export const launch = ({ args, ...options } = {}) => launcher.launch(options);

export const identity = (browser) => `${label} ${browser.version()}`;
export const settle = (page, settlePage, options) => settlePage(page, options);
export const normalizeError = (message) => message;
