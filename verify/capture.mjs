import { pathToFileURL } from "node:url";
import { capabilities } from "./engines.mjs";

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
  const to = 1000;
  const max = 8;
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

async function observe({ lossy, probe, motion, pixels }) {
  const describe = (element, pseudo) => {
    const style = getComputedStyle(element, pseudo);
    if (pseudo && style.content === "none") return "";
    const noImage = style.backgroundImage === "none";
    const legacyBox = style.display.includes("box");
    const prefix = pseudo ?? "";
    let text = "";
    for (const name of style) {
      if (name.startsWith("--")) continue;
      const position = name.startsWith("background-position");
      if (noImage && position) continue;
      if (!legacyBox && name.startsWith("-webkit-box-")) continue;
      const value = style.getPropertyValue(name);
      text += `${prefix}${name}:${position ? value.replace(/\b0px\b/g, "0%") : value};`;
    }
    return text;
  };
  if (probe) {
    const element = document.querySelectorAll(probe.selector)[probe.index];
    if (!element) return { style: "", states: {} };
    return {
      style: describe(element, null),
      states: {
        hover: element.matches(":hover"),
        focus: element.matches(":focus"),
        focusVisible: element.matches(":focus-visible"),
        active: element.matches(":active"),
      },
    };
  }

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
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script, style, link, noscript").forEach((node) => node.remove());
  const embedded = [...clone.querySelectorAll("img")].flatMap((img) =>
    ["src", "data-src"].flatMap((attribute) => {
      const value = img.getAttribute(attribute);
      return value?.startsWith(lossy ? "data:image/" : "data:image/png") ? [{ img, attribute, value }] : [];
    }),
  );
  const prints = await Promise.all(embedded.map(({ value }) => (pixels ? fingerprint(value).catch(() => value) : "skipped")));
  for (const [at, { img, attribute }] of embedded.entries()) {
    img.removeAttribute(attribute);
    img.setAttribute(`pixels-${attribute}`, prints[at]);
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
    ...(element.matches("input[placeholder], textarea[placeholder]") ? ["::placeholder"] : []),
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
    fonts: [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family).sort(),
    sheets: document.styleSheets.length,
    scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
  };
}

const GUARD = () => {
  const hold = (event) => event.stopImmediatePropagation();
  const block = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of ["mousedown", "mouseup"]) document.addEventListener(type, hold, true);
  document.addEventListener("click", block, true);
  window.octavoGuard = { hold, block };
};

const UNGUARD = () => {
  if (!window.octavoGuard) return;
  for (const type of ["mousedown", "mouseup"]) document.removeEventListener(type, window.octavoGuard.hold, true);
  document.removeEventListener("click", window.octavoGuard.block, true);
  delete window.octavoGuard;
};

const STATES = ["hover", "focus", "active"];

const emptyChecks = (elements) => ({ elements, hover: 0, focus: 0, focusVisible: 0, active: 0 });

async function focusWithTab(page, index) {
  for (let step = 0; step < 80; step++) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate((probe) => {
      const target = document.querySelectorAll(probe.selector)[probe.index];
      const active = document.activeElement;
      const key = active ? `${active.tagName}:${active.id}:${(active.textContent || "").slice(0, 16)}` : "";
      const state = (window.octavoTab ??= { key: "", stuck: 0 });
      state.stuck = state.key === key ? state.stuck + 1 : 0;
      state.key = key;
      if (!target || !active || active === document.body) return { reached: false, passed: false, stuck: state.stuck > 2 };
      if (active === target) return { reached: true, passed: false, stuck: false };
      const passed = Boolean(target.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { reached: false, passed, stuck: state.stuck > 2 };
    }, { selector: INTERACTIVE, index });
    if (at.reached) return true;
    if (at.passed || at.stuck) return false;
  }
  return false;
}

async function pointerStates(page) {
  const interactive = page.locator(INTERACTIVE);
  const count = Math.min(await interactive.count(), 40);
  const states = [];
  const checks = emptyChecks(0);
  const scroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
  const restore = () => page.evaluate(([left, top]) => window.scrollTo({ left, top, behavior: "instant" }), scroll);
  const probe = (index) => page.evaluate(observe, { probe: { selector: INTERACTIVE, index } });
  await page.evaluate(GUARD);
  try {
    for (let index = 0; index < count; index++) {
      const element = interactive.nth(index);
      await element.scrollIntoViewIfNeeded().catch(() => {});
      let box = await element.boundingBox().catch(() => null);
      if (!box || !box.width || !box.height) {
        for (const state of STATES) states.push([`:${state} on interactive #${index}`, "hidden"]);
        continue;
      }
      checks.elements += 1;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      let seen = await probe(index);
      if (!seen.states.hover) {
        await page.waitForTimeout(50);
        seen = await probe(index);
      }
      states.push([`:hover on interactive #${index}`, seen.style]);
      if (seen.states.hover) checks.hover += 1;
      await page.evaluate(() => document.activeElement?.blur());
      if (capabilities().focusVisible) {
        await page.keyboard.press("Shift");
        await element.focus({ timeout: 1000 }).catch(() => {});
      } else {
        await focusWithTab(page, index);
      }
      seen = await probe(index);
      states.push([`:focus on interactive #${index}`, seen.style]);
      if (seen.states.focus) checks.focus += 1;
      if (seen.states.focusVisible) checks.focusVisible += 1;
      await page.evaluate(() => document.activeElement?.blur());
      await restore();
      await page.mouse.down();
      seen = await probe(index);
      states.push([`:active on interactive #${index}`, seen.style]);
      if (seen.states.active) checks.active += 1;
      await page.mouse.up();
      await restore();
    }
  } finally {
    await page.evaluate(UNGUARD);
    await page.mouse.move(0, 0).catch(() => {});
    await restore();
  }
  return { states, checks };
}

async function protocolStates(page) {
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await session.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: INTERACTIVE });
  const states = [];
  const checks = emptyChecks(Math.min(nodeIds.length, 40));
  for (const [index, nodeId] of nodeIds.slice(0, 40).entries()) {
    for (const state of [["hover"], ["focus", "focus-visible"], ["active"]]) {
      await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: state });
      const seen = await page.evaluate(observe, { probe: { selector: INTERACTIVE, index } });
      states.push([`:${state[0]} on interactive #${index}`, seen.style]);
    }
    checks.hover += 1;
    checks.focus += 1;
    checks.focusVisible += 1;
    checks.active += 1;
    await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  }
  await session.detach();
  return { states, checks };
}

async function forcedStates(page) {
  return capabilities().forcedStates === "protocol" ? protocolStates(page) : pointerStates(page);
}

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

async function digestOf(page) {
  return page.evaluate(async () => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script, style, link, noscript").forEach((node) => node.remove());
    for (const node of clone.querySelectorAll('[src^="data:"], [data-src^="data:"]')) {
      node.removeAttribute("src");
      node.removeAttribute("data-src");
    }
    const text = `${clone.outerHTML}|${scrollX},${scrollY}|${innerWidth}x${innerHeight}`;
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
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

export async function capture(browser, file, scenario, lossy, { interact = true, patient = false } = {}) {
  const pace = patient ? PATIENCE : 1;
  const scripted = scenario.javaScriptEnabled !== false;
  const context = await browser.newContext({
    viewport: scenario.viewport,
    colorScheme: scenario.colorScheme,
    deviceScaleFactor: 1,
    reducedMotion: scenario.motion ? "no-preference" : "reduce",
    javaScriptEnabled: scripted,
  });
  try {
    await context.addInitScript(seedRandom);
    await context.addInitScript(trackTimers);
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const network = { pending: 0, count: 0, last: 0 };
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
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
    const wait = (options = {}) => settle(page, { quiet: (options.quiet ?? QUIET) * pace, limit: LIMIT * pace, network });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    if (scenario.media) await page.emulateMedia({ media: scenario.media });
    if (scripted && !scenario.motion) await page.addStyleTag({ content: NO_MOTION });

    const states = [];
    const record = async (label, extra = {}) => {
      if (scenario.media) await page.emulateMedia({ media: scenario.media });
      const screenshot = await page.screenshot({ fullPage: true, animations: "disabled" }).catch(() => null);
      states.push({ label, ...(await page.evaluate(observe, { lossy, motion: scenario.motion, pixels: scenario.pixels })), screenshot, ...extra });
    };
    await wait();
    const forced = scripted && !scenario.motion ? await forcedStates(page) : { states: [], checks: emptyChecks(0) };
    const accessibility = await settledAccessibilityTree(page);
    await wait();
    await record("load", { forced: forced.states, accessibility });
    const base = { states: states.slice(0, 1), errors: errors.slice(), requests: requests.slice() };
    if (interact && scripted && scenario.sweep) {
      const slideDeck = await page.evaluate(() => Boolean(document.querySelector(".reveal")));
      let previous = await digestOf(page);
      states[0].digest = previous;
      for (const [index, interact] of interactions.entries()) {
        await interact(page).catch((error) => errors.push(`interaction ${index}: ${error.message}`));
        await wait({ quiet: slideDeck ? (index === NAVIGATION ? 1200 : 400) : QUIET });
        const digest = await digestOf(page);
        if (digest === previous && !ALWAYS_OBSERVED.has(index)) {
          states.push({ label: `interaction ${index}`, digest, unchanged: true });
          continue;
        }
        previous = digest;
        await record(`interaction ${index}`, { digest });
      }
    }
    return {
      states,
      errors,
      requests,
      base,
      checks: { ...forced.checks, screenshots: { taken: states.filter((state) => state.screenshot).length, total: states.length } },
    };
  } finally {
    await context.close();
  }
}
