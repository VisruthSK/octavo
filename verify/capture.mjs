import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { engine } from "./engines/index.mjs";
import { scrollbarPseudo } from "./engines/pseudos.mjs";
import { isLinkedFileLoadFailure, isMissingFile } from "./linked-artifacts.mjs";
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
  serve: {
    scenarios: ["desktop-light", "desktop-dark", "mobile", "tablet", "motion", "no-js", "print"],
    sweep: ["desktop-light", "desktop-dark", "mobile", "tablet"],
  },
  portable: { scenarios: ["desktop-light", "mobile", "no-js"], sweep: ["desktop-light"] },
  archive: { scenarios: ["desktop-light", "mobile", "no-js"], sweep: ["desktop-light"] },
};

export const scenariosFor = (level) => {
  const set = SCENARIO_SETS[level] ?? SCENARIO_SETS.serve;
  return set.scenarios.map((name) => ({ ...SCENARIOS[name], sweep: set.sweep.includes(name) }));
};

export const scenarios = scenariosFor("serve");

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
    const targets = (await page.$$(".footnote-ref, a[role=doc-biblioref], a.quarto-xref")).slice(0, 3);
    for (const el of targets) await el.hover({ timeout: 2000 }).catch(() => {});
    return targets.length > 0;
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

function observe({ lossy, probe, motion, linked, prints = [], placeholderStyle = true, scrollbarPseudo }) {
  const describe = (element, pseudo, baseStyle) => {
    const style = pseudo === null && baseStyle ? baseStyle : getComputedStyle(element, pseudo);
    if ((pseudo === "::before" || pseudo === "::after") && style.content === "none") return "";
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
    const element = (window[Symbol.for("octavo.interactive")] ?? document.querySelectorAll(probe.selector))[probe.index];
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
  const roots = [document.documentElement, document.body].filter(Boolean);
  const elements = [
    ...roots,
    ...document.body.querySelectorAll("*:not(script):not(style):not(link):not(noscript)"),
  ];
  const animations = motion
    ? (() => {
        const list = document.getAnimations();
        if (!list.length) return [];
        const position = new Map(elements.map((element, at) => [element, at]));
        return list
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
          .sort();
      })()
    : [];
  if (motion) {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
  }
  const styleValues = [];
  const styleIndexes = new Map();
  return {
    animations,
    title: document.title,
    dom: clone.outerHTML,
    labels: elements.map((el) => el.tagName + (el.id ? `#${el.id}` : "")),
    rects: elements.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return [x, y, width, height].map((n) => Math.round(n * 100) / 100);
    }),
    styles: (() => {
      const sampleTags = new Set(["p", "a", "h1", "h2", "h3", "h4", "h5", "h6", "li", "code"]);
      const sampled = new Set();
      return elements.map((el) => {
        const base = getComputedStyle(el);
        const tag = el.tagName.toLowerCase();
        const isRoot = el === document.documentElement || el === document.body;
        const isSample = sampleTags.has(tag);
        const hasScroll = isRoot || isSample || el.matches?.(".custom-scroll, [style*='overflow']") || (base.overflow && base.overflow !== "visible");
        const pseudos = [
          null,
          "::before",
          "::after",
          ...(base.display === "list-item" || tag === "li" ? ["::marker"] : []),
          ...(placeholderStyle && el.matches("input[placeholder], textarea[placeholder]") ? ["::placeholder"] : []),
          ...(isRoot || isSample ? ["::selection"] : []),
          ...(hasScroll ? [scrollbarPseudo] : []),
        ];
        const value = pseudos.map((pseudo) => describe(el, pseudo, base)).join("");
        if (!styleIndexes.has(value)) {
          styleIndexes.set(value, styleValues.length);
          styleValues.push(value);
        }
        return styleIndexes.get(value);
      });
    })(),
    styleValues,
    writingModes: elements.map((el) => getComputedStyle(el).writingMode),
    fonts: (() => {
      const weights = { normal: "400", bold: "700" };
      const faces = new Map();
      for (const font of document.fonts) {
        if (font.status !== "loaded") continue;
        const stretch = font.stretch === "normal" ? "100%" : font.stretch;
        faces.set([font.family, font.style, weights[font.weight] ?? font.weight, stretch, font.unicodeRange].join("|"), font.family);
      }
      return [...faces.values()].sort();
    })(),
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

const probe = ({ javaScriptEnabled = true } = {}) => {
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
  const hub = window.MathJax?.Hub;
  const mathjax =
    Boolean(hub?.queue) && (Boolean(hub.queue.running) || Boolean(hub.queue.pending));
  let revealReady = false;
  try {
    revealReady = typeof window.Reveal?.isReady === "function" ? Boolean(window.Reveal.isReady()) : false;
  } catch {
    revealReady = false;
  }
  const hasRevealScript = javaScriptEnabled && [...document.querySelectorAll("script")].some((script) =>
    /reveal/i.test(script.src || "") || /reveal/i.test(script.textContent || "")
  );
  const reveal = Boolean(element) && javaScriptEnabled && (typeof window.Reveal !== "undefined" || hasRevealScript);
  const inspectable = (doc) => {
    const list = [];
    try {
      for (const iframe of doc.querySelectorAll("iframe")) {
        let inner;
        try {
          inner = iframe.contentDocument;
        } catch {
          continue;
        }
        if (!inner) continue;
        list.push(iframe);
        list.push(...inspectable(inner));
      }
    } catch {}
    return list;
  };
  const iframes = inspectable(document).every((iframe) => {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return true;
      if (doc.readyState !== "complete") return false;
      if (doc.fonts && doc.fonts.status !== "loaded") return false;
      return true;
    } catch {
      return true;
    }
  });
  return {
    due,
    running: running.length,
    fonts: document.fonts.status === "loaded",
    iframes,
    transitioning,
    indices,
    reveal,
    revealReady,
    mathjax,
    mathjax3: Boolean(window.MathJax?.startup?.promise),
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
  const observeDoc = (doc) => {
    try {
      const mutations = new MutationObserver(touch);
      const resizes = new ResizeObserver(touch);
      mutations.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      resizes.observe(doc.documentElement);
      doc.addEventListener("scroll", touch, { capture: true, passive: true });
      for (const iframe of doc.querySelectorAll("iframe")) {
        try {
          if (iframe.contentDocument) observeDoc(iframe.contentDocument);
        } catch {}
      }
    } catch {}
  };
  observeDoc(document);
  return state;
};

const frames = async (page) => {
  await Promise.race([
    page.evaluate(() => {
      const wait = (win) =>
        new Promise((done) => {
          try {
            if (!win || typeof win.requestAnimationFrame !== "function") return done();
            const timer = setTimeout(done, 500);
            win.requestAnimationFrame(() =>
              win.requestAnimationFrame(() => {
                clearTimeout(timer);
                done();
              }),
            );
          } catch {
            done();
          }
        });
      const inspectable = (doc) => {
        const wins = [];
        try {
          for (const iframe of doc.querySelectorAll("iframe")) {
            let inner;
            try {
              inner = iframe.contentDocument;
            } catch {
              continue;
            }
            if (!inner || !iframe.contentWindow) continue;
            wins.push(iframe.contentWindow);
            wins.push(...inspectable(inner));
          }
        } catch {}
        return wins;
      };
      return Promise.all([window, ...inspectable(document)].map(wait));
    }).catch(() => {}),
    page.waitForTimeout(500),
  ]);
};

export function trackNetwork(page, requests = []) {
  const openRequests = new Set();
  const network = { pending: 0, count: 0, last: 0, openRequests };
  page.on("request", (request) => {
    if (/^(data|blob|about):/.test(request.url())) return;
    network.pending += 1;
    network.count += 1;
    network.last = Date.now();
    openRequests.add(request);
    if (!/^file:/.test(request.url())) requests.push(request.url());
  });
  const finished = (request) => {
    if (!openRequests.delete(request)) return;
    network.pending -= 1;
    network.last = Date.now();
  };
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  return network;
}
export async function settle(page, { quiet = QUIET, limit = LIMIT, network, longLived, javaScriptEnabled, scripted } = {}) {
  const enabled = javaScriptEnabled ?? scripted ?? true;
  const deadline = Date.now() + limit;
  if (enabled) {
    await page.waitForFunction(() => !document.querySelector(".reveal .scrollbar.visible"), null, { timeout: limit }).catch(() => {});
  }
  await page.evaluate(watch).catch(() => {});
  const isNetworkQuiet = () => {
    if (!network) return true;
    if (Date.now() - network.last < quiet) return false;
    if (!network.pending) return true;
    if (!network.openRequests) return false;
    if (!network.openRequests.size) return false;
    for (const request of network.openRequests) {
      if (!longLived?.has(request)) return false;
    }
    return true;
  };
  let previous = null;
  while (Date.now() < deadline) {
    if (network) {
      while (Date.now() < deadline) {
        if (isNetworkQuiet()) break;
        await page.waitForTimeout(50);
      }
    }
    const state = await page.evaluate(probe, { javaScriptEnabled: enabled }).catch(() => null);
    if (!state) {
      await page.waitForTimeout(50);
      continue;
    }
    if (state.reveal) {
      if (state.revealReady !== true || state.transitioning || state.indices !== previous) {
        previous = state.indices;
        await page.waitForTimeout(100);
        continue;
      }
    }
    if (!state.fonts || !state.iframes) {
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
    if (state.mathjax) {
      await page.waitForTimeout(100);
      continue;
    }
    if (state.mathjax3) {
      const idle = await page
        .evaluate(() =>
          new Promise((done) => {
            const promise = window.MathJax?.startup?.promise;
            if (!promise) return done(true);
            Promise.resolve(promise).then(() => done(true), () => done(true));
            let left = 16;
            const tick = () => (left-- <= 0 ? done(false) : requestAnimationFrame(tick));
            requestAnimationFrame(tick);
          }),
        )
        .catch(() => true);
      if (!idle) {
        await page.waitForTimeout(100);
        continue;
      }
    }
    const changed = await page.evaluate(() => globalThis[Symbol.for("octavo.quiet")]?.changed ?? Date.now()).catch(() => Date.now());
    if (Date.now() - changed < quiet) {
      await page.waitForTimeout(25);
      continue;
    }
    await frames(page);
    const settled = await page.evaluate(() => globalThis[Symbol.for("octavo.quiet")]?.changed ?? Date.now()).catch(() => 0);
    if (!isNetworkQuiet()) continue;
    if (Date.now() - settled >= quiet) return true;
  }
  return false;
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
  const text = await page.evaluate(({ forms, linked }) => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script, style, link, noscript").forEach((node) => node.remove());
    for (const node of clone.querySelectorAll(linked ? "[src], [data-src], [srcset]" : '[src^="data:"], [data-src^="data:"]')) {
      node.removeAttribute("src");
      node.removeAttribute("data-src");
      if (linked) node.removeAttribute("srcset");
    }
    const html = `${clone.outerHTML}|${scrollX},${scrollY}|${innerWidth}x${innerHeight}`;
    return forms.reduce((current, form) => current.split(form).join("{site}"), html);
  }, { forms, linked });
  return createHash("sha256").update(text).digest("hex");
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
const MAX_FULL_PAGE_HEIGHT = 16384;
const SCREENSHOT_TIMEOUT_AREA = 1280 * 720;
const MAX_SCREENSHOT_TILE_HEIGHT = 8000;
const MAX_SCREENSHOT_PIXELS = 20_000_000;
const MAX_SCREENSHOT_TILES = 2048;
const MAX_SCREENSHOT_BYTES = 128 * 1024 * 1024;

export const tileTimeout = (width, height) => SCREENSHOT_TIMEOUT_MS * Math.max(1, Math.ceil((width * height) / SCREENSHOT_TIMEOUT_AREA));

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

export const loadDocument = (page, file) => engine.loadDocument(page, file);

export async function captureScreenshot(page, viewport, onTile = () => {}, javaScriptEnabled = true) {
  const pageSize = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
  }));
  const width = Math.max(viewport.width, pageSize.width);
  const height = Math.max(viewport.height, pageSize.height);
  let fullPageError = `page height exceeds ${MAX_FULL_PAGE_HEIGHT} pixels`;
  if (height <= MAX_FULL_PAGE_HEIGHT) {
    try {
      return await page.screenshot({ fullPage: true, animations: "disabled", timeout: SCREENSHOT_TIMEOUT_MS });
    } catch (error) {
      fullPageError = error.message;
    }
  }
  const tileWidth = Math.min(viewport.width, MAX_SCREENSHOT_TILE_HEIGHT);
  const tileHeight = Math.min(MAX_SCREENSHOT_TILE_HEIGHT, Math.floor(MAX_SCREENSHOT_PIXELS / tileWidth));
  const positions = (size, step) => Array.from({ length: Math.ceil(size / step) }, (_, index) => index * step);
  if (Math.ceil(width / tileWidth) * Math.ceil(height / tileHeight) > MAX_SCREENSHOT_TILES) {
    return { kind: "limit", width, height, limit: MAX_SCREENSHOT_TILES, reason: "tile count" };
  }
  const originalScroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
  const tiles = [];
  let bytes = 0;
  try {
    for (const y of positions(height, tileHeight)) {
      for (const x of positions(width, tileWidth)) {
        const started = performance.now();
        let evaluated;
        try {
          await page.evaluate(([left, top, scripted]) => {
            window.scrollTo({ left, top, behavior: "instant" });
            if (scripted) return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          }, [x, y, javaScriptEnabled]);
          evaluated = performance.now();
          const clipWidth = Math.min(tileWidth, width - x);
          const clipHeight = Math.min(tileHeight, height - y);
          const png = await page.screenshot({
            fullPage: true,
            clip: { x, y, width: clipWidth, height: clipHeight },
            animations: "disabled",
            timeout: tileTimeout(clipWidth, clipHeight),
          });
          bytes += png.length;
          if (bytes > MAX_SCREENSHOT_BYTES) return { kind: "limit", width, height, limit: MAX_SCREENSHOT_BYTES, reason: "tile bytes" };
          tiles.push({ x, y, width: clipWidth, height: clipHeight, png });
        } finally {
          const ended = performance.now();
          onTile({ x, y, evaluateMs: (evaluated ?? ended) - started, screenshotMs: evaluated ? ended - evaluated : 0 });
        }
      }
    }
  } catch (error) {
    throw new Error(`full-page screenshot: ${fullPageError}; tiled screenshot: ${error.message}`);
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
  { interact = true, patient = false, root, linked = false, linkedOriginal = false, timeoutMs = CAPTURE_TIMEOUT_MS, longLived, onPhase = () => {} } = {},
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
  let phaseStarted = performance.now();
  const trace = process.env.OCTAVO_CAPTURE_TRACE === "1";
  const log = (detail) => {
    if (trace) console.error(`[capture] ${JSON.stringify({ file, scenario: scenario.name, rss: process.memoryUsage().rss, ...detail })}`);
  };
  const setPhase = (next) => {
    log({ phase, ms: performance.now() - phaseStarted });
    phase = next;
    onPhase(next);
    phaseStarted = performance.now();
  };
  onPhase(phase);
  const deadline = captureDeadline(context, timeoutMs, () => phase);
  try {
    setPhase("install init scripts");
    await context.addInitScript(seedRandom);
    await context.addInitScript(trackTimers);
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const network = trackNetwork(page, requests);
    const { openRequests } = network;
    let missingFiles = linked ? 0 : undefined;
    page.on("pageerror", (error) => errors.push(engine.normalizeError(error.message)));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (linkedOriginal && isLinkedFileLoadFailure(message.text(), message.location())) return;
      if (linked && isMissingFile(message.text(), message.location())) {
        missingFiles += 1;
        return;
      }
      errors.push(engine.normalizeError(message.text()));
    });
    const knownLongLived = new Set(longLived ?? []);
    const waits = [];
    const wait = async (name, options = {}) => {
      setPhase(`settle ${name}`);
      waits.push(
        await engine.settle(page, settle, {
          quiet: (options.quiet ?? QUIET) * pace,
          limit: (options.limit ?? LIMIT) * pace,
          network,
          longLived: knownLongLived,
          javaScriptEnabled: options.javaScriptEnabled ?? scripted,
        }),
      );
    };
    setPhase("goto");
    let navigationRetries = 0;
    let initialNavigationError;
    let response;
    try {
      response = await loadDocument(page, file);
    } catch (error) {
      initialNavigationError = error.message;
      setPhase("goto retry");
      response = await loadDocument(page, file).catch((retryError) => {
        throw new Error(`navigation failed: ${JSON.stringify({ url: page.url(), error: retryError.message, initialError: error.message })}`);
      });
      navigationRetries = 1;
    }
    setPhase("document body ready");
    let waitError;
    await page.waitForFunction(() => Boolean(document.body), null, { timeout: LIMIT * pace }).catch((error) => { waitError = error.message; });
    let body;
    let evaluateError;
    try {
      body = await page.evaluate(() => Boolean(document.body));
    } catch (error) {
      evaluateError = error.message;
    }
    if (!body) {
      let documentState;
      try {
        documentState = await page.evaluate(() => {
          const html = document.documentElement?.outerHTML ?? "";
          return { readyState: document.readyState, bodyNull: document.body === null, htmlLength: html.length, htmlStart: html.slice(0, 200) };
        });
      } catch (error) {
        documentState = { error: error.message };
      }
      throw new Error(`document body did not appear after page load: ${JSON.stringify({ waitError, evaluateError, url: page.url(), document: documentState, response: response ? { url: response.url(), status: response.status() } : null })}`);
    }
    if (scenario.media) await page.emulateMedia({ media: scenario.media });
    if (scripted && !scenario.motion) await page.addStyleTag({ content: NO_MOTION });
    setPhase("fonts ready");
    if (scripted) await page.evaluate(() => document.fonts.ready);
    else await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 3000 }).catch(() => {});
    await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: "instant" })).catch(() => {});
    await frames(page);
    await wait("initial page");
    for (const request of openRequests) knownLongLived.add(request);

    let previousDigest = await digestOf(page, forms, linked);
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.waitForTimeout(50);
      await frames(page);
      const currentDigest = await digestOf(page, forms, linked);
      if (currentDigest === previousDigest) break;
      previousDigest = currentDigest;
      await wait(`stability ${attempt}`);
    }

    const states = [];
    const record = async (label, extra = {}) => {
      setPhase(`screenshot ${label}`);
      if (scenario.media) await page.emulateMedia({ media: scenario.media });
      let screenshotError;
      const screenshot = await captureScreenshot(page, scenario.viewport, (tile) => log({ phase, tile }), scripted).catch((error) => {
        screenshotError = error.message;
        return null;
      });
      setPhase(`image fingerprints ${label}`);
      const prints = scenario.pixels ? await page.evaluate(fingerprints, { lossy, linked }) : [];
      setPhase(`page observation ${label}`);
      if (scripted) await page.evaluate(() => document.fonts.ready).catch(() => {});
      const observation = await page.evaluate(observe, { lossy, motion: scenario.motion, linked, prints, placeholderStyle: engine.placeholderStyle, scrollbarPseudo });
      observation.fonts = observation.fonts.map(canonicalFontFamily).sort();
      states.push({ label, ...observation, screenshot, ...(screenshotError ? { screenshotError } : {}), ...extra });
    };
    await record("load", { digest: previousDigest });
    setPhase("forcedStates element count");
    const forced = scripted && !scenario.motion
      ? await engine.forcedStates(page, INTERACTIVE, observe, setPhase)
      : emptyChecks(0);
    setPhase("accessibility snapshot");
    const accessibility = await settledAccessibilityTree(page);
    states[0].forced = forced.states;
    states[0].accessibility = accessibility;
    const base = { states: states.slice(0, 1), errors: errors.slice(), requests: requests.slice() };
    if (scripted && scenario.name === "desktop-light") {
      setPhase("resize viewport");
      await page.setViewportSize({ width: 900, height: 700 });
      await wait("after resize");
      await record("resize");
      await page.setViewportSize(scenario.viewport);
      await wait("after restore viewport");
    }
    if (interact && scripted && scenario.name === "desktop-light") {
      setPhase("behaviour sweep selection");
      const handles = await page.$$("button, summary, [role=button], [role=tab], input[type=checkbox], input[type=radio], select");
      const safe = [];
      for (const handle of handles) {
        if (safe.length >= 8) break;
        const valid = await handle.evaluate((el) => {
          if (el.closest("a[href]")) return false;
          if (el.tagName === "BUTTON" && el.type === "submit" && el.form?.getAttribute("action")) return false;
          if (el.getAttribute("target") === "_blank") return false;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const s = getComputedStyle(el);
          return s.visibility !== "hidden" && s.display !== "none" && s.pointerEvents !== "none";
        }).catch(() => false);
        if (valid) safe.push(handle);
      }
      if (safe.length > 0) {
        for (const [index, handle] of safe.entries()) {
          setPhase(`behaviour sweep element ${index}`);
          const isSelect = await handle.evaluate((el) => el.tagName === "SELECT").catch(() => false);
          if (isSelect) {
            await handle.evaluate((el) => {
              if (el.options.length > 1) {
                el.selectedIndex = el.selectedIndex === 0 ? 1 : 0;
                el.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }).catch(() => {});
          } else {
            await handle.click({ timeout: 1000 }).catch(() => {});
          }
        }
        await page.keyboard.press("Escape").catch(() => {});
        await wait("after behaviour sweep");
        await record("behaviour");
      }
    }
    if (interact && scripted && scenario.sweep) {
      setPhase("reveal slide number lookup");
      const slideDeck = await page.evaluate(() => Boolean(document.querySelector(".reveal")));
      let previous = previousDigest;
      for (const [index, interact] of interactions.entries()) {
        setPhase(`interaction sweep step ${index} slide number lookup`);
        const slideNumber = await page.evaluate(() => {
          const index = window.Reveal?.getIndices?.();
          return index ? `${index.h}.${index.v}` : "none";
        }).catch(() => "unknown");
        setPhase(`interaction sweep step ${index} slide ${slideNumber}`);
        const acted = await interact(page).catch((error) => errors.push(`interaction ${index}: ${error.message}`));
        const cursorDelay = slideDeck && index === HOVER
          ? await page.evaluate(() => window.Reveal?.getConfig?.().hideCursorTime ?? 0).catch(() => 0)
          : 0;
        const quiet = slideDeck ? (index === NAVIGATION ? 1200 : Math.max(400, cursorDelay + QUIET)) : QUIET;
        const limit = slideDeck && index === HOVER ? Math.max(LIMIT, cursorDelay + quiet + 500) : LIMIT;
        await wait(`interaction sweep step ${index} slide ${slideNumber}`, { quiet, limit });
        const digest = await digestOf(page, forms, linked);
        if (digest === previous && (!ALWAYS_OBSERVED.has(index) || acted === false)) {
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
      openRequests: new Set([...openRequests].map((request) => request.url())),
      base,
      checks: {
        ...forced.checks,
        settled: waits.every((outcome) => outcome !== false),
        ...(linked ? { missingFiles } : {}),
        screenshots: {
          taken: recorded.filter((state) => state.screenshot).length,
          total: recorded.length,
          limits: recorded.flatMap(({ label, screenshot }) =>
            screenshot?.kind === "limit" ? [{ label, width: screenshot.width, height: screenshot.height, limit: screenshot.limit, reason: screenshot.reason }] : [],
          ),
        },
        navigationRetries,
        ...(initialNavigationError ? { initialNavigationError } : {}),
      },
    }, forms);
  } catch (error) {
    if (deadline.timedOut()) throw new Error(`capture timed out during ${deadline.phase()} after ${timeoutMs} ms`);
    throw new Error(`capture failed during ${phase}: ${error.message}`);
  } finally {
    onPhase(null);
    await deadline.close();
  }
}
