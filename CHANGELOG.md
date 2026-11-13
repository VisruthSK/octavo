# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Site mode: `octavo <directory>` optimizes the stylesheets, scripts, fonts and PNG images that a rendered site's pages share, once for the whole site and under the same file names. The library function is `optimize_directory`. `verify/site.mjs` compares every page of the original and the optimized site in Chromium.
- Site mode plans the output before writing it. The library function `plan_directory` returns a `SitePlan` with every file of the output, and `SitePlan::write` writes it.

### Changed

- Site mode: `--lossy-images` now re-encodes PNG and JPEG images that a directory's pages share instead of being refused. Each image file is encoded once as AVIF or WebP, at the largest width any page draws it at, taken from the `width` attributes, inline styles and stylesheets of the pages; the image keeps its size when any use of it cannot be sized, and the pages' `src` attributes are rewritten to the new format's name. PNGs with partial transparency, images referenced outside `<img>` tags and images whose size is unknown stay lossless.
- Site mode: `--subset-fonts` now cuts text fonts to the characters that any page, script, stylesheet or JSON file of the site can show, including the text that only `search.json` reveals. When one of those files cannot be read, every text font stays whole.
- Site mode writes the whole tree into a staging directory next to the output, checks that every planned file is there with the planned size, and only then promotes the tree with renames. The promotion is a sequence of renames and not a single atomic operation: the old output is renamed aside, the staged tree takes its place, and the old tree is deleted afterwards. A run that fails before the promotion removes the staging directory and leaves the previous output byte for byte as it was, and a file from an earlier run that is no longer part of the site does not survive.
- Site mode reads regular files only. A symbolic link that points at a regular file inside the site is copied as a regular file, and one that points outside the site is an error that names the path. Any other kind of entry is an error too, so nothing is left out silently.

### Changed

- Fonts: `--subset-fonts` cuts text fonts with [skera](https://crates.io/crates/skera) instead of HarfBuzz, so the build no longer compiles C++ for font subsetting. The same characters are kept, every layout feature survives, and the axes of a variable font are unchanged.

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
