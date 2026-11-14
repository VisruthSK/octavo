import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

const CHUNK_BYTES = 8 * 1024 * 1024;
const remembered = new Map();

const digestOf = (path) => {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  const descriptor = openSync(path, "r");
  try {
    for (let read = readSync(descriptor, buffer, 0, CHUNK_BYTES, null); read > 0; read = readSync(descriptor, buffer, 0, CHUNK_BYTES, null)) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
};

export const executableFingerprint = (path) => {
  if (!path || !existsSync(path)) return "missing";
  const size = statSync(path).size;
  const key = `${path}:${size}`;
  if (!remembered.has(key)) remembered.set(key, `${size}-${digestOf(path).slice(0, 24)}`);
  return remembered.get(key);
};
