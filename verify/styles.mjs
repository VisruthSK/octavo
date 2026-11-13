const KEYWORD_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
  "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "inherit", "initial", "unset", "revert", "revert-layer", "default",
]);
const BARE_FAMILY = /^-?[A-Za-z_][\w-]*(?: -?[A-Za-z_][\w-]*)*$/;

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
    const physical = property === "inline-size" ? (horizontal ? "width" : "height") :
      property === "block-size" ? (horizontal ? "height" : "width") : property;
    if (["width", "height"].includes(physical)) {
      const key = `${pseudo}${physical}`;
      const isPhysical = property === physical;
      const existing = sizes.get(key);
      if (!existing || isPhysical || !existing.isPhysical) {
        sizes.set(key, { declaration: `${key}${declaration.slice(colon)}`, isPhysical });
      }
    } else {
      declarations.push(`${pseudo}${physical}${declaration.slice(colon)}`);
    }
  }
  return [...declarations, ...[...sizes.values()].map(({ declaration }) => declaration)].join(";");
};
