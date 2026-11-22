import { canonicalStyle } from "../styles.mjs";

const STATES = ["hover", "focus", "focus-visible", "active"];
const CHECKS = { hover: "hover", focus: "focus", "focus-visible": "focusVisible", active: "active" };
const LIMIT = 40;
const MIRRORS = Symbol.for("octavo.mirrors");

const MIRROR = (names) => {
  const pattern = new RegExp(`:(${names.join("|")})(?![\w-])`, "g");
  const mirrors = [];
  const visit = (parent) => {
    let rules;
    try {
      rules = parent.cssRules;
    } catch {
      return;
    }
    for (let index = rules.length - 1; index >= 0; index--) {
      const rule = rules[index];
      if (rule.cssRules?.length) visit(rule);
      const selector = rule.selectorText;
      if (!selector || !pattern.test(selector)) continue;
      pattern.lastIndex = 0;
      const body = rule.cssText.slice(selector.length);
      try {
        const at = parent.insertRule(`${selector.replace(pattern, (_, name) => `[data-octavo-${name}]`)}${body}`, index + 1);
        mirrors.push({ parent, rule: parent.cssRules[at] });
      } catch {}
      pattern.lastIndex = 0;
    }
  };
  for (const sheet of document.styleSheets) visit(sheet);
  window[Symbol.for("octavo.mirrors")] = mirrors;
  return mirrors.length;
};

const UNMIRROR = () => {
  const mirrors = window[Symbol.for("octavo.mirrors")] ?? [];
  for (const { parent, rule } of mirrors.reverse()) {
    const index = Array.prototype.indexOf.call(parent.cssRules, rule);
    if (index >= 0) parent.deleteRule(index);
  }
  delete window[Symbol.for("octavo.mirrors")];
};

const APPLY = ({ selector, index, name, on }) => {
  const target = (window[Symbol.for("octavo.interactive")] ?? document.querySelectorAll(selector))[index];
  if (!target) return false;
  const chain = name === "hover" || name === "active" ? [] : [target];
  if (chain.length === 0) for (let node = target; node; node = node.parentElement) chain.push(node);
  for (const node of chain) {
    if (on) node.setAttribute(`data-octavo-${name}`, "");
    else node.removeAttribute(`data-octavo-${name}`);
  }
  getComputedStyle(target).color;
  for (const animation of document.getAnimations()) {
    if (animation instanceof CSSTransition) animation.finish();
  }
  return true;
};

export async function forcedStates(page, selector, observe, onPhase = () => {}) {
  onPhase("forcedStates mirror rules");
  await page.evaluate(MIRROR, STATES);
  const count = await page.evaluate((selector) => {
    const found = document.querySelectorAll(selector);
    window[Symbol.for("octavo.interactive")] = found;
    return found.length;
  }, selector);
  const states = [];
  const checks = { elements: Math.min(count, LIMIT), hover: 0, focus: 0, focusVisible: 0, active: 0 };
  for (let index = 0; index < checks.elements; index++) {
    for (const name of STATES) {
      onPhase(`forcedStates element ${index} ${name}`);
      await page.evaluate(APPLY, { selector, index, name, on: true });
      const seen = await page.evaluate(observe, { probe: { selector, index } });
      await page.evaluate(APPLY, { selector, index, name, on: false });
      states.push([`:${name} on interactive #${index}`, canonicalStyle(seen.style, seen.writingMode)]);
      checks[CHECKS[name]] += 1;
    }
  }
  await page.evaluate(UNMIRROR);
  await page.evaluate(() => {
    delete window[Symbol.for("octavo.interactive")];
  });
  return { states, checks };
}
