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

async function reasonFor(element, state) {
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
    const rect = target.getBoundingClientRect();
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
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

export async function focus(page, element) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let attempt = 0; attempt < 60; attempt++) {
    await page.keyboard.press("Tab");
    if (await element.evaluate((target) => document.activeElement === target).catch(() => false)) return true;
  }
  await page.keyboard.down("Tab");
  await element.focus({ timeout: 1000 }).catch(() => {});
  await page.keyboard.up("Tab");
  return element.evaluate((target) => document.activeElement === target).catch(() => false);
}

export async function forcedStates(page, selector, observe, onPhase = () => {}) {
  const interactive = page.locator(selector);
  const count = Math.min(await interactive.count(), 40);
  const states = [];
  const checks = emptyChecks(0);
  const scroll = await page.evaluate(() => [window.scrollX, window.scrollY]);
  const restore = () => page.evaluate(([left, top]) => window.scrollTo({ left, top, behavior: "instant" }), scroll);
  const probe = (index) => page.evaluate(observe, { probe: { selector, index } });
  await page.evaluate(GUARD);
  try {
    for (let index = 0; index < count; index++) {
      onPhase(`forcedStates element ${index} pointer hover`);
      const element = interactive.nth(index);
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
      onPhase(`forcedStates element ${index} boundingBox`);
      let box = await element.boundingBox().catch(() => null);
      if (!box || !box.width || !box.height) {
        for (const state of STATES) states.push([`:${state} on interactive #${index}`, "unavailable"]);
        for (const state of CHECKS) noteFailure(checks, state, detail(state, "visible element has no usable bounding box"));
        continue;
      }
      onPhase(`forcedStates element ${index} locator hover`);
      await element.hover({ timeout: 1000 }).catch(() => {});
      onPhase(`forcedStates element ${index} hover probe`);
      let seen = await probe(index);
      for (let attempt = 0; attempt < 3 && !seen.states.hover; attempt++) {
        onPhase(`forcedStates element ${index} hover retry ${attempt}`);
        await element.hover({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(50);
        seen = await probe(index);
      }
      if (!seen.states.hover) {
        await element.evaluate((target) => target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })).catch(() => {});
        await element.hover({ timeout: 1000 }).catch(() => {});
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
      onPhase(`forcedStates element ${index} active target`);
      await element.hover({ timeout: 1000 }).catch(() => {});
      onPhase(`forcedStates element ${index} active`);
      await page.mouse.down();
      seen = await probe(index);
      if (seen.states.active) {
        checks.active += 1;
        states.push([`:active on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
      } else {
        const reason = await reasonFor(element, "active");
        if (reason) {
          states.push([`:active on interactive #${index}`, "unreachable"]);
          noteUnreachable(checks, "active", detail("active", reason), unreachableStates);
        } else {
          states.push([`:active on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
          noteFailure(checks, "active", detail("active", ""));
        }
      }
      if (unreachableStates.size) checks.elements -= 1;
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
