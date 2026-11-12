# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.1]

First pre-release. The command line and the library API can still change.

### Added

- The `octavo` command line: `octavo <input> [output]`, with `--level` (`safe`, `scripts`, `packed`), `--audit`, `--lossy-images`, `--image-quality`, `--max-image-side`, `--no-subset-fonts`, `--strip-licenses`, `--cache-dir`, `--no-cache`, `--maximum`, `--woff2-quality`, `--png-preset`, `--brotli-quality` and `--jobs`.
- The `octavo` library: `optimize`, `simplify` and `Simplified::pack`, with typed modes, options, results, warnings and errors. `Options::compression` takes `Compression::Balanced`, `Compression::Maximum` or `Compression::Custom(Tuning)`, and `Options::cache_directory` names the font cache, and `Simplified::pack_checked` steps down to a safer mode when your own check rejects a result.
- Removal of Quarto's bundled JavaScript libraries (Bootstrap, Popper, Tippy, Clipboard.js, Anchor.js) that the page never uses.
- JavaScript minification and stylesheet pruning and minification, with custom property values kept verbatim. A rule the CSS parser rejects, or whose `calc()` arithmetic would lose precision, is kept as written and the rest of the stylesheet is still optimized.
- Font handling: unused fonts dropped, the source browsers use kept and converted to WOFF2, legacy copies removed, icon fonts subsetted to the glyphs the surviving CSS can reach, and text fonts subsetted by default to the characters the document uses, with HarfBuzz, keeping kerning and every layout feature. Fonts converted whole are cached between runs, by default in the user cache directory.
- Lossless PNG recompression that keeps the chunks that change colour rendering, identical images processed once, and optional lossy AVIF or WebP re-encoding with a size cap.
- Packing of scripts, styles, SVG, images and data blocks into one compressed blob restored by a small loader.
- A browser verifier that compares the original and the optimized page in seven scenarios, pixel for pixel, including running animations, and a self-test that proves it catches a dozen known breakages.
- A test corpus of about 300 hand-written documents and every Quarto test document that renders to self-contained HTML. CI runs a quick sample on every push and pull request, and the full tier, split across 24 shards, before every release.
- A release workflow that builds and publishes only after the CI suite and the full corpus pass, with one-line shell and PowerShell installers.
- Third-party license notices in the release archives, and preservation of license comments in the optimized output.

