import { webkit as launcher } from "playwright-core";

export { focus, forcedStates } from "./pointer.mjs";

export const name = "webkit";
export const label = "WebKit";
export const tag = `[${name}] `;
export const isolated = false;
export const contextOptions = {};
export const pixel = { channel: 1, faint: 8, budget: 12 };
export const noise = { pixels: 10383312, differing: 0, max: 0 };

export const launch = ({ args, ...options } = {}) => launcher.launch(options);

export const identity = (browser) => `${label} ${browser.version()}`;
export const settle = (page, settlePage, options) => settlePage(page, options);
export const normalizeError = (message) => message.replace(/null is not an object \(evaluating '[^']*'\)/g, "null is not an object");
