import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { launch } from "./engines/index.mjs";
import { capture, scenarios } from "./capture.mjs";
import { differences } from "./compare.mjs";

const [original, optimized, scenarioName, directory] = process.argv.slice(2);
const scenario = scenarios.find((entry) => entry.name === scenarioName);
if (!scenario) throw new Error(`unknown scenario ${scenarioName}`);
mkdirSync(directory, { recursive: true });

const PADDING = 24;
const SCALE = 12;

const crop = (image, x0, y0, x1, y1) => {
  const width = (x1 - x0 + 1) * SCALE;
  const height = (y1 - y0 + 1) * SCALE;
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((y0 + Math.floor(y / SCALE)) * image.width + x0 + Math.floor(x / SCALE)) * 4;
      const to = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) out.data[to + channel] = image.data[from + channel];
    }
  }
  return PNG.sync.write(out);
};

const open = await launch({ args: ["--allow-file-access-from-files"] });
try {
  const before = await capture(open, original, scenario, false);
  const after = await capture(open, optimized, scenario, false);
  const left = PNG.sync.read(before.states[0].screenshot);
  const right = PNG.sync.read(after.states[0].screenshot);
  writeFileSync(join(directory, "original.png"), before.states[0].screenshot);
  writeFileSync(join(directory, "optimized.png"), after.states[0].screenshot);
  if (left.width !== right.width || left.height !== right.height) {
    writeFileSync(join(directory, "summary.txt"), `sizes differ: ${left.width}x${left.height} vs ${right.width}x${right.height}\n`);
  } else {
    const found = differences(left, right);
    const lines = [`pixels off by more than one level: ${found.count}`, `pixels off by exactly one level: ${found.rounded}`];
    const [minX, minY, maxX, maxY] = found.anyBox;
    if (maxX >= 0) {
      const region = [Math.max(0, minX - PADDING), Math.max(0, minY - PADDING), Math.min(left.width - 1, maxX + PADDING), Math.min(left.height - 1, maxY + PADDING)];
      writeFileSync(join(directory, "zoom-original.png"), crop(left, ...region));
      writeFileSync(join(directory, "zoom-optimized.png"), crop(right, ...region));
      const pixels = [];
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const at = (y * left.width + x) * 4;
        pixels.push(`(${x},${y}) rgba(${left.data.subarray(at, at + 4).join(",")}) vs rgba(${right.data.subarray(at, at + 4).join(",")})`);
      }
      lines.push(`pixels that differ at all lie within x ${minX}-${maxX} y ${minY}-${maxY}`, ...pixels.slice(0, 40), `zoomed region x ${region[0]}-${region[2]} y ${region[1]}-${region[3]} at ${SCALE}x`);
    }
    writeFileSync(join(directory, "summary.txt"), `${lines.join("\n")}\n`);
  }
} finally {
  await open.close();
}
