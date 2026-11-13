use crate::{
    check::{Origin, Url},
    doc::Doc,
    html::{AttrName, Element, Rel, Tag},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{collections::HashSet, ops::Range};

const DEPTH_LIMIT: usize = 8;

/// A file found by a [`Resources`] provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Loaded {
    /// The file's content.
    pub bytes: Vec<u8>,
    /// A name for the file that identifies it uniquely, such as its absolute
    /// path. Octavo passes it back as `from` when the file refers to other
    /// files, and uses it to stop a stylesheet that imports itself.
    pub id: String,
    /// The media type a server sent with the file, such as `text/css`, or
    /// `None` to use the one that the file's extension suggests.
    pub content_type: Option<String>,
}

/// Finds the files that a page and its stylesheets link.
pub trait Resources {
    /// Returns the file that `reference` names, or `None` if there is no such
    /// file. `reference` is written exactly as in the source. `from` is the
    /// [`Loaded::id`] of the stylesheet that contains it, or an empty string
    /// when the page itself contains it.
    fn load(&mut self, reference: &str, from: &str) -> Option<Loaded>;
}

/// The result of [`embed_resources`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Embedded {
    /// The document with every file it could find embedded.
    pub html: String,
    /// How many files were embedded, counting each use.
    pub embedded: usize,
    /// The total size in bytes of those files before they were embedded.
    pub resource_bytes: u64,
    /// References to local files that the provider could not find. They are
    /// left as written.
    pub missing: Vec<String>,
}

/// Embeds the local files that a document links, as Quarto's
/// `embed-resources: true` does, so that [`optimize`](crate::optimize) can
/// accept it.
///
/// Scripts, images, stylesheets and icons become `data:` URLs, which keeps
/// every other attribute of the tag, such as `async` or `media`. Inside an
/// embedded stylesheet, the `url()` and `@import` references that it makes
/// are embedded too, relative to the stylesheet. Links to the network and
/// `data:` URLs are left as they are.
///
/// ```
/// use octavo::{embed_resources, Loaded, Resources};
///
/// struct One;
/// impl Resources for One {
///     fn load(&mut self, reference: &str, _from: &str) -> Option<Loaded> {
///         (reference == "app.js").then(|| Loaded { bytes: b"let a = 1;".to_vec(), id: "app.js".into(), content_type: None })
///     }
/// }
///
/// let embedded = embed_resources("<script src=\"app.js\"></script>", &mut One);
/// assert_eq!(embedded.html, "<script>let a = 1;</script>");
/// assert_eq!(embedded.embedded, 1);
/// ```
pub fn embed_resources(src: &str, resources: &mut dyn Resources) -> Embedded {
    let doc = Doc::new(src);
    let mut state = State {
        resources,
        active: HashSet::new(),
        embedded: 0,
        resource_bytes: 0,
        missing: Vec::new(),
    };
    let mut edits: Vec<(Range<usize>, String)> = Vec::new();
    for tag in doc.tags().iter().filter(|tag| !tag.in_svg) {
        match tag.element {
            Element::Script => {
                let inlinable = runs_in_place(tag);
                if let Some(script) = tag
                    .attr(AttrName::Src)
                    .and_then(|reference| state.script(reference, inlinable))
                {
                    match script {
                        Script::Inline(text) => {
                            let open = tag.open_tag(|name, value| {
                                (!is_loading_attribute(name)).then(|| value.to_string())
                            });
                            edits.push((tag.span.clone(), format!("{open}{text}</script>")));
                        }
                        Script::Uri(uri) => {
                            let open = tag.open_tag(|name, value| {
                                Some(if *name == AttrName::Src {
                                    uri.clone()
                                } else {
                                    value.to_string()
                                })
                            });
                            let rest = tag
                                .body
                                .as_ref()
                                .map_or("", |body| &src[body.start..tag.span.end]);
                            edits.push((tag.span.clone(), format!("{open}{rest}")));
                        }
                    }
                }
            }
            Element::Img => {
                let src_uri = tag
                    .attr(AttrName::Src)
                    .and_then(|reference| state.uri(reference, "", 0));
                let lazy_uri = tag
                    .attr(AttrName::DataSrc)
                    .and_then(|reference| state.uri(reference, "", 0));
                if src_uri.is_some() || lazy_uri.is_some() {
                    let open = tag.open_tag(|name, value| {
                        let new = match name {
                            AttrName::Src => src_uri.as_deref(),
                            AttrName::DataSrc => lazy_uri.as_deref(),
                            _ => None,
                        };
                        Some(new.unwrap_or(value).to_string())
                    });
                    edits.push((tag.span.clone(), open));
                }
            }
            Element::Link => {
                let embeddable = tag.rel().is_some_and(|rel| match rel {
                    Rel::Stylesheet => true,
                    Rel::Other(value) => value.to_ascii_lowercase().contains("icon"),
                });
                if let Some(uri) = embeddable
                    .then(|| tag.attr(AttrName::Href))
                    .flatten()
                    .and_then(|reference| state.uri(reference, "", 0))
                {
                    let open = tag.open_tag(|name, value| {
                        Some(if *name == AttrName::Href {
                            uri.clone()
                        } else {
                            value.to_string()
                        })
                    });
                    edits.push((tag.span.clone(), open));
                }
            }
            Element::Style => {
                if let Some(body) = &tag.body
                    && let Some(css) = state.css(&src[body.clone()], "", 0)
                {
                    edits.push((body.clone(), css));
                }
            }
            Element::Svg => {}
        }
    }
    edits.sort_by_key(|(span, _)| span.start);
    let mut html =
        String::with_capacity(src.len() + edits.iter().map(|(_, text)| text.len()).sum::<usize>());
    let mut at = 0;
    for (span, text) in edits {
        if span.start < at {
            continue;
        }
        html.push_str(&src[at..span.start]);
        html.push_str(&text);
        at = span.end;
    }
    html.push_str(&src[at..]);
    Embedded {
        html,
        embedded: state.embedded,
        resource_bytes: state.resource_bytes,
        missing: state.missing,
    }
}

struct State<'a> {
    resources: &'a mut dyn Resources,
    active: HashSet<String>,
    embedded: usize,
    resource_bytes: u64,
    missing: Vec<String>,
}

impl State<'_> {
    fn fetch(&mut self, reference: &str, from: &str, depth: usize) -> Option<Loaded> {
        let url = Url::parse(reference)?;
        if depth > DEPTH_LIMIT {
            return None;
        }
        let Some(loaded) = self.resources.load(reference, from) else {
            if url.origin() == Origin::Local {
                self.missing.push(reference.to_string());
            }
            return None;
        };
        if !self.active.insert(loaded.id.clone()) {
            return None;
        }
        self.resource_bytes += loaded.bytes.len() as u64;
        Some(loaded)
    }

    fn uri(&mut self, reference: &str, from: &str, depth: usize) -> Option<String> {
        let reference = reference.trim();
        let loaded = self.fetch(reference, from, depth)?;
        Some(self.encode(reference, loaded, depth))
    }

    fn script(&mut self, reference: &str, inlinable: bool) -> Option<Script> {
        let reference = reference.trim();
        if Url::parse(reference)?.origin() == Origin::Remote {
            return None;
        }
        let loaded = self.fetch(reference, "", 0)?;
        if !inlinable {
            return Some(Script::Uri(self.encode(reference, loaded, 0)));
        }
        let Loaded {
            bytes,
            id,
            content_type,
        } = loaded;
        match String::from_utf8(bytes) {
            Ok(text) if !closes_script(&text) && !text.contains("<!--") => {
                self.active.remove(&id);
                self.embedded += 1;
                Some(Script::Inline(text))
            }
            Ok(text) => {
                let loaded = Loaded {
                    bytes: text.into_bytes(),
                    id,
                    content_type,
                };
                Some(Script::Uri(self.encode(reference, loaded, 0)))
            }
            Err(error) => {
                let loaded = Loaded {
                    bytes: error.into_bytes(),
                    id,
                    content_type,
                };
                Some(Script::Uri(self.encode(reference, loaded, 0)))
            }
        }
    }

    fn encode(&mut self, reference: &str, loaded: Loaded, depth: usize) -> String {
        let mime = media_type(&loaded, reference);
        let bytes = if mime == "text/css" {
            match String::from_utf8(loaded.bytes) {
                Ok(text) => self
                    .css(&text, &loaded.id, depth + 1)
                    .unwrap_or(text)
                    .into_bytes(),
                Err(error) => error.into_bytes(),
            }
        } else if mime == "application/javascript" || mime == "text/javascript" {
            match String::from_utf8(loaded.bytes) {
                Ok(text) => self
                    .module_imports(&text, &loaded.id, depth + 1)
                    .unwrap_or(text)
                    .into_bytes(),
                Err(error) => error.into_bytes(),
            }
        } else {
            loaded.bytes
        };
        self.active.remove(&loaded.id);
        self.embedded += 1;
        let mut uri =
            String::with_capacity("data:;base64,".len() + mime.len() + bytes.len().div_ceil(3) * 4);
        uri.push_str("data:");
        uri.push_str(&mime);
        uri.push_str(";base64,");
        STANDARD.encode_string(bytes, &mut uri);
        uri
    }

    fn module_imports(&mut self, code: &str, from: &str, depth: usize) -> Option<String> {
        let mut out = String::with_capacity(code.len());
        let mut at = 0;
        for span in import_specifiers(code) {
            if let Some(uri) = self.uri(&code[span.clone()], from, depth) {
                out.push_str(&code[at..span.start]);
                out.push_str(&uri);
                at = span.end;
            }
        }
        if at == 0 {
            return None;
        }
        out.push_str(&code[at..]);
        Some(out)
    }

    fn flatten(&mut self, reference: &str, from: &str, depth: usize) -> Option<String> {
        let reference = reference.trim();
        let url = Url::parse(reference)?;
        if url.origin() == Origin::Remote || depth > DEPTH_LIMIT {
            return None;
        }
        let Some(loaded) = self.resources.load(reference, from) else {
            self.missing.push(reference.to_string());
            return None;
        };
        if !self.active.insert(loaded.id.clone()) {
            return None;
        }
        self.resource_bytes += loaded.bytes.len() as u64;
        let text = String::from_utf8(loaded.bytes).ok();
        let flat = text.map(|text| self.css(&text, &loaded.id, depth + 1).unwrap_or(text));
        self.active.remove(&loaded.id);
        if flat.is_some() {
            self.embedded += 1;
        }
        flat
    }

    fn css(&mut self, css: &str, from: &str, depth: usize) -> Option<String> {
        let imports = plain_imports(css);
        let mut replacements: Vec<(Range<usize>, String)> = Vec::new();
        for (statement, reference) in &imports {
            if let Some(flat) = self.flatten(&css[reference.clone()], from, depth) {
                replacements.push((statement.clone(), flat));
            }
        }
        for span in reference_spans(css) {
            let inside = imports
                .iter()
                .any(|(statement, _)| statement.start <= span.start && span.end <= statement.end);
            if inside {
                continue;
            }
            if let Some(uri) = self.uri(&css[span.clone()], from, depth) {
                replacements.push((span, uri));
            }
        }
        if replacements.is_empty() {
            return None;
        }
        replacements.sort_by_key(|(range, _)| range.start);
        let mut out = String::with_capacity(css.len());
        let mut at = 0;
        for (range, text) in replacements {
            if range.start < at {
                continue;
            }
            out.push_str(&css[at..range.start]);
            out.push_str(&text);
            at = range.end;
        }
        out.push_str(&css[at..]);
        Some(out)
    }
}

fn media_type(loaded: &Loaded, reference: &str) -> String {
    loaded
        .content_type
        .as_deref()
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| value.contains('/') && value != "application/octet-stream")
        .unwrap_or_else(|| mime_of(reference).to_string())
}

fn mime_of(reference: &str) -> &'static str {
    let end = reference.find(['?', '#']).unwrap_or(reference.len());
    let extension = reference[..end]
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "css" => "text/css",
        "js" | "mjs" => "application/javascript",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

fn plain_imports(css: &str) -> Vec<(Range<usize>, Range<usize>)> {
    let bytes = css.as_bytes();
    let lower = css.to_ascii_lowercase();
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(offset) = lower[from..].find("@import") {
        let statement = from + offset;
        let mut at = statement + "@import".len();
        from = at;
        while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        let reference = if lower[at..].starts_with("url(") {
            let open = at + "url(".len();
            let Some(close) = css[open..].find(')') else {
                continue;
            };
            at = open + close + 1;
            let inner = &css[open..open + close];
            let trimmed = inner.trim();
            let lead = inner.len() - inner.trim_start().len();
            let quoted = trimmed.len() >= 2
                && matches!(trimmed.as_bytes()[0], b'"' | b'\'')
                && trimmed.as_bytes()[0] == trimmed.as_bytes()[trimmed.len() - 1];
            let (skip, cut) = if quoted { (1, 1) } else { (0, 0) };
            open + lead + skip..open + lead + trimmed.len() - cut
        } else if matches!(bytes.get(at), Some(b'"' | b'\'')) {
            let quote = bytes[at];
            let open = at + 1;
            let Some(close) = bytes[open..].iter().position(|byte| *byte == quote) else {
                continue;
            };
            at = open + close + 1;
            open..open + close
        } else {
            continue;
        };
        while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        if bytes.get(at) == Some(&b';') {
            found.push((statement..at + 1, reference));
            from = at + 1;
        }
    }
    found
}

enum Script {
    Inline(String),
    Uri(String),
}

fn closes_script(text: &str) -> bool {
    text.as_bytes()
        .windows("</script".len())
        .any(|window| window.eq_ignore_ascii_case(b"</script"))
}

fn is_loading_attribute(name: &AttrName) -> bool {
    match name {
        AttrName::Src => true,
        AttrName::Other(written) => matches!(written.as_str(), "integrity" | "crossorigin"),
        _ => false,
    }
}

fn runs_in_place(tag: &Tag) -> bool {
    let classic = tag.attr(AttrName::Type).is_none_or(|kind| {
        let kind = kind.trim();
        kind.is_empty()
            || kind.eq_ignore_ascii_case("text/javascript")
            || kind.eq_ignore_ascii_case("application/javascript")
    });
    classic
        && !tag.attrs.iter().any(|attr| {
            matches!(&attr.name, AttrName::Other(written) if matches!(written.as_str(), "defer" | "async" | "nomodule"))
        })
}

fn import_specifiers(code: &str) -> Vec<Range<usize>> {
    let bytes = code.as_bytes();
    let is_word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$';
    let mut found = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let keyword = ["import", "export"].into_iter().find(|word| {
            bytes[at..].starts_with(word.as_bytes())
                && (at == 0 || !is_word(bytes[at - 1]))
                && !bytes
                    .get(at + word.len())
                    .is_some_and(|byte| is_word(*byte))
        });
        let Some(keyword) = keyword else {
            at += 1;
            continue;
        };
        let mut cursor = at + keyword.len();
        at = cursor;
        let mut last_word = None;
        let mut dynamic = false;
        while let Some(&byte) = bytes.get(cursor) {
            if byte == b'"' || byte == b'\'' {
                let allowed = dynamic || last_word.is_none_or(|word| word == "from");
                let open = cursor + 1;
                let Some(length) = bytes[open..].iter().position(|next| *next == byte) else {
                    break;
                };
                let specifier = &code[open..open + length];
                if allowed
                    && (specifier.starts_with("./")
                        || specifier.starts_with("../")
                        || specifier.starts_with('/'))
                {
                    found.push(open..open + length);
                }
                at = open + length;
                break;
            }
            if byte == b'(' && keyword == "import" && cursor == at {
                dynamic = true;
                cursor += 1;
                while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
                    cursor += 1;
                }
                continue;
            }
            if byte.is_ascii_whitespace() || matches!(byte, b',' | b'{' | b'}' | b'*') {
                cursor += 1;
                continue;
            }
            if is_word(byte) {
                let start = cursor;
                while bytes.get(cursor).is_some_and(|next| is_word(*next)) {
                    cursor += 1;
                }
                last_word = Some(&code[start..cursor]);
                continue;
            }
            break;
        }
    }
    found
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

#[cfg(test)]
mod scanner_tests {
    use super::*;

    fn slices(source: &str, ranges: impl IntoIterator<Item = Range<usize>>) -> Vec<&str> {
        ranges.into_iter().map(|range| &source[range]).collect()
    }

    #[test]
    fn plain_import_with_quoted_reference() {
        let css = "@import 'a.css';";
        let found = plain_imports(css);
        let statements = slices(css, found.iter().map(|(statement, _)| statement.clone()));
        let references = slices(css, found.into_iter().map(|(_, reference)| reference));
        assert_eq!(statements, ["@import 'a.css';"]);
        assert_eq!(references, ["a.css"]);
    }

    #[test]
    fn plain_import_with_unquoted_url() {
        let css = "@import url(a.css);";
        let found = plain_imports(css);
        let references = slices(css, found.into_iter().map(|(_, reference)| reference));
        assert_eq!(references, ["a.css"]);
    }

    #[test]
    fn plain_import_with_quoted_url_and_spaces() {
        let css = "@import url( \"a.css\" );";
        let found = plain_imports(css);
        let references = slices(css, found.into_iter().map(|(_, reference)| reference));
        assert_eq!(references, ["a.css"]);
    }

    #[test]
    fn plain_import_with_uppercase_keyword() {
        let css = "@IMPORT url('a.css');";
        let found = plain_imports(css);
        let statements = slices(css, found.iter().map(|(statement, _)| statement.clone()));
        let references = slices(css, found.into_iter().map(|(_, reference)| reference));
        assert_eq!(statements, ["@IMPORT url('a.css');"]);
        assert_eq!(references, ["a.css"]);
    }

    #[test]
    fn multiple_plain_imports_keep_source_order() {
        let css = "@import 'a.css'; @import 'b.css';";
        let found = plain_imports(css);
        let statements = slices(css, found.iter().map(|(statement, _)| statement.clone()));
        let references = slices(css, found.into_iter().map(|(_, reference)| reference));
        assert_eq!(statements, ["@import 'a.css';", "@import 'b.css';"]);
        assert_eq!(references, ["a.css", "b.css"]);
    }

    #[test]
    fn url_import_with_media_query_is_not_plain() {
        let css = "@import url(a.css) print;";
        assert_eq!(
            slices(
                css,
                plain_imports(css)
                    .into_iter()
                    .map(|(_, reference)| reference)
            ),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn quoted_import_with_media_query_is_not_plain() {
        let css = "@import 'a.css' screen;";
        assert_eq!(
            slices(
                css,
                plain_imports(css)
                    .into_iter()
                    .map(|(_, reference)| reference)
            ),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn plain_import_without_semicolon_is_not_plain() {
        let css = "@import url(a.css)";
        assert_eq!(
            slices(
                css,
                plain_imports(css)
                    .into_iter()
                    .map(|(_, reference)| reference)
            ),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn bare_at_import_keyword_is_not_plain() {
        let css = "@import";
        assert_eq!(
            slices(
                css,
                plain_imports(css)
                    .into_iter()
                    .map(|(_, reference)| reference)
            ),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn unterminated_url_import_is_not_plain() {
        let css = "@import url(a.css";
        assert_eq!(
            slices(
                css,
                plain_imports(css)
                    .into_iter()
                    .map(|(_, reference)| reference)
            ),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn import_from_relative_specifier_is_returned() {
        let code = "import x from './a.js';";
        assert_eq!(slices(code, import_specifiers(code)), ["./a.js"]);
    }

    #[test]
    fn side_effect_import_specifier_is_returned() {
        let code = "import './side.js';";
        assert_eq!(slices(code, import_specifiers(code)), ["./side.js"]);
    }

    #[test]
    fn reexport_parent_specifier_is_returned() {
        let code = "export * from \"../b.js\";";
        assert_eq!(slices(code, import_specifiers(code)), ["../b.js"]);
    }

    #[test]
    fn absolute_path_specifier_is_returned() {
        let code = "import { a, b } from '/abs/c.js';";
        assert_eq!(slices(code, import_specifiers(code)), ["/abs/c.js"]);
    }

    #[test]
    fn dynamic_import_specifier_is_returned() {
        let code = "const m = await import('./d.js');";
        assert_eq!(slices(code, import_specifiers(code)), ["./d.js"]);
    }

    #[test]
    fn bare_specifier_is_not_returned() {
        let code = "import x from 'bare';";
        assert_eq!(slices(code, import_specifiers(code)), Vec::<&str>::new());
    }

    #[test]
    fn remote_url_specifier_is_not_returned() {
        let code = "import x from \"https://cdn.test/x.js\";";
        assert_eq!(slices(code, import_specifiers(code)), Vec::<&str>::new());
    }

    #[test]
    fn export_without_from_yields_no_specifier() {
        let code = "export const a = 1;";
        assert_eq!(slices(code, import_specifiers(code)), Vec::<&str>::new());
    }

    #[test]
    fn keyword_inside_larger_word_is_not_returned() {
        let code = "const important = 1; reimport('./e.js');";
        assert_eq!(slices(code, import_specifiers(code)), Vec::<&str>::new());
    }

    #[test]
    fn unterminated_string_is_not_returned() {
        let code = "import x from './unterminated";
        assert_eq!(slices(code, import_specifiers(code)), Vec::<&str>::new());
    }

    #[test]
    fn multiple_import_specifiers_keep_source_order() {
        let code = "import a from './a.js'; import b from '../b.js';";
        assert_eq!(slices(code, import_specifiers(code)), ["./a.js", "../b.js"]);
    }
}
