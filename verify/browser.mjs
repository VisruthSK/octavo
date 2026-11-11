import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

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

export const launch = (options = {}) => chromium.launch({ executablePath: executable(), ...options });
