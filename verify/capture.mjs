import { pathToFileURL } from "node:url";

export const scenarios = [
  { name: "desktop-light", viewport: { width: 1280, height: 900 }, colorScheme: "light", pixels: true },
  { name: "desktop-dark", viewport: { width: 1280, height: 900 }, colorScheme: "dark" },
  { name: "mobile", viewport: { width: 390, height: 844 }, colorScheme: "light" },
  { name: "tablet", viewport: { width: 768, height: 1024 }, colorScheme: "light" },
  { name: "motion", viewport: { width: 1280, height: 900 }, colorScheme: "light", motion: true },
  { name: "no-js", viewport: { width: 1280, height: 900 }, colorScheme: "light", javaScriptEnabled: false },
  { name: "print", viewport: { width: 1280, height: 900 }, colorScheme: "light", media: "print" },
];

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
  if (probe) return describe(document.querySelectorAll(probe.selector)[probe.index], null);

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

async function forcedStates(page) {
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await session.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: INTERACTIVE });
  const states = [];
  for (const [index, nodeId] of nodeIds.slice(0, 40).entries()) {
    for (const state of [["hover"], ["focus", "focus-visible"], ["active"]]) {
      await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: state });
      states.push([`:${state[0]} on interactive #${index}`, await page.evaluate(observe, { probe: { selector: INTERACTIVE, index } })]);
    }
    await session.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  }
  await session.detach();
  return states;
}

async function settle(page, { quiet = 150, limit = 3000 } = {}) {
  await page.waitForFunction(() => !document.querySelector(".reveal .scrollbar.visible"), null, { timeout: limit }).catch(() => {});
  await page.evaluate(
    ({ quiet, limit }) =>
      new Promise((resolve) => {
        let timer;
        const finish = () => {
          clearTimeout(timer);
          mutations.disconnect();
          resizes.disconnect();
          removeEventListener("scroll", bump);
          resolve();
        };
        const bump = () => {
          clearTimeout(timer);
          timer = setTimeout(finish, quiet);
        };
        const mutations = new MutationObserver(bump);
        mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        const resizes = new ResizeObserver(bump);
        resizes.observe(document.documentElement);
        addEventListener("scroll", bump, { passive: true });
        setTimeout(finish, limit);
        bump();
      }),
    { quiet, limit },
  );
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

export async function capture(browser, file, scenario, lossy, { interact = true } = {}) {
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
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    page.on("request", (request) => !/^(file|data|blob|about):/.test(request.url()) && requests.push(request.url()));
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    if (scenario.media) await page.emulateMedia({ media: scenario.media });
    if (scripted && !scenario.motion) await page.addStyleTag({ content: NO_MOTION });
    await page.evaluate(() => document.fonts.ready);
    if (scripted) await settle(page);

    const states = [];
    const record = async (label, extra = {}) => {
      if (scenario.media) await page.emulateMedia({ media: scenario.media });
      const screenshot = await page.screenshot({ fullPage: true, animations: "disabled" }).catch(() => null);
      states.push({ label, ...(await page.evaluate(observe, { lossy, motion: scenario.motion, pixels: scenario.pixels })), screenshot, ...extra });
    };
    await record("load", {
      forced: scripted && !scenario.motion ? await forcedStates(page) : [],
      accessibility: await settledAccessibilityTree(page),
    });
    if (interact && scripted && !scenario.media && !scenario.motion) {
      const slideDeck = await page.evaluate(() => Boolean(document.querySelector(".reveal")));
      for (const [index, interact] of interactions.entries()) {
        await interact(page).catch((error) => errors.push(`interaction ${index}: ${error.message}`));
        await settle(page, { quiet: slideDeck ? 400 : 150 });
        await record(`interaction ${index}`);
      }
    }
    return { states, errors, requests };
  } finally {
    await context.close();
  }
}
