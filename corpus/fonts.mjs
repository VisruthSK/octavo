import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = join(import.meta.dirname, ".cache", "fonts");
const pinned = JSON.parse(readFileSync(join(import.meta.dirname, "fonts.json"), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pathOf = (name) => join(directory, `${name}.ttf`);

const ATTEMPTS = 4;

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { redirect: "follow" }).catch((error) => ({ ok: false, status: 0, error }));
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    const transient = response.status === 0 || response.status === 429 || response.status >= 500;
    if (!transient || attempt === ATTEMPTS) throw new Error(`${url} returned ${response.status || response.error}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

export async function ensureFonts() {
  mkdirSync(directory, { recursive: true });
  for (const font of pinned) {
    if (existsSync(pathOf(font.name)) && sha256(readFileSync(pathOf(font.name))) === font.sha256) continue;
    const bytes = await download(font.url);
    if (sha256(bytes) !== font.sha256) throw new Error(`${font.name}: download does not match the pinned sha256`);
    writeFileSync(pathOf(font.name), bytes);
  }
}

export function fontFace(name) {
  const font = pinned.find((entry) => entry.name === name);
  if (!font) throw new Error(`no pinned font named ${name}`);
  if (!existsSync(pathOf(name))) throw new Error(`${name} is not downloaded yet, run node corpus/build.mjs`);
  const data = readFileSync(pathOf(name)).toString("base64");
  return `@font-face{font-family:'${font.family}';font-weight:100 900;src:url(data:font/ttf;base64,${data}) format('truetype')}`;
}

if (process.argv[1]?.endsWith("fonts.mjs")) {
  await ensureFonts();
  console.log(`${pinned.length} fonts ready in ${directory}`);
}
