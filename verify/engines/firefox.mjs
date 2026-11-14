import { firefox as launcher } from "playwright-core";
import { executableFingerprint } from "./fingerprint.mjs";

export { focus, forcedStates } from "./pointer.mjs";

export const name = "firefox";
export const label = "Firefox";
export const tag = `[${name}] `;
export const isolated = true;
export const contextOptions = {};
export const placeholderStyle = true;
export const pixel = { channel: 1, faint: 8, budget: 12 };
export const noise = { pixels: 10383312, differing: 0, max: 0 };

export const launch = ({ args, ...options } = {}) => launcher.launch(options);

export const identity = (browser, { channel = "" } = {}) => {
  const path = launcher.executablePath();
  const stamp = executableFingerprint(path);
  return `${label} ${browser.version()} ${path} ${stamp} channel=${channel} args=[]`;
};
export const settle = (page, settlePage, options) => settlePage(page, options);
const PROPERTY_ACCESS_ON_VALUE = /(can't access property "[^"]*", )\S+( is (?:undefined|null))/g;

const OWN_PAGE_FILE = /({file: ")[^"]*.html(")/g;

export const normalizeError = (message) => message.replace(PROPERTY_ACCESS_ON_VALUE, "$1<value>$2").replace(OWN_PAGE_FILE, "$1<page>$2");
