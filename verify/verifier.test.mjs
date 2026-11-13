import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser, verify, withTimeout } from "./verify.mjs";
import { checksOf, engine, engineNames } from "./engines/index.mjs";

after(closeBrowser);

const directory = mkdtempSync(join(tmpdir(), "octavo-verifier-"));

test("a page that never settles times out and is closed", async () => {
  let closed = false;
  await assert.rejects(
    withTimeout(() => new Promise(() => {}), 1, async () => { closed = true; }),
    /comparison timed out/,
  );
  assert.equal(closed, true);
});

const page = (style, body = '<h1>Title</h1><ul><li>one</li><li>two</li></ul><a class="link" href="#x">link</a><input placeholder="name"><div class="box"></div>') =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>${style}</style></head><body>${body}</body></html>`;

const base = [
  "body{margin:8px;font:16px sans-serif}",
  ".box{width:50px;height:50px;background:rgb(10,20,30);animation:slide 2s infinite}",
  "@keyframes slide{from{margin-left:0}to{margin-left:100px}}",
  "a.link{color:rgb(0,0,200)}",
  "a.link{transition:color 2s}",
  "a.link:hover{color:rgb(200,0,0)}",
  "a.link:focus{color:rgb(0,200,0)}",
  "a.link:active{color:rgb(200,200,0)}",
  "@media (max-width:500px){h1{font-size:12px}}",
  "@media (min-width:700px) and (max-width:900px){h1{font-size:40px}}",
  "@media (prefers-color-scheme:dark){body{background:rgb(0,0,0);color:rgb(255,255,255)}}",
  "@media print{.box{display:none}}",
  "li::marker{color:rgb(255,0,0)}",
  "input::placeholder{color:rgb(0,128,0)}",
  "@media (prefers-reduced-motion:reduce){h1{letter-spacing:2px}}",
].join("");

const write = (name, html) => {
  const file = join(directory, `${name}.html`);
  writeFileSync(file, html);
  return file;
};

const scenariosFailing = async (original, changed, only) =>
  (await verify(write("original", original), write("changed", changed), { only }))
    .filter(({ issues }) => issues.length)
    .map(({ scenario }) => scenario);

test("an identical copy passes every scenario", async () => {
  assert.deepEqual(await scenariosFailing(page(base), page(base)), []);
});

test(`the self-test runs in ${engine.label}`, () => {
  assert.ok(engineNames.includes(engine.name));
});

test("every forced state is applied on every engine", async () => {
  const report = await verify(write("original", page(base)), write("changed", page(base)));
  for (const { scenario, checks } of report) {
    if (scenario === "motion" || scenario === "no-js") continue;
    assert.deepEqual(checksOf(checks), [], scenario);
  }
});

const breakages = [
  ["a dropped keyframes rule", (css) => css.replace("@keyframes slide{from{margin-left:0}to{margin-left:100px}}", ""), "motion"],
  ["a changed animation duration", (css) => css.replace("2s infinite", "3s infinite"), "motion"],
  ["a dropped hover rule", (css) => css.replace("a.link:hover{color:rgb(200,0,0)}", ""), "desktop-light"],
  ["a dropped focus rule", (css) => css.replace("a.link:focus{color:rgb(0,200,0)}", ""), "desktop-light"],
  ["a dropped active rule", (css) => css.replace("a.link:active{color:rgb(200,200,0)}", ""), "desktop-light"],
  ["a dropped mobile media rule", (css) => css.replace("@media (max-width:500px){h1{font-size:12px}}", ""), "mobile"],
  ["a dropped tablet media rule", (css) => css.replace("@media (min-width:700px) and (max-width:900px){h1{font-size:40px}}", ""), "tablet"],
  ["a dropped dark rule", (css) => css.replace("@media (prefers-color-scheme:dark){body{background:rgb(0,0,0);color:rgb(255,255,255)}}", ""), "desktop-dark"],
  ["a dropped print rule", (css) => css.replace("@media print{.box{display:none}}", ""), "print"],
  ["a changed marker colour", (css) => css.replace("li::marker{color:rgb(255,0,0)}", "li::marker{color:rgb(255,0,1)}"), "desktop-light"],
  ["a changed placeholder colour", (css) => css.replace("input::placeholder{color:rgb(0,128,0)}", "input::placeholder{color:rgb(0,128,1)}"), "desktop-light"],
  ["a dropped reduced-motion rule", (css) => css.replace("@media (prefers-reduced-motion:reduce){h1{letter-spacing:2px}}", ""), "desktop-light"],
  ["a one-unit colour change", (css) => css.replace("rgb(10,20,30)", "rgb(10,20,31)"), "desktop-light"],
  ["a changed text node", (css) => css, "desktop-light"],
  ["a hundredth-pixel layout change", (css) => css, "desktop-light"],
];

const reducedExclusions = {
  "a dropped keyframes rule": ["motion", "the reduced sets omit the motion preference"],
  "a changed animation duration": ["motion", "the reduced sets omit the motion preference"],
  "a dropped tablet media rule": ["tablet", "the reduced sets omit the tablet viewport"],
  "a dropped dark rule": ["desktop-dark", "the reduced sets omit dark color scheme"],
  "a dropped print rule": ["print", "the reduced sets omit print media"],
};

const failingScenarios = (report) => report.filter(({ issues }) => issues.length).map(({ scenario }) => scenario);

const reducedCase = ([name, change]) => {
  const original = page(base);
  if (name === "a changed text node") {
    return [name, original, page(base, "<h1>Title!</h1><ul><li>one</li><li>two</li></ul><a class=\"link\" href=\"#x\">link</a><input placeholder=\"name\"><div class=\"box\"></div>")];
  }
  if (name === "a hundredth-pixel layout change") {
    return [name, page(`${base}.t{width:100px}`, "<div class=\"t\">x</div>"), page(`${base}.t{width:100.02px}`, "<div class=\"t\">x</div>")];
  }
  return [name, original, page(change(base))];
};

test("reduced scenario sets preserve every safe-set proof outside explicit exclusions", async () => {
  const problems = await Promise.all(
    breakages.map(reducedCase).map(async ([name, original, optimized], at) => {
      const originalFile = write(`reduced-${at}-original`, original);
      const changedFile = write(`reduced-${at}-changed`, optimized);
      if (reducedExclusions[name]) {
        const [scenario, reason] = reducedExclusions[name];
        const safe = failingScenarios(await verify(originalFile, changedFile, { only: [scenario] }));
        return safe.includes(scenario) ? [] : [`${name} was not caught by its listed exclusion: ${reason}`];
      }
      const missed = [];
      for (const level of ["scripts", "packed"]) {
        if (!failingScenarios(await verify(originalFile, changedFile, { level })).length) missed.push(`${name} escaped ${level}`);
      }
      return missed;
    }),
  );
  assert.deepEqual(problems.flat(), []);
});

const loaderBreakages = [
  ["blob corrupted", "window.target.textContent='restored'", "window.target.textContent='corrupted'"],
  ["wrong script order", "window.order.push('first');window.order.push('second');window.target.textContent=window.order.join('-')", "window.order.push('second');window.order.push('first');window.target.textContent=window.order.join('-')"],
  ["loader missing", "window.target.textContent='loaded'", ""],
  ["deferred script moved", "window.ready=true;window.target.textContent='ready'", "window.target.textContent=window.ready?'ready':'early';window.ready=true"],
];

test("scripts and packed scenarios catch loader restoration breakages", async () => {
  const shell = (script) => page("body{margin:8px}", `<h1 id="target">initial</h1><script>window.target=document.getElementById('target');window.order=[];${script}</script>`);
  const escaped = await Promise.all(
    loaderBreakages.flatMap(([name, expected, changed], at) =>
      ["scripts", "packed"].map(async (level) => {
        const originalFile = write(`loader-${at}-${level}-original`, shell(expected));
        const changedFile = write(`loader-${at}-${level}-changed`, shell(changed));
        const found = failingScenarios(await verify(originalFile, changedFile, { level }));
        return found.length ? [] : [`${name} escaped ${level}`];
      }),
    ),
  );
  assert.deepEqual(escaped.flat(), []);
});

const caughtByDedicatedTests = new Set(["a changed text node", "a hundredth-pixel layout change"]);

for (const [name, change, expected] of breakages.filter(([name]) => !caughtByDedicatedTests.has(name))) {
  test(`${name} is caught in ${expected}`, async () => {
    const failing = await scenariosFailing(page(base), page(change(base)), [expected]);
    assert.ok(failing.includes(expected), `${failing}`);
  });
}

test("a changed text node is caught", async () => {
  const failing = await scenariosFailing(page(base), page(base, "<h1>Title!</h1>"), ["desktop-light"]);
  assert.ok(failing.includes("desktop-light"), `${failing}`);
});

test("a changed layout by a hundredth of a pixel is caught", async () => {
  const failing = await scenariosFailing(page(base + ".t{width:100.00px}", "<div class=t>x</div>"), page(base + ".t{width:100.02px}", "<div class=t>x</div>"));
  assert.ok(failing.length > 0);
});

test("a script moved from the head into the body is not a difference", async () => {
  const script = "<script>window.ready = true</script>";
  const original = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>${base}</style>${script}</head><body><h1>Title</h1></body></html>`;
  const moved = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>${base}</style></head><body><h1>Title</h1>${script}</body></html>`;
  assert.deepEqual(await scenariosFailing(original, moved), []);
});
