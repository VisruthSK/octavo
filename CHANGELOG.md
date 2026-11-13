# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-13

### Changed

- Fonts are re-encoded to WOFF2 with [`ttf2woff2`](https://crates.io/crates/ttf2woff2), a pure Rust encoder, instead of `woofwoof`, which wraps Google's C++ WOFF2 library. `Tuning::woff2_quality` still controls the Brotli quality of the output. The `glyf`/`loca` transformation is applied only when the font's `glyf` table is at most 131070 bytes, so the rebuilt short `loca` table cannot overflow when `glyf` exceeds what the short format can address.
- The public enums and `Options` are `#[non_exhaustive]`, so adding variants or fields later is not a breaking change.
- Fonts: text fonts are subsetted by default, with [skera](https://crates.io/crates/skera) instead of HarfBuzz, so the build no longer compiles C++ for font subsetting. The same characters are kept, every layout feature survives, and the axes of a variable font are unchanged. Hinted static fonts, those with `fpgm`, `prep` and `cvt ` tables, are kept whole because Chromium on Linux draws them with slightly different stroke shading after subsetting; variable fonts and fonts without hinting programs are subsetted. A font kept whole for this reason is listed by `--audit` as a `font-kept-whole` row with a `0 B` saving. `--subset-fonts` is replaced by `--no-subset-fonts`.
- The `--audit` output now applies the same options as a normal run, instead of only the defaults.

### Added

- Embedding: `octavo page.html` embeds the files a page links before optimizing it, so `embed-resources: true` is no longer required and the output is always one self-contained file. Octavo looks next to the page, in each `--resource-path <DIR>`, in parent directories (which finds `/site_libs/...`), and in `site_libs` or `<name>_files` directories beside the page or a parent. Files linked from the web are downloaded unless `--no-fetch` is given. Plain scripts are inlined, `@import` is flattened into the stylesheet and relative imports in module scripts become data URLs. The library has `embed_resources`, the `Resources` trait, `Loaded`, `Embedded` and `is_self_contained`. `verify/linked.mjs` and a job in the corpus workflow compare Octavo on linked renders with embedded renders of the same Quarto documents.
- Lossless WebP: an 8-bit PNG without a colour profile, gamma, chromaticity, cICP, EXIF or animation chunk, and with only fully opaque or fully transparent pixels, becomes lossless WebP when that is smaller than the best PNG, with identical pixels. `--keep-png` (`Options::keep_png`) turns it off. `--image-memory <MIB>` (`Options::image_memory`, default `Options::DEFAULT_IMAGE_MEMORY`, 2560 MiB) caps the memory the encoder uses at once, at about 20 bytes per pixel. libwebp is added under the BSD-3-Clause license, and `ureq` with the CDLA-Permissive-2.0 root certificate data is added for downloads.

## [0.1.0-alpha.1]

First pre-release. The command line and the library API can still change. On Quarto's own 465 test documents the median page shrinks 12.8 times at the `packed` level.

### Added

- The `octavo` command line: `octavo <input> [output]` with `--level` (`safe`, `scripts`, `packed`), `--audit`, `--lossy-images`, `--image-quality`, `--max-image-side`, `--subset-fonts`, `--strip-licenses`, `--cache-dir`, `--no-cache`, `--maximum`, `--woff2-quality`, `--png-preset`, `--brotli-quality`, `--jobs` and `--completions` for bash, zsh, fish, elvish, PowerShell and nushell. The defaults quoted in `--help` are read from the library.
- The `octavo` library: `optimize`, `simplify` and `Simplified::pack`, with typed modes, options, results, warnings and errors. `Options::compression` takes `Compression::Balanced`, `Compression::Maximum` or `Compression::Custom(Tuning)`, `Options::cache_directory` names the font cache, and `Simplified::pack_checked` steps down to a safer mode when your own check rejects a result.
- Removal of the bundled JavaScript libraries that Quarto inlines (Bootstrap, Popper, Tippy, Clipboard.js, Anchor.js) when the page never uses them.
- JavaScript minification, and stylesheet pruning and minification with custom property values kept verbatim. A rule the CSS parser rejects, or whose `calc()` arithmetic would lose precision, is kept as written and the rest of the stylesheet is still optimized.
- Fonts: unused fonts are dropped, the source browsers use is kept and converted to WOFF2, legacy copies are removed, and icon fonts are subsetted to the glyphs the surviving CSS can reach. Text fonts stay whole, or with `--subset-fonts` are cut to the characters the document uses with HarfBuzz, keeping kerning and every layout feature. Fonts converted whole are cached between runs in the user cache directory.
- Lossless PNG recompression that keeps the chunks affecting colour rendering, identical images processed once, and optional lossy AVIF or WebP re-encoding with a size cap.
- Packing of scripts, styles, SVG, images and data blocks into one compressed blob restored by a small loader. The blob uses DEFLATE or Brotli, whichever gives the smaller page.
- `--audit`, which prints what each step saves at the chosen level.
- A browser verifier that compares the original and the optimized page in seven scenarios, including running animations, with a self-test that breaks a page in a dozen known ways and requires each to be caught.
- A corpus of 318 hand-written documents and the 465 Quarto test documents that render to self-contained HTML. CI runs a sample of 71 on every push and pull request, and the full corpus, split across 24 shards, before every release.
- A release workflow that builds and publishes only after the CI suite and the full corpus pass, with one-line shell and PowerShell installers.
- Third-party license notices in the release archives, and preservation of license comments in the optimized output.

### Known issues

- Chromium on Linux draws some hinted static fonts, such as Fira Sans, with slightly different stroke shading after `--subset-fonts`. Layout is identical. Text fonts stay whole by default because of this.
- A `packed` page that uses Brotli needs `unsafe-eval`. Octavo detects a `<meta>` Content-Security-Policy and skips packing, but cannot see a policy sent as an HTTP header. Use `--level scripts` or allow `unsafe-eval` for those pages.
