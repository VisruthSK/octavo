// Optimized observe function with batched getComputedStyle calls
// Reduces round trips between node and browser by collecting all styles in one call
import { scrollbarPseudo } from "../verify/engines/pseudos.mjs";

const sampleTags = new Set(["p", "a", "h1", "h2", "h3", "h4", "h5", "h6", "li", "code"]);

export function observe({ lossy, probe, motion, linked, prints = [], placeholderStyle = true, scrollbarPseudo }) {
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
    const style = describe(element, null);
    return {
      style,
      writingMode: getComputedStyle(element).writingMode,
      states: {
        hover: element.matches(":hover"),
        focus: element.matches(":focus"),
        focusVisible: element.matches(":focus-visible"),
        active: element.matches(":active"),
      },
    };
  }

  const docClone = document.documentElement.cloneNode(true);
  docClone.querySelectorAll("script, style, link, noscript").forEach((node) => node.remove());
  if (linked) {
    for (const node of docClone.querySelectorAll("[src], [data-src], [srcset]")) {
      for (const attribute of ["src", "data-src", "srcset"]) node.removeAttribute(attribute);
    }
    for (const node of docClone.querySelectorAll("[style*='url(']")) {
      node.setAttribute("style", node.getAttribute("style").replace(/url([^)]*)/g, "url()"));
    }
  }
  const embedded = [...docClone.querySelectorAll("img")].flatMap((img) =>
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
  const elements = [...roots, ...document.body.querySelectorAll("*:not(script):not(style):not(link):not(noscript)")];
  
  const getStyleForElements = (elements, linked, placeholderStyle, scrollbarPseudo) => {
    const baseStyles = elements.map((el, idx) => {
      const style = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();
      const isRoot = el === document.documentElement || el === document.body;
      const isSample = sampleTags.has(tag);
      const hasScroll = isRoot || isSample || el.matches?.(".custom-scroll, [style*='overflow']") || (style.overflow && style.overflow !== "visible");
      const pseudos = [null];
      if (!linked) {
        pseudos.push("::before", "::after");
        if (style.display === "list-item" || tag === "li") pseudos.push("::marker");
        if (placeholderStyle && el.matches("input[placeholder], textarea[placeholder]")) pseudos.push("::placeholder");
        if (isRoot || isSample) pseudos.push("::selection");
        if (hasScroll) pseudos.push(scrollbarPseudo);
      }
      const result = {};
      for (const pseudo of pseudos) {
        const s = pseudo === null ? style : getComputedStyle(el, pseudo);
        const prefix = pseudo ?? "";
        let css = describe(el, pseudo, style);
        if (!css) continue;
        css += ` ${prefix}writing-mode:${s.writingMode};`;
        css += ` ${prefix}display:${s.display};`;
        css += ` ${prefix}box-sizing:${s.boxSizing};`;
        result[pseudo ?? 'base'] = css;
      }
      return { index: idx, element: el, styles: result, tag, isRoot, isSample, hasScroll };
    });
    const signatures = new Map();
    const uniqueStyles = [];
    const elementIndices = new Map();
    for (const { index, styles } of baseStyles) {
      const signature = Object.values(styles).sort().join('|');
      if (!signatures.has(signature)) {
        signatures.set(signature, uniqueStyles.length);
        uniqueStyles.push(styles);
      }
      elementIndices.set(index, signatures.get(signature));
    }
    return { baseStyles, uniqueStyles, elementIndices };
  };
  
  const { baseStyles, uniqueStyles, elementIndices } = getStyleForElements(elements, linked, placeholderStyle, scrollbarPseudo);
  
  const animations = motion ? (() => {
    const list = document.getAnimations();
    if (!list.length) return [];
    const position = new Map(elements.map((element, at) => [element, at]));
    return list.map((animation) => {
      const timing = animation.effect?.getTiming?.() ?? {};
      return [position.get(animation.effect?.target) ?? -1, animation.animationName ?? animation.transitionProperty ?? "", animation.constructor.name, JSON.stringify([timing.duration, timing.delay, timing.iterations, timing.direction, timing.easing, timing.fill]), JSON.stringify(animation.effect?.getKeyframes?.() ?? [])].join("|");
    }).sort();
  })() : [];
  if (motion) {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
    if (probe) {
      return {
        animations,
        title: document.title,
        dom: docClone.outerHTML,
        labels: baseStyles.map((s) => s.tag + (s.element.id ? `#${s.element.id}` : "")),
        rects: baseStyles.map((s) => {
          const { x, y, width, height } = s.element.getBoundingClientRect();
          return [x, y, width, height].map((n) => Math.round(n * 100) / 100);
        }),
        styles: uniqueStyles.map((_, idx) => elementIndices.get(baseStyles.find(s => s.styles === _)?.index ?? -1)),
        styleValues: [...uniqueStyles.values()].flatMap(Object.values).filter(Boolean).map(s => s.replace(/\s+/g, " ")),
        writingModes: baseStyles.map((s) => getComputedStyle(s.element).writingMode),
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
    return {
      animations,
      title: document.title,
      dom: docClone.outerHTML,
      labels: baseStyles.map((s) => s.tag + (s.element.id ? `#${s.element.id}` : "")),
      rects: baseStyles.map((s) => {
        const { x, y, width, height } = s.element.getBoundingClientRect();
        return [x, y, width, height].map((n) => Math.round(n * 100) / 100);
      }),
      styles: baseStyles.map((s, idx) => elementIndices.get(idx)),
      styleValues: uniqueStyles.map((_, idx) => Object.values(_).sort().join('|')).filter(Boolean),
      writingModes: baseStyles.map((s) => getComputedStyle(s.element).writingMode),
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
  if (probe) return { style: "", states: {} };
  
  const styleValues = [];
  const styleIndexes = new Map();
  return {
    animations,
    title: document.title,
    dom: docClone.outerHTML,
    labels: elements.map((el) => el.tagName + (el.id ? `#${el.id}` : "")),
    rects: elements.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return [x, y, width, height].map((n) => Math.round(n * 100) / 100);
    }),
    styles: (() => {
      return elements.map((el) => {
        const base = getComputedStyle(el);
        const tag = el.tagName.toLowerCase();
        const isRoot = el === document.documentElement || el === document.body;
        const isSample = sampleTags.has(tag);
        const hasScroll = isRoot || isSample || el.matches?.(".custom-scroll, [style*='overflow']") || (base.overflow && base.overflow !== "visible");
        const pseudos = [null, "::before", "::after", ...(base.display === "list-item" || tag === "li" ? ["::marker"] : []), ...(placeholderStyle && el.matches("input[placeholder], textarea[placeholder]") ? ["::placeholder"] : []), ...(isRoot || isSample ? ["::selection"] : []), ...(hasScroll ? [scrollbarPseudo] : [])];
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