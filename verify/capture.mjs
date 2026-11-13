import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { engine } from "./engines/index.mjs";
import { isLinkedFileLoadFailure } from "./linked-artifacts.mjs";
import { canonicalFontFamily } from "./styles.mjs";

export const SCENARIOS = {
  "desktop-light": { name: "desktop-light", viewport: { width: 1280, height: 900 }, colorScheme: "light", pixels: true },
  "desktop-dark": { name: "desktop-dark", viewport: { width: 1280, height: 900 }, colorScheme: "dark" },
  mobile: { name: "mobile", viewport: { width: 390, height: 844 }, colorScheme: "light" },
  tablet: { name: "tablet", viewport: { width: 768, height: 1024 }, colorScheme: "light" },
  motion: { name: "motion", viewport: { width: 1280, height: 900 }, colorScheme: "light", motion: true },
  "no-js": { name: "no-js", viewport: { width: 1280, height: 900 }, colorScheme: "light", javaScriptEnabled: false },
  print: { name: "print", viewport: { width: 1280, height: 900 }, colorScheme: "light", media: "print" },
};

export const SCENARIO_SETS = {
  safe: {
    scenarios: ["desktop-light", "desktop-dark", "mobile", "tablet", "motion", "no-js", "print"],
    sweep: ["desktop-light", "desktop-dark", "mobile", "tablet"],
  },
  scripts: { scenarios: ["desktop-light", "mobile", "no-js"], sweep: ["desktop-light"] },
  packed: { scenarios: ["desktop-light", "mobile", "no-js"], sweep: ["desktop-light"] },
};

export const scenariosFor = (level) => {
  const set = SCENARIO_SETS[level] ?? SCENARIO_SETS.safe;
  return set.scenarios.map((name) => ({ ...SCENARIOS[name], sweep: set.sweep.includes(name) }));
};

export const scenarios = scenariosFor("safe");

const INTERACTIVE = "a[href], button, input, select, summary, [role=tab], [tabindex]";
const NO_MOTION = "*,*::before,*::after{transition:none!important;animation:none!important}";

const interactions = [
  (page) => page.evaluate(() => window.quartoToggleColorScheme?.()),
  async (page) => {
    for (const tab of (await page.$$("[role=tab]")).slice(0, 8)) await tab.click({ timeout: 2000 }).catch(() => {});
  },
  async (page) => {
    for (const el of (await page.$$("[data-bs-toggle=collapse], summary")).slice(0, 6)) await el.click({ timeout: 2000 }).catch(() => {});
  },
  async (page) => {
    for (const el of (await page.$$(".footnote-ref, a[role=doc-biblioref], a.quarto-xref")).slice(0, 3)) await el.hover({ timeout: 2000 }).catch(() => {});
  },
  (page) => page.keyboard.press("ArrowRight"),
  (page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)),
];

function seedRandom() {
  let seed = 123456789;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIMERS = Symbol.for("octavo.timers");

export function trackTimers() {
  const from = 50;
  const to = 6000;
  const max = 32;
  const state = { pending: new Map() };
  globalThis[Symbol.for("octavo.timers")] = state;
  const native = window.setTimeout;
  window.setTimeout = function (handler, delay, ...args) {
    const wait = Number(delay) || 0;
    if (typeof handler !== "function") return native.call(window, handler, wait, ...args);
    const id = native.call(
      window,
      (...inner) => {
        state.pending.delete(id);
        handler(...inner);
      },
      wait,
    );
    if (wait >= from && wait <= to && state.pending.size < max) state.pending.set(id, Date.now() + wait);
    return id;
  };
  const clear = window.clearTimeout;
  window.clearTimeout = function (id) {
    state.pending.delete(id);
    return clear.call(window, id);
  };
}

async function fingerprints({ lossy, linked }) {
  const remembered = (globalThis[Symbol.for("octavo.fingerprints")] ??= new Map());
  const fingerprint = async (uri) => {
    const key = `${lossy}:${uri}`;
    if (!remembered.has(key)) {
      const image = new Image();
      image.src = uri;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = lossy ? [] : [...new Uint8Array(await crypto.subtle.digest("SHA-256", context.getImageData(0, 0, canvas.width, canvas.height).data))];
      remembered.set(key, `${canvas.width}x${canvas.height}:${pixels.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`);
    }
    return remembered.get(key);
  };
  if (linked) return [];
  const embedded = [...document.querySelectorAll("img")].flatMap((img) =>
    ["src", "data-src"].flatMap((attribute) => {
      const value = img.getAttribute(attribute);
      return value && (lossy ? value.startsWith("data:image/") : /^data:image\/(png|webp)[;,]/.test(value)) ? [value] : [];
    }),
  );
  return Promise.all(embedded.map((value) => fingerprint(value).catch(() => value)));
}

function observe({ lossy, probe, motion, linked, prints = [], placeholderStyle = true }) {
  const describe = (element, pseudo) => {
    const style = getComputedStyle(element, pseudo);
    if (pseudo && style.content === "none") return "";
    const noImage = style.backgroundImage === "none";
    const legacyBox = style.display.includes("box");
    const prefix = pseudo ?? "";
    let text = "";
    for (const name of style) {
      if (name.startsWith("--")) continue;
      if (["width", "height"].includes(name)) continue;
      const position = name.startsWith("background-position");
      if (noImage && position) continue;
      if (!legacyBox && /^-[a-z]+-box-/.test(name)) continue;
      const raw = style.getPropertyValue(name);
      const value = linked ? raw.replace(/url\([^)]*\)/g, "url()") : raw;
      text += `${prefix}${name}:${position ? value.replace(/\b0px\b/g, "0%") : value};`;
    }
    for (const name of ["width", "height"]) {
      const value = style.getPropertyValue(name);
      if (value) text += `${prefix}${name}:${value};`;
    }
    return text;
  };
  if (probe) {
    const element = document.querySelectorAll(probe.selector)[probe.index];
    if (!element) return { style: "", states: {} };
    return {
      style: describe(element, null),
      writingMode: getComputedStyle(element).writingMode,
      states: {
        hover: element.matches(":hover"),
        focus: element.matches(":focus"),
        focusVisible: element.matches(":focus-visible"),
        active: element.matches(":active"),
      },
    };
  }

  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script, style, link, noscript").forEach((node) => node.remove());
  if (linked) {
    for (const node of clone.querySelectorAll("[src], [data-src], [srcset]")) {
      for (const attribute of ["src", "data-src", "srcset"]) node.removeAttribute(attribute);
    }
    for (const node of clone.querySelectorAll("[style*='url(']")) {
      node.setAttribute("style", node.getAttribute("style").replace(/url([^)]*)/g, "url()"));
    }
  }
  const embedded = [...clone.querySelectorAll("img")].flatMap((img) =>
    ["src", "data-src"].flatMap((attribute) => {
      const value = img.getAttribute(attribute);
      return value && (lossy ? value.startsWith("data:image/") : /^data:image\/(png|webp)[;,]/.test(value)) ? [{ img, attribute }] : [];
    }),
  );
  for (const [at, { img, attribute }] of embedded.entries()) {
    img.removeAttribute(attribute);
    img.setAttribute(`pixels-${attribute}`, prints[at] ?? "skipped");
  }
  const elements = [...document.body.querySelectorAll("*:not(script):not(style):not(link):not(noscript)")];
  const position = new Map(elements.map((element, at) => [element, at]));
  const animations = motion
    ? document
        .getAnimations()
        .map((animation) => {
          const timing = animation.effect?.getTiming?.() ?? {};
          return [
            position.get(animation.effect?.target) ?? -1,
            animation.animationName ?? animation.transitionProperty ?? "",
            animation.constructor.name,
            JSON.stringify([timing.duration, timing.delay, timing.iterations, timing.direction, timing.easing, timing.fill]),
            JSON.stringify(animation.effect?.getKeyframes?.() ?? []),
          ].join("|");
        })
        .sort()
    : [];
  if (motion) {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
  }
  const pseudosOf = (element) => [
    null,
    "::before",
    "::after",
    ...(getComputedStyle(element).display === "list-item" ? ["::marker"] : []),
    ...(placeholderStyle && element.matches("input[placeholder], textarea[placeholder]") ? ["::placeholder"] : []),
  ];
  return {
    animations,
    title: document.title,
    dom: clone.outerHTML,
    labels: elements.map((el) => el.tagName + (el.id ? `#${el.id}` : "")),
    rects: elements.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return [x, y, width, height].map((n) => Math.round(n * 100) / 100);
    }),
    styles: elements.map((el) => pseudosOf(el).map((pseudo) => describe(el, pseudo)).join("")),
    writingModes: elements.map((el) => getComputedStyle(el).writingMode),
    fonts: [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family).sort(),
    sheets: document.styleSheets.length,
    scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
  };
}

const emptyChecks = (elements) => ({
  states: [],
  checks: { elements, hover: 0, focus: 0, focusVisible: 0, active: 0 },
});

const QUIET = 150;
const LIMIT = 3000;

const probe = () => {
  const state = globalThis[Symbol.for("octavo.timers")];
  const now = Date.now();
  let due = 0;
  if (state) {
    for (const [id, at] of state.pending) {
      if (at <= now) state.pending.delete(id);
      else due = Math.max(due, at);
    }
  }
  const running = document.getAnimations().filter((animation) => {
    if (animation.playState !== "running") return false;
    const timing = animation.effect?.getTiming?.() ?? {};
    return timing.iterations !== Infinity;
  });
  const element = document.querySelector(".reveal");
  const slides = document.querySelector(".reveal .slides");
  const transitioning = [element, slides].some((node) => node && [...node.classList].some((name) => name.includes("transition")));
  let indices = "";
  try {
    indices = window.Reveal?.getIndices ? JSON.stringify(window.Reveal.getIndices()) : "";
  } catch {
    indices = "";
  }
  return {
    due,
    running: running.length,
    fonts: document.fonts.status === "loaded",
    transitioning,
    indices,
    reveal: typeof window.Reveal?.isReady === "function",
  };
};

const watch = () => {
  const existing = globalThis[Symbol.for("octavo.quiet")];
  if (existing) return existing;
  const state = { changed: Date.now() };
  globalThis[Symbol.for("octavo.quiet")] = state;
  const touch = () => {
    state.changed = Date.now();
  };
  const mutations = new MutationObserver(touch);
  const resizes = new ResizeObserver(touch);
  mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  resizes.observe(document.documentElement);
  document.addEventListener("scroll", touch, { capture: true, passive: true });
  return state;
};

const frames = async (page) => {
  await Promise.race([
    page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))).catch(() => {}),
    page.waitForTimeout(500),
  ]);
};

export async function settle(page, { quiet = QUIET, limit = LIMIT, network } = {}) {
  const deadline = Date.now() + limit;
  await page.waitForFunction(() => !document.querySelector(".reveal .scrollbar.visible"), null, { timeout: limit }).catch(() => {});
  await page.evaluate(watch).catch(() => {});
  let previous = null;
  while (Date.now() < deadline) {
    if (network) {
      while (Date.now() < deadline) {
        if (!network.pending && Date.now() - network.last >= quiet) break;
        await page.waitForTimeout(50);
      }
    }
    const state = await page.evaluate(probe).catch(() => null);
    if (!state) {
      await page.waitForTimeout(50);
      continue;
    }
    if (state.reveal) {
      const ready = await page.evaluate(() => Promise.resolve(window.Reveal.isReady())).catch(() => false);
      if (ready !== true || state.transitioning || state.indices !== previous) {
        previous = state.indices;
        await page.waitForTimeout(100);
        continue;
      }
    }
    if (!state.fonts) {
      await page.waitForTimeout(50);
      continue;
    }
    if (state.due > Date.now()) {
      await page.waitForTimeout(Math.min(state.due - Date.now(), 100));
      continue;
    }
    if (state.running) {
      await page.waitForTimeout(100);
      continue;
    }
    const changed = await page.evaluate(() => globalThis[Symbol.for("octavo.quiet")]?.changed ?? Date.now()).catch(() => Date.now());
    if (Date.now() - changed < quiet) {
      await page.waitForTimeout(25);
      continue;
    }
    await frames(page);
    const settled = await page.evaluate(() => globalThis[Symbol.for("octavo.quiet")]?.changed ?? Date.now()).catch(() => 0);
    if (Date.now() - settled >= quiet) return;
  }
}

async function settledAccessibilityTree(page) {
  let previous = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await page.locator("body").ariaSnapshot({ timeout: 5000 }).catch(() => "");
    if (current === previous) break;
    previous = current;
    await page.waitForTimeout(100);
  }
  return previous;
}

const INTERACTIVE_CONTENT =
  "script, details, summary, button, input, select, textarea, dialog, [role=tab], [tabindex], [contenteditable]";

const HOVER = 3;
const NAVIGATION = 4;
const ALWAYS_OBSERVED = new Set([HOVER]);

async function digestOf(page, forms = [], linked = false) {
  return page.evaluate(async ({ forms, linked }) => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script, style, link, noscript").forEach((node) => node.remove());
    for (const node of clone.querySelectorAll(linked ? "[src], [data-src], [srcset]" : '[src^="data:"], [data-src^="data:"]')) {
      node.removeAttribute("src");
      node.removeAttribute("data-src");
      if (linked) node.removeAttribute("srcset");
    }
    const html = `${clone.outerHTML}|${scrollX},${scrollY}|${innerWidth}x${innerHeight}`;
    const text = forms.reduce((current, form) => current.split(form).join("{site}"), html);
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }, { forms, linked });
}

function rootForms(root) {
  if (!root) return [];
  const slashed = resolve(root).replaceAll("\\", "/");
  const withoutDrive = slashed.replace(/^[A-Za-z]:/, "");
  const url = pathToFileURL(resolve(root)).href;
  const forms = new Set([url, decodeURI(url), `file://${slashed}`, slashed, withoutDrive, encodeURI(slashed), encodeURI(withoutDrive)]);
  return [...forms].filter((form) => form.length > 3).sort((a, b) => b.length - a.length);
}

function scrubDeep(value, forms) {
  if (!forms.length) return value;
  if (typeof value === "string") return forms.reduce((text, form) => text.split(form).join("{site}"), value);
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, forms));
  if (value && typeof value === "object" && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubDeep(item, forms)]));
  }
  return value;
}

export async function hasInteractions(browser, file) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    return await page.evaluate((selector) => Boolean(document.querySelector(selector)), INTERACTIVE_CONTENT);
  } finally {
    await context.close();
  }
}

const PATIENCE = 4;
const CAPTURE_TIMEOUT_MS = 300_000;
const SCREENSHOT_TIMEOUT_MS = 5_000;
const MAX_SCREENSHOT_TILE_HEIGHT = 8000;
const MAX_SCREENSHOT_PIXELS = 20_000_000;

export function captureDeadline(context, timeoutMs = CAPTURE_TIMEOUT_MS, phase = () => "capture") {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void context.close().catch(() => {});
  }, timeoutMs);
  return {
    timedOut: () => timedOut,
    phase,
    close: async () => {
      clearTimeout(timer);
      await context.close().catch(() => {});
    },
  };
}

async function captureScreenshot(page, viewport) {
  const pageSize = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
  }));
  const width = Math.max(viewport.width, pageSize.width);
  const height = Math.max(viewport.height, pageSize.height);
  try {
    return await page.screenshot({ fullPage: true, animations: "disabled", timeout: SCREENSHOT_TIMEOUT_MS });
  } catch {}
  if (width * height > MAX_SCREENSHOT_PIXELS) {
    return { kind: "limit", width, height, limit: MAX_SCREENSHOT_PIXELS };
  }
  const tileWidth = Math.min(viewport.width, MAX_SCREENSHOT_TILE_HEIGHT);
  const tileHeight = Math.min(viewport.height, MAX_SCREENSHOT_TILE_HEIGHT);
  const positions = (size, step) => Array.from({ length: Math.ceil(size / step) }, (_, index) => index * step);
  const originalScroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
  const tiles = [];
  try {
    for (const y of positions(height, tileHeight)) {
      for (const x of positions(width, tileWidth)) {
        await page.evaluate(([left, top]) => window.scrollTo({ left, top, behavior: "instant" }), [x, y]);
        const [left, top] = await page.evaluate(() => [window.scrollX, window.scrollY]);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const clipX = x - left;
        const clipY = y - top;
        const clipWidth = Math.min(tileWidth, width - x);
        const clipHeight = Math.min(tileHeight, height - y);
        const png = await page.screenshot({
          clip: { x: clipX, y: clipY, width: clipWidth, height: clipHeight },
          animations: "disabled",
          timeout: SCREENSHOT_TIMEOUT_MS,
        });
        tiles.push({ x, y, width: clipWidth, height: clipHeight, png });
      }
    }
  } finally {
    await page.evaluate(([left, top]) => window.scrollTo({ left, top, behavior: "instant" }), originalScroll);
  }
  return { kind: "tiles", width, height, tiles };
}

export async function capture(
  browser,
  file,
  scenario,
  lossy,
  { interact = true, patient = false, root, linked = false, linkedOriginal = false, timeoutMs = CAPTURE_TIMEOUT_MS } = {},
) {
  const pace = patient ? PATIENCE : 1;
  const forms = rootForms(root);
  const scripted = scenario.javaScriptEnabled !== false;
  const context = await browser.newContext({
    viewport: scenario.viewport,
    colorScheme: scenario.colorScheme,
    deviceScaleFactor: 1,
    reducedMotion: scenario.motion ? "no-preference" : "reduce",
    javaScriptEnabled: scripted,
    ...engine.contextOptions,
  });
  let phase = "new page";
  const deadline = captureDeadline(context, timeoutMs, () => phase);
  try {
    phase = "install init scripts";
    await context.addInitScript(seedRandom);
    await context.addInitScript(trackTimers);
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const network = { pending: 0, count: 0, last: 0 };
    page.on("pageerror", (error) => errors.push(engine.normalizeError(error.message)));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (linkedOriginal && isLinkedFileLoadFailure(message.text(), message.location())) return;
      errors.push(engine.normalizeError(message.text()));
    });
    page.on("request", (request) => {
      if (/^(data|blob|about):/.test(request.url())) return;
      network.pending += 1;
      network.count += 1;
      network.last = Date.now();
      if (!/^file:/.test(request.url())) requests.push(request.url());
    });
    const finished = () => {
      network.pending = Math.max(0, network.pending - 1);
      network.last = Date.now();
    };
    page.on("requestfinished", finished);
    page.on("requestfailed", finished);
    const wait = async (name, options = {}) => {
      phase = `settle ${name}`;
      await engine.settle(page, settle, { quiet: (options.quiet ?? QUIET) * pace, limit: (options.limit ?? LIMIT) * pace, network });
    };
    phase = "goto";
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    phase = "document body ready";
    await page.waitForFunction(() => Boolean(document.body), null, { timeout: LIMIT * pace }).catch(() => {});
    if (!(await page.evaluate(() => Boolean(document.body)).catch(() => false))) throw new Error("document body did not appear after page load");
    if (scenario.media) await page.emulateMedia({ media: scenario.media });
    if (scripted && !scenario.motion) await page.addStyleTag({ content: NO_MOTION });
    phase = "fonts ready";
    if (scripted) await page.evaluate(() => document.fonts.ready);
    else await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 3000 }).catch(() => {});
    await wait("initial page");

    const states = [];
    const record = async (label, extra = {}) => {
      phase = `screenshot ${label}`;
      if (scenario.media) await page.emulateMedia({ media: scenario.media });
      const screenshot = await captureScreenshot(page, scenario.viewport).catch(() => null);
      phase = `image fingerprints ${label}`;
      const prints = scenario.pixels ? await page.evaluate(fingerprints, { lossy, linked }) : [];
      phase = `page observation ${label}`;
      const observation = await page.evaluate(observe, { lossy, motion: scenario.motion, linked, prints, placeholderStyle: engine.placeholderStyle });
      observation.fonts = observation.fonts.map(canonicalFontFamily).sort();
      states.push({ label, ...observation, screenshot, ...extra });
    };
    await wait("before forced states");
    phase = "forcedStates element count";
    const forced = scripted && !scenario.motion
      ? await engine.forcedStates(page, INTERACTIVE, observe, (detail) => { phase = detail; })
      : emptyChecks(0);
    phase = "accessibility snapshot";
    const accessibility = await settledAccessibilityTree(page);
    await wait("before initial capture");
    await record("load", { forced: forced.states, accessibility });
    const base = { states: states.slice(0, 1), errors: errors.slice(), requests: requests.slice() };
    if (interact && scripted && scenario.sweep) {
      phase = "reveal slide number lookup";
      const slideDeck = await page.evaluate(() => Boolean(document.querySelector(".reveal")));
      let previous = await digestOf(page, forms, linked);
      states[0].digest = previous;
      for (const [index, interact] of interactions.entries()) {
        phase = `interaction sweep step ${index} slide number lookup`;
        const slideNumber = await page.evaluate(() => {
          const index = window.Reveal?.getIndices?.();
          return index ? `${index.h}.${index.v}` : "none";
        }).catch(() => "unknown");
        phase = `interaction sweep step ${index} slide ${slideNumber}`;
        await interact(page).catch((error) => errors.push(`interaction ${index}: ${error.message}`));
        const cursorDelay = slideDeck && index === HOVER
          ? await page.evaluate(() => window.Reveal?.getConfig?.().hideCursorTime ?? 0).catch(() => 0)
          : 0;
        const quiet = slideDeck ? (index === NAVIGATION ? 1200 : Math.max(400, cursorDelay + QUIET)) : QUIET;
        const limit = slideDeck && index === HOVER ? Math.max(LIMIT, cursorDelay + quiet + 500) : LIMIT;
        await wait(`interaction sweep step ${index} slide ${slideNumber}`, { quiet, limit });
        const digest = await digestOf(page, forms, linked);
        if (digest === previous && !ALWAYS_OBSERVED.has(index)) {
          states.push({ label: `interaction ${index}`, digest, unchanged: true });
          continue;
        }
        previous = digest;
        await record(`interaction ${index}`, { digest });
      }
    }
    const recorded = states.filter((state) => !state.unchanged);
    return scrubDeep({
      states,
      errors,
      requests,
      base,
      checks: {
        ...forced.checks,
        screenshots: {
          taken: recorded.filter((state) => state.screenshot).length,
          total: recorded.length,
          limits: recorded.flatMap(({ label, screenshot }) =>
            screenshot?.kind === "limit" ? [{ label, width: screenshot.width, height: screenshot.height, limit: screenshot.limit }] : [],
          ),
        },
      },
    }, forms);
  } catch (error) {
    if (deadline.timedOut()) throw new Error(`capture timed out during ${deadline.phase()} after ${timeoutMs} ms`);
    throw new Error(`capture failed during ${phase}: ${error.message}`);
  } finally {
    await deadline.close();
  }
}
