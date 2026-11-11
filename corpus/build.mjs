import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const buildDir = join(root, "build");
const manifestPath = join(root, "manifest.json");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const readManifest = () => JSON.parse(readFileSync(manifestPath, "utf8"));

const serialize = (manifest) => {
  const lines = ["{", `  "version": ${manifest.version},`, '  "assets": {'];
  const assets = Object.entries(manifest.assets ?? {});
  assets.forEach(([name, asset], index) => {
    lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(asset)}${index + 1 < assets.length ? "," : ""}`);
  });
  lines.push("  },", '  "documents": [');
  manifest.documents.forEach((entry, index) => {
    lines.push(`    ${JSON.stringify(entry)}${index + 1 < manifest.documents.length ? "," : ""}`);
  });
  lines.push("  ]", "}");
  return `${lines.join("\n")}\n`;
};

const assetPath = (name) => join(buildDir, "assets", name);

const fetchAsset = async (name, asset, options) => {
  const path = assetPath(name);
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    if (sha256(bytes) === asset.sha256) return path;
  }
  if (options.offline) throw new Error(`${name} is not available offline`);
  const response = await fetch(asset.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${asset.url} returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = sha256(bytes);
  if (hash !== asset.sha256) {
    throw new Error(`${name} has sha256 ${hash} but the manifest pins ${asset.sha256}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
};

const which = (tool) => {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(finder, [tool], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split(/\r?\n/)[0] : null;
};

const renderDocument = (entry, options) => {
  const source = entry.source;
  const tool = which(source.tool);
  if (!tool) return null;
  const output = join(buildDir, "render", entry.id);
  mkdirSync(output, { recursive: true });
  const command =
    source.tool === "quarto"
      ? [tool, "render", join(root, source.file), "--output-dir", output, "--quiet"]
      : [
          tool,
          join(root, source.file),
          "--standalone",
          "--embed-resources",
          "--output",
          join(output, `${entry.id}.html`),
        ];
  const result = spawnSync(command[0], command.slice(1), { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(`${result.stderr ?? ""}\n`);
    return null;
  }
  const rendered = join(output, `${entry.id}.html`);
  return existsSync(rendered) ? readFileSync(rendered, "utf8") : null;
};

const produce = async (entry, assets, options) => {
  const source = entry.source;
  if (source.kind === "download") return readFileSync(await fetchAsset(source.name, source, options), "utf8");
  if (source.kind === "render") return renderDocument(entry, options);
  const module = await import(pathToFileURL(join(root, "generators", source.script)).href);
  const paths = {};
  for (const name of source.assets ?? []) paths[name] = assets[name];
  return module.generate({ seed: source.seed, ...(source.options ?? {}), assets: paths });
};

const parseArguments = (argv) => {
  const options = { update: false, offline: false, only: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--update") options.update = true;
    else if (argument === "--offline") options.offline = true;
    else if (argument === "--only") options.only = argv[(index += 1)].split(",");
    else if (argument === "--ids") options.only = argv[(index += 1)].split(",");
  }
  return options;
};

const run = async () => {
  const options = parseArguments(process.argv.slice(2));
  const manifest = readManifest();
  mkdirSync(buildDir, { recursive: true });
  const assets = {};
  for (const [name, asset] of Object.entries(manifest.assets ?? {})) {
    assets[name] = await fetchAsset(name, asset, options);
  }
  const selected = manifest.documents.filter(
    (entry) => !options.only.length || options.only.includes(entry.id),
  );
  const index = [];
  const problems = [];
  for (const entry of selected) {
    let html;
    try {
      html = await produce(entry, assets, options);
    } catch (error) {
      problems.push(`${entry.id}: ${error.message}`);
      continue;
    }
    if (html === null) {
      index.push({ id: entry.id, available: false });
      continue;
    }
    const bytes = Buffer.from(html, "utf8");
    const hash = sha256(bytes);
    const path = join(buildDir, entry.category, `${entry.id}.html`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    if (entry.sha256 && entry.sha256 !== hash && !options.update) {
      problems.push(`${entry.id}: sha256 ${hash} does not match the pinned ${entry.sha256}`);
    }
    if (options.update) {
      entry.sha256 = hash;
      entry.bytes = bytes.length;
    }
    index.push({ id: entry.id, available: true, path, bytes: bytes.length, sha256: hash });
  }
  writeFileSync(join(buildDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  if (options.update) writeFileSync(manifestPath, serialize(manifest));
  const missing = index.filter((entry) => !entry.available).length;
  const bytes = index.reduce((total, entry) => total + (entry.bytes ?? 0), 0);
  console.log(
    `built ${index.length - missing} documents (${bytes} bytes)${missing ? `, ${missing} unavailable` : ""}`,
  );
  if (problems.length) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exit(1);
  }
};

await run();
