import { canonicalStyle } from "../styles.mjs";

const STATES = ["hover", "focus", "focus-visible", "active"];
const CHECKS = { hover: "hover", focus: "focus", "focus-visible": "focusVisible", active: "active" };
const LIMIT = 40;

const MIRROR = (names) => {
  const alternatives = names.join("|");
  const test = new RegExp(`:(?:${alternatives})(?![\\w-])`);
  const replace = new RegExp(`:(${alternatives})(?![\\w-])`, "g");
  const behind = new RegExp(`(::[\\w-]+(?:\\([^)]*\\))?)((?::(?:${alternatives})(?![\\w-]))+)`, "g");
  const mirrors = [];
  const unreadable = [];
  const failed = [];
  const visit = (parent, label) => {
    let rules;
    try {
      rules = parent.cssRules;
    } catch {
      unreadable.push(label);
      return;
    }
    for (let index = rules.length - 1; index >= 0; index--) {
      const rule = rules[index];
      if (rule.styleSheet) visit(rule.styleSheet, rule.href ?? "import");
      if (rule.cssRules?.length) visit(rule, label);
      const selector = rule.selectorText;
      if (!selector || !test.test(selector)) continue;
      const body = rule.cssRules?.length ? rule.cssText.slice(rule.cssText.indexOf("{")) : `{ ${rule.style.cssText} }`;
      const mirrored = selector.replace(behind, (_, element, states) => states.replace(replace, "[data-octavo-$1]") + element).replace(replace, "[data-octavo-$1]");
      try {
        const at = parent.insertRule(`${mirrored} ${body}`, index + 1);
        mirrors.push({ parent, rule: parent.cssRules[at] });
      } catch {
        failed.push(mirrored);
      }
    }
  };
  const roots = [document, ...[...document.querySelectorAll("*")].flatMap((element) => (element.shadowRoot ? [element.shadowRoot] : []))];
  for (const root of roots) {
    for (const sheet of [...root.styleSheets, ...root.adoptedStyleSheets]) visit(sheet, sheet.href ?? "inline");
  }
  window[Symbol.for("octavo.mirrors")] = mirrors;
  return { mirrored: mirrors.length, unreadable, failed };
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
  const found = await page.evaluate(MIRROR, STATES);
  const { mirrored, failed } = found;
  const unreadable = found.unreadable.filter((href) => !page.blockedUrls?.has(href));
  const count = await page.evaluate((selector) => {
    const found = document.querySelectorAll(selector);
    window[Symbol.for("octavo.interactive")] = found;
    return found.length;
  }, selector);
  const states = [];
  const checks = { elements: Math.min(count, LIMIT), hover: 0, focus: 0, focusVisible: 0, active: 0, mirrored, unreadable, unmirrored: failed.length, unmirroredRules: failed.slice(0, 5) };
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
