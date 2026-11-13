import { chromium as launcher } from "playwright-core";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { canonicalStyle } from "../styles.mjs";

export { focus } from "./pointer.mjs";

const { LOCALAPPDATA = "", PROGRAMFILES = "", "PROGRAMFILES(X86)": PROGRAMFILES_X86 = "", PATH = "" } = process.env;

const installed = {
  win32: [
    join(LOCALAPPDATA, "Chromium/Application/chrome.exe"),
    join(PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    join(PROGRAMFILES_X86, "Google/Chrome/Application/chrome.exe"),
    join(PROGRAMFILES_X86, "Microsoft/Edge/Application/msedge.exe"),
  ],
  darwin: [
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ],
  linux: ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"].flatMap((name) =>
    PATH.split(delimiter).map((dir) => join(dir, name)),
  ),
};

function executable() {
  const configured = process.env.CHROME_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  return configured ?? (installed[process.platform] ?? []).find(existsSync);
}

export const name = "chromium";
export const label = "Chromium";
export const tag = "";
export const isolated = false;
export const contextOptions = {};
export const placeholderStyle = true;
export const pixel = { channel: 1, faint: 8, budget: 12 };
export const noise = { pixels: 275589552, differing: 0, max: 0 };

export const launch = (options = {}) => launcher.launch({ executablePath: executable(), ...options });

export const identity = (browser, { args = [], channel = "" } = {}) => {
  const path = executable() ?? launcher.executablePath();
  const stamp = existsSync(path) ? `${statSync(path).size}-${statSync(path).mtimeMs}` : "missing";
  return `${label} ${browser.version()} ${path} ${stamp} channel=${channel} args=${JSON.stringify(args)}`;
};
export const settle = (page, settlePage, options) => settlePage(page, options);
export const normalizeError = (message) => message;

export async function forcedStates(page, selector, observe, onPhase = () => {}) {
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await session.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
  await page.evaluate((selector) => {
    window[Symbol.for("octavo.interactive")] = document.querySelectorAll(selector);
  }, selector);
  const states = [];
  const checks = { elements: Math.min(nodeIds.length, 40), hover: 0, focus: 0, focusVisible: 0, active: 0 };
  for (const [index, nodeId] of nodeIds.slice(0, 40).entries()) {
    for (const state of [["hover"], ["focus", "focus-visible"], ["active"]]) {
      onPhase(`forcedStates element ${index} ${state[0]}`);
      await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: state });
      const seen = await page.evaluate(observe, { probe: { selector, index } });
      states.push([`:${state[0]} on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
    }
    checks.hover += 1;
    checks.focus += 1;
    checks.focusVisible += 1;
    checks.active += 1;
    await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  }
  await page.evaluate(() => {
    delete window[Symbol.for("octavo.interactive")];
  });
  await session.detach();
  return { states, checks };
}
