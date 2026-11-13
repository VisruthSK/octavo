use crate::{
    Licenses, Options, css,
    doc::{Doc, Edits},
    fonts,
    html::{AttrName, Element},
    images, js,
    words::Words,
};
use percent_encoding::percent_decode_str;
use rayon::prelude::*;
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fmt, fs, io,
    ops::Range,
    path::{Path, PathBuf},
};

/// The kind of shared file that [`optimize_directory`] changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SiteKind {
    /// A stylesheet that at least one page links.
    Stylesheet,
    /// A script that at least one page loads.
    Script,
    /// A font converted to WOFF2.
    Font,
    /// A PNG recompressed without changing a pixel.
    Image,
}

/// What a file in a [`SitePlan`] is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SiteFileKind {
    /// An HTML page.
    Page,
    /// A stylesheet.
    Stylesheet,
    /// A script.
    Script,
    /// A font.
    Font,
    /// An image.
    Image,
    /// Any other file.
    Other,
}

/// One file that [`optimize_directory`] made smaller.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SiteChange {
    /// The file's path relative to the site's root. For a converted font this
    /// is the original font.
    pub path: PathBuf,
    /// What kind of file it is.
    pub kind: SiteKind,
    /// Its size in bytes before.
    pub before: u64,
    /// Its size in bytes after.
    pub after: u64,
}

/// One file that a [`SitePlan`] holds.
#[derive(Clone, Debug)]
pub struct SiteFile {
    /// The file's path relative to the output directory.
    pub path: PathBuf,
    /// What kind of file it is.
    pub kind: SiteFileKind,
    /// Its size in bytes once written.
    pub size: u64,
    content: SiteContent,
}

#[derive(Clone, Debug)]
enum SiteContent {
    Bytes(Vec<u8>),
    Copy(PathBuf),
}

/// What [`optimize_directory`] did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SiteReport {
    /// The number of HTML pages found.
    pub pages: usize,
    /// The number of files in the site, including the pages.
    pub files: usize,
    /// The total size of all files in the input, in bytes.
    pub bytes: u64,
    /// The files that got smaller.
    pub changes: Vec<SiteChange>,
    /// Things Octavo noticed, such as files that are not valid UTF-8 where
    /// text was expected.
    pub warnings: Vec<String>,
}

/// Why [`optimize_directory`] could not run.
#[derive(Debug)]
pub enum SiteError {
    /// The input is not a directory.
    NotADirectory(PathBuf),
    /// The output directory contains the input or sits inside it.
    OverlappingPaths {
        /// The input directory.
        input: PathBuf,
        /// The output directory.
        output: PathBuf,
    },
    /// A symbolic link that does not point at a regular file inside the
    /// input.
    Symlink(PathBuf),
    /// A file that is neither a regular file nor a directory.
    UnsupportedFile(PathBuf),
    /// A planned file was not written, or was written with another size.
    Incomplete {
        /// The path of the file, relative to the output directory.
        path: PathBuf,
        /// The size in bytes the plan expects.
        expected: u64,
        /// The size in bytes the file has.
        found: u64,
    },
    /// Reading or writing a file failed.
    Io {
        /// The path that failed.
        path: PathBuf,
        /// What went wrong.
        source: io::Error,
    },
}

impl fmt::Display for SiteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SiteError::NotADirectory(path) => write!(f, "{} is not a directory", path.display()),
            SiteError::OverlappingPaths { input, output } => write!(
                f,
                "the output {} and the input {} overlap",
                output.display(),
                input.display()
            ),
            SiteError::Symlink(path) => write!(
                f,
                "{} is a symbolic link that does not point at a regular file inside the input",
                path.display()
            ),
            SiteError::UnsupportedFile(path) => {
                write!(f, "{} is not a regular file or a directory", path.display())
            }
            SiteError::Incomplete {
                path,
                expected,
                found,
            } => write!(
                f,
                "{} was written with {found} bytes instead of {expected}",
                path.display()
            ),
            SiteError::Io { path, source } => write!(f, "{}: {source}", path.display()),
        }
    }
}

impl std::error::Error for SiteError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            SiteError::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

fn io_error(path: &Path, source: io::Error) -> SiteError {
    SiteError::Io {
        path: path.to_path_buf(),
        source,
    }
}

/// Optimizes the shared files of a rendered site once, for all its pages.
///
/// `input` is the output directory of a normal Quarto render: HTML pages next
/// to the stylesheets, scripts, fonts and images they share. Octavo builds one
/// index of the words used by every page and every script, then:
///
/// - prunes and minifies each stylesheet that a page links, against that
///   index, so a rule survives if any page needs it;
/// - minifies each script that a page loads;
/// - converts WOFF, TrueType and OpenType fonts to WOFF2 and rewrites the
///   `url()` that names them;
/// - recompresses PNG images without changing a pixel.
///
/// Pruning is only correct for the whole site: a rule that no page in
/// `input` uses is removed, so `input` must be a complete, fresh render. A
/// partial or incremental build, or a page published later from another
/// build, can lose styling. Writing over the input cannot be undone, so prefer
/// a separate `output` and run again when pages change.
///
/// Pages and every other file are copied unchanged, and files keep their
/// names, so the pages work as before and browsers still cache the shared
/// files once. Passing the same directory as `input` and `output` rewrites the
/// files in place. Images are never re-encoded lossily. With
/// [`Options::subset_text_fonts`], text fonts are also cut to the characters
/// that any page, script, stylesheet or JSON file of the site can show; when
/// one of those files cannot be read, every text font stays whole.
///
/// The output is written into a staging directory beside `output` and put in
/// place with renames once every file is there, so a run that fails leaves
/// the previous output as it was.
///
/// ```no_run
/// use octavo::{optimize_directory, Options};
/// use std::path::Path;
///
/// let report = optimize_directory(Path::new("_site"), Path::new("_site.min"), &Options::default())?;
/// println!("{} files changed", report.changes.len());
/// # Ok::<(), octavo::SiteError>(())
/// ```
///
/// # Errors
///
/// Fails if `input` is not a directory, if `output` contains it or sits inside
/// it, if a file is not a regular file, or if a file cannot be read or
/// written.
pub fn optimize_directory(
    input: &Path,
    output: &Path,
    options: &Options,
) -> Result<SiteReport, SiteError> {
    plan_directory(input, options)?.write(output)
}

/// The output of site mode, worked out before anything is written.
///
/// A plan holds every file the output will have: the bytes of the files
/// Octavo rewrites, and the path of the files it copies, which are read from
/// disk when the plan is written. The pages are therefore not held in
/// memory.
#[derive(Clone, Debug)]
pub struct SitePlan {
    input: PathBuf,
    files: Vec<SiteFile>,
    report: SiteReport,
}

impl SitePlan {
    /// What the plan does to the site's files.
    #[must_use]
    pub fn report(&self) -> &SiteReport {
        &self.report
    }

    /// The files the plan holds, ordered by path.
    #[must_use]
    pub fn files(&self) -> &[SiteFile] {
        &self.files
    }

    /// Writes the plan into `output` and returns what it did.
    ///
    /// The whole tree is written into a staging directory beside `output`,
    /// then checked against the plan: every planned file must be there with
    /// the planned size. Only then is the tree put in place. If `output`
    /// exists, it is renamed aside first, the staging directory takes its
    /// place, and the old tree is removed. The promotion is a sequence of
    /// renames, not one atomic operation, so a reader can see the old tree or
    /// the new one, but never a half-written tree.
    ///
    /// When anything fails before the promotion, the staging directory is
    /// removed and `output` is left exactly as it was.
    ///
    /// # Errors
    ///
    /// Fails if `output` contains the input or sits inside it, or if a file
    /// cannot be written.
    pub fn write(&self, output: &Path) -> Result<SiteReport, SiteError> {
        let output = resolve_output(output)?;
        if output != self.input
            && (output.starts_with(&self.input) || self.input.starts_with(&output))
        {
            return Err(SiteError::OverlappingPaths {
                input: self.input.clone(),
                output,
            });
        }
        let staging = staging_path(&output);
        let previous = previous_path(&output);
        remove_tree(&staging)?;
        if let Err(error) = self
            .write_tree(&staging)
            .and_then(|()| self.check(&staging))
        {
            let _ = remove_tree(&staging);
            return Err(error);
        }
        if let Err(error) = promote(&output, &staging, &previous) {
            let _ = remove_tree(&staging);
            return Err(error);
        }
        Ok(self.report.clone())
    }

    fn write_tree(&self, root: &Path) -> Result<(), SiteError> {
        fs::create_dir_all(root).map_err(|error| io_error(root, error))?;
        for file in &self.files {
            let target = root.join(&file.path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| io_error(parent, error))?;
            }
            match &file.content {
                SiteContent::Bytes(bytes) => {
                    fs::write(&target, bytes).map_err(|error| io_error(&target, error))?;
                }
                SiteContent::Copy(source) => {
                    fs::copy(source, &target).map_err(|error| io_error(&target, error))?;
                }
            }
        }
        Ok(())
    }

    fn check(&self, root: &Path) -> Result<(), SiteError> {
        for file in &self.files {
            let path = root.join(&file.path);
            let size = fs::metadata(&path)
                .map_err(|error| io_error(&path, error))?
                .len();
            if size != file.size {
                return Err(SiteError::Incomplete {
                    path: file.path.clone(),
                    expected: file.size,
                    found: size,
                });
            }
        }
        Ok(())
    }
}

/// Works out the output of site mode without writing anything.
///
/// The plan holds every file the output will have, with the bytes of the
/// files Octavo rewrites and the path of the files it copies. Nothing is
/// written, so a plan can be looked at before it is published, and the same
/// plan can be written more than once.
///
/// The files are the ones [`optimize_directory`] would write: the shared
/// stylesheets, scripts, fonts and images of a rendered site, changed once
/// for the whole site, and every other file copied unchanged.
///
/// # Errors
///
/// Fails if `input` is not a directory, if a file is not a regular file, or
/// if a file cannot be read.
///
/// ```no_run
/// use octavo::{Options, plan_directory};
/// use std::path::Path;
///
/// let plan = plan_directory(Path::new("_site"), &Options::default())?;
/// println!("{} files", plan.files().len());
/// # Ok::<(), octavo::SiteError>(())
/// ```
pub fn plan_directory(input: &Path, options: &Options) -> Result<SitePlan, SiteError> {
    let input = fs::canonicalize(input).map_err(|error| io_error(input, error))?;
    if !input.is_dir() {
        return Err(SiteError::NotADirectory(input));
    }

    let mut report = SiteReport::default();
    let mut sources: BTreeMap<String, PathBuf> = BTreeMap::new();
    collect(&input, &input, &mut sources)?;
    report.files = sources.len();
    report.bytes = sources
        .values()
        .map(|path| fs::metadata(path).map_or(0, |meta| meta.len()))
        .sum();

    let licenses = if options.strip_licenses {
        Licenses::Strip
    } else {
        Licenses::Keep
    };
    let tuning = options.compression.tuning();
    let keys: BTreeSet<String> = sources.keys().cloned().collect();
    let read_text = |key: &str| fs::read_to_string(&sources[key]);

    let pages: Vec<(String, String)> = keys
        .iter()
        .filter(|key| is_page(key))
        .filter_map(|key| match read_text(key) {
            Ok(text) => Some(Ok((key.clone(), text))),
            Err(error) if error.kind() == io::ErrorKind::InvalidData => None,
            Err(error) => Some(Err(io_error(&sources[key], error))),
        })
        .collect::<Result<_, _>>()?;
    report.pages = pages.len();

    let facts: Vec<PageFacts> = pages
        .par_iter()
        .map(|(key, text)| page_facts(key, text, &keys))
        .collect();
    let mut words = Words::default();
    let mut stylesheets: BTreeSet<String> = BTreeSet::new();
    let mut scripts: BTreeMap<String, (bool, bool)> = BTreeMap::new();
    for page in facts {
        words.absorb(page.words);
        stylesheets.extend(page.stylesheets);
        for (key, module) in page.scripts {
            let entry = scripts.entry(key).or_default();
            if module {
                entry.0 = true;
            } else {
                entry.1 = true;
            }
        }
    }

    let script_texts: BTreeMap<String, String> = keys
        .iter()
        .filter(|key| key.ends_with(".js"))
        .filter_map(|key| read_text(key).ok().map(|text| (key.clone(), text)))
        .collect();
    let script_words: Vec<Words> = script_texts
        .par_iter()
        .map(|(_, text)| {
            let mut words = Words::default();
            words.add_text(text);
            words
        })
        .collect();
    for part in script_words {
        words.absorb(part);
    }

    let mut sheet_texts: BTreeMap<String, String> = BTreeMap::new();
    let mut queue: Vec<String> = stylesheets.iter().cloned().collect();
    let mut seen: BTreeSet<String> = stylesheets.clone();
    while let Some(key) = queue.pop() {
        let Ok(text) = read_text(&key) else {
            report.warnings.push(format!(
                "{key} is not valid UTF-8 text and was left as it is"
            ));
            continue;
        };
        for span in reference_spans(&text) {
            if let Some(target) = resolve(&key, &text[span], &keys)
                && target.ends_with(".css")
                && seen.insert(target.clone())
            {
                queue.push(target);
            }
        }
        sheet_texts.insert(key, text);
    }

    let optimized_sheets: BTreeMap<String, String> = sheet_texts
        .par_iter()
        .map(|(key, text)| {
            let better = optimize_stylesheet(text, &words, options, licenses)
                .filter(|better| better.len() < text.len());
            (key.clone(), better.unwrap_or_else(|| text.clone()))
        })
        .collect();

    let subset = options
        .subset_text_fonts
        .then(|| {
            site_text_charset(
                &keys,
                &sources,
                &pages,
                &script_texts,
                &optimized_sheets,
                &mut report,
            )
        })
        .flatten();

    let mut font_sources: BTreeSet<String> = BTreeSet::new();
    for (key, text) in &optimized_sheets {
        for span in reference_spans(text) {
            if let Some(target) = resolve(key, &text[span], &keys)
                && is_convertible_font(&target)
            {
                font_sources.insert(target);
            }
        }
    }
    let converted: BTreeMap<String, Vec<u8>> = font_sources
        .par_iter()
        .filter_map(|key| {
            let bytes = fs::read(&sources[key]).ok()?;
            let woff2 = match &subset {
                Some(chars) => fonts::woff2_file_subsets(&bytes, chars, tuning),
                None => fonts::woff2_file(&bytes, options.cache_directory.as_deref(), tuning),
            }?;
            let target = woff2_name(key);
            (woff2.len() < bytes.len() && !keys.contains(&target)).then_some((key.clone(), woff2))
        })
        .collect();

    let mut writes: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for (key, text) in &optimized_sheets {
        let renamed = rewrite_references(text, |raw| {
            let target = resolve(key, raw, &keys)?;
            converted.contains_key(&target).then(|| woff2_name(raw))
        });
        let final_text = renamed.as_deref().unwrap_or(text);
        let original = &sheet_texts[key];
        if final_text != original {
            report.changes.push(SiteChange {
                path: PathBuf::from(key),
                kind: SiteKind::Stylesheet,
                before: original.len() as u64,
                after: final_text.len() as u64,
            });
            writes.insert(key.clone(), final_text.as_bytes().to_vec());
        }
    }

    let mut dropped: BTreeSet<String> = BTreeSet::new();
    let mut added: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    if !converted.is_empty() {
        let mentioned = mentioned_fonts(&sources, &keys, &converted, &sheet_texts);
        for (key, woff2) in converted {
            let before = fs::metadata(&sources[&key]).map_or(0, |meta| meta.len());
            report.changes.push(SiteChange {
                path: PathBuf::from(&key),
                kind: SiteKind::Font,
                before,
                after: woff2.len() as u64,
            });
            added.insert(woff2_name(&key), woff2);
            if !mentioned.contains(&key) {
                dropped.insert(key);
            }
        }
    }

    let script_changes: Vec<(String, String)> = script_texts
        .par_iter()
        .filter_map(|(key, text)| {
            let (module, classic) = *scripts.get(key)?;
            if module && classic {
                return None;
            }
            js::minify_file(text, module, licenses).map(|better| (key.clone(), better))
        })
        .collect();
    for (key, better) in script_changes {
        report.changes.push(SiteChange {
            path: PathBuf::from(&key),
            kind: SiteKind::Script,
            before: script_texts[&key].len() as u64,
            after: better.len() as u64,
        });
        writes.insert(key, better.into_bytes());
    }

    let image_changes: Vec<(String, u64, Vec<u8>)> = keys
        .par_iter()
        .filter(|key| key.to_ascii_lowercase().ends_with(".png"))
        .filter_map(|key| {
            let bytes = fs::read(&sources[key]).ok()?;
            let smaller = images::recompress_png_file(&bytes, tuning)?;
            Some((key.clone(), bytes.len() as u64, smaller))
        })
        .collect();
    for (key, before, smaller) in image_changes {
        report.changes.push(SiteChange {
            path: PathBuf::from(&key),
            kind: SiteKind::Image,
            before,
            after: smaller.len() as u64,
        });
        writes.insert(key, smaller);
    }

    let mut files: Vec<SiteFile> = Vec::with_capacity(sources.len() + added.len());
    for (key, source) in &sources {
        if dropped.contains(key) {
            continue;
        }
        let content = match writes.remove(key) {
            Some(bytes) => SiteContent::Bytes(bytes),
            None => SiteContent::Copy(source.clone()),
        };
        let size = match &content {
            SiteContent::Bytes(bytes) => bytes.len() as u64,
            SiteContent::Copy(path) => fs::metadata(path).map_or(0, |meta| meta.len()),
        };
        files.push(SiteFile {
            path: PathBuf::from(key),
            kind: file_kind(key),
            size,
            content,
        });
    }
    for (key, bytes) in added {
        let kind = file_kind(&key);
        files.push(SiteFile {
            path: PathBuf::from(key),
            kind,
            size: bytes.len() as u64,
            content: SiteContent::Bytes(bytes),
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));

    report.changes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(SitePlan {
        input,
        files,
        report,
    })
}

struct PageFacts {
    words: Words,
    stylesheets: Vec<String>,
    scripts: Vec<(String, bool)>,
}

fn page_facts(key: &str, text: &str, keys: &BTreeSet<String>) -> PageFacts {
    let doc = Doc::new(text);
    let markup = doc.markup();
    let parts = doc.word_parts();
    let words = doc.words(markup, parts, &[]);
    let mut stylesheets = Vec::new();
    let mut scripts = Vec::new();
    for tag in doc.tags() {
        match tag.element {
            Element::Link => {
                if let Some(target) = tag
                    .attr(AttrName::Href)
                    .and_then(|href| resolve(key, href, keys))
                    && target.ends_with(".css")
                {
                    stylesheets.push(target);
                }
            }
            Element::Script => {
                if let Some(target) = tag
                    .attr(AttrName::Src)
                    .and_then(|src| resolve(key, src, keys))
                    && target.ends_with(".js")
                {
                    let module = tag
                        .attr(AttrName::Type)
                        .is_some_and(|kind| kind.trim().eq_ignore_ascii_case("module"));
                    scripts.push((target, module));
                }
            }
            _ => {}
        }
    }
    PageFacts {
        words,
        stylesheets,
        scripts,
    }
}

fn optimize_stylesheet(
    css_text: &str,
    words: &Words,
    options: &Options,
    licenses: Licenses,
) -> Option<String> {
    if css_text.to_ascii_lowercase().contains("</style") {
        return None;
    }
    let wrapped = format!("<style>{css_text}</style>");
    let doc = Doc::new(&wrapped);
    let edits = css::stage(
        &doc,
        words,
        false,
        licenses,
        options.cache_directory.as_deref(),
        options.compression.tuning(),
    );
    let applied = Edits::new(edits).apply(&wrapped);
    applied
        .strip_prefix("<style>")?
        .strip_suffix("</style>")
        .map(str::to_string)
}

/// The characters that any page of the site can show: the text of the pages,
/// the scripts, the stylesheets and every JSON file, with the case variants
/// and the Latin base added. `None` keeps every text font whole, because a
/// file could not be read and the set would be incomplete.
fn site_text_charset(
    keys: &BTreeSet<String>,
    sources: &BTreeMap<String, PathBuf>,
    pages: &[(String, String)],
    scripts: &BTreeMap<String, String>,
    sheets: &BTreeMap<String, String>,
    report: &mut SiteReport,
) -> Option<HashSet<char>> {
    let mut unreadable = |name: &str| {
        report.warnings.push(format!(
            "{name} could not be read, so text fonts were kept whole"
        ));
    };
    for key in keys.iter().filter(|key| is_page(key)) {
        if !pages.iter().any(|(page, _)| *page == *key) {
            unreadable(key);
            return None;
        }
    }
    for key in keys.iter().filter(|key| key.ends_with(".js")) {
        if !scripts.contains_key(key) {
            unreadable(key);
            return None;
        }
    }
    let mut chars: HashSet<char> = HashSet::new();
    for text in pages
        .iter()
        .map(|(_, text)| text.as_str())
        .chain(scripts.values().map(String::as_str))
        .chain(sheets.values().map(String::as_str))
    {
        chars.extend(fonts::document_chars(text));
    }
    for key in keys
        .iter()
        .filter(|key| key.to_ascii_lowercase().ends_with(".json"))
    {
        match fs::read_to_string(&sources[key]) {
            Ok(text) => chars.extend(fonts::document_chars(&text)),
            Err(_) => {
                unreadable(key);
                return None;
            }
        }
    }
    Some(fonts::text_charset(chars))
}

fn is_page(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm")
}

fn is_convertible_font(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    [".woff", ".ttf", ".otf"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn file_kind(key: &str) -> SiteFileKind {
    let lower = key.to_ascii_lowercase();
    if is_page(key) {
        SiteFileKind::Page
    } else if lower.ends_with(".css") {
        SiteFileKind::Stylesheet
    } else if lower.ends_with(".js") {
        SiteFileKind::Script
    } else if [".woff", ".woff2", ".ttf", ".otf"]
        .iter()
        .any(|ext| lower.ends_with(ext))
    {
        SiteFileKind::Font
    } else if [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif"]
        .iter()
        .any(|ext| lower.ends_with(ext))
    {
        SiteFileKind::Image
    } else {
        SiteFileKind::Other
    }
}

fn woff2_name(reference: &str) -> String {
    let end = reference.find(['?', '#']).unwrap_or(reference.len());
    let (path, suffix) = reference.split_at(end);
    let stem = path.rsplit_once('.').map_or(path, |(stem, _)| stem);
    format!("{stem}.woff2{suffix}")
}

fn resolve(page: &str, reference: &str, keys: &BTreeSet<String>) -> Option<String> {
    let reference = reference.trim();
    let end = reference.find(['?', '#']).unwrap_or(reference.len());
    let path = &reference[..end];
    if path.is_empty() || path.contains(':') || path.starts_with("//") {
        return None;
    }
    let decoded = percent_decode_str(path).decode_utf8().ok()?;
    let mut parts: Vec<&str> = if decoded.starts_with('/') {
        Vec::new()
    } else {
        let mut parts: Vec<&str> = page.split('/').collect();
        parts.pop();
        parts
    };
    for piece in decoded.split('/') {
        match piece {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    let key = parts.join("/");
    keys.contains(&key).then_some(key)
}

fn reference_spans(css_text: &str) -> Vec<Range<usize>> {
    let bytes = css_text.as_bytes();
    let mut spans = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let rest = &bytes[at..];
        if rest.starts_with(b"/*") {
            at += rest
                .windows(2)
                .position(|pair| pair == b"*/")
                .map_or(rest.len(), |end| end + 2);
        } else if rest.len() >= 4 && rest[..4].eq_ignore_ascii_case(b"url(") {
            let (span, next) = delimited(bytes, at + 4, b')');
            spans.extend(span);
            at = next;
        } else if rest.len() >= 7 && rest[..7].eq_ignore_ascii_case(b"@import") {
            let mut start = at + 7;
            while bytes.get(start).is_some_and(u8::is_ascii_whitespace) {
                start += 1;
            }
            if matches!(bytes.get(start), Some(b'"' | b'\'')) {
                let (span, next) = delimited(bytes, start, b')');
                spans.extend(span);
                at = next;
            } else {
                at += 7;
            }
        } else {
            at += 1;
        }
    }
    spans
}

fn delimited(bytes: &[u8], from: usize, closer: u8) -> (Option<Range<usize>>, usize) {
    let mut start = from;
    while bytes.get(start).is_some_and(u8::is_ascii_whitespace) {
        start += 1;
    }
    let (start, end_marker) = match bytes.get(start) {
        Some(&quote @ (b'"' | b'\'')) => (start + 1, quote),
        _ => (start, closer),
    };
    let Some(length) = bytes[start..].iter().position(|&byte| byte == end_marker) else {
        return (None, bytes.len());
    };
    let mut end = start + length;
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    (Some(start..end), start + length + 1)
}

fn rewrite_references(css_text: &str, replace: impl Fn(&str) -> Option<String>) -> Option<String> {
    let mut out = String::with_capacity(css_text.len());
    let mut at = 0;
    let mut changed = false;
    for span in reference_spans(css_text) {
        if let Some(new) = replace(&css_text[span.clone()]) {
            out.push_str(&css_text[at..span.start]);
            out.push_str(&new);
            at = span.end;
            changed = true;
        }
    }
    out.push_str(&css_text[at..]);
    changed.then_some(out)
}

fn mentioned_fonts(
    sources: &BTreeMap<String, PathBuf>,
    keys: &BTreeSet<String>,
    converted: &BTreeMap<String, Vec<u8>>,
    rewritten: &BTreeMap<String, String>,
) -> BTreeSet<String> {
    let names: HashMap<&str, &str> = converted
        .keys()
        .map(|key| (key.as_str(), key.rsplit('/').next().unwrap_or(key)))
        .collect();
    keys.iter()
        .filter(|key| !rewritten.contains_key(*key))
        .filter(|key| {
            let lower = key.to_ascii_lowercase();
            [
                ".html", ".htm", ".js", ".css", ".json", ".xml", ".svg", ".txt",
            ]
            .iter()
            .any(|ext| lower.ends_with(ext))
        })
        .filter_map(|key| fs::read_to_string(&sources[key]).ok())
        .flat_map(|text| {
            names
                .iter()
                .filter(|(_, name)| text.contains(**name))
                .map(|(key, _)| (*key).to_string())
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Collects every regular file under `root`, refusing anything else.
fn collect(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, PathBuf>,
) -> Result<(), SiteError> {
    let mut entries: Vec<_> = fs::read_dir(directory)
        .map_err(|error| io_error(directory, error))?
        .collect::<Result<_, _>>()
        .map_err(|error| io_error(directory, error))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        let kind = entry.file_type().map_err(|error| io_error(&path, error))?;
        let relative = path.strip_prefix(root).unwrap_or(&path);
        let key = relative
            .components()
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        if kind.is_symlink() {
            let target = symlink_target(root, &path)?;
            files.insert(key, target);
        } else if kind.is_dir() {
            collect(root, &path, files)?;
        } else if kind.is_file() {
            files.insert(key, path);
        } else {
            return Err(SiteError::UnsupportedFile(path));
        }
    }
    Ok(())
}

/// The file a symbolic link points at, when it is a regular file inside the
/// root.
fn symlink_target(root: &Path, link: &Path) -> Result<PathBuf, SiteError> {
    let Ok(target) = fs::canonicalize(link) else {
        return Err(SiteError::Symlink(link.to_path_buf()));
    };
    if !target.starts_with(root) || !target.is_file() {
        return Err(SiteError::Symlink(link.to_path_buf()));
    }
    Ok(target)
}

fn resolve_output(output: &Path) -> Result<PathBuf, SiteError> {
    if let Ok(existing) = fs::canonicalize(output) {
        return Ok(existing);
    }
    let name = output
        .file_name()
        .ok_or_else(|| io_error(output, io::Error::from(io::ErrorKind::InvalidInput)))?;
    let parent = match output.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let parent = fs::canonicalize(&parent).map_err(|error| io_error(&parent, error))?;
    Ok(parent.join(name))
}

/// The directory the new tree is written into, beside the output.
fn staging_path(output: &Path) -> PathBuf {
    let mut name = output.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".octavo-staging-{}", std::process::id()));
    output.with_file_name(name)
}

/// The directory the old output is moved to while the new tree is put in
/// place.
fn previous_path(output: &Path) -> PathBuf {
    let mut name = output.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".octavo-old-{}", std::process::id()));
    output.with_file_name(name)
}

/// Puts the staged tree in place of the output.
fn promote(output: &Path, staging: &Path, previous: &Path) -> Result<(), SiteError> {
    if fs::symlink_metadata(output).is_err() {
        return fs::rename(staging, output).map_err(|error| io_error(output, error));
    }
    fs::rename(output, previous).map_err(|error| io_error(output, error))?;
    if let Err(error) = fs::rename(staging, output) {
        return match fs::rename(previous, output) {
            Ok(()) => Err(io_error(output, error)),
            Err(restore) => Err(io_error(
                output,
                io::Error::other(format!(
                    "{error}; the previous tree is at {} and could not be put back: {restore}",
                    previous.display()
                )),
            )),
        };
    }
    remove_tree(previous)
}

/// Removes a file or a directory, and does nothing when it is not there.
fn remove_tree(path: &Path) -> Result<(), SiteError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => {
            fs::remove_dir_all(path).map_err(|error| io_error(path, error))
        }
        Ok(_) => fs::remove_file(path).map_err(|error| io_error(path, error)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(path, error)),
    }
}
