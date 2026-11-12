//! Octavo shrinks the self-contained HTML that Quarto writes with
//! `embed-resources: true`.
//!
//! A document goes through a fixed series of stages: dead Quarto runtime
//! libraries are removed, scripts and stylesheets are minified and pruned,
//! fonts are converted to WOFF2 (icon fonts are subsetted to the glyphs the
//! CSS can reach), and images are recompressed.
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
mod cache;
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
mod site;
mod words;

pub use check::Url;
pub use site::{
    SiteChange, SiteError, SiteFile, SiteFileKind, SiteKind, SitePlan, SiteReport,
    optimize_directory, plan_directory,
};

use doc::{Doc, Edit, Edits};
use std::{
    fmt,
    num::{NonZeroU32, NonZeroUsize},
    ops::Range,
    str::FromStr,
};

/// How aggressively a document is rewritten.
///
/// The levels nest: each includes everything the previous level does, plus
/// more.
///
/// ```
/// use octavo::{optimize, Mode};
///
/// let safe = optimize("<html><head></head><body></body></html>", Mode::Safe)?;
/// # assert_eq!(safe.html, "<html><head></head><body></body></html>");
/// # Ok::<(), octavo::Error>(())
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Minify and prune. The output needs nothing the original did not.
    Safe,
    /// Additionally compress scripts and data blocks into one blob that a
    /// small loader restores while the page is parsed. Stylesheets and
    /// inline SVG stay real elements, so the page works with JavaScript off.
    Scripts,
    /// Additionally compress stylesheets, inline SVG and images into the
    /// same blob. The loader needs JavaScript, so the page is unstyled when
    /// JavaScript is off.
    Packed,
}

impl fmt::Display for Mode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            Mode::Safe => "safe",
            Mode::Scripts => "scripts",
            Mode::Packed => "packed",
        })
    }
}

impl FromStr for Mode {
    type Err = String;

    /// Parses the lowercase names `safe`, `scripts` and `packed`.
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "safe" => Ok(Mode::Safe),
            "scripts" => Ok(Mode::Scripts),
            "packed" => Ok(Mode::Packed),
            other => Err(format!(
                "unknown level '{other}', expected one of: safe, scripts, packed"
            )),
        }
    }
}

/// Settings for [`simplify`].
///
/// The default keeps images lossless, keeps text fonts whole and keeps license
/// notices.
///
/// ```
/// use octavo::{simplify, Options};
///
/// let options = Options::default();
/// assert!(options.images.is_none() && !options.subset_text_fonts && !options.strip_licenses);
/// ```
#[derive(Clone, Debug, Default)]
pub struct Options {
    /// Re-encode embedded PNG and JPEG images when that makes them smaller.
    /// `None` keeps them as they are, recompressed losslessly.
    pub images: Option<ImageEncoding>,
    /// Subset embedded text fonts to the characters in the document plus
    /// the Latin letters, digits and punctuation, keeping every layout
    /// feature and all kerning. This is often the largest saving in a themed
    /// document, but it is off by default: on Linux, Chromium draws some
    /// hinted fonts, such as Fira Sans, with slightly different strokes after
    /// subsetting, so the output is not pixel-exact everywhere. Text that
    /// JavaScript adds later with characters outside that set falls back to a
    /// system font. Icon fonts are always subsetted to the glyphs the CSS can
    /// reach.
    pub subset_text_fonts: bool,
    /// Drop the license and copyright notices of bundled libraries and
    /// fonts. Most open-source licenses require them to stay with copies,
    /// so only set this if the notices are shipped some other way. By
    /// default the notices in scripts and stylesheets stay where they are,
    /// and the copyright and license fields of a subsetted font move into a
    /// comment beside its `@font-face`.
    pub strip_licenses: bool,
    /// The root of the cache that remembers work between runs, with one
    /// subfolder per kind of entry. Today that is `fonts`: fonts converted
    /// whole, which are the slowest step in most documents and repeat across
    /// documents rendered by the same tool. There is one file per distinct
    /// font, named by a hash of its bytes and quality; subsetted fonts are
    /// cheap and are never stored, so the folder does not fill with variants.
    /// `None` keeps nothing.
    pub cache_directory: Option<std::path::PathBuf>,
    /// How hard the compressors for fonts, PNG images and the packed blob
    /// work. It is independent of the [`Mode`].
    pub compression: Compression,
}

/// How much time to spend compressing.
///
/// ```
/// use octavo::{Compression, Tuning};
///
/// assert_eq!(Compression::default(), Compression::Balanced);
/// assert!(Compression::Maximum.tuning().woff2_quality > Compression::Balanced.tuning().woff2_quality);
/// let custom = Compression::Custom(Tuning { png_preset: Some(0), ..Tuning::BALANCED });
/// assert_eq!(custom.tuning().png_preset, Some(0));
/// ```
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Compression {
    /// A good balance: output a few percent larger than the smallest
    /// possible, in a fraction of the time.
    #[default]
    Balanced,
    /// The slowest, strongest settings everywhere, whatever they cost in
    /// time. The output is usually a little smaller and takes several times
    /// as long, so use it only when every byte matters.
    Maximum,
    /// Your own settings.
    Custom(Tuning),
}

impl Compression {
    /// The settings this choice stands for.
    #[must_use]
    pub fn tuning(self) -> Tuning {
        match self {
            Compression::Balanced => Tuning::BALANCED,
            Compression::Maximum => Tuning::MAXIMUM,
            Compression::Custom(tuning) => tuning,
        }
    }
}

/// The compressor settings behind a [`Compression`]. Values above a
/// setting's range count as its maximum.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tuning {
    /// The Brotli quality of re-encoded WOFF2 fonts, 0 to 11.
    pub woff2_quality: u8,
    /// The oxipng preset for PNG images, 0 (fast) to 6 (thorough). `None`
    /// picks a preset by image size: big images get the quick ones.
    pub png_preset: Option<u8>,
    /// The Brotli quality of the packed blob, 0 to 11. `None` uses 6 and keeps
    /// the result only when the page comes out smaller than with DEFLATE,
    /// counting Brotli's own decoder. Brotli finds
    /// repeated content far apart, such as the same image on many slides,
    /// which DEFLATE cannot.
    pub brotli_quality: Option<u8>,
}

impl Tuning {
    /// The Brotli quality used when [`Tuning::brotli_quality`] is `None`.
    /// The reference encoder uses its large-input hasher at quality 4 only for
    /// inputs over 1 MB and the H5 and H6 hashers from 5 to 9. On an 11 MB
    /// payload quality 5 did not beat DEFLATE where 4 and 6 to 9 beat it by 15
    /// to 18 percent, so 6 is the lowest quality above that gap. It is within 2
    /// percent of 7 in about half a second less.
    pub const DEFAULT_BROTLI_QUALITY: u8 = 6;

    /// What [`Compression::Balanced`] uses.
    pub const BALANCED: Tuning = Tuning {
        woff2_quality: 9,
        png_preset: None,
        brotli_quality: None,
    };
    /// What [`Compression::Maximum`] uses.
    pub const MAXIMUM: Tuning = Tuning {
        woff2_quality: 11,
        png_preset: Some(6),
        brotli_quality: Some(11),
    };
}

/// The quality of a re-encoded image.
///
/// ```
/// use octavo::Quality;
///
/// assert_eq!(Quality::new(80).map(Quality::get), Some(80));
/// assert!(Quality::new(0).is_none() && Quality::new(101).is_none());
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Quality(u8);

impl Quality {
    const AVIF: Quality = Quality(60);
    const WEBP: Quality = Quality(80);

    /// Creates a quality, if it is from 1 to 100.
    ///
    /// ```
    /// use octavo::Quality;
    ///
    /// assert!(Quality::new(60).is_some());
    /// assert!(Quality::new(0).is_none());
    /// ```
    pub fn new(quality: u8) -> Option<Self> {
        (1..=100).contains(&quality).then_some(Quality(quality))
    }

    /// The quality as a number.
    ///
    /// ```
    /// use octavo::Quality;
    ///
    /// assert_eq!(Quality::new(80).map(Quality::get), Some(80));
    /// ```
    #[must_use]
    pub fn get(self) -> u8 {
        self.0
    }
}

/// A lossy image format.
///
/// ```
/// use octavo::ImageFormat;
///
/// assert_eq!("webp".parse::<ImageFormat>(), Ok(ImageFormat::Webp));
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFormat {
    /// AVIF: the smallest, and decoded by every current browser.
    Avif,
    /// WebP: larger than AVIF, but faster to encode.
    Webp,
}

impl fmt::Display for ImageFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            ImageFormat::Avif => "avif",
            ImageFormat::Webp => "webp",
        })
    }
}

impl FromStr for ImageFormat {
    type Err = String;

    /// Parses the lowercase names `avif` and `webp`.
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "avif" => Ok(ImageFormat::Avif),
            "webp" => Ok(ImageFormat::Webp),
            other => Err(format!(
                "unknown format '{other}', expected one of: avif, webp"
            )),
        }
    }
}

/// How to re-encode images.
///
/// ```
/// use octavo::ImageEncoding;
/// use octavo::ImageFormat;
///
/// let encoding = ImageEncoding::new(ImageFormat::Avif);
/// assert_eq!(encoding.quality.get(), 60);
/// assert_eq!(encoding.max_side.map(|side| side.get()), Some(3840));
/// ```
#[derive(Clone, Copy, Debug)]
pub struct ImageEncoding {
    /// The format to encode to.
    pub format: ImageFormat,
    /// The quality of the re-encoded image, from 1 to 100.
    pub quality: Quality,
    /// Shrink images whose longest side is larger than this many pixels,
    /// keeping the aspect ratio. Layout is unchanged while the page never
    /// shows the image larger than this.
    pub max_side: Option<NonZeroU32>,
}

impl ImageEncoding {
    /// The defaults for `format`: quality 60 for AVIF and 80 for WebP, and a
    /// 3840 pixel cap on the longest side.
    ///
    /// ```
    /// use octavo::{ImageEncoding, ImageFormat};
    ///
    /// let encoding = ImageEncoding::new(ImageFormat::Webp);
    /// assert_eq!(encoding.quality.get(), 80);
    /// ```
    #[must_use]
    pub fn new(format: ImageFormat) -> Self {
        let quality = match format {
            ImageFormat::Avif => Quality::AVIF,
            ImageFormat::Webp => Quality::WEBP,
        };
        ImageEncoding {
            format,
            quality,
            max_side: NonZeroU32::new(3840),
        }
    }
}

/// The kind of change a stage made.
///
/// ```
/// use octavo::Transform;
///
/// assert_eq!(Transform::DeadLibrary.to_string(), "dead-library");
/// ```
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

/// A bundled Quarto library, named by the global it defined.
///
/// ```
/// use octavo::{Library, Target};
///
/// assert_eq!(Target::Library(Library::Clipboard).to_string(), "ClipboardJS");
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Library {
    /// `tippy.js`, bundled with Quarto to power footnote, citation and
    /// cross-reference popups.
    Tippy,
    /// `Bootstrap` v5, the CSS framework behind every themed document.
    Bootstrap,
    /// `@popperjs/core`, the positioning engine behind Tippy.
    Popper,
    /// `clipboard.js` v2, bundled for the copy-code buttons.
    Clipboard,
    /// `AnchorJS`, bundled for the heading anchor links.
    Anchor,
}

impl Library {
    /// The name of the global the library defines, as written in the bundled
    /// source.
    ///
    /// ```
    /// use octavo::Library;
    ///
    /// assert_eq!(Library::Clipboard.name(), "ClipboardJS");
    /// ```
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Library::Tippy => "tippy",
            Library::Bootstrap => "bootstrap",
            Library::Popper => "Popper",
            Library::Clipboard => "ClipboardJS",
            Library::Anchor => "AnchorJS",
        }
    }
}

impl fmt::Display for Library {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.name())
    }
}

/// What a transformation changed.
///
/// ```
/// use octavo::Target;
/// use std::num::NonZeroUsize;
///
/// assert_eq!(Target::Resources(NonZeroUsize::new(3).expect("non-zero")).to_string(), "3 resources");
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    /// A bundled library, named by the global it defined.
    Library(Library),
    /// A resource of the document, named by its `id` or by its element name.
    Resource(String),
    /// Resources compressed into one blob.
    Resources(NonZeroUsize),
}

impl fmt::Display for Target {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Target::Library(library) => library.fmt(f),
            Target::Resource(name) => f.pad(name),
            Target::Resources(count) => write!(f, "{} resources", count.get()),
        }
    }
}

/// One transformation and the bytes it saved.
///
/// ```
/// use octavo::optimize;
/// use octavo::Mode;
///
/// let out = optimize("<html><head></head><body></body></html>", Mode::Safe)?;
/// assert!(out.applied.iter().all(|step| step.after <= step.before));
/// # Ok::<(), octavo::Error>(())
/// ```
#[derive(Clone, Debug)]
pub struct Applied {
    /// What kind of change this was.
    pub transform: Transform,
    /// What it changed.
    pub target: Target,
    /// Size before, in bytes.
    pub before: usize,
    /// Size after, in bytes.
    pub after: usize,
}

/// Something worth knowing about a document that does not stop optimization.
///
/// ```
/// use octavo::{optimize, Mode, Warning};
///
/// let remote = "<!DOCTYPE html><html><head>\
///     <script src=\"https://cdn.example.com/lib.js\"></script></head><body></body></html>";
/// let out = optimize(remote, Mode::Safe)?;
/// assert!(out.warnings.iter().any(|warning| matches!(warning, Warning::RemoteResource(_))));
/// # Ok::<(), octavo::Error>(())
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Warning {
    /// The page loads a resource from the network, so it cannot work
    /// offline. Carries the URL as written in the document.
    RemoteResource(Url),
}

impl fmt::Display for Warning {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Warning::RemoteResource(url) => {
                write!(
                    f,
                    "loads {url} when opened, so the page does not work offline"
                )
            }
        }
    }
}

/// An optimized document and what happened to it.
///
/// ```
/// use octavo::{optimize, Mode};
///
/// let html = "<!DOCTYPE html><html><head></head><body><p>hi</p></body></html>";
/// let out = optimize(html, Mode::Safe)?;
/// assert!(out.applied.is_empty());
/// # Ok::<(), octavo::Error>(())
/// ```
#[derive(Clone, Debug)]
pub struct Output {
    /// The optimized HTML.
    pub html: String,
    /// Every transformation applied, in order.
    pub applied: Vec<Applied>,
    /// Things worth knowing about the input, such as resources it loads from
    /// the network and therefore cannot work without one.
    pub warnings: Vec<Warning>,
}

/// Why a document cannot be optimized.
///
/// ```
/// use octavo::{optimize, Error, Mode};
///
/// assert_eq!(optimize("just some words", Mode::Safe).unwrap_err(), Error::NotHtml);
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// The input has no `<html>` element.
    NotHtml,
    /// The document links to local files instead of containing them, which
    /// means it was not rendered with `embed-resources: true`. Holds the
    /// links in document order.
    NotSelfContained(Vec<Url>),
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
                write!(
                    f,
                    "{}",
                    links[..links.len().min(SHOWN)]
                        .iter()
                        .map(Url::as_str)
                        .collect::<Vec<_>>()
                        .join(", ")
                )?;
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
///
/// ```
/// use octavo::{optimize, Mode};
///
/// let html = "<!DOCTYPE html><html><head><style>.a{color:red}.b{color:blue}</style>\
///             </head><body><p class=a>hi</p></body></html>";
/// let out = optimize(html, Mode::Safe)?;
/// assert!(out.html.contains(".a{color:red}") && !out.html.contains(".b"));
/// # Ok::<(), octavo::Error>(())
/// ```
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
///
/// ```
/// use octavo::{simplify, Mode, Options};
///
/// let simplified = simplify("<html><head></head><body></body></html>", Options::default())?;
/// for mode in [Mode::Safe, Mode::Scripts, Mode::Packed] {
///     let out = simplified.pack(mode);
///     println!("{mode}: {} bytes", out.html.len());
/// }
/// # Ok::<(), octavo::Error>(())
/// ```
pub fn simplify(src: &str, options: Options) -> Result<Simplified, Error> {
    let doc = Doc::new(src);
    if !check::is_html(&doc) {
        return Err(Error::NotHtml);
    }
    let links = check::links(&doc);
    if !links.is_self_contained() {
        return Err(Error::NotSelfContained(links.local().cloned().collect()));
    }
    let licenses = if options.strip_licenses {
        Licenses::Strip
    } else {
        Licenses::Keep
    };
    let (images, (removals, scripts, styles)) = rayon::join(
        || images::stage(&doc, options.images, options.compression.tuning()),
        || {
            let (markup, parts) = rayon::join(|| doc.markup(), || doc.word_parts());
            let removals = quarto::stage(&doc, &markup);
            let removed: Vec<Range<usize>> =
                removals.iter().map(|edit| edit.span.clone()).collect();
            let (scripts, styles) = rayon::join(
                || js::stage(&doc, &removed, licenses),
                || {
                    let words = doc.words(markup, parts, &removed);
                    css::stage(
                        &doc,
                        &words,
                        options.subset_text_fonts,
                        licenses,
                        options.cache_directory.as_deref(),
                        options.compression.tuning(),
                    )
                },
            );
            (removals, scripts, styles)
        },
    );
    let edits: Vec<Edit> = removals
        .into_iter()
        .chain(scripts)
        .chain(styles)
        .chain(images)
        .collect();
    let edits = Edits::new(edits);
    let applied = edits
        .kept()
        .iter()
        .map(|edit| Applied {
            transform: edit.transform,
            target: edit.target.clone(),
            before: edit.span.len(),
            after: edit.text.len(),
        })
        .collect();
    let html = edits.apply(src);
    Ok(Simplified {
        scanned: html::Scanned::new(html),
        compression: options.compression,
        applied,
        warnings: links
            .remote()
            .cloned()
            .map(Warning::RemoteResource)
            .collect(),
    })
}

/// A document after the stages that do not depend on a [`Mode`].
///
/// Packing is the only step left, and it is the expensive one, so it is kept
/// separate: try several modes on one `Simplified` without redoing the rest.
///
/// ```
/// use octavo::{simplify, Mode, Options};
///
/// let simplified = simplify("<html><head></head><body></body></html>", Options::default())?;
/// assert_eq!(simplified.warnings().len(), 0);
/// let out = simplified.pack(Mode::Scripts);
/// # assert_eq!(out.html, "<html><head></head><body></body></html>");
/// # Ok::<(), octavo::Error>(())
/// ```
#[derive(Clone, Debug)]
pub struct Simplified {
    scanned: html::Scanned,
    applied: Vec<Applied>,
    warnings: Vec<Warning>,
    compression: Compression,
}

impl Simplified {
    /// Things worth knowing about the input, such as resources it loads from
    /// the network. The same list appears on every [`Output`].
    ///
    /// ```
    /// use octavo::{simplify, Options};
    ///
    /// let simplified = simplify("<html><head></head><body></body></html>", Options::default())?;
    /// assert!(simplified.warnings().is_empty());
    /// # Ok::<(), octavo::Error>(())
    /// ```
    #[must_use]
    pub fn warnings(&self) -> &[Warning] {
        &self.warnings
    }

    /// Produces the final document for `mode`, keeping the unpacked document
    /// when packing would not make it smaller.
    ///
    /// ```
    /// use octavo::{simplify, Mode, Options};
    ///
    /// let simplified = simplify("<html><head></head><body></body></html>", Options::default())?;
    /// let out = simplified.pack(Mode::Packed);
    /// assert_eq!(out.html, "<html><head></head><body></body></html>");
    /// # Ok::<(), octavo::Error>(())
    /// ```
    #[must_use]
    pub fn pack(&self, mode: Mode) -> Output {
        let unpacked = || Output {
            html: self.scanned.html().to_string(),
            applied: self.applied.clone(),
            warnings: self.warnings.clone(),
        };
        if mode == Mode::Safe {
            return unpacked();
        }
        let Some(packed) = pack::run(&self.scanned, mode, self.compression.tuning())
            .filter(|p| p.html.len() < self.scanned.html().len())
        else {
            return unpacked();
        };
        let mut applied = self.applied.clone();
        applied.push(Applied {
            transform: Transform::Packed,
            target: Target::Resources(packed.blobs),
            before: self.scanned.html().len(),
            after: packed.html.len(),
        });
        Output {
            html: packed.html,
            applied,
            warnings: self.warnings.clone(),
        }
    }

    /// Produces the final document for `mode`, but only if `accept` approves
    /// it. A rejected result is replaced by the next safer mode (`Packed`,
    /// then `Scripts`, then `Safe`), and `None` means every mode was
    /// rejected, so the caller should keep the original. `accept` sees each
    /// candidate with the mode that produced it, and the mode returned is the
    /// one that was accepted.
    ///
    /// Use it to put your own check, such as a browser comparison, between
    /// Octavo and the file it writes.
    ///
    /// ```
    /// use octavo::{simplify, Mode, Options};
    ///
    /// let simplified = simplify("<html><head></head><body></body></html>", Options::default())?;
    /// let mut tried = Vec::new();
    /// let accepted = simplified.pack_checked(Mode::Packed, |mode, _| {
    ///     tried.push(mode);
    ///     mode == Mode::Safe
    /// });
    /// assert_eq!(tried, [Mode::Packed, Mode::Scripts, Mode::Safe]);
    /// assert_eq!(accepted.map(|(mode, _)| mode), Some(Mode::Safe));
    /// # Ok::<(), octavo::Error>(())
    /// ```
    pub fn pack_checked(
        &self,
        mode: Mode,
        mut accept: impl FnMut(Mode, &Output) -> bool,
    ) -> Option<(Mode, Output)> {
        let ladder: &[Mode] = match mode {
            Mode::Packed => &[Mode::Packed, Mode::Scripts, Mode::Safe],
            Mode::Scripts => &[Mode::Scripts, Mode::Safe],
            Mode::Safe => &[Mode::Safe],
        };
        ladder.iter().find_map(|&step| {
            let candidate = self.pack(step);
            accept(step, &candidate).then_some((step, candidate))
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Licenses {
    Keep,
    Strip,
}
