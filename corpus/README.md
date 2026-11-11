# Octavo corpus

Roughly 300 documents that exercise Octavo on realistic output, on scale, and on inputs built to break it. Nothing large is committed. Each document is a small module that builds its text deterministically, and `manifest.json` records its size and SHA-256 so drift is caught.

## Layout

- `spec.mjs` defines what a document is and validates it. `specs.mjs` loads every `docs/*.mjs` file. `build.mjs` writes `.cache/<id>.html` and `manifest.json`.
- `docs/<topic>.mjs` default-exports an array of specs. Add a file per topic; do not edit other topics' files.
- `../verify/corpus.mjs` runs the release binary over the corpus and writes `out/corpus/report.md` and `report.json`.
- `spec.test.mjs` checks the specs and the manifest (`node --test corpus`).

## Writing a document

```js
{
  id: "unused-rules-are-pruned",
  category: "css",
  tier: "smoke",
  expect: { outcome: "optimizes", retains: [".shown{"], removes: [".gone0{"] },
  build: () => page(`<style>...</style>`, "<p class=shown>kept</p>"),
}
```

- `id` and `category` are lowercase words joined by hyphens. The id is unique across the corpus and names the behavior, not the implementation.
- `tier` is `smoke` for a small, fast, representative subset (at most a quarter of the corpus, every category has at least one) and `full` for the rest.
- `build` takes no arguments, returns the document text, and is deterministic. Use `random(seed)` from `spec.mjs` for pseudo-random content, never `Math.random` or the clock.
- `expect` is written from what Octavo promises, before running anything:
  - `{ outcome: "optimizes" }` the output is smaller and renders identically in Chromium. Add `retains: [...]` (text that must still be present) and `removes: [...]` (text that must be gone). These are checked on the `safe` level output, where the text is not packed.
  - `{ outcome: "accepts" }` Octavo optimizes the input or leaves it as it was, but never rejects it. Use it for real-world documents where the gain is not the point.
  - `{ outcome: "keeps" }` Octavo finds nothing to gain and leaves the file as it was.
  - `{ outcome: "rejects", error: "not-html" | "not-self-contained" }` the input is refused with that error.
- Set `browser: false` on an `optimizes` document only when it cannot be rendered meaningfully (for example a page that is intentionally enormous). Say why in the id.

When the runner disagrees with an expectation, decide which side is wrong. If Octavo has a bug, leave the expectation as it is and report the bug; never edit an expectation to match a bug.

## Real documents from upstream

`sources.json` pins upstream repositories by URL and SHA-256. `corpus/selection.json` lists every one of their documents that renders cleanly to self-contained HTML, not a sample, and marks a small stratified subset as the smoke tier. It pins exactly which are used, so every run, locally and in CI, renders the same ones and a document that fails to render is an error, not a skip. `node corpus/upstream.mjs [--tier smoke|full] [--jobs N]` renders the pinned documents. `node corpus/upstream.mjs --select` regenerates the selection (the corpus workflow runs it with the `select` tier, so the renders happen in CI), and is only needed when `sources.json` changes. `--shard K/N` renders and verifies one share, which is how CI splits the full tier: it downloads and extracts the example documents, keeps the ones that need no R, Python or Julia and no project files, and splits them by declared format into html, slides (revealjs, slidy, s5, dzslides) and dashboard. Each format has its own pool size and selection quota in `sources.json`, so slides and dashboards are always represented. Every pooled document is rendered with Quarto in its own format into `.cache/rendered/`, measured (size, script, style, image and font weight, and which Quarto features it uses), and the quota is then chosen per format by farthest-point sampling over those measurements. `index.json` lists the selection with the Quarto version; `pool.json` lists everything that was measured. Documents that fail to render are skipped and reported. The runner picks the rendered documents up automatically (`--no-upstream` skips them) and expects `accepts` plus browser equivalence. Nothing rendered is committed, because the HTML depends on the Quarto version. Set `QUARTO` to the executable when it is not on `PATH`.

## Running

```sh
cargo build --release
node corpus/build.mjs            # regenerate manifest.json and .cache
node corpus/build.mjs --check    # fail if manifest.json is stale
node verify/corpus.mjs --tier smoke --browser
node verify/corpus.mjs --tier full --browser --filter '^css-'
```

Flags: `--tier smoke|full`, `--levels safe,scripts,packed`, `--browser`, `--filter <regex on id>`, `--jobs <n>`, `--binary <path>`, `--out <dir>`.

## What the runner checks

- The outcome matches the expectation, the error text matches, the output is never larger than the input, and `retains` and `removes` hold.
- With `--browser`, each optimized page is compared with the original across the scenarios in `verify/capture.mjs`.
- Slowdown watchdog: any document slower than 100 times the corpus median time per byte (plus a fixed startup allowance) is re-run once and fails if it is still over.
- The report compares each level with a naive minifier (comments and inter-tag whitespace removed) and with Brotli applied to the original.
