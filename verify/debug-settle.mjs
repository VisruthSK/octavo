import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./engines/index.mjs";
import { capture, scenariosFor } from "./capture.mjs";

const directory = mkdtempSync(join(tmpdir(), "octavo-timing-"));
const base = [
  "body{margin:8px;font:16px sans-serif}",
  ".box{width:50px;height:50px;background:rgb(10,20,30);animation:slide 2s infinite}",
  "@keyframes slide{from{margin-left:0}to{margin-left:100px}}",
].join("");
const file = join(directory, "page.html");
writeFileSync(file, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title><style>${base}</style></head><body><h1>Title</h1><div class="box"></div></body></html>`);

const browser = await launch();
for (const scenario of scenariosFor("safe")) {
  const started = Date.now();
  const result = await capture(browser, file, scenario, false);
  console.log(scenario.name, `${Date.now() - started} ms`, `states=${result.states.length}`);
}
await browser.close();
