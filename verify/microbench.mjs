import { performance } from "node:perf_hooks";
import { PNG } from "pngjs";
import { compare, differences, sameStyle } from "./compare.mjs";
import { canonicalCssValue, canonicalStyle } from "./styles.mjs";

const makePng = (width, height, diffAt = null) => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = (x + y) % 256;
      png.data[idx + 1] = (x * 2) % 256;
      png.data[idx + 2] = (y * 3) % 256;
      png.data[idx + 3] = 255;
    }
  }
  if (diffAt) {
    for (const [x, y, delta] of diffAt) {
      const idx = (y * width + x) * 4;
      png.data[idx] = Math.min(255, Math.max(0, png.data[idx] + delta));
    }
  }
  return PNG.sync.write(png);
};

const png1 = makePng(800, 600);
const png2 = makePng(800, 600, [[100, 100, 15], [200, 200, 2], [799, 599, 10]]);

const makeState = (elemCount, mutate = false) => {
  const labels = [];
  const rects = [];
  const styles = [];
  const writingModes = [];
  const stylePool = [
    "color:rgba(10,20,30,1);font-size:16.000000px;width:120.456789px;inline-size:120.456789px;margin:0px 5.500000px",
    "color:rgb(255,0,0);background-image:linear-gradient(180deg,rgb(0,0,0) 0%,rgb(255,255,255) 100%);height:40px",
    "font-family:\"Source Sans Pro\", sans-serif;display:flex;align-items:center;padding:8px 12px",
    "color:#123456;font-size:14px;line-height:1.500000;border:1px solid #ddd",
    "display:none;opacity:0.850000;transform:translate(10.500000px, 20.250000px)",
  ];
  for (let i = 0; i < elemCount; i++) {
    labels.push(`DIV.${i}`);
    rects.push([0, i * 20, 100, 20]);
    let style = stylePool[i % stylePool.length];
    if (mutate && i === 42) {
      style = "color:rgba(10,20,30,1);font-size:17.000000px;width:120.456789px";
    }
    styles.push(style);
    writingModes.push("horizontal-tb");
  }
  return {
    label: "load",
    title: "Test Page",
    accessibility: "heading 'Test'",
    forced: [],
    dom: "<div>" + "<span>item</span>".repeat(elemCount) + "</div>",
    fonts: ["Source Sans Pro", "Inter"],
    animations: [],
    sheets: 2,
    scroll: [1280, 2000],
    labels,
    rects,
    styles,
    writingModes,
    screenshot: png1,
  };
};

const stateA = makeState(5000, false);
const stateB = makeState(5000, true);
const before = { states: [stateA], errors: [], requests: ["http://example.com/style.css"] };
const after = { states: [stateB], errors: [], requests: ["http://example.com/style.css"] };
const afterIdentical = { states: [stateA], errors: [], requests: ["http://example.com/style.css"] };

const tileA = {
  kind: "tiles",
  width: 800,
  height: 1200,
  tiles: [
    { x: 0, y: 0, width: 800, height: 600, png: png1 },
    { x: 0, y: 600, width: 800, height: 600, png: png1 },
  ],
};
const tileB = {
  kind: "tiles",
  width: 800,
  height: 1200,
  tiles: [
    { x: 0, y: 0, width: 800, height: 600, png: png1 },
    { x: 0, y: 600, width: 800, height: 600, png: png2 },
  ],
};
const beforeTile = { states: [{ ...stateA, screenshot: tileA }], errors: [], requests: [] };
const afterTile = { states: [{ ...stateB, screenshot: tileB }], errors: [], requests: [] };

const iterations = 50;
console.log(`Running microbenchmark with ${iterations} iterations...`);

const start = performance.now();
for (let i = 0; i < iterations; i++) {
  compare(before, after, false);
  compare(before, afterIdentical, false);
  compare(beforeTile, afterTile, false);
}
const elapsed = performance.now() - start;
console.log(`Total elapsed: ${elapsed.toFixed(2)}ms (${(elapsed / iterations).toFixed(2)}ms per iter)`);
