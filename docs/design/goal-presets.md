# Goal presets vs names evaluation

Evaluation of the optimization presets against their stated names and goals, resolving Issue #82.

## Summary of findings

The optimization levels are named by their architectural goal:
- **`exact`**: lossless, provably semantics-preserving transforms under formal oracles. Zero layout shifts, zero font subsetting, zero pixel changes.
- **`serve`**: smallest output when compressed by the server (Brotli or Gzip HTTP transfer encoding).
- **`portable`**: smallest standalone file that remains fully usable with JavaScript disabled.
- **`archive`**: smallest standalone file overall (compresses styles, body and assets into an unpacker blob; requires JavaScript).

Across 775 valid corpus documents and fixtures measured with Brotli quality 11 and Gzip quality 9:
1. **`serve`** is the smallest over the wire in **90.0%** of documents under Brotli and **70.0%** under Gzip. The remaining cases are pages with large unpruned JavaScript/JSON data blobs where whole-script compression out-compresses server stream chunking.
2. **`portable`** reduces on-disk size compared to `serve` in **67.2%** of corpus documents (saving up to 86% on script-heavy pages like Quarto interactive widgets and framework templates), with a median wire penalty of **0.0%** on static pages and **15–20%** when scripts are packed into the base91 payload. Inline SVG is correctly retained as unpacked markup; packing SVG into the script blob would break rendering when JavaScript is disabled, violating `portable`'s core contract.
3. **`archive`** is smaller on disk than `portable` in **63.0%** of documents (saving up to 89% on SVG- and CSS-rich documents). Because `archive` packs document stylesheets and body elements, viewing an archive file without JavaScript produces a blank or unstyled page. A minimal `<noscript>` notice is recommended to clarify that the document is a packed archive requiring JavaScript to unpack.
4. Two distinct goals are identified as candidates for future presets:
   - `email`: standalone HTML compatible with strict email client limitations (no JavaScript, inlined CSS styles, no SVG, external or CID images).
   - `diff-friendly`: structural minification that retains line breaks between major block elements to preserve readable git diffs.
5. Command-line documentation in `--help` previously mischaracterized `--level serve` as "keep the page working without JavaScript", which describes `portable`. The CLI help and audit output have been updated to reflect the exact goal of each preset.

---

## Evaluation of Issue #82 Questions

### 1. `serve`: Smallest over the wire

**Stated goal**: Smallest output when the server compresses it.

**Empirical evaluation**:
- Tested across representative documents spanning static documents, Quarto reports, slide decks, and data-dense dashboards.
- `serve` achieves the smallest wire size in **90.0%** of documents under Brotli 11 and **70.0%** under Gzip 9.
- *Mechanism*: Server compression (HTTP Content-Encoding: brotli/gzip) operates directly on the text token stream. By keeping HTML, CSS and scripts as unencoded plain text rather than packing them into base64/base91 payloads, the compressor can find cross-block redundancies between stylesheet selectors, HTML tags and script strings.
- *Exceptions*: On documents containing multi-megabyte unpruned script libraries or inline JSON state (e.g. `scale-three-mib-mixed-widgets` and `scale-five-mib-framework-and-scripts`), `portable` or `archive` produces a smaller wire size (0.85x of serve) because whole-buffer deflate/brotli chunking eliminates repetitive syntax that `serve` left in the unpruned script bodies. However, for all typical Quarto reports and articles, `serve` consistently produces the wire optimum.

**Verdict**: The name `serve` accurately describes its primary design objective and real-world behavior.

---

### 2. `portable`: Smallest standalone file without JavaScript

**Stated goal**: Smallest standalone file that still works with JavaScript off.

**Empirical evaluation**:
- **521 of 775 (67.2%)** corpus documents are strictly smaller on disk in `portable` than in `serve`.
- On script-dense Quarto documents (htmlwidgets, interactive plots, reveal.js presentations), `portable` shrinks on-disk size by 4x to 7x (e.g. `scale-three-mib-htmlwidget-json` shrinks from 2,397 KiB to 548 KiB).
- On pure markup or static text documents with minimal script content, `portable` is byte-identical or within 0.1% of `serve`.
- **Wire penalty**: When scripts are packed into an encoded blob, transferring that blob over HTTP costs approximately 15% to 20% more bytes than transmitting the raw minified text under Brotli.
- **Inline SVG handling**: Issue #82 asks whether `portable` should also take inline SVG into the packed blob. SVG is native markup that browsers render without script execution. If inline SVG were packed into the script unpacker blob, every chart, icon and diagram on the page would disappear when JavaScript is disabled. Keeping inline SVG outside the packed blob is mandatory to preserve `portable`'s invariant.

**Verdict**: The name `portable` is accurate. Script and data packing provides substantial on-disk savings while ensuring the document remains legible and functional when scripts are blocked or unavailable.

---

### 3. `archive`: Smallest standalone file overall

**Stated goal**: Smallest standalone file; requires JavaScript to unpack.

**Empirical evaluation**:
- **488 of 775 (63.0%)** corpus documents are strictly smaller in `archive` than in `portable`.
- Relative to `serve`, **538 of 775 (69.4%)** documents shrink in `archive`.
- Maximum disk shrink occurs on SVG-heavy and stylesheet-heavy pages (e.g. `scale-one-mib-many-svgs` shrinks from 1,208 KiB in `serve` and `portable` down to 135 KiB in `archive`, an 8.9x reduction).
- **No-JavaScript fallback**: Because `archive` packs stylesheets and document elements into the unpacker payload, a user viewing the file in a browser with JavaScript disabled receives an empty white screen or unformatted raw fallback text. A compact `<noscript>` element explaining that the file is an optimized archive requiring JavaScript provides a clean user experience with negligible byte overhead (~100 bytes uncompressed, ~40 bytes brotli).

**Verdict**: The name `archive` accurately reflects its role as maximum long-term standalone storage efficiency where runtime JavaScript unpacker execution is acceptable.

---

### 4. Missing goals assessment

Two specialized goals were evaluated:

1. **`email`**:
   - Web email clients (Gmail, Outlook 365, Yahoo Mail) strictly strip `<script>` tags, sanitize `<style>` blocks, and reject `data:` URIs for raster images.
   - A dedicated `email` preset would:
     - Inline CSS rules directly into element `style="..."` attributes.
     - Drop all `<script>` tags and unpackers.
     - Retain external or CID image references rather than data URLs.
     - Eliminate SVG where client support is fragile.
   - Recommended as a candidate for a dedicated post-v0.1 feature.

2. **`diff-friendly`**:
   - Standard minification strips newlines and collapses whitespace into unbroken single-line streams, resulting in unreadable git diffs where any change modifies the entire file.
   - A `diff-friendly` mode would apply all exact or serve-level optimizations while preserving line breaks between major structural blocks (paragraphs, sections, script/style tags).

---

### 5. CLI help and audit alignment

- **`--help` examples**: Corrected the example in `crates/octavo-cli/src/main.rs`:
  - Previously: `--level serve keep the page working without JavaScript` (confused with portable).
  - Updated: `--level portable keep the page working without JavaScript` and added `--level serve smallest output over the wire`.
- **`--level` flag description**: Replaced generic description with concise per-preset goal statements.
- **`--audit` output**: Updated the summary line to display the preset's goal alongside its name.
