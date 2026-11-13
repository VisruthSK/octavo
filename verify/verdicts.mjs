import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
export const directory = join(root, "corpus", ".cache", "verdicts");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const verifierHash = () => {
  const folder = join(root, "verify");
  const names = readdirSync(folder)
    .filter((name) => name.endsWith(".mjs"))
    .sort()
    .concat("package-lock.json");
  const hash = createHash("sha256");
  for (const name of names) {
    hash.update(name);
    hash.update(readFileSync(join(folder, name)));
  }
  return hash.digest("hex");
};

export const verdictKey = ({ original, optimized, level, verifier, browser, scenarios, version }) =>
  sha256([original, optimized, level, verifier, browser, scenarios, version].join("\n"));

export const shouldRevalidate = (key, percent) => {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new RangeError("revalidate must be between 0 and 100");
  return Number.parseInt(key.slice(0, 8), 16) % 100 < percent;
};

export const readVerdict = (key, folder = directory) => {
  const file = join(folder, `${key}.json`);
  if (!existsSync(file)) return null;
  try {
    const verdict = JSON.parse(readFileSync(file, "utf8"));
    return verdict.key === key ? verdict : null;
  } catch {
    return null;
  }
};

export const writeVerdict = (key, verdict, folder = directory) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${key}.json`), `${JSON.stringify({ key, ...verdict }, null, 2)}\n`);
};

export const revalidateVerdict = async (key, cached, verify, folder = directory) => {
  const fresh = await verify();
  if (fresh !== cached) {
    unlinkSync(join(folder, `${key}.json`));
    throw new Error(`cached browser verdict disagrees for ${key}: cached ${cached}, fresh ${fresh}`);
  }
  return fresh;
};

export const readIdentity = (folder = directory) => {
  const file = join(folder, "browser.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

export const writeIdentity = (identity, folder = directory) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "browser.json"), `${JSON.stringify(identity, null, 2)}\n`);
};
