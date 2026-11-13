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

const STATES = ["hover", "focus", "active"];

const emptyChecks = (elements) => ({ elements, hover: 0, focus: 0, focusVisible: 0, active: 0 });

export async function focus(page, element) {
  await page.keyboard.press("Shift");
  await element.focus({ timeout: 1000 }).catch(() => {});
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
      onPhase(`forcedStates element ${index} boundingBox`);
      let box = await element.boundingBox().catch(() => null);
      if (!box || !box.width || !box.height) {
        for (const state of STATES) states.push([`:${state} on interactive #${index}`, "hidden"]);
        continue;
      }
      checks.elements += 1;
      onPhase(`forcedStates element ${index} mouse move`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      onPhase(`forcedStates element ${index} hover probe`);
      let seen = await probe(index);
      for (let attempt = 0; attempt < 3 && !seen.states.hover; attempt++) {
        onPhase(`forcedStates element ${index} hover retry ${attempt}`);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(50);
        seen = await probe(index);
      }
      states.push([`:hover on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
      if (seen.states.hover) checks.hover += 1;
      await page.evaluate(() => document.activeElement?.blur());
      onPhase(`forcedStates element ${index} focus`);
      await focus(page, element);
      seen = await probe(index);
      for (let attempt = 0; attempt < 3 && !seen.states.focus; attempt++) {
        await element.focus({ timeout: 1000 }).catch(() => {});
        await page.waitForTimeout(50);
        seen = await probe(index);
      }
      states.push([`:focus on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
      if (seen.states.focus) checks.focus += 1;
      if (seen.states.focusVisible) checks.focusVisible += 1;
      await page.evaluate(() => document.activeElement?.blur());
      await restore();
      onPhase(`forcedStates element ${index} active`);
      await page.mouse.down();
      seen = await probe(index);
      states.push([`:active on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
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
