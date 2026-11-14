import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
export const directory = join(root, "corpus", ".cache", "captures");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quality = { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } };

export const captureKey = ({ original, scenario, engine, verifier, interactions }) =>
  sha256([sha256(original), scenario, engine, verifier, interactions].join("\n"));

const encode = (screenshot) => {
  if (!screenshot) return null;
  if (Buffer.isBuffer(screenshot)) return { kind: "png", png: screenshot.toString("base64") };
  if (screenshot.kind !== "tiles") return screenshot;
  return { ...screenshot, tiles: screenshot.tiles.map((tile) => ({ ...tile, png: tile.png.toString("base64") })) };
};

const decode = (screenshot) => {
  if (!screenshot) return null;
  if (screenshot.kind === "png") return Buffer.from(screenshot.png, "base64");
  if (screenshot.kind !== "tiles") return screenshot;
  return { ...screenshot, tiles: screenshot.tiles.map((tile) => ({ ...tile, png: Buffer.from(tile.png, "base64") })) };
};

export const payloadOf = (result) => ({
  states: result.states.map(({ screenshot, ...state }) => ({ ...state, screenshot: encode(screenshot) })),
  errors: result.errors,
  requests: result.requests,
  checks: result.checks,
});

export const resultOf = ({ states, errors, requests, checks }) => {
  const decoded = states.map(({ screenshot, ...state }) => ({ ...state, screenshot: decode(screenshot) }));
  return { states: decoded, errors, requests, base: { states: decoded.slice(0, 1), errors: [...errors], requests: [...requests] }, checks };
};

export const readCapture = (key, folder = directory) => {
  const file = join(folder, `${key}.json.br`);
  if (!existsSync(file)) return null;
  try {
    const payload = JSON.parse(brotliDecompressSync(readFileSync(file)).toString("utf8"));
    if (payload.key !== key || !Array.isArray(payload.states) || payload.states.length === 0) return null;
    return resultOf(payload);
  } catch {
    return null;
  }
};

export const writeCapture = (key, result, folder = directory) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${key}.json.br`), brotliCompressSync(Buffer.from(JSON.stringify({ key, ...payloadOf(result) })), quality));
};

const cacheable = (result) => {
  const screenshots = result.checks?.screenshots;
  return (
    result.checks?.settled !== false &&
    result.requests.length === 0 &&
    (!screenshots || screenshots.taken === screenshots.total)
  );
};

export const cachedCapture = async ({ key, folder = directory, capture }) => {
  const hit = readCapture(key, folder);
  if (hit) return { cached: true, result: hit };
  const result = await capture();
  if (cacheable(result)) writeCapture(key, result, folder);
  return { cached: false, result };
};
