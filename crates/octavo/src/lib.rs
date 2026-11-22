//! Octavo shrinks the self-contained HTML that Quarto writes with
//! `embed-resources: true`.
//!
//! A document goes through a fixed series of stages: dead Quarto runtime
//! libraries are removed, scripts and stylesheets are minified and pruned,
//! fonts are converted to WOFF2 (text fonts are subsetted, hinted static
//! fonts are kept whole, and icon fonts are subsetted to the glyphs the
//! CSS can reach), and images are recompressed.
//! Each stage reads the document and returns edits to byte ranges, so
//! anything Octavo does not understand stays exactly as it was.
//!
//! ```
//! use octavo::{Packaging, optimize};
//!
//! let html = "<!DOCTYPE html><html><head><style>.a{color:red}.b{color:blue}</style>\
//!             </head><body><p class=a>hi</body></html>";
//! let out = optimize(html, Packaging::Plain)?;
//! assert!(out.html.contains(".a{color:red}") && !out.html.contains(".b"));
//! # Ok::<(), octavo::Error>(())
//! ```
//!
//! To try several packaging formats on one document, run [`simplify`] once and call
//! [`Simplified::package`] for each packaging target.

mod ascii;
mod cache;
mod check;
mod css;
mod data;
mod doc;
mod embed;
mod fonts;
mod html;
mod images;
mod js;
mod pack;
mod quarto;
mod words;

pub use cache::Cache;
pub use check::Url;
pub use embed::{Embedded, Loaded, Resources, embed_resources};

use doc::{Doc, Edit, Edits};
use std::{
    collections::BTreeMap,
    fmt,
    num::{NonZeroU32, NonZeroUsize},
    ops::Range,
    str::FromStr,
    sync::Arc,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum Packaging {
    #[default]
    Plain,
    Scripts,
    Packed,
}

impl fmt::Display for Packaging {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            Packaging::Plain => "plain",
            Packaging::Scripts => "scripts",
            Packaging::Packed => "packed",
        })
    }
}

impl FromStr for Packaging {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "plain" => Ok(Packaging::Plain),
            "scripts" => Ok(Packaging::Scripts),
            "packed" => Ok(Packaging::Packed),
            other => Err(format!(
                "unknown packaging '{other}', expected one of: plain, scripts, packed"
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum Effort {
    Fast,
    #[default]
    Balanced,
    Maximum,
}

impl Effort {
    #[must_use]
    pub const fn tuning(self) -> Tuning {
        match self {
            Effort::Fast => Tuning::FAST,
            Effort::Balanced => Tuning::BALANCED,
            Effort::Maximum => Tuning::MAXIMUM,
        }
    }
}

impl fmt::Display for Effort {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            Effort::Fast => "fast",
            Effort::Balanced => "balanced",
            Effort::Maximum => "maximum",
        })
    }
}

impl FromStr for Effort {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "fast" => Ok(Effort::Fast),
            "balanced" => Ok(Effort::Balanced),
            "maximum" => Ok(Effort::Maximum),
            other => Err(format!(
                "unknown effort '{other}', expected one of: fast, balanced, maximum"
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum EvidenceClass {
    Exact,
    #[default]
    Generic,
    Quarto1,
}

impl fmt::Display for EvidenceClass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            EvidenceClass::Exact => "exact",
            EvidenceClass::Generic => "generic",
            EvidenceClass::Quarto1 => "quarto1",
        })
    }
}

impl FromStr for EvidenceClass {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "exact" => Ok(EvidenceClass::Exact),
            "generic" => Ok(EvidenceClass::Generic),
            "quarto1" => Ok(EvidenceClass::Quarto1),
            other => Err(format!(
                "unknown evidence class '{other}', expected one of: exact, generic, quarto1"
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum FontPolicy {
    #[default]
    Auto,
    Force,
    Off,
}

impl fmt::Display for FontPolicy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            FontPolicy::Auto => "auto",
            FontPolicy::Force => "force",
            FontPolicy::Off => "off",
        })
    }
}

impl FromStr for FontPolicy {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "auto" => Ok(FontPolicy::Auto),
            "force" => Ok(FontPolicy::Force),
            "off" => Ok(FontPolicy::Off),
            other => Err(format!(
                "unknown font policy '{other}', expected one of: auto, force, off"
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum Licenses {
    #[default]
    Keep,
    Strip,
}

impl fmt::Display for Licenses {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            Licenses::Keep => "keep",
            Licenses::Strip => "strip",
        })
    }
}

impl FromStr for Licenses {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "keep" => Ok(Licenses::Keep),
            "strip" => Ok(Licenses::Strip),
            other => Err(format!(
                "unknown licenses policy '{other}', expected one of: keep, strip"
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum PngPolicy {
    #[default]
    LosslessWebp,
    Preserve,
}

impl fmt::Display for PngPolicy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            PngPolicy::LosslessWebp => "lossless-webp",
            PngPolicy::Preserve => "preserve",
        })
    }
}

impl FromStr for PngPolicy {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "lossless-webp" => Ok(PngPolicy::LosslessWebp),
            "preserve" => Ok(PngPolicy::Preserve),
            other => Err(format!(
                "unknown png policy '{other}', expected one of: lossless-webp, preserve"
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum Rule {
    QuartoDeadLibrary,
    ScriptMinified,
    StylesheetPruned,
    PngRecompressed,
    ImageReencoded,
    FontKeptWhole,
    FontSubsetted,
    PackResources,
}

impl Rule {
    #[must_use]
    pub const fn evidence_class(&self) -> EvidenceClass {
        match self {
            Rule::QuartoDeadLibrary => EvidenceClass::Quarto1,
            Rule::ScriptMinified => EvidenceClass::Exact,
            Rule::StylesheetPruned
            | Rule::PngRecompressed
            | Rule::ImageReencoded
            | Rule::FontKeptWhole
            | Rule::FontSubsetted
            | Rule::PackResources => EvidenceClass::Generic,
        }
    }
}

impl fmt::Display for Rule {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(match self {
            Rule::QuartoDeadLibrary => "quarto-dead-library",
            Rule::ScriptMinified => "script-minified",
            Rule::StylesheetPruned => "stylesheet-pruned",
            Rule::PngRecompressed => "png-recompressed",
            Rule::ImageReencoded => "image-reencoded",
            Rule::FontKeptWhole => "font-kept-whole",
            Rule::FontSubsetted => "font-subsetted",
            Rule::PackResources => "pack-resources",
        })
    }
}

#[derive(Clone)]
#[non_exhaustive]
pub struct Config {
    pub packaging: Packaging,
    pub effort: Effort,
    pub evidence: EvidenceClass,
    pub fonts: FontPolicy,
    pub licenses: Licenses,
    pub png: PngPolicy,
    pub images: Option<ImageEncoding>,
    pub image_memory: Option<NonZeroUsize>,
    pub tuning: Option<Tuning>,
    pub cache: Option<Arc<dyn Cache>>,
}

impl Config {
    pub const DEFAULT_IMAGE_MEMORY: usize = 128 * 1_048_576;
}

impl Default for Config {
    fn default() -> Self {
        Self {
            packaging: Packaging::default(),
            effort: Effort::default(),
            evidence: EvidenceClass::default(),
            fonts: FontPolicy::default(),
            licenses: Licenses::default(),
            png: PngPolicy::default(),
            images: None,
            image_memory: None,
            tuning: None,
            cache: None,
        }
    }
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("packaging", &self.packaging)
            .field("effort", &self.effort)
            .field("evidence", &self.evidence)
            .field("fonts", &self.fonts)
            .field("licenses", &self.licenses)
            .field("png", &self.png)
            .field("images", &self.images)
            .field("image_memory", &self.image_memory)
            .field("tuning", &self.tuning)
            .field("cache", &self.cache.as_ref().map(|_| "..."))
            .finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum ImageFormat {
    Avif,
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

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "avif" => Ok(ImageFormat::Avif),
            "webp" => Ok(ImageFormat::Webp),
            other => Err(format!(
                "unknown image format '{other}', expected one of: avif, webp"
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Quality(u8);

impl Quality {
    #[must_use]
    pub const fn new(value: u8) -> Option<Self> {
        if value >= 1 && value <= 100 {
            Some(Self(value))
        } else {
            None
        }
    }

    #[must_use]
    pub const fn get(self) -> u8 {
        self.0
    }
}

impl fmt::Display for Quality {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct ImageEncoding {
    pub format: ImageFormat,
    pub quality: Quality,
    pub max_side: Option<NonZeroU32>,
}

impl ImageEncoding {
    pub const DEFAULT_AVIF_QUALITY: Quality = Quality(60);
    pub const DEFAULT_WEBP_QUALITY: Quality = Quality(80);
    pub const DEFAULT_MAX_SIDE: NonZeroU32 = match NonZeroU32::new(3840) {
        Some(side) => side,
        None => panic!("non-zero side"),
    };

    #[must_use]
    pub const fn new(format: ImageFormat) -> Self {
        let quality = match format {
            ImageFormat::Avif => Self::DEFAULT_AVIF_QUALITY,
            ImageFormat::Webp => Self::DEFAULT_WEBP_QUALITY,
        };
        Self {
            format,
            quality,
            max_side: Some(Self::DEFAULT_MAX_SIDE),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BrotliQuality(u8);

impl BrotliQuality {
    #[must_use]
    pub const fn new(value: u8) -> Option<Self> {
        if value <= 11 { Some(Self(value)) } else { None }
    }

    #[must_use]
    pub const fn get(self) -> u8 {
        self.0
    }
}

impl fmt::Display for BrotliQuality {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tuning {
    pub woff2_quality: u8,
    pub png_preset: Option<u8>,
    pub brotli_quality: Option<u8>,
}

impl Tuning {
    pub const DEFAULT_BROTLI_QUALITY: u8 = 9;

    pub const FAST: Self = Self {
        woff2_quality: 1,
        png_preset: Some(0),
        brotli_quality: Some(5),
    };

    pub const BALANCED: Self = Self {
        woff2_quality: 11,
        png_preset: None,
        brotli_quality: None,
    };

    pub const MAXIMUM: Self = Self {
        woff2_quality: 11,
        png_preset: Some(6),
        brotli_quality: Some(11),
    };
}

impl Default for Tuning {
    fn default() -> Self {
        Self::BALANCED
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum Library {
    Tippy,
    Bootstrap,
    Popper,
    Clipboard,
    Anchor,
}

impl Library {
    #[must_use]
    pub const fn name(self) -> &'static str {
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

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum Target {
    Library(Library),
    Resource(String),
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum Transform {
    DeadLibrary,
    MinifiedScript,
    PrunedStylesheet,
    RecompressedPng,
    ReencodedImage,
    FontKeptWhole,
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
            Transform::FontKeptWhole => "font-kept-whole",
            Transform::Packed => "packed",
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Applied {
    pub rule: Rule,
    pub evidence: EvidenceClass,
    pub transform: Transform,
    pub target: Target,
    pub before: usize,
    pub after: usize,
}

impl Applied {
    #[must_use]
    pub fn saved(&self) -> usize {
        self.before.saturating_sub(self.after)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Skipped {
    pub rule: Rule,
    pub evidence: EvidenceClass,
    pub transform: Transform,
    pub target: Target,
    pub winner: Transform,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Warning {
    RemoteResource(Url),
}

impl fmt::Display for Warning {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Warning::RemoteResource(url) => write!(
                f,
                "the document loads a resource from the network: {url}; \
                 the optimized output still depends on that resource being reachable"
            ),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AuditEntry {
    pub count: usize,
    pub before: usize,
    pub after: usize,
}

impl AuditEntry {
    #[must_use]
    pub fn saved(&self) -> usize {
        self.before.saturating_sub(self.after)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AuditReport {
    pub by_transform: BTreeMap<Transform, AuditEntry>,
    pub by_rule: BTreeMap<Rule, AuditEntry>,
    pub by_evidence: BTreeMap<EvidenceClass, AuditEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Output {
    pub html: String,
    pub applied: Vec<Applied>,
    pub skipped: Vec<Skipped>,
    pub warnings: Vec<Warning>,
}

impl Output {
    #[must_use]
    pub fn report(&self) -> AuditReport {
        let mut report = AuditReport::default();
        for step in &self.applied {
            let t = report.by_transform.entry(step.transform).or_default();
            t.count += 1;
            t.before += step.before;
            t.after += step.after;

            let r = report.by_rule.entry(step.rule).or_default();
            r.count += 1;
            r.before += step.before;
            r.after += step.after;

            let e = report.by_evidence.entry(step.evidence).or_default();
            e.count += 1;
            e.before += step.before;
            e.after += step.after;
        }
        report
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Error {
    NotHtml,
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

#[must_use]
pub fn is_self_contained(src: &str) -> bool {
    let doc = Doc::new(src);
    check::is_html(&doc) && check::links(&doc).is_self_contained()
}

pub fn optimize(src: &str, packaging: Packaging) -> Result<Output, Error> {
    let mut config = Config::default();
    config.packaging = packaging;
    Ok(simplify(src, config)?.package(packaging))
}

pub fn simplify(src: &str, config: Config) -> Result<Simplified, Error> {
    let doc = Doc::new(src);
    if !check::is_html(&doc) {
        return Err(Error::NotHtml);
    }
    let links = check::links(&doc);
    if !links.is_self_contained() {
        return Err(Error::NotSelfContained(links.local().cloned().collect()));
    }
    let tuning = config.tuning.unwrap_or_else(|| config.effort.tuning());
    let licenses = config.licenses;
    let (images, (removals, scripts, styles, kept_whole)) = rayon::join(
        || {
            images::stage(
                &doc,
                config.images,
                tuning,
                (config.png == PngPolicy::LosslessWebp).then(|| {
                    config
                        .image_memory
                        .map_or(Config::DEFAULT_IMAGE_MEMORY as u64, |m| m.get() as u64)
                }),
            )
        },
        || {
            let (markup, parts) = rayon::join(|| doc.markup(), || doc.word_parts());
            let removals = quarto::stage(&doc, &markup);
            let removed: Vec<Range<usize>> =
                removals.iter().map(|edit| edit.span.clone()).collect();
            let (scripts, (styles, kept_whole)) = rayon::join(
                || js::stage(&doc, &removed, licenses),
                || {
                    let words = doc.words(markup, parts, &removed);
                    css::stage(
                        &doc,
                        &words,
                        config.fonts,
                        licenses,
                        config.cache.as_deref(),
                        tuning,
                    )
                },
            );
            (removals, scripts, styles, kept_whole)
        },
    );
    let edits: Vec<Edit> = removals
        .into_iter()
        .chain(scripts)
        .chain(styles)
        .chain(images)
        .collect();
    let edits = Edits::new(edits);
    let mut applied: Vec<Applied> = edits
        .kept()
        .iter()
        .map(|edit| Applied {
            rule: edit.rule,
            evidence: edit.rule.evidence_class(),
            transform: edit.transform,
            target: edit.target.clone(),
            before: edit.span.len(),
            after: edit.text.len(),
        })
        .collect();
    applied.extend(kept_whole.into_iter().map(|(family, bytes)| Applied {
        rule: Rule::FontKeptWhole,
        evidence: EvidenceClass::Generic,
        transform: Transform::FontKeptWhole,
        target: Target::Resource(family),
        before: bytes,
        after: bytes,
    }));
    let skipped: Vec<Skipped> = edits
        .skipped()
        .iter()
        .map(|edit| Skipped {
            rule: edit.rule,
            evidence: edit.rule.evidence_class(),
            transform: edit.transform,
            target: edit.target.clone(),
            winner: edit.winner,
        })
        .collect();
    let html = edits.apply(src);
    Ok(Simplified {
        scanned: html::Scanned::new(html),
        applied,
        skipped,
        warnings: links
            .remote()
            .cloned()
            .map(Warning::RemoteResource)
            .collect(),
        tuning,
    })
}

#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct Simplified {
    scanned: html::Scanned,
    applied: Vec<Applied>,
    skipped: Vec<Skipped>,
    warnings: Vec<Warning>,
    tuning: Tuning,
}

impl Simplified {
    #[must_use]
    pub fn warnings(&self) -> &[Warning] {
        &self.warnings
    }

    #[must_use]
    pub fn skipped(&self) -> &[Skipped] {
        &self.skipped
    }

    #[must_use]
    pub fn applied(&self) -> &[Applied] {
        &self.applied
    }

    #[must_use]
    pub fn package(&self, packaging: Packaging) -> Output {
        let unpacked = || Output {
            html: self.scanned.html().to_string(),
            applied: self.applied.clone(),
            skipped: self.skipped.clone(),
            warnings: self.warnings.clone(),
        };
        if packaging == Packaging::Plain {
            return unpacked();
        }
        let Some(packed) = pack::run(&self.scanned, packaging, self.tuning)
            .filter(|p| p.html.len() < self.scanned.html().len())
        else {
            return unpacked();
        };
        let mut applied = self.applied.clone();
        applied.push(Applied {
            rule: Rule::PackResources,
            evidence: EvidenceClass::Generic,
            transform: Transform::Packed,
            target: Target::Resources(packed.blobs),
            before: self.scanned.html().len(),
            after: packed.html.len(),
        });
        Output {
            html: packed.html,
            applied,
            skipped: self.skipped.clone(),
            warnings: self.warnings.clone(),
        }
    }

    pub fn package_checked(
        &self,
        packaging: Packaging,
        mut accept: impl FnMut(Packaging, &Output) -> bool,
    ) -> Option<(Packaging, Output)> {
        let ladder: &[Packaging] = match packaging {
            Packaging::Packed => &[Packaging::Packed, Packaging::Scripts, Packaging::Plain],
            Packaging::Scripts => &[Packaging::Scripts, Packaging::Plain],
            Packaging::Plain => &[Packaging::Plain],
        };
        ladder.iter().find_map(|&step| {
            let candidate = self.package(step);
            accept(step, &candidate).then_some((step, candidate))
        })
    }
}
