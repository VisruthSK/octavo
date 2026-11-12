# Octavo corpus

The corpus is 783 documents that Octavo is tested against: 318 hand-written fixtures and 465 documents from Quarto's own test suite. Each one states what Octavo should do with it, and the runner checks that outcome at every level and, with `--browser`, that the optimized page renders the same as the original in Chromium.

| Source | Documents | Purpose |
|---|---|---|
| Hand-written fixtures | 318 | Realistic output, scale, and inputs built to break the optimizer |
| Quarto's test documents | 465 (357 pages, 86 slide decks, 22 dashboards) | Real output across Quarto's formats and features |

The hand-written fixtures fall into eleven categories: `quarto` (58), `css` (49), `parsing` (48), `libraries` (40), `images` (37), `scale` (26), `fonts` (18), `javascript` (18), `script-tags` (16), `modules` (6) and `validation` (2).

Nothing large is committed. Fixtures are small modules that build their text deterministically, and `manifest.json` records each one's size and SHA-256 so any change to the generated text is visible. Quarto's documents are rendered on demand from a pinned release.

## Tiers

Every document belongs to a tier. `smoke` is a small sample that covers every category and format. `full` is the rest.

| Tier | Hand-written | Quarto | Runs |
|---|---|---|---|
| `smoke` | 59 | 12 | On every push and pull request |
| `full` | 259 | 453 | Before every release tag, split across 24 shards in CI |

The `engines` job repeats the browser comparison in Firefox and WebKit for the documents where engines can differ: images (lossless WebP), fonts, CSS with modern selectors and at-rules, scripts and the packed level's decompression loader, libraries, and the Quarto documents. It runs the same tier and shards as the Chromium job, with `OCTAVO_BROWSER` set to the engine, and failures are prefixed with the engine name.

## Hand-written fixtures

```
corpus/
  spec.mjs        what a document is, and validation
  specs.mjs       loads every docs/*.mjs
  docs/<topic>.mjs   one array of specs per topic
  build.mjs       writes .cache/<id>.html and manifest.json
  spec.test.mjs   checks the specs and the manifest (node --test corpus)
```

A document is an object:

```js
{
  id: "unused-rules-are-pruned",
  category: "css",
  tier: "smoke",
  expect: { outcome: "optimizes", retains: [".shown{"], removes: [".gone0{"] },
  build: () => page(`<style>...</style>`, "<p class=shown>kept</p>"),
}
```

- `id` and `category` are lowercase words joined by hyphens. The id is unique and names the behavior, not the implementation.
- `build` takes no arguments, returns the document text and is deterministic. Pseudo-random content comes from `random(seed)` in `spec.mjs`, never from `Math.random` or the clock.
- `expect` states what Octavo promises, written before running anything:

| Outcome | Meaning | Count |
|---|---|---|
| `optimizes` | The output is smaller and renders identically in Chromium. `retains` lists text that must survive and `removes` lists text that must be gone, both checked on the `safe` output, where nothing is packed | 304 |
| `keeps` | Octavo finds nothing to gain and returns the file unchanged | 5 |
| `rejects` | The input is refused, with the error `not-html` or `not-self-contained` | 8 |
| `accepts` | Octavo may optimize the input or leave it as it was, but never rejects it. It suits real-world documents where the gain is not the point | 1 |

An `optimizes` document is compared in the browser unless it sets `browser: false`. 98 fixtures do: the 58 Quarto-shaped ones, which check through `retains` and `removes` which bundled libraries are removed, 25 scale documents that are too large to render meaningfully, and 15 others whose input is not a page a browser can compare.

When the runner disagrees with an expectation, the expectation stays and the disagreement is reported as an Octavo bug.

### Fonts with real features

`fonts.json` pins two open fonts from Google Fonts by URL and SHA-256: Fira Sans (static, hinted) and Inter (variable). `node corpus/build.mjs` downloads them into `.cache/fonts/` and verifies the hash. The fixtures in `docs/features.mjs` embed them to exercise tabular and old-style numbers, stylistic sets, small caps, fractions, superscripts and kerning. Both fonts are licensed under the SIL Open Font License, are used only as test input and are never committed.

## Quarto's test documents

`sources.json` pins a Quarto release by URL and SHA-256. `selection.json` lists every document in it that renders to self-contained HTML without R, Python or Julia and without project files, with its format (`html`, `slides` or `dashboard`) and tier. Because the list is committed, every run renders the same documents, and a document that fails to render is an error.

```sh
node corpus/upstream.mjs [--tier smoke|full] [--jobs N] [--shard K/N]
node corpus/upstream.mjs --select
```

The first command renders the listed documents with Quarto into `.cache/rendered/` and writes `index.json`. `--shard` renders one share, which is how CI splits the full tier. The second command rebuilds `selection.json`: it extracts the example documents, renders each in its own format, and drops those that fail, need the network or are not self-contained, printing a count per reason. It is needed only when `sources.json` changes. Nothing rendered is committed, because the HTML depends on the Quarto version. Set `QUARTO` to the executable when it is not on `PATH`.

## Benchmark pages

`src/` holds small Quarto sources (articles, figures, tables, citations, dashboards, reveal.js decks, Plotly and SVG pages). The pages built with R need the matching R packages, such as ggplot2, gt, plotly, DT and dygraphs. `render.sh` renders them with Quarto into `html/train` and `html/test`, which are not committed. `verify/bench.mjs` runs Octavo over those renders and reports the size before and after and the time:

```sh
node verify/bench.mjs packed corpus/html/train corpus/html/test
```

## Running

```sh
cargo build --release
node corpus/build.mjs            # regenerate manifest.json and .cache
node corpus/build.mjs --check    # fail if manifest.json is out of date
node verify/corpus.mjs --tier smoke --browser
node verify/corpus.mjs --tier full --browser --filter '^css-'
```

| Flag | Meaning |
|---|---|
| `--tier smoke\|full` | Which tier to run. The default is `smoke` |
| `--levels safe,scripts,packed` | Which levels to run. The default is `safe,packed` for `smoke` and all three for `full` |
| `--browser` | Compare each optimized page with the original in Chromium |
| `--filter <regex>` | Run only documents whose id matches |
| `--jobs <n>` | Documents processed at once |
| `--shard K/N` | One share of the documents, matching the flag on `upstream.mjs` |
| `--no-upstream` | Skip Quarto's documents |
| `--binary <path>` | The Octavo binary to run |
| `--out <dir>` | Where the report is written. The default is `out/corpus` |

## What the runner checks

- The outcome matches the expectation, the error matches for rejected inputs, the output is never larger than the input, and `retains` and `removes` hold.
- With `--browser`, each optimized page is compared with the original in the scenarios defined in `verify/capture.mjs`: desktop light and dark, mobile, tablet, print, JavaScript off and animations on, plus an interaction sweep.
- A document that takes more than 100 times the corpus median time per byte, plus a fixed startup allowance, is run again once and fails if it is still over.
- The report lists size and time per document and level, compares each level with a naive minifier (comments and whitespace between tags removed) and with Brotli applied to the original, and totals the sizes by category and level. `report.md` and `report.json` are written to the output directory.
