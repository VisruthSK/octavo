import { captureScreenshot } from "./capture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { boundMap, compare, differences, missingFrom, sameStyle } from "./compare.mjs";
import { canonicalCssValue, canonicalFontFamily, canonicalStyle, CSS_SIGNIFICANT_DIGITS } from "./styles.mjs";
import { scrollbarPseudo } from "./engines/pseudos.mjs";
import { launch, incompleteChecks, engine } from "./engines/index.mjs";
import pixelmatch from "pixelmatch";

const image = (width, height, fill = 200) => ({ width, height, data: new Uint8Array(width * height * 4).fill(fill) });

const nudged = (base, pixels, by) => {
  const copy = { ...base, data: Uint8Array.from(base.data) };
  for (const [x, y] of pixels) for (let c = 0; c < 3; c++) copy.data[(y * base.width + x) * 4 + c] += by;
  return copy;
};

const block = (count) => Array.from({ length: count }, (_, i) => [i, 0]);

test("a difference of one level is rounding and counts as nothing", () => {
  const base = image(40, 4);
  const result = differences(base, nudged(base, block(30), 1));
  assert.equal(result.count, 0);
  assert.equal(result.rounded, 30);
});

test("a few faint pixels are tolerated and still counted", () => {
  const base = image(40, 4);
  const result = differences(base, nudged(base, block(12), 8));
  assert.equal(result.count, 0);
  assert.equal(result.rounded, 12);
});

test("faint pixels beyond the budget fail", () => {
  const base = image(40, 4);
  assert.equal(differences(base, nudged(base, block(13), 8)).count, 13);
});

test("one pixel off by more than eight levels fails", () => {
  const base = image(40, 4);
  assert.equal(differences(base, nudged(base, [[5, 2]], 9)).count, 1);
});

test("a visible difference takes the faint pixels with it", () => {
  const base = image(40, 4);
  const changed = nudged(nudged(base, [[5, 2]], 40), block(3), 2);
  assert.equal(differences(base, changed).count, 4);
});

const up = "background-image:linear-gradient(0deg, rgb(255, 255, 255) 88%, rgb(115, 133, 159) 100%)";
const down = "background-image:linear-gradient(rgb(115, 133, 159) 0%, rgb(255, 255, 255) 12%)";

test("a linear gradient and its mirror image are the same style", () => {
  assert.deepEqual(missingFrom(up, `color:red;${down}`), []);
  assert.deepEqual(missingFrom(down, up), []);
});

test("a gradient with different colours is a difference", () => {
  const other = "background-image:linear-gradient(rgb(115, 133, 159) 0%, rgb(250, 255, 255) 12%)";
  assert.deepEqual(missingFrom(up, other), [up]);
});

test("a gradient mirrored with the wrong stop positions is a difference", () => {
  const wrong = "background-image:linear-gradient(rgb(115, 133, 159) 0%, rgb(255, 255, 255) 20%)";
  assert.deepEqual(missingFrom(up, wrong), [up]);
});

test("a diagonal gradient is compared as written", () => {
  const diagonal = "background-image:linear-gradient(45deg, red 0%, blue 100%)";
  assert.deepEqual(missingFrom(diagonal, diagonal), []);
  assert.deepEqual(missingFrom(diagonal, "background-image:linear-gradient(225deg, blue 0%, red 100%)"), [diagonal]);
});

test("a font family with its quotes removed is the same style", () => {
  const quoted = "font-family:SFMono-Regular, Menlo, \"Liberation Mono\", \"Courier New\", monospace";
  const bare = "font-family:SFMono-Regular, Menlo, Liberation Mono, Courier New, monospace";
  assert.deepEqual(missingFrom(quoted, bare), []);
  assert.deepEqual(missingFrom(bare, quoted), []);
  assert.deepEqual(missingFrom("font-family:Menlo, monospace", "font-family:monospace"), ["font-family:Menlo, monospace"]);
});

test("a quoted keyword or a name that needs its quotes is not the unquoted one", () => {
  assert.deepEqual(missingFrom('font-family:"serif"', "font-family:serif"), ['font-family:"serif"']);
  assert.deepEqual(missingFrom('font-family:"Monospace", Menlo', "font-family:monospace, Menlo"), ['font-family:"Monospace", Menlo']);
  assert.deepEqual(missingFrom('font-family:"1Face"', "font-family:1Face"), ['font-family:"1Face"']);
  assert.deepEqual(missingFrom("font-family:'Fira Sans', serif", 'font-family:"Fira Sans", serif'), []);
});

test("font fallback order remains significant", () => {
  assert.deepEqual(missingFrom("font-family:Arial, serif", "font-family:serif, Arial"), ["font-family:Arial, serif"]);
});

test("loaded font-family serialization normalizes only syntactic quotes and keeps case", () => {
  assert.equal(canonicalFontFamily('"Source Sans Pro"'), "Source Sans Pro");
  assert.equal(canonicalFontFamily('"serif"'), '"serif"');
  assert.notEqual(canonicalFontFamily('"Arial"'), canonicalFontFamily("arial"));
});

test("logical sizes are removed only when an equal physical size is present", () => {
  assert.deepEqual(canonicalStyle("width:33.333332%;inline-size:33.333332%"), "width:33.333332%");
  assert.deepEqual(
    missingFrom(canonicalStyle("width:33.333332%;inline-size:34%"), "width:33.333332%"),
    ["inline-size:34%"],
  );
  assert.deepEqual(missingFrom(canonicalStyle("inline-size:33.333332%"), "width:33.333332%"), ["inline-size:33.333332%"]);
});

test("vertical logical sizes retain their property when a physical size is missing or differs", () => {
  const inline = canonicalStyle("inline-size:40px", "vertical-rl");
  assert.equal(inline, "inline-size:40px");
  assert.deepEqual(missingFrom(inline, canonicalStyle("height:40px", "vertical-rl")), ["inline-size:40px"]);
  assert.deepEqual(
    missingFrom(canonicalStyle("height:40px;inline-size:41px", "vertical-rl"), "height:40px"),
    ["inline-size:41px"],
  );
  assert.deepEqual(
    missingFrom(canonicalStyle("height:40px;inline-size:40px", "vertical-rl"), "height:40px"),
    [],
  );
});

test("CSS property numbers compare at six significant digits without changing units", () => {
  assert.equal(CSS_SIGNIFICANT_DIGITS, 6);
  assert.deepEqual(missingFrom("width:33.333332%", "width:33.333302%"), []);
  assert.deepEqual(missingFrom("width:33.3333%", "width:33.3334%"), ["width:33.3333%"]);
  assert.deepEqual(missingFrom("width:100px", "width:100.02px"), ["width:100px"]);
  assert.deepEqual(missingFrom("width:12.3456789px", "width:12.3457px"), []);
  assert.deepEqual(missingFrom("width:0.0001px", "width:0.0002px"), ["width:0.0001px"]);
  assert.deepEqual(missingFrom("width:12.3456789px", "width:12.3457em"), ["width:12.3456789px"]);
});

test("numeric text and font names are not rounded", () => {
  assert.deepEqual(missingFrom('content:"100px"', 'content:"100.000px"'), ['content:"100px"']);
  assert.deepEqual(missingFrom("font-family:Font 123", "font-family:Font 123.00000"), ["font-family:Font 123"]);
});

test("physical boxes and screenshot pixels remain exact", () => {
  const state = (width) => ({
    title: "",
    accessibility: "",
    forced: [],
    dom: "",
    fonts: [],
    animations: [],
    sheets: 0,
    scroll: [100, 100],
    labels: ["DIV"],
    rects: [[0, 0, width, 100]],
    styles: [`width:${width}px`],
    screenshot: Buffer.from("same"),
  });
  const issues = compare(
    { states: [state(100)], errors: [], requests: [] },
    { states: [state(100.02)], errors: [], requests: [] },
    false,
  );
  assert.ok(issues.some((issue) => issue.includes("laid out differently")));
  assert.ok(issues.some((issue) => issue.includes("different computed style")));
  assert.equal(differences(image(1, 1), nudged(image(1, 1), [[0, 0]], 9)).count, 1);
});

test("a missing screenshot is an issue when either or both captures lack one", () => {
  const state = (screenshot) => ({
    title: "",
    accessibility: "",
    forced: [],
    dom: "",
    fonts: [],
    animations: [],
    sheets: 0,
    scroll: [0, 0],
    labels: [],
    rects: [],
    styles: [],
    screenshot,
  });
  for (const [before, after] of [[null, null], [Buffer.from("png"), null], [null, Buffer.from("png")]]) {
    const issues = compare(
      { states: [state(before)], errors: [], requests: [] },
      { states: [state(after)], errors: [], requests: [] },
      false,
    );
    assert.ok(issues.some((issue) => issue.includes("screenshot missing")));
  }
});

test("screenshot errors report both failed capture attempts", async () => {
  let evaluations = 0;
  const page = {
    evaluate: async () => {
      evaluations++;
      if (evaluations === 1) return { width: 100, height: 100 };
      if (evaluations === 2 || evaluations === 4) return [0, 0];
    },
    screenshot: async (options) => {
      throw new Error(options.fullPage && !options.clip ? "full page failed" : "tile failed");
    },
  };
  await assert.rejects(captureScreenshot(page, { width: 100, height: 100 }), /full-page screenshot: full page failed; tiled screenshot: tile failed/);
});

test("oversized pages skip the full-page screenshot", async () => {
  const optionsSeen = [];
  const timings = [];
  let evaluations = 0;
  const page = {
    evaluate: async () => ++evaluations === 1 ? { width: 100, height: 16385 } : [0, 0],
    screenshot: async (options) => { optionsSeen.push(options); return Buffer.from("tile"); },
  };
  const result = await captureScreenshot(page, { width: 100, height: 100 }, (tile) => timings.push(tile));
  assert.equal(result.kind, "tiles");
  assert.equal(result.tiles.length, 3);
  assert.ok(optionsSeen.every((options) => options.fullPage && options.clip));
  assert.equal(timings.length, 3);
});

test("missing screenshot reports its capture error", () => {
  const state = (screenshot, screenshotError) => ({
    title: "", accessibility: "", forced: [], dom: "", fonts: [], animations: [], sheets: 0,
    scroll: [0, 0], labels: [], rects: [], styles: [], screenshot, screenshotError,
  });
  const issues = compare(
    { states: [state(Buffer.from("png"))], errors: [], requests: [] },
    { states: [state(null, "tile failed")], errors: [], requests: [] },
    false,
  );
  assert.ok(issues.some((issue) => issue.includes("screenshot missing in optimized capture (optimized: tile failed)")));
});
test("screenshot limits report incomplete comparison", () => {
  const state = (screenshot) => ({
    title: "",
    accessibility: "",
    forced: [],
    dom: "",
    fonts: [],
    animations: [],
    sheets: 0,
    scroll: [0, 0],
    labels: [],
    rects: [],
    styles: [],
    screenshot,
  });
  const compareScreenshots = (before, after) => compare(
    { states: [state(before)], errors: [], requests: [] },
    { states: [state(after)], errors: [], requests: [] },
    false,
  );
  const limited = (height, limit = 20_000_000) => ({ kind: "limit", width: 1280, height, limit });
  assert.ok(compareScreenshots(limited(200_000), limited(200_000)).some((issue) => issue.includes("check incomplete: screenshot pixels not compared")));
  assert.ok(compareScreenshots(limited(200_000), Buffer.from("not a screenshot"))[0].includes("page too large for screenshots limit"));
  assert.ok(compareScreenshots(limited(200_000), limited(210_000))[0].includes("page too large for screenshots limit differs"));
});

test("large screenshots compare every tile", () => {
  const state = (screenshot) => ({
    title: "",
    accessibility: "",
    forced: [],
    dom: "",
    fonts: [],
    animations: [],
    sheets: 0,
    scroll: [0, 0],
    labels: [],
    rects: [],
    styles: [],
    screenshot,
  });
  const pixel = (color) => {
    const image = new PNG({ width: 1, height: 1 });
    image.data = Buffer.from([color, 0, 0, 255]);
    return PNG.sync.write(image);
  };
  const tiles = (color) => ({
    kind: "tiles",
    width: 1,
    height: 1,
    tiles: [{ x: 0, y: 0, width: 1, height: 1, png: pixel(color) }],
  });
  const check = (before, after) => compare(
    { states: [state(before)], errors: [], requests: [] },
    { states: [state(after)], errors: [], requests: [] },
    false,
  );
  assert.deepEqual(check(tiles(0), tiles(0)), []);
  assert.ok(check(tiles(0), tiles(200)).some((issue) => issue.includes("tile at 0,0: screenshot")));
});

test("an unreachable marker differing from a reachable state fails comparison", () => {
  const state = (forced) => ({
    title: "",
    accessibility: "",
    forced: [[":hover on interactive #0", forced]],
    dom: "",
    fonts: [],
    animations: [],
    sheets: 0,
    scroll: [0, 0],
    labels: [],
    rects: [],
    styles: [],
    screenshot: Buffer.from("same"),
  });
  const issues = compare(
    { states: [state("unreachable")], errors: [], requests: [] },
    { states: [state("color:red")], errors: [], requests: [] },
    false,
  );
  assert.ok(issues.some((issue) => issue.includes("forced :hover")));
});

test("quotes elsewhere in a declaration still matter", () => {
  assert.deepEqual(missingFrom('content:"a"', "content:a"), ['content:"a"']);
});

test("declarations without gradients still compare exactly", () => {
  assert.deepEqual(missingFrom("color:red;width:10px", "width:10px"), ["color:red"]);
});

test("scrollbar pseudo styles remain distinct and comparable", () => {
  const before = `${scrollbarPseudo}width:8px;`;
  const after = `${scrollbarPseudo}width:9px;`;
  assert.deepEqual(missingFrom(canonicalStyle(before), canonicalStyle(after)), [`${scrollbarPseudo}width:8px`]);
});

test("a mirrored gradient makes two style strings the same, an extra declaration does not", async () => {
  const { sameStyle } = await import("./compare.mjs");
  assert.equal(sameStyle(`color:red;${up}`, `${down};color:red`), true);
  assert.equal(sameStyle(`color:red;${up}`, `${down};color:red;width:1px`), false);
});

test("missing and extra computed style entries are reported instead of throwing", () => {
  const state = (styles) => ({
    title: "",
    accessibility: "",
    forced: [],
    dom: "",
    fonts: [],
    animations: [],
    sheets: 0,
    scroll: [0, 0],
    labels: ["DIV", "P"],
    rects: [[0, 0, 1, 1], [0, 0, 1, 1]],
    styles,
    screenshot: null,
  });
  for (const styles of [["color:red"], ["color:red", "color:blue", "color:green"]]) {
    const issues = compare(
      { states: [state(["color:red", "color:blue"])], errors: [], requests: [] },
      { states: [state(styles)], errors: [], requests: [] },
      false,
    );
    assert.ok(issues.some((issue) => issue.includes("style count")));
  }
});

test("interned styles retain late element and pseudo-style differences", () => {
  const state = (styles, styleValues) => ({
    title: "", accessibility: "", forced: [], dom: "", fonts: [], animations: [], sheets: 0,
    scroll: [0, 0], labels: ["P", "P", "P"], rects: [[0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1]],
    styles, styleValues, screenshot: Buffer.from("same"),
  });
  const a = state([0, 0, 0], ["color:red;::selectioncolor:blue"]);
  const b = state([1, 1, 0], ["color:red;::selectioncolor:green", "color:red;::selectioncolor:blue"]);
  const result = compare({ states: [a], errors: [], requests: [] }, { states: [b], errors: [], requests: [] }, false);
  assert.ok(result.some((issue) => issue.includes("1 elements with different computed style")));
  const same = state([1, 1, 1], b.styleValues);
  assert.deepEqual(compare({ states: [a], errors: [], requests: [] }, { states: [same], errors: [], requests: [] }, false), []);
});

test("interned and legacy styles compare with each element's writing mode", () => {
  const state = (styles, styleValues, writingModes) => ({
    title: "", accessibility: "", forced: [], dom: "", fonts: [], animations: [], sheets: 0,
    scroll: [0, 0], labels: ["P"], rects: [[0, 0, 1, 1]], styles, styleValues, writingModes,
    screenshot: Buffer.from("same"),
  });
  const style = "width:40px;inline-size:40px";
  const original = state([style], undefined, ["horizontal-tb"]);
  const same = state([0], [style], ["horizontal-tb"]);
  const otherMode = state([0], [style], ["vertical-rl"]);
  const check = (a, b) => compare({ states: [a], errors: [], requests: [] }, { states: [b], errors: [], requests: [] }, false);
  assert.deepEqual(check(original, same), []);
  assert.ok(check(original, otherMode).some((issue) => issue.includes("different computed style")));
  assert.throws(() => check(original, state([1], [style], ["horizontal-tb"])), /invalid computed style storage/);
});

test("the requests comparison ignores order and lazily fetched font files and keeps everything else", () => {
  const state = {
    title: "",
    accessibility: "",
    forced: [],
    dom: "",
    fonts: [],
    animations: [],
    sheets: 0,
    scroll: [100, 100],
    labels: ["DIV"],
    rects: [[0, 0, 100, 100]],
    styles: ["width:100px"],
    screenshot: Buffer.from("same"),
  };
  const run = (before, after) => compare({ states: [state], errors: [], requests: before }, { states: [state], errors: [], requests: after }, false);
  const script = "https://cdn.example/lib.js";
  const style = "https://cdn.example/lib.css";
  const font = "https://cdn.example/fonts/Size4-Regular.woff?V=2.7.9";
  assert.deepEqual(run([script, font, style], [style, script]), []);
  assert.deepEqual(run([script, style], [style, script, script]), []);
  assert.ok(run([script, style], [script]).some((issue) => issue.startsWith("requests:")));
  assert.ok(run([script], [script, "https://cdn.example/extra.js"]).some((issue) => issue.startsWith("requests:")));
  assert.ok(run([script], [script, "https://cdn.example/image.png"]).some((issue) => issue.startsWith("requests:")));
});

test("linked mode missing file count comparisons", () => {
  const state = {
    title: "",
    accessibility: "",
    forced: [],
    dom: "",
    fonts: [],
    animations: [],
    sheets: 0,
    scroll: [100, 100],
    labels: ["DIV"],
    rects: [[0, 0, 100, 100]],
    styles: ["width:100px"],
    screenshot: Buffer.from("same"),
  };
  const make = (errors, missingFiles) => ({
    states: [state],
    errors,
    requests: [],
    checks: missingFiles !== undefined ? { missingFiles } : {},
  });

  assert.deepEqual(compare(make([], 2), make([], 2), false), []);
  assert.deepEqual(compare(make([], 2), make([], 1), false), []);
  assert.deepEqual(compare(make([], 1), make([], 3), false), [
    "2 more missing files on the optimized page",
  ]);
  assert.deepEqual(compare(make(["TypeError: x is undefined"], 1), make([], 1), false), [
    'console errors: ["TypeError: x is undefined"] vs []',
  ]);
  assert.deepEqual(
    compare(
      make(["Failed to load resource: net::ERR_FILE_NOT_FOUND"], 1),
      make(["Failed to load resource: net::ERR_FILE_NOT_FOUND"], 1),
      false,
    ),
    [],
  );
  const notFound = "Failed to load resource: the server responded with a status of 404 (Not Found)";
  assert.deepEqual(compare(make([notFound, notFound], 2), make([], 2), false), []);
  assert.deepEqual(compare(make([notFound], undefined), make([], undefined), false), [`console errors: ["${notFound}"] vs []`]);
  assert.deepEqual(compare(make(["a", "b"], 1), make(["b", "a"], 1), false), []);
  assert.deepEqual(compare(make(["a", "a"], 1), make(["a"], 1), false), ['console errors: ["a","a"] vs ["a"]']);
  assert.deepEqual(
    compare(
      { states: [state], errors: ["Failed to load resource: net::ERR_FILE_NOT_FOUND"], requests: [] },
      { states: [state], errors: [], requests: [] },
      false,
    ),
    ['console errors: ["Failed to load resource: net::ERR_FILE_NOT_FOUND"] vs []'],
  );
});

test("lazily loaded math renderer fonts are not part of the loaded fonts comparison and other fonts are", () => {
  const state = (fonts) => ({
    title: "",
    accessibility: "",
    forced: [],
    dom: "",
    fonts,
    animations: [],
    sheets: 0,
    scroll: [100, 100],
    labels: ["DIV"],
    rects: [[0, 0, 100, 100]],
    styles: ["width:100px"],
    screenshot: Buffer.from("same"),
  });
  const run = (before, after) => compare({ states: [state(before)], errors: [], requests: [] }, { states: [state(after)], errors: [], requests: [] }, false);
  assert.deepEqual(run(["MathJax_Main", "Source Sans Pro"], ["MathJax_Main", "MathJax_Size4", "Source Sans Pro"]), []);
  assert.deepEqual(run(["KaTeX_Main", "Inter"], ["Inter"]), []);
  assert.ok(run(["Inter", "Source Sans Pro"], ["Inter"]).some((issue) => issue.includes("fonts ")));
  assert.ok(run(["Inter"], ["Inter", "Source Sans Pro"]).some((issue) => issue.includes("fonts ")));
});


test("a synthetic tall page compares the last tile and reports a tile cap", async () => {
  const browser = await launch();
  try {
    const viewport = { width: 1280, height: 720 };
    const page = await browser.newPage({ viewport });
    await page.setContent('<style>body { margin: 0; height: 16000px } #pixel { position: absolute; top: 15999px; left: 0; width: 1px; height: 1px; background: white }</style><div id="pixel"></div>');
    const capture = () => captureScreenshot({
      evaluate: (...args) => page.evaluate(...args),
      screenshot: (options) => options.fullPage && !options.clip ? Promise.reject(new Error("screenshot too large")) : page.screenshot(options),
    }, viewport);
    const before = await capture();
    await page.locator("#pixel").evaluate((pixel) => pixel.style.background = "black");
    const after = await capture();
    assert.equal(before.kind, "tiles");
    assert.equal(before.height, 16000);
    assert.equal(before.tiles.at(-1).y + before.tiles.at(-1).height, 16000);
    const state = (screenshot) => ({ label: "load", title: "", accessibility: "", forced: [], dom: "", fonts: [], animations: [], sheets: 0, scroll: [0, 0], labels: [], rects: [], styles: [], screenshot });
    const result = (screenshot) => ({ states: [state(screenshot)], errors: [], requests: [] });
    assert.deepEqual(compare(result(before), result(before), false), []);
    assert.ok(compare(result(before), result(after), false).some((issue) => issue.includes(`tile at 0,${before.tiles.at(-1).y}: screenshot: 1 pixels differ`)));
    await page.evaluate(() => document.body.style.height = "17000000px");
    const limited = await capture();
    assert.equal(limited.kind, "limit");
    assert.equal(limited.reason, "tile count");
    const checks = { elements: 0, screenshots: { taken: 1, total: 1, limits: [{ label: "load", ...limited }] } };
    assert.ok(incompleteChecks(checks).some((issue) => issue.startsWith("check incomplete: screenshot pixels not compared")));
  } finally {
    await browser.close();
  }
});

test("script-disabled tall pages compare their last tile", { timeout: 10000 }, async () => {
  const browser = await launch();
  try {
    const viewport = { width: 100, height: 100 };
    const page = await browser.newPage({ viewport, javaScriptEnabled: false });
    await page.setContent('<style>body{margin:0;height:16385px} #pixel{position:absolute;top:16384px;width:1px;height:1px;background:white}</style><div id="pixel"></div>');
    const before = await captureScreenshot(page, viewport, () => {}, false);
    await page.locator("#pixel").evaluate((pixel) => pixel.style.background = "black");
    const after = await captureScreenshot(page, viewport, () => {}, false);
    assert.equal(before.kind, "tiles");
    assert.equal(before.tiles.at(-1).y + before.tiles.at(-1).height, 16385);
    const state = (screenshot) => ({ label: "load", title: "", accessibility: "", forced: [], dom: "", fonts: [], animations: [], sheets: 0, scroll: [0, 0], labels: [], rects: [], styles: [], screenshot });
    const result = (screenshot) => ({ states: [state(screenshot)], errors: [], requests: [] });
    assert.ok(compare(result(before), result(after), false).some((issue) => issue.includes(`tile at 0,${before.tiles.at(-1).y}: screenshot: 1 pixels differ`)));
  } finally {
    await browser.close();
  }
});

test("bounded map clears when it exceeds 50000 entries", () => {
  const map = boundMap();
  for (let i = 0; i < 50000; i++) map.set(i, i);
  assert.equal(map.size, 50000);
  map.set(50000, 50000);
  assert.equal(map.size, 0);
});

test("bounded map helper clears custom limit", () => {
  const map = boundMap(new Map(), 3);
  map.set("a", 1);
  map.set("b", 2);
  map.set("c", 3);
  assert.equal(map.size, 3);
  map.set("d", 4);
  assert.equal(map.size, 0);
});

const unquotedFamiliesRef = (declaration) =>
  declaration.replace(/font-family:(.*)$/, (_, value) => `font-family:${value.split(",").map(canonicalFontFamily).join(", ")}`);

const canonicalRef = (declaration) => {
  let text = unquotedFamiliesRef(declaration);
  const marker = "linear-gradient(";
  const start = text.indexOf(marker);
  if (start >= 0) {
    const open = start + marker.length - 1;
    let depth = 0;
    let end = -1;
    for (let at = open; at < text.length; at++) {
      if (text[at] === "(") depth += 1;
      else if (text[at] === ")" && --depth === 0) { end = at; break; }
    }
    if (end >= 0) {
      const parts = [];
      let d = 0;
      let from = 0;
      const body = text.slice(open + 1, end);
      for (let at = 0; at < body.length; at++) {
        if (body[at] === "(") d += 1;
        else if (body[at] === ")") d -= 1;
        else if (body[at] === "," && d === 0) {
          parts.push(body.slice(from, at).trim());
          from = at + 1;
        }
      }
      parts.push(body.slice(from).trim());
      const direction = /^-?[\d.]+deg$/.test(parts[0]) ? parts.shift() : null;
      const angle = (((direction ? parseFloat(direction) : 180) % 360) + 360) % 360;
      const stops = parts.map((part) => part.match(/^(.*\S)\s+(-?[\d.]+)%$/));
      if (!stops.some((stop) => !stop) && (angle === 0 || angle === 180)) {
        const placed = stops.map(([, color, position]) => [color, parseFloat(position)]);
        const upright = angle === 0 ? placed.map(([color, position]) => [color, 100 - position]).reverse() : placed;
        const replaced = `linear-gradient(180deg,${upright.map(([color, position]) => `${color} ${String(Number(position.toFixed(4)))}%`).join(",")})`;
        text = text.slice(0, start) + replaced + text.slice(end + 1);
      }
    }
  }
  const pseudo = ["::before", "::after", "::marker", "::placeholder", "::selection", scrollbarPseudo].find((prefix) => text.startsWith(prefix)) ?? "";
  const colon = text.indexOf(":", pseudo ? 2 : 0);
  if (colon < 0 || text.slice(pseudo.length, colon) === "font-family") return text;
  return `${text.slice(0, colon + 1)}${canonicalCssValue(text.slice(colon + 1))}`;
};

const missingFromRef = (reference, candidate = "") => {
  const present = new Set(candidate.split(";").map(canonicalRef));
  return reference.split(";").filter((declaration) => !present.has(canonicalRef(declaration)));
};

const sameStyleRef = (left, right = "") =>
  left === right || (missingFromRef(left, right).length === 0 && missingFromRef(right, left).length === 0);

function differencesRef(left, right, tolerance = engine.pixel) {
  if (Buffer.from(left.data.buffer, left.data.byteOffset, left.data.byteLength).equals(Buffer.from(right.data.buffer, right.data.byteOffset, right.data.byteLength))) {
    return { count: 0, rounded: 0, different: 0, max: 0, box: [Infinity, Infinity, -1, -1], anyBox: [Infinity, Infinity, -1, -1], where: "" };
  }
  const rounding = tolerance.channel;
  const faintLevels = tolerance.faint;
  const budget = tolerance.budget;
  let count = 0;
  let rounded = 0;
  let different = 0;
  let max = 0;
  const faint = [];
  let [anyMinX, anyMinY, anyMaxX, anyMaxY] = [Infinity, Infinity, -1, -1];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -1, -1];
  let first = "";
  for (let y = 0; y < left.height; y++) {
    for (let x = 0; x < left.width; x++) {
      const at = (y * left.width + x) * 4;
      const worst = Math.max(
        Math.abs(left.data[at] - right.data[at]),
        Math.abs(left.data[at + 1] - right.data[at + 1]),
        Math.abs(left.data[at + 2] - right.data[at + 2]),
        Math.abs(left.data[at + 3] - right.data[at + 3]),
      );
      if (worst > 0) {
        different += 1;
        max = Math.max(max, worst);
        [anyMinX, anyMinY, anyMaxX, anyMaxY] = [Math.min(anyMinX, x), Math.min(anyMinY, y), Math.max(anyMaxX, x), Math.max(anyMaxY, y)];
      }
      if (worst <= rounding) {
        if (worst > 0) rounded += 1;
        continue;
      }
      if (worst <= faintLevels) {
        faint.push([x, y, at]);
        continue;
      }
      count += 1;
      first ||= `(${x},${y}) rgba(${left.data.subarray(at, at + 4).join(",")}) vs rgba(${right.data.subarray(at, at + 4).join(",")})`;
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  const spread = count > 0 || faint.length > budget;
  if (!spread) rounded += faint.length;
  else for (const [x, y, at] of faint) {
    count += 1;
    first ||= `(${x},${y}) rgba(${left.data.subarray(at, at + 4).join(",")}) vs rgba(${right.data.subarray(at, at + 4).join(",")})`;
    [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
  }
  return { count, rounded, different, max, box: [minX, minY, maxX, maxY], anyBox: [anyMinX, anyMinY, anyMaxX, anyMaxY], where: count ? `, within x ${minX}-${maxX} y ${minY}-${maxY}, first ${first}` : "" };
}

function compareImageBytesRef(a, b, lossy, stats) {
  if (a.equals(b)) return [];
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) {
    return [`screenshot size ${left.width}x${left.height} vs ${right.width}x${right.height}`];
  }
  if (lossy) {
    const differing = pixelmatch(left.data, right.data, null, left.width, left.height, { threshold: 0.1 });
    return differing / (left.width * left.height) > 0.02 ? [`screenshot: ${differing} pixels differ`] : [];
  }
  const { count, rounded, where } = differencesRef(left, right);
  if (stats) stats.roundedPixels += rounded;
  return count ? [`screenshot: ${count} pixels differ by more than ${engine.pixel.channel}${where}`] : [];
}

function compareScreenshotsRef(a, b, lossy, stats) {
  if (a?.kind === "limit" || b?.kind === "limit") {
    if (a?.kind !== "limit" || b?.kind !== "limit") {
      const limited = a?.kind === "limit" ? "original" : "optimized";
      const screenshot = a?.kind === "limit" ? a : b;
      return [`page too large for screenshots limit on ${limited}: ${screenshot.width}x${screenshot.height}, ${screenshot.reason ?? "pixels"} limit ${screenshot.limit}`];
    }
    return a.width === b.width && a.height === b.height && a.limit === b.limit
      ? [`check incomplete: screenshot pixels not compared for page too large for screenshots limit: ${a.width}x${a.height}, ${a.reason ?? "pixels"} limit ${a.limit}`]
      : [`page too large for screenshots limit differs: original ${a.width}x${a.height}, ${a.reason ?? "pixels"} limit ${a.limit}, optimized ${b.width}x${b.height}, ${b.reason ?? "pixels"} limit ${b.limit}`];
  }
  if (a.kind !== "tiles" && b.kind !== "tiles") return compareImageBytesRef(a, b, lossy, stats);
  if (a.kind !== "tiles" || b.kind !== "tiles") return ["screenshot tile coverage differs"];
  if (a.width !== b.width || a.height !== b.height) return [`screenshot size ${a.width}x${a.height} vs ${b.width}x${b.height}`];
  if (a.tiles.length !== b.tiles.length) return [`screenshot tile count ${a.tiles.length} vs ${b.tiles.length}`];
  const issues = [];
  for (const [index, left] of a.tiles.entries()) {
    const right = b.tiles[index];
    if (left.x !== right.x || left.y !== right.y || left.width !== right.width || left.height !== right.height) {
      issues.push(`screenshot tile ${index} region differs: ${left.x},${left.y} ${left.width}x${left.height} vs ${right.x},${right.y} ${right.width}x${right.height}`);
      continue;
    }
    issues.push(...compareImageBytesRef(left.png, right.png, lossy, stats).map((issue) => `tile at ${left.x},${left.y}: ${issue}`));
  }
  return issues;
}

const MISSING_FILE_ERROR = /^Failed to load resource: (?:the server responded with a status of 404|net::ERR_FILE_NOT_FOUND)/;

function compareRef(before, after, lossy, stats) {
  if (before.crashed || after.crashed) return [`crashed: original=${before.crashed ?? "no"} optimized=${after.crashed ?? "no"}`];
  const issues = [];
  if (!before.states.length) issues.push("original produced no states");
  const linked = before.checks?.missingFiles !== undefined || after.checks?.missingFiles !== undefined;
  const countedElsewhere = (error) => linked && MISSING_FILE_ERROR.test(error);
  const beforeErrors = before.errors.filter((error) => !countedElsewhere(error)).sort();
  const afterErrors = after.errors.filter((error) => !countedElsewhere(error)).sort();
  if (JSON.stringify(beforeErrors) !== JSON.stringify(afterErrors)) {
    issues.push(`console errors: ${JSON.stringify(beforeErrors)} vs ${JSON.stringify(afterErrors)}`);
  }
  if (linked) {
    const beforeCount = before.checks?.missingFiles ?? 0;
    const afterCount = after.checks?.missingFiles ?? 0;
    if (afterCount > beforeCount) {
      issues.push(`${afterCount - beforeCount} more missing files on the optimized page`);
    }
  }
  const requestsBefore = [...new Set(before.requests.filter((url) => !/.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(url)))].sort();
  const requestsAfter = [...new Set(after.requests.filter((url) => !/.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(url)))].sort();
  if (requestsBefore.join() !== requestsAfter.join()) issues.push(`requests: ${requestsBefore} vs ${requestsAfter}`);
  if (before.states.length !== after.states.length) issues.push(`state count ${before.states.length} vs ${after.states.length}`);
  for (const [i, state] of before.states.entries()) {
    if (after.states[i]) {
      const a = state;
      const b = after.states[i];
      const stateIssues = [];
      if (a.unchanged || b.unchanged) {
        if (a.digest !== b.digest) stateIssues.push("the page changed differently after this interaction");
      } else {
        if (a.title !== b.title) stateIssues.push(`title [${a.title}] vs [${b.title}]`);
        if (a.accessibility !== b.accessibility) stateIssues.push("accessibility tree differs");
        for (const [fi, [name, expected]] of (a.forced ?? []).entries()) {
          const actual = b.forced?.[fi]?.[1] ?? "";
          if (!sameStyleRef(expected, actual)) stateIssues.push(`forced ${name}: ${missingFromRef(expected, actual).slice(0, 3).join(" | ")}`);
        }
        if (a.dom !== b.dom) {
          const len = Math.min(a.dom.length, b.dom.length);
          let at = a.dom.length !== b.dom.length ? len : -1;
          for (let di = 0; di < len; di++) {
            if (a.dom.charCodeAt(di) !== b.dom.charCodeAt(di)) { at = di; break; }
          }
          stateIssues.push(`dom differs at ${at}: [${a.dom.slice(Math.max(0, at - 60), at + 100)}] vs [${b.dom.slice(Math.max(0, at - 60), at + 100)}]`);
        }
        const fontsA = a.fonts.filter((family) => !/^(?:MathJax|KaTeX)_/.test(family));
        const fontsB = b.fonts.filter((family) => !/^(?:MathJax|KaTeX)_/.test(family));
        if (fontsA.join() !== fontsB.join()) stateIssues.push(`fonts ${fontsA} vs ${fontsB}`);
        if (a.animations.join("\n") !== b.animations.join("\n")) {
          const present = new Set(b.animations);
          const missing = a.animations.filter((animation) => !present.has(animation));
          stateIssues.push(`animations ${a.animations.length} vs ${b.animations.length}, e.g. ${(missing[0] ?? "extra in optimized").slice(0, 160)}`);
        }
        if (a.sheets !== b.sheets) stateIssues.push(`style sheets ${a.sheets} vs ${b.sheets}`);
        if (a.scroll.join() !== b.scroll.join()) stateIssues.push(`scroll size ${a.scroll} vs ${b.scroll}`);
        if (a.labels.length !== b.labels.length) stateIssues.push(`element count ${a.labels.length} vs ${b.labels.length}`);
        const tolerance = lossy ? 1 : 0.01;
        const moved = a.rects.flatMap((rect, ri) =>
          rect.every((n, k) => Math.abs(n - (b.rects[ri]?.[k] ?? Infinity)) <= tolerance) ? [] : [ri],
        );
        if (moved.length) {
          const [first] = moved;
          stateIssues.push(`${moved.length} elements laid out differently, e.g. ${a.labels[first]}: [${a.rects[first]}] vs [${b.rects[first]}]`);
        }
        const beforeStyles = a.styles ?? [];
        const afterStyles = b.styles ?? [];
        const styleAt = (s, styles, idx) => idx >= styles.length ? "" : s.styleValues === undefined ? styles[idx] : s.styleValues[styles[idx]];
        if (beforeStyles.length !== afterStyles.length) stateIssues.push(`style count ${beforeStyles.length} vs ${afterStyles.length}`);
        const differing = Array.from({ length: Math.max(beforeStyles.length, afterStyles.length) }, (_, si) => si).filter((si) => {
          const beforeS = styleAt(a, beforeStyles, si);
          const afterS = styleAt(b, afterStyles, si);
          if (beforeS === afterS && a.writingModes?.[si] === b.writingModes?.[si]) return false;
          return !sameStyleRef(canonicalStyle(beforeS, a.writingModes?.[si]), canonicalStyle(afterS, b.writingModes?.[si]));
        });
        if (differing.length) {
          const [first] = differing;
          const beforeS = styleAt(a, beforeStyles, first);
          const afterS = styleAt(b, afterStyles, first);
          const lost = missingFromRef(beforeS, afterS).slice(0, 3);
          const gained = missingFromRef(afterS, beforeS).slice(0, 3);
          stateIssues.push(`${differing.length} elements with different computed style, e.g. ${a.labels[first] ?? ""}: lost ${JSON.stringify(lost)} gained ${JSON.stringify(gained)}`);
        }
        if (!a.screenshot || !b.screenshot) {
          const missing = [!a.screenshot && "original", !b.screenshot && "optimized"].filter(Boolean);
          const details = [!a.screenshot && a.screenshotError && `original: ${a.screenshotError}`, !b.screenshot && b.screenshotError && `optimized: ${b.screenshotError}`].filter(Boolean);
          stateIssues.push(`screenshot missing in ${missing.join(" and ")} capture${details.length ? ` (${details.join("; ")})` : ""}`);
        } else {
          stateIssues.push(...compareScreenshotsRef(a.screenshot, b.screenshot, lossy, stats));
        }
      }
      issues.push(...stateIssues.map((issue) => `${state.label}: ${issue}`));
    }
  }
  return issues;
}

test("proof: identical output to reference implementation across synthetic PNG pairs including edge pixels", () => {
  const width = 64;
  const height = 48;
  const makeRaw = () => new Uint8Array(width * height * 4).fill(120);
  const testPixels = [
    [0, 0, 10],
    [width - 1, 0, 10],
    [0, height - 1, 10],
    [width - 1, height - 1, 10],
    [32, 24, 1],
    [32, 24, 8],
    [32, 24, 9],
    [10, 10, 50],
  ];
  for (const [px, py, diff] of testPixels) {
    const rawA = makeRaw();
    const rawB = makeRaw();
    const idx = (py * width + px) * 4;
    rawB[idx] = Math.min(255, rawB[idx] + diff);
    const imgA = { width, height, data: rawA };
    const imgB = { width, height, data: rawB };
    assert.deepEqual(differences(imgA, imgB), differencesRef(imgA, imgB));
  }
  const identicalA = { width, height, data: makeRaw() };
  const identicalB = { width, height, data: makeRaw() };
  assert.deepEqual(differences(identicalA, identicalB), differencesRef(identicalA, identicalB));
  assert.deepEqual(differences(identicalA, identicalA), differencesRef(identicalA, identicalA));
});

test("proof: identical output to reference implementation across synthetic and real tiled PNGs", () => {
  const makePngBuffer = (w, h, diffPixel = null) => {
    const p = new PNG({ width: w, height: h });
    p.data.fill(100);
    if (diffPixel) {
      const [x, y, v] = diffPixel;
      p.data[(y * w + x) * 4] = v;
    }
    return PNG.sync.write(p);
  };
  const baseTile0 = makePngBuffer(100, 100);
  const baseTile1 = makePngBuffer(100, 100);
  const diffTileEdge = makePngBuffer(100, 100, [99, 99, 240]);
  const diffTileTop = makePngBuffer(100, 100, [0, 0, 240]);

  const tileSetA = {
    kind: "tiles",
    width: 100,
    height: 200,
    tiles: [
      { x: 0, y: 0, width: 100, height: 100, png: baseTile0 },
      { x: 0, y: 100, width: 100, height: 100, png: baseTile1 },
    ],
  };
  const tileSetEdge = {
    kind: "tiles",
    width: 100,
    height: 200,
    tiles: [
      { x: 0, y: 0, width: 100, height: 100, png: diffTileEdge },
      { x: 0, y: 100, width: 100, height: 100, png: diffTileTop },
    ],
  };
  const makeCap = (screenshot) => ({
    states: [{
      label: "load",
      title: "t",
      accessibility: "a",
      forced: [],
      dom: "<div></div>",
      fonts: [],
      animations: [],
      sheets: 0,
      scroll: [100, 200],
      labels: [],
      rects: [],
      styles: [],
      screenshot,
    }],
    errors: [],
    requests: [],
  });
  assert.deepEqual(compare(makeCap(tileSetA), makeCap(tileSetA), false), compareRef(makeCap(tileSetA), makeCap(tileSetA), false));
  assert.deepEqual(compare(makeCap(tileSetA), makeCap(tileSetEdge), false), compareRef(makeCap(tileSetA), makeCap(tileSetEdge), false));
});

test("proof: identical output to reference implementation across observation pairs", () => {
  const makeObs = (modStyle = false, modRect = false, modDom = false) => ({
    states: [{
      label: "load",
      title: "Test Observation",
      accessibility: "tree",
      forced: [[":hover", "color:red;font-size:16px"]],
      dom: modDom ? "<div><span>different</span></div>" : "<div><span>same</span></div>",
      fonts: ["Arial", "Inter"],
      animations: ["anim1 1s ease"],
      sheets: 1,
      scroll: [100, 100],
      labels: ["DIV", "SPAN"],
      rects: modRect ? [[0, 0, 10, 10], [5, 5, 20, 20]] : [[0, 0, 10, 10], [5, 5, 10, 10]],
      styles: modStyle
        ? ["color:red;width:100.000000px;inline-size:100.000000px", "font-family:\"Arial\";color:#112233"]
        : ["color:red;width:100.000000px;inline-size:100.000000px", "font-family:Arial;color:#112233"],
      writingModes: ["horizontal-tb", "horizontal-tb"],
      screenshot: Buffer.from("fake-png-identical"),
    }],
    errors: [],
    requests: ["https://example.com/a.css"],
  });
  const o1 = makeObs(false, false, false);
  const o2 = makeObs(true, false, false);
  const o3 = makeObs(false, true, false);
  const o4 = makeObs(false, false, true);

  assert.deepEqual(compare(o1, o1, false), compareRef(o1, o1, false));
  assert.deepEqual(compare(o1, o2, false), compareRef(o1, o2, false));
  assert.deepEqual(compare(o1, o3, false), compareRef(o1, o3, false));
  assert.deepEqual(compare(o1, o4, false), compareRef(o1, o4, false));
});
