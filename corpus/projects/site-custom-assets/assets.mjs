import { readFileSync } from "node:fs";
import { join } from "node:path";
import { png } from "../../docs/assets.mjs";
import { ensureFonts } from "../../fonts.mjs";

export default async () => {
  await ensureFonts();
  return {
    "img/dot.png": png({ width: 96, height: 96 }),
    "fonts/fira.woff2": readFileSync(join(import.meta.dirname, "..", "..", ".cache", "fonts", "fira-sans-woff2.woff2")),
    "fonts/legacy.ttf": readFileSync(join(import.meta.dirname, "..", "..", ".cache", "fonts", "fira-sans.ttf")),
  };
};
