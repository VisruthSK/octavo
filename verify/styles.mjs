const KEYWORD_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "inherit", "initial", "unset", "revert", "revert-layer", "default",
]);
const BARE_FAMILY = /^-?[A-Za-z_][\w-]*(?: -?[A-Za-z_][\w-]*)*$/;
export const CSS_SIGNIFICANT_DIGITS = 6;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

export const canonicalCssValue = (value) => {
  let result = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] === "'" || value[index] === '"') {
      const quote = value[index];
      const start = index++;
      while (index < value.length) {
        if (value[index] === "\\") index += 2;
        else if (value[index++] === quote) break;
      }
      result += value.slice(start, index);
      continue;
    }
    if (value.slice(index, index + 4).toLowerCase() === "url(") {
      let depth = 0;
      let quote = "";
      let end = index;
      for (; end < value.length; end++) {
        const char = value[end];
        if (quote) {
          if (char === "\\") end += 1;
          else if (char === quote) quote = "";
        } else if (char === "'" || char === '"') quote = char;
        else if (char === "(") depth += 1;
        else if (char === ")" && --depth === 0) {
          end += 1;
          break;
        }
      }
      result += value.slice(index, end);
      index = end;
      continue;
    }
    if (value[index] === "#") {
      const hash = /^#[\da-f]+/i.exec(value.slice(index));
      if (hash) {
        result += hash[0];
        index += hash[0].length;
        continue;
      }
    }
    const previous = value[index - 1] ?? "";
    if (!/[\w#-]/.test(previous)) {
      const number = NUMBER.exec(value.slice(index));
      if (number) {
        result += Number(number[0]).toPrecision(CSS_SIGNIFICANT_DIGITS);
        index += number[0].length;
        continue;
      }
    }
    result += value[index++];
  }
  return result;
};

export const canonicalFontFamily = (name) => {
  const quoted = name.trim().match(/^(\")(.*)\1$/) ?? name.trim().match(/^(')(.*)\1$/);
  if (!quoted) return name.trim();
  const inner = quoted[2];
  return BARE_FAMILY.test(inner) && !KEYWORD_FAMILIES.has(inner.toLowerCase()) ? inner : `"${inner}"`;
};


export const canonicalStyle = (style = "", writingMode = "horizontal-tb") => {
  const horizontal = writingMode.startsWith("horizontal");
  const declarations = [];
  const sizes = new Map();
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) {
      declarations.push(declaration);
      continue;
    }
    const name = declaration.slice(0, colon);
    const pseudo = ["::before", "::after", "::marker", "::placeholder"].find((prefix) => name.startsWith(prefix)) ?? "";
    const property = name.slice(pseudo.length);
    if (["width", "height", "inline-size", "block-size"].includes(property)) {
      const physical = property === "inline-size" ? (horizontal ? "width" : "height") :
        property === "block-size" ? (horizontal ? "height" : "width") : property;
      const key = `${pseudo}|${physical}`;
      const values = sizes.get(key) ?? [];
      values.push({ property, declaration, value: declaration.slice(colon + 1) });
      sizes.set(key, values);
    } else {
      declarations.push(declaration);
    }
  }
  for (const [key, values] of sizes) {
    const physical = key.split("|")[1];
    const physicalValue = values.find(({ property }) => property === physical)?.value;
    const logical = values.filter(({ property }) => property === "inline-size" || property === "block-size");
    const equivalent = physicalValue !== undefined && logical.length > 0 && logical.every(({ value }) => value === physicalValue);
    declarations.push(...values.filter(({ property }) => !equivalent || property === physical).map(({ declaration }) => declaration));
  }
  return declarations.join(";");
};
