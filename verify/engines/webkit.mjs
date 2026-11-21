import { webkit as launcher } from "playwright-core";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { executableFingerprint } from "./fingerprint.mjs";

export { focus, forcedStates } from "./pointer.mjs";

export const name = "webkit";
export const label = "WebKit";
export const tag = `[${name}] `;
export const isolated = false;
export const contextOptions = {};
export const loadDocument = async (page, file) => {
  const url = pathToFileURL(file).href;
  const body = await readFile(file);
  const fulfill = (route) => route.fulfill({ body, contentType: "text/html" });
  await page.route(url, fulfill);
  try {
    return await page.goto(url, { waitUntil: "load", timeout: 0 });
  } finally {
    await page.unroute(url, fulfill);
  }
};
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

const LOCAL_DIRECTORY = /(file:\/\/\/|\/\/)(?:home|Users|tmp|var|mnt|runner)\/[^"\s]*\//g;

const LEVEL_SUFFIX = /\.(?:serve|portable|archive)\.html/g;

export const normalizeError = (message) =>
  message
    .replace(MISSING_VALUE_EXPRESSION, "$1 is not an object")
    .replace(LOCAL_DIRECTORY, "$1")
    .replace(LEVEL_SUFFIX, ".html");
