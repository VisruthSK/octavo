use crate::{
    Licenses, Options, Rule, Target, Transform,
    css::{self, WidthRule},
    doc::{Doc, Edit, Edits},
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SiteKind {
    Stylesheet,
    Script,
    Font,
    Image,
    Page,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SiteFileKind {
    Page,
    Stylesheet,
    Script,
    Font,
    Image,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SiteChange {
    pub path: PathBuf,
    pub kind: SiteKind,
    pub before: u64,
    pub after: u64,
}

#[derive(Clone, Debug)]
pub struct SiteFile {
    pub path: PathBuf,
    pub kind: SiteFileKind,
    pub size: u64,
    content: SiteContent,
}

#[derive(Clone, Debug)]
enum SiteContent {
    Bytes(Vec<u8>),
    Copy(PathBuf),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SiteReport {
    pub pages: usize,
    pub files: usize,
    pub bytes: u64,
    pub changes: Vec<SiteChange>,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
pub enum SiteError {
    NotADirectory(PathBuf),
    OverlappingPaths {
        input: PathBuf,
        output: PathBuf,
    },
    Symlink(PathBuf),
    UnsupportedFile(PathBuf),
    Incomplete {
        path: PathBuf,
        expected: u64,
        found: u64,
    },
    Io {
        path: PathBuf,
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

pub fn optimize_directory(
    input: &Path,
    output: &Path,
    options: &Options,
) -> Result<SiteReport, SiteError> {
    plan_directory(input, options)?.write(output)
}

#[derive(Clone, Debug)]
pub struct SitePlan {
    input: PathBuf,
    files: Vec<SiteFile>,
    report: SiteReport,
}

impl SitePlan {
    #[must_use]
    pub fn report(&self) -> &SiteReport {
        &self.report
    }

    #[must_use]
    pub fn files(&self) -> &[SiteFile] {
        &self.files
    }

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
    let page_images: Vec<PageImages> = facts
        .iter()
        .map(|page| PageImages {
            stylesheets: page.stylesheets.clone(),
            styles: page.styles.clone(),
            images: page.images.clone(),
        })
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

    if let Some(encoding) = options.images
        && keys
            .iter()
            .filter(|key| is_page(key))
            .all(|key| pages.iter().any(|(page, _)| page == key))
    {
        let ext = match encoding.format {
            crate::ImageFormat::Avif => "avif",
            crate::ImageFormat::Webp => "webp",
        };
        let sheet_rules: BTreeMap<String, Vec<WidthRule>> = optimized_sheets
            .par_iter()
            .map(|(key, text)| (key.clone(), css::width_hints(text)))
            .collect();
        let page_uses: Vec<Vec<ImageUse>> = page_images
            .par_iter()
            .map(|page| page_image_uses(page, &sheet_rules, &optimized_sheets, &keys))
            .collect();
        let mut uses_per_key: BTreeMap<String, Vec<(usize, ImageUse)>> = BTreeMap::new();
        for (at, uses) in page_uses.iter().enumerate() {
            for image in uses {
                uses_per_key
                    .entry(image.key.clone())
                    .or_default()
                    .push((at, image.clone()));
            }
        }
        let mut candidates: Vec<(String, String)> = keys
            .iter()
            .filter(|key| is_reencodable(key))
            .map(|key| (key.clone(), renamed_value(key, ext)))
            .filter(|(_, target)| !keys.contains(target))
            .collect();
        let mut seen_targets: BTreeSet<String> = BTreeSet::new();
        candidates.retain(|(_, target)| seen_targets.insert(target.clone()));
        let converted: Vec<(String, String, u64, Vec<u8>)> = candidates
            .par_iter()
            .filter_map(|(key, target)| {
                let uses = uses_per_key.get(key)?;
                if uses.iter().any(|(_, image)| image.width.is_none()) {
                    return None;
                }
                let limit = uses.iter().filter_map(|(_, image)| image.width).max()?;
                let bytes = fs::read(&sources[key]).ok()?;
                if key.to_ascii_lowercase().ends_with(".png") && images::has_partial_alpha(&bytes) {
                    return None;
                }
                if mentioned_elsewhere(key, uses, &pages, &sources, &keys) {
                    return None;
                }
                let (_, encoded) = images::reencode_file(&bytes, encoding, Some(limit))?;
                Some((key.clone(), target.clone(), bytes.len() as u64, encoded))
            })
            .collect();
        let renames: BTreeMap<String, (String, String)> = converted
            .iter()
            .map(|(key, target, _, _)| {
                let extension = target.rsplit_once('.').map_or(ext, |(_, part)| part);
                (key.clone(), (target.clone(), extension.to_string()))
            })
            .collect();
        for (key, target, before, encoded) in converted {
            report.changes.push(SiteChange {
                path: PathBuf::from(&key),
                kind: SiteKind::Image,
                before,
                after: encoded.len() as u64,
            });
            added.insert(target, encoded);
            dropped.insert(key);
        }
        let rewritten: Vec<(usize, String, String)> = pages
            .par_iter()
            .enumerate()
            .filter_map(|(at, (page_key, text))| {
                if !page_uses[at]
                    .iter()
                    .any(|image| renames.contains_key(&image.key))
                {
                    return None;
                }
                let doc = Doc::new(text);
                let mut edits = Vec::new();
                for tag in doc.tags() {
                    if tag.element != Element::Img || tag.in_svg {
                        continue;
                    }
                    let touches = tag.attrs.iter().any(|attr| {
                        matches!(attr.name, AttrName::Src | AttrName::DataSrc)
                            && resolve(page_key, &attr.value, &keys)
                                .is_some_and(|key| renames.contains_key(&key))
                    });
                    if !touches {
                        continue;
                    }
                    let open = tag.open_tag(|name, value| {
                        if !matches!(name, AttrName::Src | AttrName::DataSrc) {
                            return Some(value.to_string());
                        }
                        let extension = resolve(page_key, value, &keys)
                            .and_then(|key| renames.get(&key))?
                            .1
                            .clone();
                        Some(renamed_value(value, &extension))
                    });
                    edits.push(Edit {
                        span: tag.span.clone(),
                        text: open,
                        transform: Transform::ReencodedImage,
                        rule: Rule::from(Transform::ReencodedImage),
                        target: Target::Resource(tag.label().to_string()),
                    });
                }
                if edits.is_empty() {
                    return None;
                }
                let applied = Edits::new(edits).apply(text);
                Some((at, page_key.clone(), applied))
            })
            .collect();
        for (at, page_key, applied) in rewritten {
            report.changes.push(SiteChange {
                path: PathBuf::from(&page_key),
                kind: SiteKind::Page,
                before: pages[at].1.len() as u64,
                after: applied.len() as u64,
            });
            writes.insert(page_key, applied.into_bytes());
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
    images: Vec<ImgFact>,
    styles: Vec<String>,
}

#[derive(Clone)]
struct ImgFact {
    key: Option<String>,
    classes: Vec<String>,
    id: Option<String>,
    width: Option<String>,
    style: Option<String>,
    value_span: Range<usize>,
}

#[derive(Clone)]
struct ImageUse {
    key: String,
    width: Option<u32>,
    value_span: Range<usize>,
}

struct PageImages {
    stylesheets: Vec<String>,
    styles: Vec<String>,
    images: Vec<ImgFact>,
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
    let images = doc
        .tags()
        .iter()
        .filter(|tag| tag.element == Element::Img && !tag.in_svg)
        .flat_map(|tag| {
            tag.attrs
                .iter()
                .filter(|attr| matches!(attr.name, AttrName::Src | AttrName::DataSrc))
                .filter_map(|attr| {
                    Some(ImgFact {
                        key: resolve(key, &attr.value, keys),
                        classes: tag
                            .attr(AttrName::Other("class".into()))
                            .map(|value| {
                                value
                                    .split_whitespace()
                                    .map(str::to_string)
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default(),
                        id: tag.attr(AttrName::Id).map(str::to_string),
                        width: tag
                            .attr(AttrName::Other("width".into()))
                            .map(str::to_string),
                        style: tag
                            .attr(AttrName::Other("style".into()))
                            .map(str::to_string),
                        value_span: attr.value_span.clone()?,
                    })
                })
        })
        .collect();
    let styles = doc
        .tags()
        .iter()
        .filter(|tag| tag.element == Element::Style && !tag.in_svg)
        .filter_map(|tag| Some(doc.src()[tag.body.clone()?].to_string()))
        .collect();
    PageFacts {
        words,
        stylesheets,
        scripts,
        images,
        styles,
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
    let (edits, _) = css::stage(
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

fn is_reencodable(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn page_image_uses(
    page: &PageImages,
    sheet_rules: &BTreeMap<String, Vec<WidthRule>>,
    sheets: &BTreeMap<String, String>,
    keys: &BTreeSet<String>,
) -> Vec<ImageUse> {
    let mut rules: Vec<WidthRule> = Vec::new();
    let mut queue: Vec<String> = page.stylesheets.clone();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    while let Some(sheet) = queue.pop() {
        if seen.insert(sheet.clone()) {
            if let Some(found) = sheet_rules.get(&sheet) {
                rules.extend(found.iter().cloned());
            }
            if let Some(text) = sheets.get(&sheet) {
                for span in reference_spans(text) {
                    if let Some(target) = resolve(&sheet, &text[span], keys)
                        && target.ends_with(".css")
                        && !seen.contains(&target)
                    {
                        queue.push(target);
                    }
                }
            }
        }
    }
    for text in &page.styles {
        rules.extend(css::width_hints(text));
    }
    page.images
        .iter()
        .filter_map(|img| {
            Some(ImageUse {
                key: img.key.clone()?,
                width: rendered_width(img, &rules),
                value_span: img.value_span.clone(),
            })
        })
        .collect()
}

fn rendered_width(img: &ImgFact, rules: &[WidthRule]) -> Option<u32> {
    let mut widths: Vec<u32> = Vec::new();
    let mut min: Option<u32> = None;
    let mut max: Option<u32> = None;
    for rule in rules.iter().filter(|rule| matches_img(rule, img)) {
        for declared in [rule.width, rule.min_width, rule.max_width] {
            if declared == Some(css::CssWidth::Unknown) {
                return None;
            }
        }
        if let Some(css::CssWidth::Px(w)) = rule.width
            && !widths.contains(&w)
        {
            widths.push(w);
        }
        if let Some(css::CssWidth::Px(w)) = rule.min_width {
            min = Some(min.map_or(w, |found| found.max(w)));
        }
        if let Some(css::CssWidth::Px(w)) = rule.max_width {
            max = Some(max.map_or(w, |found| found.min(w)));
        }
    }
    let inline = img.style.as_deref().and_then(style_width);
    let width = match inline {
        Some(Ok(w)) => w,
        Some(Err(())) => return None,
        None => match widths.as_slice() {
            [] => img.width.as_deref().and_then(px_number)?,
            [w] => *w,
            _ => return None,
        },
    };
    let width = min.map_or(width, |found| width.max(found));
    let width = max.map_or(width, |found| width.min(found));
    Some(width)
}

fn matches_img(rule: &WidthRule, img: &ImgFact) -> bool {
    rule.any_match
        || (rule
            .tag
            .as_ref()
            .is_none_or(|tag| tag.eq_ignore_ascii_case("img"))
            && rule.classes.iter().all(|class| {
                img.classes
                    .iter()
                    .any(|own| own.eq_ignore_ascii_case(class))
            })
            && rule.ids.iter().all(|id| {
                img.id
                    .as_deref()
                    .is_some_and(|own| own.eq_ignore_ascii_case(id))
            }))
}

fn style_width(style: &str) -> Option<Result<u32, ()>> {
    let mut found = None;
    for declaration in style.split(';') {
        let Some((name, value)) = declaration.split_once(':') else {
            continue;
        };
        if !name.trim().eq_ignore_ascii_case("width") {
            continue;
        }
        if value.trim().eq_ignore_ascii_case("auto") {
            return Some(Err(()));
        }
        found = Some(px_number(value).ok_or(()));
    }
    found
}

fn px_number(value: &str) -> Option<u32> {
    let trimmed = value.trim();
    let number = trimmed
        .strip_suffix('x')
        .or_else(|| trimmed.strip_suffix('X'))
        .and_then(|head| head.strip_suffix('p').or_else(|| head.strip_suffix('P')))
        .unwrap_or(trimmed)
        .trim();
    number
        .parse::<f64>()
        .ok()
        .filter(|px| *px >= 0.0 && px.is_finite())
        .map(|px| px.ceil() as u32)
}

fn mentioned_elsewhere(
    key: &str,
    uses: &[(usize, ImageUse)],
    pages: &[(String, String)],
    sources: &BTreeMap<String, PathBuf>,
    keys: &BTreeSet<String>,
) -> bool {
    let name = key.rsplit('/').next().unwrap_or(key);
    for (at, (_, text)) in pages.iter().enumerate() {
        let spans: Vec<&Range<usize>> = uses
            .iter()
            .filter(|(page, _)| *page == at)
            .map(|(_, image)| &image.value_span)
            .collect();
        for (found, _) in text.match_indices(name) {
            if !spans.iter().any(|span| span.contains(&found)) {
                return true;
            }
        }
    }
    for other in keys
        .iter()
        .filter(|key| !is_page(key) && is_mentionable(key))
    {
        if fs::read_to_string(&sources[other]).is_ok_and(|text| text.contains(name)) {
            return true;
        }
    }
    false
}

fn is_mentionable(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    [
        ".html", ".htm", ".js", ".css", ".json", ".xml", ".svg", ".txt",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
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
    renamed_value(reference, "woff2")
}

fn renamed_value(reference: &str, extension: &str) -> String {
    let end = reference.find(['?', '#']).unwrap_or(reference.len());
    let (path, suffix) = reference.split_at(end);
    let stem = path.rsplit_once('.').map_or(path, |(stem, _)| stem);
    format!("{stem}.{extension}{suffix}")
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

fn staging_path(output: &Path) -> PathBuf {
    let mut name = output.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".octavo-staging-{}", std::process::id()));
    output.with_file_name(name)
}

fn previous_path(output: &Path) -> PathBuf {
    let mut name = output.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".octavo-old-{}", std::process::id()));
    output.with_file_name(name)
}

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
