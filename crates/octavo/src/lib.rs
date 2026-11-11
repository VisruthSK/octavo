//! Octavo shrinks the self-contained HTML that Quarto writes with
//! `embed-resources: true`.
//!
//! A document goes through a fixed series of stages: dead Quarto runtime
//! libraries are removed, scripts and stylesheets are minified and pruned,
//! fonts are converted to WOFF2 and subsetted, and images are recompressed.
//! Each stage reads the document and returns edits to byte ranges, so
//! anything Octavo does not understand stays exactly as it was.
//!
//! ```
//! use octavo::{optimize, Mode};
//!
//! let html = "<!DOCTYPE html><html><head><style>.a{color:red}.b{color:blue}</style>\
//!             </head><body><p class=a>hi</body></html>";
//! let out = optimize(html, Mode::Safe)?;
//! assert!(out.html.contains(".a{color:red}") && !out.html.contains(".b"));
//! # Ok::<(), octavo::Error>(())
//! ```
//!
//! To try several [`Mode`]s on one document, run [`simplify`] once and call
//! [`Simplified::pack`] for each mode.

mod ascii;
mod check;
mod css;
mod data;
mod doc;
mod fonts;
mod html;
mod images;
mod js;
mod pack;
mod quarto;
mod words;

use doc::{apply, Doc, Edit};
use std::{fmt, ops::Range};

/// How aggressively a document is rewritten.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Minify and prune. The output needs nothing the original did not.
    Safe,
    /// Additionally compress scripts, and with `styles` also stylesheets,
    /// inline SVG and images, into one blob that a small loader restores
    /// while the page is parsed. The loader needs JavaScript, so with
    /// `styles` the page is unstyled when JavaScript is off.
    Packed {
        /// Also pack stylesheets, inline SVG and images.
        styles: bool,
    },
}

/// Settings for [`simplify`].
///
/// The default is lossless and keeps license notices.
#[derive(Clone, Copy, Debug, Default)]
pub struct Options {
    /// Re-encode embedded PNG and JPEG images when that makes them smaller.
    /// `None` keeps them as they are, recompressed losslessly.
    pub images: Option<ImageEncoding>,
    /// Subset embedded text fonts to the characters in the document plus
    /// the Latin letters, digits and punctuation. This is often the largest
    /// saving in a themed document, but it is not exact: the subsetter drops
    /// some kerning pairs, so text can move by a pixel or two, and text that
    /// JavaScript adds later in another script falls back to a system font.
    /// Icon fonts are always subsetted to the glyphs the CSS can reach.
    pub subset_text_fonts: bool,
    /// Drop the license and copyright notices of bundled libraries and
    /// fonts. Most open-source licenses require them to stay with copies,
    /// so only set this if the notices are shipped some other way. By
    /// default the notices in scripts and stylesheets stay where they are,
    /// and the copyright and license fields of a subsetted font move into a
    /// comment beside its `@font-face`.
    pub strip_licenses: bool,
}

/// A lossy image format.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFormat {
    /// AVIF: the smallest, and decoded by every current browser.
    Avif,
    /// WebP: larger than AVIF, but faster to encode.
    Webp,
}

/// How to re-encode images.
#[derive(Clone, Copy, Debug)]
pub struct ImageEncoding {
    /// The format to encode to.
    pub format: ImageFormat,
    /// Quality from 1 to 100.
    pub quality: u8,
    /// Shrink images whose longest side is larger than this many pixels,
    /// keeping the aspect ratio. Layout is unchanged while the page never
    /// shows the image larger than this.
    pub max_side: Option<u32>,
}

impl ImageEncoding {
    /// The defaults for `format`: quality 60 for AVIF and 80 for WebP, and a
    /// 3840 pixel cap on the longest side.
    pub fn new(format: ImageFormat) -> Self {
        let quality = match format {
            ImageFormat::Avif => 60,
            ImageFormat::Webp => 80,
        };
        ImageEncoding {
            format,
            quality,
            max_side: Some(3840),
        }
    }
}

/// The kind of change a stage made.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Transform {
    /// A Quarto runtime library the document never uses was removed.
    DeadLibrary,
    /// A script was minified.
    MinifiedScript,
    /// A stylesheet lost unreachable rules and was minified.
    PrunedStylesheet,
    /// A PNG was recompressed losslessly.
    RecompressedPng,
    /// An image was re-encoded in a lossy format.
    ReencodedImage,
    /// Resources were compressed into one blob.
    Packed,
}

impl fmt::Display for Transform {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            Transform::DeadLibrary => "dead-library",
            Transform::MinifiedScript => "script-minified",
            Transform::PrunedStylesheet => "stylesheet-pruned",
            Transform::RecompressedPng => "png-recompressed",
            Transform::ReencodedImage => "image-reencoded",
            Transform::Packed => "packed",
        })
    }
}

/// One transformation and the bytes it saved.
#[derive(Clone, Debug)]
pub struct Applied {
    /// What kind of change this was.
    pub transform: Transform,
    /// The resource it changed.
    pub target: String,
    /// Size before, in bytes.
    pub before: usize,
    /// Size after, in bytes.
    pub after: usize,
}

/// An optimized document and what happened to it.
#[derive(Clone, Debug)]
pub struct Output {
    /// The optimized HTML.
    pub html: String,
    /// Every transformation applied, in order.
    pub applied: Vec<Applied>,
    /// Things worth knowing about the input, such as resources it loads from
    /// the network and therefore cannot work without one.
    pub warnings: Vec<String>,
}

/// Why a document cannot be optimized.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// The input has no `<html>` element.
    NotHtml,
    /// The document links to local files instead of containing them, which
    /// means it was not rendered with `embed-resources: true`. Holds the
    /// links in document order.
    NotSelfContained(Vec<String>),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const SHOWN: usize = 3;
        match self {
            Error::NotHtml => write!(f, "this is not an HTML document"),
            Error::NotSelfContained(links) => {
                write!(
                    f,
                    "the document links to files instead of containing them: "
                )?;
                write!(f, "{}", links[..links.len().min(SHOWN)].join(", "))?;
                if links.len() > SHOWN {
                    write!(f, " and {} more", links.len() - SHOWN)?;
                }
                write!(f, "; render it with `embed-resources: true`")
            }
        }
    }
}

impl std::error::Error for Error {}

/// Optimizes `src` in the given mode with the default [`Options`].
///
/// # Errors
///
/// Fails if `src` is not an HTML document or is not self-contained.
pub fn optimize(src: &str, mode: Mode) -> Result<Output, Error> {
    Ok(simplify(src, Options::default())?.pack(mode))
}

/// Runs the stages that do not depend on a [`Mode`].
///
/// Call [`Simplified::pack`] on the result for each mode to try.
///
/// # Errors
///
/// Fails if `src` is not an HTML document or is not self-contained.
pub fn simplify(src: &str, options: Options) -> Result<Simplified, Error> {
    if !check::is_html(src) {
        return Err(Error::NotHtml);
    }
    let doc = Doc::new(src);
    let links = check::links(&doc);
    if !links.local.is_empty() {
        return Err(Error::NotSelfContained(links.local.into_iter().collect()));
    }
    let removals = quarto::stage(&doc);
    let removed: Vec<Range<usize>> = removals.iter().map(|edit| edit.span.clone()).collect();
    let words = doc.words(&removed);
    let (scripts, (styles, images)) = rayon::join(
        || js::stage(&doc, &removed, !options.strip_licenses),
        || {
            rayon::join(
                || {
                    css::stage(
                        &doc,
                        &words,
                        options.subset_text_fonts,
                        !options.strip_licenses,
                    )
                },
                || images::stage(&doc, options.images),
            )
        },
    );
    let edits: Vec<Edit> = removals
        .into_iter()
        .chain(scripts)
        .chain(styles)
        .chain(images)
        .collect();
    let applied = edits
        .iter()
        .map(|edit| Applied {
            transform: edit.transform,
            target: edit.target.clone(),
            before: edit.span.len(),
            after: edit.text.len(),
        })
        .collect();
    let html = apply(src, edits);
    let tags = html::scan(&html);
    Ok(Simplified {
        html,
        applied,
        warnings: links
            .remote
            .iter()
            .map(|url| format!("loads {url} when opened, so the page does not work offline"))
            .collect(),
        tags,
    })
}

/// A document after the stages that do not depend on a [`Mode`].
///
/// Packing is the only step left, and it is the expensive one, so it is kept
/// separate: try several modes on one `Simplified` without redoing the rest.
#[derive(Clone, Debug)]
pub struct Simplified {
    html: String,
    applied: Vec<Applied>,
    warnings: Vec<String>,
    tags: Vec<html::Tag>,
}

impl Simplified {
    /// Things worth knowing about the input, such as resources it loads from
    /// the network. The same list appears on every [`Output`].
    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// Produces the final document for `mode`, keeping the unpacked document
    /// when packing would not make it smaller.
    pub fn pack(&self, mode: Mode) -> Output {
        let unpacked = || Output {
            html: self.html.clone(),
            applied: self.applied.clone(),
            warnings: self.warnings.clone(),
        };
        let Mode::Packed { styles } = mode else {
            return unpacked();
        };
        let Some(packed) =
            pack::run(&self.html, &self.tags, styles).filter(|p| p.html.len() < self.html.len())
        else {
            return unpacked();
        };
        let mut applied = self.applied.clone();
        applied.push(Applied {
            transform: Transform::Packed,
            target: format!("{} resources", packed.blobs),
            before: self.html.len(),
            after: packed.html.len(),
        });
        Output {
            html: packed.html,
            applied,
            warnings: self.warnings.clone(),
        }
    }
}
