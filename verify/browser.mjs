import { chromium } from "playwright-core";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, delimiter, dirname, join } from "node:path";
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

export const browserTarget = () => {
  const configured = process.env.CHROME_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const found = configured ?? (installed[process.platform] ?? []).find(existsSync);
  if (found) return found;
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
};

const registry = () => {
  try {
    return JSON.parse(readFileSync(new URL("../node_modules/playwright-core/browsers.json", import.meta.url), "utf8")).browsers;
  } catch {
    return [];
  }
};

const managedRevision = (target) => {
  const at = target.split(/[\\/]/).findIndex((part) => /^(chromium|firefox|webkit|ffmpeg)-(\d+)$/.test(part));
  return at < 0 ? null : target.split(/[\\/]/)[at].split("-").pop();
};

const folderVersion = (target) => {
  for (const folder of [dirname(target), dirname(dirname(target))]) {
    try {
      const found = readdirSync(folder).find((name) => /^\d+(\.\d+){2,3}$/.test(name));
      if (found) return found;
    } catch {
      continue;
    }
  }
  return null;
};

export const browserIdentity = () => {
  const target = browserTarget();
  if (!target) return "chromium unknown";
  const known = registry().find((browser) => browser.revision === managedRevision(target));
  if (known) return `${known.name} ${known.browserVersion}`;
  const name = basename(target).replace(/\.exe$/i, "");
  if (process.platform !== "win32") {
    const output = spawnSync(target, ["--version"], { encoding: "utf8", timeout: 10000 });
    const version = `${output.stdout ?? ""}${output.stderr ?? ""}`.match(/\d+(\.\d+){2,3}/)?.[0];
    if (version) return `${name} ${version}`;
  }
  const version = folderVersion(target);
  if (version) return `${name} ${version}`;
  const { size, mtimeMs } = statSync(target);
  return `${name} ${size}-${Math.round(mtimeMs)}`;
};

export const browserStamp = () => {
  const target = browserTarget();
  if (!target) return { target: null, size: null, mtimeMs: null };
  try {
    const { size, mtimeMs } = statSync(target);
    return { target, size, mtimeMs };
  } catch {
    return { target, size: null, mtimeMs: null };
  }
};

export const launch = (options = {}) => chromium.launch({ executablePath: browserTarget(), ...options });
