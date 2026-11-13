# Octavo corpus

The corpus is 799 documents that Octavo is tested against, plus 62 Quarto projects: 334 hand-written fixtures, 465 documents from Quarto's own test suite, 8 hand-written projects and 54 projects from that suite. Each one states what Octavo should do with it, and the runner checks that outcome at every level and, with `--browser`, that the optimized page renders the same as the original in Chromium.

| Source | Documents | Purpose |
|---|---|---|
| Hand-written fixtures | 334 | Realistic output, scale, inputs built to break the optimizer, and pages that link files |
| Quarto's test documents | 465 (357 pages, 86 slide decks, 22 dashboards) | Real output across Quarto's formats and features |
| Hand-written projects | 8 | Whole sites and a book with navigation, search, themes, listings, custom assets and deep nesting |
| Quarto's test projects | 54 | Real multi-page projects rendered without `embed-resources` |

The hand-written fixtures fall into twelve categories: `quarto` (58), `css` (49), `parsing` (48), `libraries` (40), `images` (37), `scale` (26), `fonts` (18), `javascript` (18), `linking` (16), `script-tags` (16), `modules` (6) and `validation` (2).

Nothing large is committed. Fixtures are small modules that build their text deterministically, and `manifest.json` records each one's size and SHA-256 so any change to the generated text is visible. Quarto's documents are rendered on demand from a pinned release.

## Tiers

Every document and every project belongs to a tier. `smoke` is a small sample that covers every category, format and project kind. `full` is the rest.

| Tier | Hand-written | Quarto | Projects | Runs |
|---|---|---|---|---|
| `smoke` | 67 | 12 | 8 | On every push and pull request |
| `full` | 267 | 453 | 54 | Before every release tag, split across 24 shards in CI |

## Hand-written fixtures

```
corpus/
  spec.mjs        what a document is, and validation
  specs.mjs       loads every docs/*.mjs
  docs/<topic>.mjs   one array of specs per topic
  build.mjs       writes .cache/<id>.html and manifest.json
  spec.test.mjs   checks the specs and the manifest (node --test "corpus/**/*.test.mjs")
  excluded.json   documents dropped from the Quarto selection, with the reason
  baseline.json   output size per document and level
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
| `optimizes` | The output is smaller and renders identically in Chromium. `retains` lists text that must survive and `removes` lists text that must be gone, both checked on the `safe` output, where nothing is packed | 316 |
| `keeps` | Octavo finds nothing to gain and returns the file unchanged | 5 |
| `rejects` | The input is refused, with the error `not-html` or `not-self-contained` | 12 |
| `accepts` | Octavo may optimize the input or leave it as it was, but never rejects it. It suits real-world documents where the gain is not the point | 1 |

An `optimizes` document is compared in the browser unless it sets `browser: false`. 103 fixtures do: the 58 Quarto-shaped ones, which check through `retains` and `removes` which bundled libraries are removed, 25 scale documents that are too large to render meaningfully, and 20 others whose input is not a page a browser can compare.

When the runner disagrees with an expectation, the expectation stays and the disagreement is reported as an Octavo bug.

### Fonts with real features

`fonts.json` pins two open fonts from Google Fonts by URL and SHA-256: Fira Sans (static, hinted) and Inter (variable). `node corpus/build.mjs` downloads them into `.cache/fonts/` and verifies the hash. The fixtures in `docs/features.mjs` embed them to exercise tabular and old-style numbers, stylistic sets, small caps, fractions, superscripts and kerning. Both fonts are licensed under the SIL Open Font License, are used only as test input and are never committed.

## Quarto's test documents

`sources.json` pins a Quarto release by URL and SHA-256. `selection.json` lists every document in it that renders to self-contained HTML without R, Python or Julia and without project files, with its format (`html`, `slides` or `dashboard`) and tier. Because the list is committed, every run renders the same documents, and a document that fails to render is an error.

```sh
node corpus/upstream.mjs [--tier smoke|full] [--jobs N] [--shard K/N]
node corpus/upstream.mjs --select
```

The first command renders the listed documents with Quarto into `.cache/rendered/` and writes `index.json`. `--shard` renders one share, which is how CI splits the full tier. It reads `corpus/excluded.json` first and prints every excluded document with its reason, and a document that fails to render or is missing from the render stops the run. The second command rebuilds `selection.json` and `excluded.json`: it extracts the example documents, renders each in its own format, loads each render twice in Chromium with the verifier's capture, and drops those that fail, need the network, are not self-contained or differ from themselves, recording every drop with its reason in `excluded.json`. It is needed only when `sources.json` changes. Nothing rendered is committed, because the HTML depends on the Quarto version. Set `QUARTO` to the executable when it is not on `PATH`.

### Pages that link files

A fixture in the `linking` category sets `files`, a function that returns the files its page links, as relative paths with their content. The builder writes the page to `.cache/docs/<id>/index.html` and the files beside it, and the runner passes only the page to Octavo, which has to find and embed everything else. `manifest.json` hashes the files with the page and records their size as `extraBytes`, which the size check adds to the input.

Sixteen fixtures cover a stylesheet that is pruned, a script, an image, a stylesheet that imports another and uses `url()`, a module that imports modules, a root-relative `/site_libs` link, a `<name>_files` directory, a deferred script, a font in a stylesheet, a query string and a fragment on a link, a percent-encoded file name, an icon next to a stylesheet, and four pages with a missing file that must be rejected. Optimizing fixtures are compared in the browser against the page with its files beside it. The root-relative fixture sets `browser: false`, because `file://` cannot resolve that link and the original is the page that fails to load.

Scripts that must keep their `src` (deferred scripts, and modules that import others) stay base64 `data:` URLs that the script stage does not minify. Two fixtures set `grows: true` to record that the output may be larger than the page and its files together.

The corpus runner passes `--no-fetch`, so a document with a link to the web is never downloaded during a run.

## Quarto projects

`projects.json` lists the projects in the pinned Quarto release that render to HTML without R, Python or Julia, without extensions, filters or pre and post render scripts, and with at least three `.qmd` or `.md` files. Each is rendered once to confirm it works. `remote` marks projects whose pages load a script or stylesheet from the web, such as MathJax. Smoke picks five local projects of at most ten pages, chosen to differ from each other in size, scripts, styles, images, fonts and features. One smoke-all project is not selected: the brand-icon-small-favicon-book pages link `logos/small.png`, a file the pinned release does not ship, and a page that links a missing file cannot be embedded, so Octavo refuses it, correctly. `node corpus/projects.mjs --select` renders and selects blindly, so rerunning it can pick the same project again: drop it by hand afterwards, or expect the linked route to fail.

`corpus/projects/<name>/` holds a hand-written project: a real `_quarto.yml` and `.qmd` files, an `expect.json`, and an optional `assets.mjs` that returns binary files (deterministic images, the pinned Fira Sans fonts) to add before rendering.

| Project | Tier | What it exercises |
|---|---|---|
| `site-full` | smoke | Navbar, sidebar, search, light and dark themes, an about page, tabsets, collapsible callouts, a folded code block, cross-references, a figure and a listing |
| `book-appendix` | smoke | A preface, four chapters and an appendix, cross-references across chapters, a table, a callout and search |
| `site-custom-assets` | smoke | Custom scss, a stylesheet that imports another that imports a third and uses `url()`, a local woff2 font beside a legacy ttf, a classic script and a module that imports a module, at two depths |
| `blog-categories` | full | A categorised listing of posts that each have a thumbnail, a table listing, an about page |
| `site-deep-nesting` | full | Pages five directories deep, one image referenced at four depths, extra `resources:`, navigation across levels |
| `listing-grid-images` | full | A grid listing whose cards use thumbnails from different directories |
| `site-root-relative` | full | Pages three directories deep with a root-relative `url()` in the theme stylesheet, resolved against the site root at deploy time |
| `site-resources` | full | `resources:` copies an extra directory verbatim, including a file that no page links, beside files linked from two depths |

`expect.json` is written before the project is first run and states:

| Field | Meaning |
|---|---|
| `pages` | How many pages Quarto renders |
| `files` | Files that must exist in the normal output |
| `search` | `found` queries that must return results and `absent` queries that must not, in both the normal and the optimized site |
| `interactions` | Steps to click and what must hold afterwards, run on the normal site first (a failure there means the spec is wrong) and then on the optimized site |
| `prune` | Selectors that site mode must remove from the stylesheets and selectors it must keep |
| `site` | Files that must be present or absent in the optimized site, such as the WOFF2 file that replaces a TTF |
| `linked` | Text that must and must not appear in the standalone pages, such as a `data:` reference to a root-relative file |

An expectation in `interactions` can check `exists`, `count`, `countAtMost`, `class`, `notClass`, `attr`, `computed` (a computed style), `text` and `loaded` (images decoded).

For every project the runner:

1. Renders it with Quarto, without `embed-resources`.
2. Runs site mode on the output and checks the `expect.json` fields.
3. Compares every page of the optimized site with the original in Chromium, and compares search results over HTTP.
4. Optimizes every page of the normal output on its own, with no `--resource-path`, and compares each result with the original page in Chromium.
5. Records the size of the normal site, of site mode and of the standalone pages.

```sh
node verify/projects.mjs --tier smoke --browser
node verify/projects.mjs --tier full --browser --shard 1/24 --filter '^site-'
node corpus/projects.mjs --select
```

`verify/projects.mjs` takes `--tier`, `--filter`, `--shard K/N`, `--browser`, `--binary` and `--out` (default `out/projects`). Set `QUARTO` if `quarto` is not on the path. `--select` renders every eligible project and rewrites `projects.json`.

To add a project, create `corpus/projects/<name>/` with the sources and an `expect.json`, write the assertions before running it, then run `node --test "corpus/**/*.test.mjs"`, which checks the schema and that the project needs no engine or extension. Bare `node --test` from `corpus/` discovers the same files; `node --test corpus` does not work on Node 21 and later, which treat a directory argument as a file to load.

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
| `--update-baseline` | Write `corpus/baseline.json` from this run instead of comparing with it |

## Size baseline

`corpus/baseline.json` records the output size of every document at each level. A run compares each measured output with the baseline and fails when an output is more than 0.5% larger, naming the document and printing the change per category in `report.md`. A document or level without a baseline entry is reported but does not fail the run, so the gate can land before the baseline exists.

`--update-baseline` writes the measured sizes into `corpus/baseline.json` instead of comparing, merging with the entries already there. A full run with no shard or filter also drops entries for documents that are gone. Commit the rewritten baseline on its own, with a note on what changed.

The baseline comes from a full run on `main`: dispatch the Corpus workflow with `tier=full` and `baseline=true`, download the `baseline` artifact and commit its `baseline.json`. Each shard writes its share, and the `baseline` job merges the shards into one file.

## What the runner checks

- The outcome matches the expectation, the error matches for rejected inputs, the output is never larger than the input (plus the files a linking fixture ships) unless the fixture sets `grows`, and `retains` and `removes` hold.
- With `--browser`, each optimized page is compared with the original in the scenarios defined in `verify/capture.mjs`: desktop light and dark, mobile, tablet, print, JavaScript off and animations on, plus an interaction sweep.
- A document that takes more than 100 times the corpus median time per byte, plus a fixed startup allowance, is run again once and fails if it is still over.
- The report lists size and time per document and level, compares each level with a naive minifier (comments and whitespace between tags removed) and with Brotli applied to the original, and totals the sizes by category and level. `report.md` and `report.json` are written to the output directory.
- The output size of every document and level is compared with `corpus/baseline.json`; growth over 0.5% fails the run, and `--update-baseline` rewrites the baseline in its own commit.
- Every document in `corpus/excluded.json` is listed with its reason. A document that fails to render, or is missing from the render, stops the run.
