export function validStyles(state) {
  const { styles, styleValues } = state;
  if (styleValues === undefined) return styles === undefined || (Array.isArray(styles) && styles.every((value) => typeof value === "string"));
  return Array.isArray(styleValues) && styleValues.every((value) => typeof value === "string") &&
    Array.isArray(styles) && styles.every((index) => Number.isInteger(index) && index >= 0 && index < styleValues.length);
}
