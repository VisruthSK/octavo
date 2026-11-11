# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0]

First release.

### Added

- The `octavo` command line: `octavo <input> [output]`, with `--level` (`safe`, `scripts`, `packed`), `--verify`, `--audit`, `--lossy-images`, `--image-quality`, `--max-image-side`, `--subset-text-fonts`, `--strip-licenses` and `--jobs`.
- The `octavo` library: `optimize`, `simplify` and `Simplified::pack`, with typed modes, options, results, warnings and errors.
- Removal of Quarto's bundled JavaScript libraries (Bootstrap, Popper, Tippy, Clipboard.js, Anchor.js) that the page never uses.
- JavaScript minification and stylesheet pruning and minification, with custom property values kept verbatim.
- Font handling: unused fonts dropped, the source browsers use kept and converted to WOFF2, legacy copies removed, icon fonts subsetted to the glyphs the surviving CSS can reach, and optional text-font subsetting.
- Lossless PNG recompression that keeps the chunks that change colour rendering, identical images processed once, and optional lossy AVIF or WebP re-encoding with a size cap.
- Packing of scripts, styles, SVG, images and data blocks into one compressed blob restored by a small loader.
- A browser verifier that compares the original and the optimized page, and a test corpus of about 470 documents with a runner and a weekly workflow.
- Third-party license notices in the release archives, and preservation of license comments in the optimized output.
