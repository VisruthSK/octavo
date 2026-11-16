import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser, verify } from "./verify.mjs";

after(closeBrowser);

const directory = mkdtempSync(join(tmpdir(), "octavo-active-"));

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>container</title>
<style>
main{display:block;padding:60px;background:rgb(240,240,240)}
main:active{background:rgb(200,220,255)}
p{margin:0;padding:80px 0}
</style></head><body><main tabindex="-1"><p>first</p><iframe srcdoc="&lt;p&gt;inside&lt;/p&gt;" style="display:block;width:100%;height:600px;border:0"></iframe><p>third</p></main><script>0</script></body></html>`;

test("a container whose centre is an iframe can still have its active state checked", async () => {
  const file = join(directory, "container.html");
  writeFileSync(file, page);
  const reports = await verify(file, file, { level: "serve", only: ["desktop-light"] });
  const incomplete = reports.flatMap(({ issues }) => issues).filter((issue) => issue.includes("check incomplete"));
  assert.deepEqual(incomplete, []);
});
