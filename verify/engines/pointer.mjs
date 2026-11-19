import { canonicalStyle } from "../styles.mjs";

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

const STATES = ["hover", "focus", "focus-visible", "active"];
const CHECKS = ["hover", "focus", "focusVisible", "active"];

const emptyChecks = (elements) => ({
  elements,
  hover: 0,
  focus: 0,
  focusVisible: 0,
  active: 0,
  expected: { hover: 0, focus: 0, focusVisible: 0, active: 0 },
  details: { hover: [], focus: [], focusVisible: [], active: [] },
  unreachable: { elements: 0, hover: 0, focus: 0, focusVisible: 0, active: 0, details: [] },
});

async function staticReason(element, state) {
  return element.evaluate((target, state) => {
    const style = getComputedStyle(target);
    if (target.closest("[inert]")) return "inside inert subtree";
    if (style.visibility === "hidden") return "visibility hidden";
    if ((state === "focus" || state === "focusVisible") && (target.matches(":disabled") || target.tabIndex < 0)) {
      return "not focusable";
    }
    if (state !== "hover" && state !== "active") return "";
    if (style.pointerEvents === "none") return "pointer-events none";
    if (style.clipPath.includes("inset(50%") || style.clip.replaceAll(" ", "") === "rect(0px,0px,0px,0px)") return "clipped by CSS clip";
    return "";
  }, state);
}

async function reasonFor(element, state) {
  const blocked = await staticReason(element, state);
  if (blocked) return blocked;
  return element.evaluate((target, state) => {
    const rect = target.getBoundingClientRect();
    for (let ancestor = target.parentElement; ancestor; ancestor = target.parentElement) {
      const parentStyle = getComputedStyle(ancestor);
      const parentRect = ancestor.getBoundingClientRect();
      const left = parentRect.left + ancestor.clientLeft;
      const top = parentRect.top + ancestor.clientTop;
      const right = left + ancestor.clientWidth;
      const bottom = top + ancestor.clientHeight;
      const clipsX = ["hidden", "clip", "scroll", "auto"].includes(parentStyle.overflowX);
      const clipsY = ["hidden", "clip", "scroll", "auto"].includes(parentStyle.overflowY);
      if ((clipsX && (rect.right <= left || rect.left >= right)) || (clipsY && (rect.bottom <= top || rect.top >= bottom))) {
        return `clipped by ${ancestor.tagName.toLowerCase()}${ancestor.id ? `#${ancestor.id}` : ""}`;
      }
    }
    const rects = target.getClientRects();
    const list = rects.length ? [...rects] : [rect];
    for (const item of list) {
      const hit = document.elementFromPoint(item.left + item.width / 2, item.top + item.height / 2);
      if (hit && (hit === target || target.contains(hit))) return "";
    }
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (hit && hit !== target && !target.contains(hit)) return `covered by ${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}`;
    return "";
  }, state);
}

function noteFailure(checks, state, detail) {
  checks.details[state].push(detail);
}

function noteUnreachable(checks, state, detail, unreachableStates) {
  checks.expected[state] -= 1;
  checks.unreachable[state] += 1;
  checks.unreachable.details.push(`${state} ${detail}`);
  unreachableStates.add(state);
  if (unreachableStates.size === 1) checks.unreachable.elements += 1;
}

const ownPoint = (element) =>
  element
    .evaluate((target) => {
      const box = target.getBoundingClientRect();
      const rects = target.getClientRects();
      const list = rects.length ? [...rects] : [box];
      for (const rect of list) {
        const left = Math.max(rect.left, 0);
        const top = Math.max(rect.top, 0);
        const width = Math.min(rect.right, innerWidth) - left;
        const height = Math.min(rect.bottom, innerHeight) - top;
        if (width <= 0 || height <= 0) continue;
        for (const down of [0.5, 0.1, 0.9, 0.3, 0.7]) {
          for (const across of [0.5, 0.1, 0.9, 0.3, 0.7]) {
            const x = left + width * across;
            const y = top + height * down;
            const hit = document.elementFromPoint(x, y);
            if (hit && target.contains(hit) && !/^(IFRAME|FRAME|OBJECT|EMBED)$/.test(hit.tagName)) return { x: x - box.left, y: y - box.top };
          }
        }
      }
      return null;
    })
    .catch(() => null);

const FOCUS_ATTEMPTS = 60;

export const walk = async (page, element, limit = FOCUS_ATTEMPTS) => {
  for (let attempt = 0; attempt < limit; attempt++) {
    await page.keyboard.press("Tab");
    if (await element.evaluate((target) => document.activeElement === target).catch(() => false)) return true;
  }
  return false;
};

const restartFromTop = (page) =>
  page.evaluate(() => {
    const start = document.createElement("span");
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
    start.remove();
  });

export async function focus(page, element) {
  const { tabIndex, tabbables } = await element
    .evaluate((target) => {
      let count = 0;
      for (const candidate of document.querySelectorAll("a[href], button, input, select, textarea, details > summary, [tabindex], [contenteditable], iframe")) {
        if (candidate.tabIndex >= 0 && !candidate.disabled && !candidate.closest("[inert]")) count++;
      }
      return { tabIndex: target.tabIndex, tabbables: count };
    })
    .catch(() => ({ tabIndex: -1, tabbables: 0 }));
  if (tabIndex >= 0) {
    const limit = Math.min(FOCUS_ATTEMPTS, tabbables + 2);
    await page.evaluate(() => document.activeElement?.blur());
    if (await walk(page, element, limit)) return true;
    await page.evaluate(() => document.activeElement?.blur());
    await restartFromTop(page).catch(() => {});
    if (await walk(page, element, limit)) return true;
  }
  await page.keyboard.down("Tab");
  await element.focus({ timeout: 1000 }).catch(() => {});
  await page.keyboard.up("Tab");
  await page.evaluate(() => document.activeElement === element).catch(() => false);
  return true;
};

export async function forcedStates(page, selector, observe, onPhase = () => {}) {
  const snapshot = await page.evaluateHandle((selector) => {
    const elements = [...document.querySelectorAll(selector)].slice(0, 40);
    window[Symbol.for("octavo.interactive")] = elements;
    return elements;
  }, selector);
  const interactive = [...(await snapshot.getProperties()).values()].map((handle) => handle.asElement());
  const count = interactive.length;
  const states = [];
  const checks = emptyChecks(0);
  const scroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
  const restore = () => page.evaluate(([left, top]) => window.scrollTo({ left, top, behavior: "instant" }), scroll);
  const probe = (index) => page.evaluate(observe, { probe: { selector, index } });
  const print = await page.evaluate(() => matchMedia("print").matches);
  if (print) await page.emulateMedia({ media: "screen" });
  try {
    await page.evaluate(GUARD);
    for (let index = 0; index < count; index++) {
      onPhase(`forcedStates element ${index} pointer hover`);
      const element = interactive[index];
      onPhase(`forcedStates element ${index} visibility`);
      if (!(await element.isVisible().catch(() => false))) {
        for (const state of STATES) states.push([`:${state} on interactive #${index}`, "hidden"]);
        continue;
      }
      onPhase(`forcedStates element ${index} scrollIntoView`);
      await element.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      checks.elements += 1;
      for (const state of CHECKS) checks.expected[state] += 1;
      const info = await element.evaluate((target) =>
        `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ""}${target.className ? `.${String(target.className).trim().replaceAll(/\s+/g, ".")}` : ""} tabindex=${target.tabIndex}${target.getAttribute("href") ? ` href=${target.getAttribute("href")}` : ""}`,
      );
      const detail = (state, reason) => `${info}, selector "${selector}", index ${index}: ${reason || "state did not apply although the target was reachable"}`;
      const unreachableStates = new Set();
      const hoverReason = await staticReason(element, "hover");
      let seen;
      let spot;
      if (hoverReason) {
        states.push([`:hover on interactive #${index}`, "unreachable"]);
        noteUnreachable(checks, "hover", detail("hover", hoverReason), unreachableStates);
      } else {
        onPhase(`forcedStates element ${index} boundingBox`);
        const box = await element.boundingBox().catch(() => null);
        if (!box || !box.width || !box.height) {
          for (const state of STATES) states.push([`:${state} on interactive #${index}`, "unavailable"]);
          for (const state of CHECKS) noteFailure(checks, state, detail(state, "visible element has no usable bounding box"));
          continue;
        }
        onPhase(`forcedStates element ${index} locator hover`);
        spot = await ownPoint(element);
        await element.hover({ timeout: 1000, ...(spot ? { position: spot } : {}) }).catch(() => {});
        onPhase(`forcedStates element ${index} hover probe`);
        seen = await probe(index);
        for (let attempt = 0; attempt < 3 && !seen.states.hover; attempt++) {
          onPhase(`forcedStates element ${index} hover retry ${attempt}`);
          spot = await ownPoint(element);
          await element.hover({ timeout: 1000, ...(spot ? { position: spot } : {}) }).catch(() => {});
          await page.waitForTimeout(50);
          seen = await probe(index);
        }
        if (!seen.states.hover) {
          await element.evaluate((target) => target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })).catch(() => {});
          spot = await ownPoint(element);
          await element.hover({ timeout: 1000, ...(spot ? { position: spot } : {}) }).catch(() => {});
          seen = await probe(index);
        }
        if (seen.states.hover) {
          checks.hover += 1;
          states.push([`:hover on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
        } else {
          const reason = await reasonFor(element, "hover");
          if (reason) {
            states.push([`:hover on interactive #${index}`, "unreachable"]);
            noteUnreachable(checks, "hover", detail("hover", reason), unreachableStates);
          } else {
            states.push([`:hover on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
            noteFailure(checks, "hover", detail("hover", ""));
          }
        }
      }
      await page.evaluate(() => document.activeElement?.blur());
      onPhase(`forcedStates element ${index} focus`);
      const focusReason = await reasonFor(element, "focus");
      if (focusReason) {
        states.push([`:focus on interactive #${index}`, "unreachable"]);
        noteUnreachable(checks, "focus", detail("focus", focusReason), unreachableStates);
        states.push([`:focus-visible on interactive #${index}`, "unreachable"]);
        noteUnreachable(checks, "focusVisible", detail("focus-visible", focusReason), unreachableStates);
        seen = await probe(index);
      } else {
        await focus(page, element);
        seen = await probe(index);
        const focusedStyle = canonicalStyle(seen.style, seen.writingMode);
        if (seen.states.focus) {
          checks.focus += 1;
          states.push([`:focus on interactive #${index}`, focusedStyle]);
        } else {
          states.push([`:focus on interactive #${index}`, focusedStyle]);
          noteFailure(checks, "focus", detail("focus", ""));
        }
        if (seen.states.focusVisible) {
          checks.focusVisible += 1;
          states.push([`:focus-visible on interactive #${index}`, focusedStyle]);
        } else {
          states.push([`:focus-visible on interactive #${index}`, focusedStyle]);
          noteFailure(checks, "focusVisible", detail("focus-visible", ""));
        }
      }
      await page.evaluate(() => document.activeElement?.blur());
      const activeReason = hoverReason || (await staticReason(element, "active"));
      if (activeReason) {
        states.push([`:active on interactive #${index}`, "unreachable"]);
        noteUnreachable(checks, "active", detail("active", activeReason), unreachableStates);
      } else {
        onPhase(`forcedStates element ${index} active target`);
        await element.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
        spot = await ownPoint(element);
        await element.hover({ timeout: 1000, ...(spot ? { position: spot } : {}) }).catch(() => {});
        onPhase(`forcedStates element ${index} active`);
        await page.mouse.down();
        seen = await probe(index);
        for (let attempt = 0; attempt < 3 && !seen.states.active; attempt++) {
          await page.mouse.up();
          await page.waitForTimeout(50);
          await element.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
          spot = await ownPoint(element);
          await element.hover({ timeout: 1000, ...(spot ? { position: spot } : {}) }).catch(() => {});
          await page.mouse.down();
          seen = await probe(index);
        }
        if (seen.states.active) {
          checks.active += 1;
          states.push([`:active on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
        } else {
          const reason = await reasonFor(element, "active");
          if (reason) {
            states.push([`:active on interactive #${index}`, "unreachable"]);
          } else {
            states.push([`:active on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
            noteFailure(checks, "active", detail("active", ""));
          }
        }
      }
      if (unreachableStates.size) checks.elements -= 1;
      await page.mouse.up();
      await restore();
    }
  } finally {
    await page.evaluate(UNGUARD);
    await page.evaluate(() => delete window[Symbol.for("octavo.interactive")]);
    await snapshot.dispose();
    await page.mouse.move(0, 0).catch(() => {});
    await restore();
    if (print) await page.emulateMedia({ media: "print" });
  }
  return { states, checks };
}
