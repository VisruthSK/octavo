import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

export const verdictKey = ({ original, optimized, level, verifier, browser }) =>
  sha256([original, optimized, level, verifier, browser].join("\n"));

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