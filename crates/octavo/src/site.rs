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
    collections::{BTreeMap, BTreeSet, HashMap},
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
    /// Things Octavo skipped, such as symbolic links and files that are not
    /// valid UTF-8 where text was expected.
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
/// files in place. Images are never re-encoded lossily and text fonts are never
/// subsetted here, whatever `options` says.
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
/// it, or if a file cannot be read or written.
pub fn optimize_directory(
    input: &Path,
    output: &Path,
    options: &Options,
) -> Result<SiteReport, SiteError> {
    let input = fs::canonicalize(input).map_err(|error| io_error(input, error))?;
    if !input.is_dir() {
        return Err(SiteError::NotADirectory(input));
    }
    let output = resolve_output(output)?;
    let in_place = output == input;
    if !in_place && (output.starts_with(&input) || input.starts_with(&output)) {
        return Err(SiteError::OverlappingPaths { input, output });
    }

    let mut report = SiteReport::default();
    let mut files: BTreeMap<String, PathBuf> = BTreeMap::new();
    collect(&input, &input, &mut files, &mut report.warnings)?;
    report.files = files.len();
    report.bytes = files
        .values()
        .map(|path| fs::metadata(input.join(path)).map_or(0, |meta| meta.len()))
        .sum();

    let licenses = if options.strip_licenses {
        Licenses::Strip
    } else {
        Licenses::Keep
    };
    let tuning = options.compression.tuning();
    let keys: BTreeSet<String> = files.keys().cloned().collect();
    let read_text = |key: &str| fs::read_to_string(input.join(&files[key]));

    let pages: Vec<(String, String)> = keys
        .iter()
        .filter(|key| is_page(key))
        .filter_map(|key| match read_text(key) {
            Ok(text) => Some(Ok((key.clone(), text))),
            Err(error) if error.kind() == io::ErrorKind::InvalidData => None,
            Err(error) => Some(Err(io_error(&input.join(&files[key]), error))),
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
            let bytes = fs::read(input.join(&files[key])).ok()?;
            let woff2 = fonts::woff2_file(&bytes, options.cache_directory.as_deref(), tuning)?;
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
    if !converted.is_empty() {
        let mentioned = mentioned_fonts(&input, &files, &keys, &converted, &sheet_texts);
        for (key, woff2) in &converted {
            let before = fs::metadata(input.join(&files[key])).map_or(0, |meta| meta.len());
            report.changes.push(SiteChange {
                path: PathBuf::from(key),
                kind: SiteKind::Font,
                before,
                after: woff2.len() as u64,
            });
            writes.insert(woff2_name(key), woff2.clone());
            if !mentioned.contains(key) {
                dropped.insert(key.clone());
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
            let bytes = fs::read(input.join(&files[key])).ok()?;
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

    write_site(&input, &output, &files, &writes, &dropped, in_place)?;
    report.changes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(report)
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

pub(crate) fn reference_spans(css_text: &str) -> Vec<Range<usize>> {
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
    input: &Path,
    files: &BTreeMap<String, PathBuf>,
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
        .filter_map(|key| fs::read_to_string(input.join(&files[key])).ok())
        .flat_map(|text| {
            names
                .iter()
                .filter(|(_, name)| text.contains(**name))
                .map(|(key, _)| (*key).to_string())
                .collect::<Vec<_>>()
        })
        .collect()
}

fn collect(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, PathBuf>,
    warnings: &mut Vec<String>,
) -> Result<(), SiteError> {
    let mut entries: Vec<_> = fs::read_dir(directory)
        .map_err(|error| io_error(directory, error))?
        .collect::<Result<_, _>>()
        .map_err(|error| io_error(directory, error))?;
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        let kind = entry.file_type().map_err(|error| io_error(&path, error))?;
        let relative = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
        if kind.is_symlink() {
            warnings.push(format!(
                "{} is a symbolic link and was skipped",
                relative.display()
            ));
        } else if kind.is_dir() {
            collect(root, &path, files, warnings)?;
        } else {
            let key = relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            files.insert(key, relative);
        }
    }
    Ok(())
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

fn write_site(
    input: &Path,
    output: &Path,
    files: &BTreeMap<String, PathBuf>,
    writes: &BTreeMap<String, Vec<u8>>,
    dropped: &BTreeSet<String>,
    in_place: bool,
) -> Result<(), SiteError> {
    fs::create_dir_all(output).map_err(|error| io_error(output, error))?;
    let place = |key: &str, bytes: &[u8]| -> Result<(), SiteError> {
        let target = output.join(key);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| io_error(parent, error))?;
        }
        let staging = target.with_file_name(format!(
            "{}.octavo-tmp",
            target.file_name().unwrap_or_default().to_string_lossy()
        ));
        fs::write(&staging, bytes).map_err(|error| io_error(&staging, error))?;
        fs::rename(&staging, &target).map_err(|error| io_error(&target, error))
    };
    for (key, relative) in files {
        if dropped.contains(key) {
            if in_place {
                let path = input.join(relative);
                fs::remove_file(&path).map_err(|error| io_error(&path, error))?;
            }
            continue;
        }
        if let Some(bytes) = writes.get(key) {
            place(key, bytes)?;
        } else if !in_place {
            let target = output.join(key);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| io_error(parent, error))?;
            }
            fs::copy(input.join(relative), &target).map_err(|error| io_error(&target, error))?;
        }
    }
    for (key, bytes) in writes.iter().filter(|(key, _)| !files.contains_key(*key)) {
        place(key, bytes)?;
    }
    Ok(())
}
