import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const { outputFiles } = await build({
  stdin: { contents: 'import { decompress } from "brotli/decompress.js"; export default decompress;', resolveDir: import.meta.dirname },
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "BR",
  platform: "browser",
  conditions: ["browser"],
  write: false,
});
writeFileSync(new URL("brotli.js", import.meta.url), outputFiles[0].text.trim());
