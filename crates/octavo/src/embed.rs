use crate::{
    check::{Origin, Url},
    doc::Doc,
    html::{AttrName, Element, Rel, Tag},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use cssparser::{ParseError, Parser, ParserInput, Token};
use oxc::{
    allocator::Allocator,
    ast::ast::{
        ExportAllDeclaration, ExportFromDeclaration, Expression, ImportDeclaration,
        ImportExpression, StringLiteral,
    },
    ast_visit::{
        Visit as OxcVisit,
        walk::{
            walk_export_all_declaration, walk_export_from_declaration, walk_import_declaration,
            walk_import_expression,
        },
    },
    parser::Parser as OxcParser,
    span::SourceType,
};
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
/// embedded stylesheet, the `url()` references are embedded too, and `@import`
/// rules that carry nothing are inlined in place; an `@import` with a media
/// list, `supports()` condition or layer, or one that appears after another
/// rule, is kept with its reference rewritten as a data URL. Links to the
/// network and `data:` URLs are left as they are.
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

struct ScanCtx<'a> {
    from: &'a str,
    depth: usize,
    level: usize,
    rules_started: bool,
    urls: Vec<Range<usize>>,
    replacements: Vec<(Range<usize>, String)>,
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
        let allocator = Allocator::default();
        let parsed = OxcParser::new(&allocator, code, SourceType::mjs()).parse();
        if !parsed.diagnostics.is_empty() {
            return None;
        }
        let mut specifiers = ModuleSpecifiers::new(code);
        OxcVisit::visit_program(&mut specifiers, &parsed.program);
        specifiers.spans.sort_by_key(|span| span.start);
        let mut out = String::with_capacity(code.len());
        let mut at = 0;
        for span in specifiers.spans {
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

    fn css(&mut self, css: &str, from: &str, depth: usize) -> Option<String> {
        let mut ctx = ScanCtx {
            from,
            depth,
            level: 0,
            rules_started: false,
            urls: Vec::new(),
            replacements: Vec::new(),
        };
        let mut input = ParserInput::new(css);
        let mut parser = Parser::new(&mut input);
        self.walk(css, &mut parser, &mut ctx);
        for span in ctx.urls {
            if span.start >= span.end {
                continue;
            }
            if css[span.clone()].starts_with('#') {
                continue;
            }
            if let Some(uri) = self.uri(&css[span.clone()], from, depth) {
                ctx.replacements.push((span, uri));
            }
        }
        if ctx.replacements.is_empty() {
            return None;
        }
        let mut replacements = ctx.replacements;
        replacements.sort_by_key(|(span, _)| span.start);
        let mut out = String::with_capacity(css.len() + 256);
        let mut at = 0;
        for (span, text) in replacements {
            if span.start < at {
                continue;
            }
            out.push_str(&css[at..span.start]);
            out.push_str(&text);
            at = span.end;
        }
        out.push_str(&css[at..]);
        Some(out)
    }

    fn splice_import(&mut self, reference: &str, from: &str, depth: usize) -> Option<String> {
        let url = Url::parse(reference)?;
        if url.origin() == Origin::Remote || depth > DEPTH_LIMIT {
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
        let processed = String::from_utf8(loaded.bytes).ok().map(|text| {
            let id = loaded.id.clone();
            strip_charset(self.css(&text, &id, depth + 1).unwrap_or(text))
        });
        self.active.remove(&loaded.id);
        let flat = processed?;
        self.embedded += 1;
        Some(flat)
    }

    fn walk<'i, 't>(&mut self, css: &'i str, parser: &mut Parser<'i, 't>, ctx: &mut ScanCtx<'_>) {
        loop {
            let start = parser.position().byte_index();
            let token = match parser.next_including_whitespace_and_comments() {
                Ok(token) => token.clone(),
                Err(_) => break,
            };
            if token.is_parse_error() {
                continue;
            }
            let end = parser.position().byte_index();
            match token {
                Token::WhiteSpace(_) | Token::Comment(_) | Token::CDO | Token::CDC => {}
                Token::AtKeyword(ref kw) => {
                    if ctx.level == 0 {
                        if !ctx.rules_started
                            && (kw.eq_ignore_ascii_case("charset")
                                || kw.eq_ignore_ascii_case("namespace"))
                        {
                            skip_to_semicolon(parser);
                        } else if !ctx.rules_started && kw.eq_ignore_ascii_case("import") {
                            match scan_import(parser, css, start) {
                                Ok(ImportRule::Plain {
                                    statement,
                                    reference,
                                }) => {
                                    if let Some(flat) =
                                        self.splice_import(&css[reference], ctx.from, ctx.depth)
                                    {
                                        ctx.replacements.push((statement, flat));
                                    }
                                }
                                Ok(ImportRule::Conditional { reference }) => {
                                    ctx.urls.push(reference);
                                }
                                Ok(ImportRule::Empty) | Err(()) => {}
                            }
                        } else {
                            ctx.rules_started = true;
                        }
                    }
                }
                Token::CurlyBracketBlock
                | Token::SquareBracketBlock
                | Token::ParenthesisBlock
                | Token::Function(_) => {
                    if ctx.level == 0 {
                        ctx.rules_started = true;
                    }
                    ctx.level += 1;
                    let url = matches!(&token, Token::Function(f) if f.eq_ignore_ascii_case("url"));
                    let _ = parser.parse_nested_block(|sub| {
                        if url {
                            self.walk_url_argument(css, sub, ctx);
                        } else {
                            self.walk(css, sub, ctx);
                        }
                        Ok::<(), ParseError<'_, ()>>(())
                    });
                    ctx.level -= 1;
                }
                Token::UnquotedUrl(_) => ctx.urls.push(unquoted_url_inner(css, start, end)),
                Token::QuotedString(_) => {}
                _ => {
                    if ctx.level == 0 {
                        ctx.rules_started = true;
                    }
                }
            }
        }
    }

    fn walk_url_argument<'i, 't>(
        &mut self,
        css: &'i str,
        sub: &mut Parser<'i, 't>,
        ctx: &mut ScanCtx<'_>,
    ) {
        loop {
            let start = sub.position().byte_index();
            let token = match sub.next_including_whitespace_and_comments() {
                Ok(token) => token.clone(),
                Err(_) => return,
            };
            if token.is_parse_error() {
                return;
            }
            let end = sub.position().byte_index();
            match token {
                Token::WhiteSpace(_) | Token::Comment(_) => {}
                Token::QuotedString(_) => {
                    ctx.urls.push(trim_range(css, start + 1, end - 1));
                    return;
                }
                _ => return,
            }
        }
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

fn trim_range(css: &str, mut start: usize, mut end: usize) -> Range<usize> {
    let bytes = css.as_bytes();
    while start < end && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    start..end
}

fn unquoted_url_inner(css: &str, start: usize, end: usize) -> Range<usize> {
    trim_range(css, start + 4, end - 1)
}

fn skip_to_semicolon(parser: &mut Parser<'_, '_>) {
    loop {
        match parser.next_including_whitespace_and_comments() {
            Ok(Token::Semicolon) => return,
            Ok(_) => {}
            Err(_) => return,
        }
    }
}

fn strip_charset(text: String) -> String {
    let bytes = text.as_bytes();
    let mut at = 0;
    loop {
        while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
            at += 1;
        }
        if text[at..].starts_with("/*") {
            match text[at + 2..].find("*/") {
                Some(end) => {
                    at = at + 2 + end + 2;
                    continue;
                }
                None => return text,
            }
        }
        break;
    }
    let prefix = text
        .get(at..at + 8)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if prefix != "@charset" {
        return text;
    }
    match text[at..].find(';') {
        Some(offset) => {
            let end = at + offset + 1;
            let mut out = String::with_capacity(text.len());
            out.push_str(&text[..at]);
            out.push_str(&text[end..]);
            out
        }
        None => text,
    }
}

enum ImportRule {
    Plain {
        statement: Range<usize>,
        reference: Range<usize>,
    },
    Conditional {
        reference: Range<usize>,
    },
    Empty,
}

fn scan_import(
    parser: &mut Parser<'_, '_>,
    css: &str,
    rule_start: usize,
) -> Result<ImportRule, ()> {
    let mut reference: Option<Range<usize>> = None;
    let mut conditional = false;
    loop {
        let start = parser.position().byte_index();
        let token = match parser.next_including_whitespace_and_comments() {
            Ok(token) => token.clone(),
            Err(_) => return Err(()),
        };
        if token.is_parse_error() {
            return Err(());
        }
        let end = parser.position().byte_index();
        match token {
            Token::WhiteSpace(_) | Token::Comment(_) => {}
            Token::Semicolon => {
                return Ok(match reference {
                    Some(reference) => {
                        if conditional {
                            ImportRule::Conditional { reference }
                        } else {
                            ImportRule::Plain {
                                statement: rule_start..end,
                                reference,
                            }
                        }
                    }
                    None => ImportRule::Empty,
                });
            }
            Token::UnquotedUrl(_) => {
                if reference.is_none() {
                    reference = Some(unquoted_url_inner(css, start, end));
                } else {
                    conditional = true;
                }
            }
            Token::Function(ref f) => {
                if f.eq_ignore_ascii_case("url") && reference.is_none() {
                    let _ = parser.parse_nested_block(|sub| {
                        loop {
                            let inner_start = sub.position().byte_index();
                            let Ok(inner) = sub.next_including_whitespace_and_comments() else {
                                return Ok::<(), ParseError<'_, ()>>(());
                            };
                            if inner.is_parse_error() {
                                return Ok::<(), ParseError<'_, ()>>(());
                            }
                            let inner = inner.clone();
                            let inner_end = sub.position().byte_index();
                            match inner {
                                Token::WhiteSpace(_) | Token::Comment(_) => {}
                                Token::QuotedString(_) => {
                                    reference =
                                        Some(trim_range(css, inner_start + 1, inner_end - 1));
                                    return Ok::<(), ParseError<'_, ()>>(());
                                }
                                Token::UnquotedUrl(_) => {
                                    reference =
                                        Some(trim_range(css, inner_start + 4, inner_end - 1));
                                    return Ok::<(), ParseError<'_, ()>>(());
                                }
                                _ => return Ok::<(), ParseError<'_, ()>>(()),
                            }
                        }
                    });
                    if reference.is_none() {
                        conditional = true;
                    }
                } else {
                    let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<'_, ()>>(()));
                    conditional = true;
                }
            }
            Token::QuotedString(_) => {
                if reference.is_none() {
                    reference = Some(trim_range(css, start + 1, end - 1));
                } else {
                    conditional = true;
                }
            }
            Token::CurlyBracketBlock => {
                let _ = parser.parse_nested_block(|_| Ok::<(), ParseError<'_, ()>>(()));
                conditional = true;
            }
            _ => {
                conditional = true;
            }
        }
    }
}

struct ModuleSpecifiers<'c> {
    code: &'c str,
    spans: Vec<Range<usize>>,
}

impl<'c> ModuleSpecifiers<'c> {
    fn new(code: &'c str) -> Self {
        ModuleSpecifiers {
            code,
            spans: Vec::new(),
        }
    }

    fn push(&mut self, literal: &StringLiteral) {
        let span = literal.span;
        let inner = span.start as usize + 1..span.end as usize - 1;
        let value = &self.code[inner.clone()];
        if value.starts_with("./") || value.starts_with("../") || value.starts_with('/') {
            self.spans.push(inner);
        }
    }
}

impl<'a, 'c> OxcVisit<'a> for ModuleSpecifiers<'c> {
    fn visit_import_declaration(&mut self, declaration: &ImportDeclaration<'a>) {
        self.push(&declaration.source);
        walk_import_declaration(self, declaration);
    }

    fn visit_export_all_declaration(&mut self, declaration: &ExportAllDeclaration<'a>) {
        self.push(&declaration.source);
        walk_export_all_declaration(self, declaration);
    }

    fn visit_export_from_declaration(&mut self, declaration: &ExportFromDeclaration<'a>) {
        self.push(&declaration.source);
        walk_export_from_declaration(self, declaration);
    }

    fn visit_import_expression(&mut self, expression: &ImportExpression<'a>) {
        if let Expression::StringLiteral(source) = &expression.source {
            self.push(source);
        }
        walk_import_expression(self, expression);
    }
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

#[cfg(test)]
mod behaviour_tests {
    use super::*;
    use std::collections::HashMap;

    struct Files(HashMap<String, Vec<u8>>);

    impl Files {
        fn new(files: &[(&str, &[u8])]) -> Files {
            Files(
                files
                    .iter()
                    .map(|(name, bytes)| ((*name).to_string(), bytes.to_vec()))
                    .collect(),
            )
        }
    }

    impl Resources for Files {
        fn load(&mut self, reference: &str, from: &str) -> Option<Loaded> {
            let end = reference.find(['?', '#']).unwrap_or(reference.len());
            let mut parts: Vec<&str> = from.split('/').filter(|part| !part.is_empty()).collect();
            parts.pop();
            for piece in reference[..end].split('/') {
                match piece {
                    "" | "." => {}
                    ".." => {
                        parts.pop();
                    }
                    other => parts.push(other),
                }
            }
            let id = parts.join("/");
            self.0.get(id.as_str()).map(|bytes| Loaded {
                bytes: bytes.clone(),
                id,
                content_type: None,
            })
        }
    }

    fn linked_stylesheet(files: &mut Files, href: &str) -> Embedded {
        let src = format!(
            r#"<!DOCTYPE html><html><head><link rel="stylesheet" href="{href}"></head><body></body></html>"#
        );
        embed_resources(&src, files)
    }

    fn linked_module(files: &mut Files, href: &str) -> Embedded {
        let src = format!(
            r#"<!DOCTYPE html><html><head><script type="module" src="{href}"></script></head><body></body></html>"#
        );
        embed_resources(&src, files)
    }

    fn page_with_style(css: &str) -> String {
        format!("<!DOCTYPE html><html><head><style>{css}</style></head><body></body></html>")
    }

    fn decoded(html: &str, prefix: &str) -> String {
        let start = html.find(prefix).expect("a data URL") + prefix.len();
        let end = start + html[start..].find('"').unwrap();
        String::from_utf8(STANDARD.decode(&html[start..end]).unwrap()).unwrap()
    }

    fn decoded_css(html: &str) -> String {
        decoded(html, r#"href="data:text/css;base64,"#)
    }

    fn decoded_module(html: &str) -> String {
        decoded(html, r#"src="data:application/javascript;base64,"#)
    }

    #[test]
    fn an_import_with_a_quoted_reference_is_inlined() {
        let mut files = Files::new(&[
            ("theme.css", b"@import 'a.css'; .x { color: red; }"),
            ("a.css", b".a { color: blue; }"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        assert!(!css.contains("@import"), "{css}");
        assert!(css.contains(".a { color: blue; }"), "{css}");
        assert!(css.contains(".x { color: red; }"), "{css}");
        assert_eq!(embedded.embedded, 2);
    }

    #[test]
    fn an_import_with_an_unquoted_url_is_inlined() {
        let mut files = Files::new(&[
            ("theme.css", b"@import url(a.css); .x { color: red; }"),
            ("a.css", b".a { color: blue; }"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        assert!(!css.contains("@import"), "{css}");
        assert!(css.contains(".a { color: blue; }"), "{css}");
    }

    #[test]
    fn an_import_with_a_quoted_url_and_spaces_is_inlined() {
        let mut files = Files::new(&[
            ("theme.css", b"@import url( \"a.css\" ); .x { color: red; }"),
            ("a.css", b".a { color: blue; }"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        assert!(!css.contains("@import"), "{css}");
        assert!(css.contains(".a { color: blue; }"), "{css}");
    }

    #[test]
    fn an_import_with_an_uppercase_keyword_is_inlined() {
        let mut files = Files::new(&[
            ("theme.css", b"@IMPORT url('a.css'); .x { color: red; }"),
            ("a.css", b".a { color: blue; }"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        assert!(
            !css.contains("@import") && !css.contains("@IMPORT"),
            "{css}"
        );
        assert!(css.contains(".a { color: blue; }"), "{css}");
    }

    #[test]
    fn multiple_imports_inline_in_source_order() {
        let mut files = Files::new(&[
            (
                "theme.css",
                b"@import 'a.css'; @import 'b.css'; .x { color: red; }",
            ),
            ("a.css", b".aaa { color: a; }"),
            ("b.css", b".bbb { color: b; }"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        let a = css.find(".aaa").expect("a.css inline");
        let b = css.find(".bbb").expect("b.css inline");
        let x = css.find(".x").expect("the rule after the imports");
        assert!(a < b && b < x, "{css}");
        assert!(!css.contains("@import"), "{css}");
        assert_eq!(embedded.embedded, 3);
    }

    #[test]
    fn an_import_with_a_media_query_stays_an_import() {
        let mut files = Files::new(&[
            ("theme.css", b"@import url(print.css) print;"),
            ("print.css", b".p { color: red; }"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        assert!(!css.contains("@media print"), "{css}");
        assert!(
            css.contains("@import") && css.contains("data:text/css;base64,"),
            "{css}"
        );
    }

    #[test]
    fn an_import_with_a_quoted_reference_and_media_list_stays_an_import() {
        let mut files = Files::new(&[
            ("theme.css", b"@import 'screen.css' screen;"),
            ("screen.css", b".s { color: red; }"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        assert!(!css.contains("@media screen"), "{css}");
        assert!(
            css.contains("@import") && css.contains("data:text/css;base64,"),
            "{css}"
        );
    }

    #[test]
    fn an_import_without_a_semicolon_is_left_as_written() {
        let src = page_with_style("@import url(a.css)");
        let mut files = Files::new(&[("a.css", b".a { color: blue; }")]);
        let embedded = embed_resources(&src, &mut files);
        assert_eq!(embedded.embedded, 0);
        assert!(embedded.missing.is_empty());
        assert_eq!(embedded.html, src);
    }

    #[test]
    fn a_bare_at_import_keyword_is_left_as_written() {
        let src = page_with_style("@import");
        let mut files = Files::new(&[]);
        let embedded = embed_resources(&src, &mut files);
        assert_eq!(embedded.embedded, 0);
        assert_eq!(embedded.html, src);
    }

    #[test]
    fn an_unterminated_url_import_is_left_as_written() {
        let src = page_with_style("@import url(a.css");
        let mut files = Files::new(&[("a.css", b".a { color: blue; }")]);
        let embedded = embed_resources(&src, &mut files);
        assert_eq!(embedded.embedded, 0);
        assert_eq!(embedded.html, src);
    }

    #[test]
    fn a_url_inside_a_comment_is_not_embedded() {
        let src =
            page_with_style("/* url(nope/missing.png) */ .x { background: url(img/dot.png) }");
        let mut files = Files::new(&[("img/dot.png", b"pixels")]);
        let embedded = embed_resources(&src, &mut files);
        assert_eq!(embedded.missing, Vec::<String>::new());
        assert!(embedded.html.contains("data:image/png;base64,"));
    }

    #[test]
    fn a_charset_rule_is_kept() {
        let mut files = Files::new(&[
            (
                "style.css",
                b"@charset \"utf-8\";\n.icon::before { content: \"\\00a9\"; background: url(\"icon.png\"); }",
            ),
            ("icon.png", b"png bytes"),
        ]);
        let embedded = linked_stylesheet(&mut files, "style.css");
        let css = decoded_css(&embedded.html);
        assert!(css.contains("@charset \"utf-8\";"), "{css}");
        assert!(css.contains("data:image/png;base64,"), "{css}");
    }

    #[test]
    fn a_malformed_rule_is_kept() {
        let mut files = Files::new(&[
            (
                "style.css",
                b".broken { *zoom: 1; }\n.valid { background: url(\"a.png\"); }",
            ),
            ("a.png", b"png bytes"),
        ]);
        let embedded = linked_stylesheet(&mut files, "style.css");
        let css = decoded_css(&embedded.html);
        assert!(css.contains("*zoom: 1;"), "{css}");
        assert!(css.contains("data:image/png;base64,"), "{css}");
    }

    #[test]
    fn a_url_in_a_custom_property_is_embedded() {
        let src = page_with_style(
            ":root { --hero-image: url(\"img/hero.jpg\"); } .hero { background: var(--hero-image); }",
        );
        let mut files = Files::new(&[("img/hero.jpg", b"jpeg bytes")]);
        let embedded = embed_resources(&src, &mut files);
        assert!(
            embedded.html.contains("data:image/jpeg;base64,"),
            "{}",
            embedded.html
        );
        assert!(!embedded.html.contains("img/hero.jpg"));
    }

    #[test]
    fn a_url_in_image_set_is_embedded() {
        let src = page_with_style(
            ".bg { background-image: image-set(url(\"img/a.png\") 1x, url(\"img/b.png\") 2x); }",
        );
        let mut files = Files::new(&[("img/a.png", b"a"), ("img/b.png", b"b")]);
        let embedded = embed_resources(&src, &mut files);
        assert_eq!(
            embedded.html.matches("data:image/png;base64,").count(),
            2,
            "{}",
            embedded.html
        );
        assert!(!embedded.html.contains("img/a.png"));
        assert!(!embedded.html.contains("img/b.png"));
    }

    #[test]
    fn an_import_after_rules_is_left_as_written() {
        let mut files = Files::new(&[
            (
                "theme.css",
                b".a { color: red; }\n@import url(b.css);\n.b { background: url(c.png); }",
            ),
            ("b.css", b".b-inline { color: blue; }"),
            ("c.png", b"png bytes"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        assert!(!css.contains(".b-inline {"), "{css}");
        assert!(css.contains("@import url(data:text/css;base64,"), "{css}");
        assert!(css.contains("data:image/png;base64,"), "{css}");
        assert_eq!(embedded.embedded, 3);
    }

    #[test]
    fn an_import_with_a_layer_stays_an_import() {
        let mut files = Files::new(&[
            (
                "theme.css",
                b"@import url(sub.css) layer(utilities) screen;",
            ),
            ("sub.css", b".s { color: red; }"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        assert!(css.contains("@import url(data:text/css;base64,"), "{css}");
        assert!(css.contains("layer(utilities)"), "{css}");
        assert!(css.contains("screen"), "{css}");
        assert!(!css.contains("@layer"), "{css}");
    }

    #[test]
    fn vendor_prefixes_and_comments_are_kept() {
        let src = page_with_style(
            "/* keep me */ .box { -webkit-transition: color 1s; margin-top: 20px; margin: 10px; background: url(\"img/dot.png\"); }",
        );
        let mut files = Files::new(&[("img/dot.png", b"pixels")]);
        let embedded = embed_resources(&src, &mut files);
        assert!(
            embedded.html.contains("-webkit-transition"),
            "{}",
            embedded.html
        );
        assert!(embedded.html.contains("/* keep me */"), "{}", embedded.html);
        let margin_top = embedded.html.find("margin-top").expect("margin-top");
        let margin = embedded.html.find("margin: 10px").expect("margin");
        assert!(margin_top < margin, "{}", embedded.html);
        assert!(embedded.html.contains("data:image/png;base64,"));
    }

    #[test]
    fn a_cyclic_import_terminates_and_keeps_the_import() {
        let mut files = Files::new(&[
            ("a.css", b"@import url(b.css); .x { color: red; }"),
            ("b.css", b"@import url(a.css); .y { color: blue; }"),
        ]);
        let embedded = linked_stylesheet(&mut files, "a.css");
        let css = decoded_css(&embedded.html);
        assert!(css.contains(".y { color: blue; }"), "{css}");
        assert!(css.contains("@import url(a.css);"), "{css}");
    }

    #[test]
    fn an_inlined_stylesheet_drops_its_own_charset_and_keeps_the_importing_one() {
        let mut files = Files::new(&[
            (
                "theme.css",
                b"@charset \"utf-8\";\n@import 'face.css';\n.theme { color: red; }",
            ),
            (
                "face.css",
                b"@charset \"utf-8\";\n@font-face { font-family: F; src: url(f.woff2); }",
            ),
            ("f.woff2", b"font bytes"),
        ]);
        let embedded = linked_stylesheet(&mut files, "theme.css");
        let css = decoded_css(&embedded.html);
        assert_eq!(css.matches("@charset").count(), 1, "{css}");
        assert!(css.contains("@font-face"), "{css}");
        assert!(css.contains("data:font/woff2;base64,"), "{css}");
    }

    #[test]
    fn a_string_containing_the_word_import_is_not_treated_as_an_import() {
        let src = page_with_style(".x::before { content: \"@import url(nope.css);\" }");
        let mut files = Files::new(&[]);
        let embedded = embed_resources(&src, &mut files);
        assert_eq!(embedded.missing, Vec::<String>::new());
        assert!(embedded.html.contains("@import url(nope.css);"));
    }

    #[test]
    fn an_import_from_a_relative_specifier_is_rewritten() {
        let mut files = Files::new(&[
            ("main.js", b"import x from './a.js'; console.log(x);"),
            ("a.js", b"export default 1;"),
        ]);
        let embedded = linked_module(&mut files, "main.js");
        let module = decoded_module(&embedded.html);
        assert!(!module.contains("./a.js"), "{module}");
        assert_eq!(
            module
                .matches("data:application/javascript;base64,")
                .count(),
            1
        );
    }

    #[test]
    fn a_side_effect_import_specifier_is_rewritten() {
        let mut files = Files::new(&[
            ("main.js", b"import './side.js';"),
            ("side.js", b"console.log(1);"),
        ]);
        let embedded = linked_module(&mut files, "main.js");
        let module = decoded_module(&embedded.html);
        assert!(!module.contains("./side.js"), "{module}");
    }

    #[test]
    fn a_reexport_from_a_parent_specifier_is_rewritten() {
        let mut files = Files::new(&[
            ("js/main.js", b"export * from \"../b.js\";"),
            ("b.js", b"export const b = 2;"),
        ]);
        let embedded = linked_module(&mut files, "js/main.js");
        let module = decoded_module(&embedded.html);
        assert!(!module.contains("../b.js"), "{module}");
    }

    #[test]
    fn an_absolute_path_specifier_is_rewritten() {
        let mut files = Files::new(&[
            (
                "main.js",
                b"import { a, b } from '/abs/c.js'; console.log(a, b);",
            ),
            ("abs/c.js", b"export const a = 1, b = 2;"),
        ]);
        let embedded = linked_module(&mut files, "main.js");
        let module = decoded_module(&embedded.html);
        assert!(!module.contains("/abs/c.js"), "{module}");
    }

    #[test]
    fn a_dynamic_import_specifier_is_rewritten() {
        let mut files = Files::new(&[
            (
                "main.js",
                b"const m = await import('./d.js'); console.log(m);",
            ),
            ("d.js", b"export default 1;"),
        ]);
        let embedded = linked_module(&mut files, "main.js");
        let module = decoded_module(&embedded.html);
        assert!(!module.contains("./d.js"), "{module}");
    }

    #[test]
    fn a_bare_specifier_is_left_as_written() {
        let mut files = Files::new(&[("main.js", b"import x from 'bare'; console.log(x);")]);
        let embedded = linked_module(&mut files, "main.js");
        let module = decoded_module(&embedded.html);
        assert!(module.contains("from 'bare'"), "{module}");
    }

    #[test]
    fn a_remote_url_specifier_is_left_as_written() {
        let mut files = Files::new(&[(
            "main.js",
            b"import x from \"https://cdn.test/x.js\"; console.log(x);",
        )]);
        let embedded = linked_module(&mut files, "main.js");
        let module = decoded_module(&embedded.html);
        assert!(module.contains("https://cdn.test/x.js"), "{module}");
    }

    #[test]
    fn an_export_without_a_from_clause_is_left_as_written() {
        let mut files = Files::new(&[("main.js", b"export const a = 1;")]);
        let embedded = linked_module(&mut files, "main.js");
        assert_eq!(embedded.embedded, 1);
    }

    #[test]
    fn a_keyword_inside_a_larger_word_is_not_treated_as_an_import() {
        let mut files = Files::new(&[("main.js", b"const important = 1; reimport('./e.js');")]);
        let embedded = linked_module(&mut files, "main.js");
        let module = decoded_module(&embedded.html);
        assert!(module.contains("reimport('./e.js')"), "{module}");
    }
    #[test]
    fn an_unterminated_string_is_left_as_written() {
        let mut files = Files::new(&[("main.js", b"import x from './unterminated")]);
        let embedded = linked_module(&mut files, "main.js");
        assert_eq!(embedded.embedded, 1);
        assert!(embedded.missing.is_empty());
        assert!(
            embedded
                .html
                .contains("data:application/javascript;base64,")
        );
        let module = decoded_module(&embedded.html);
        assert!(module.contains("./unterminated"), "{module}");
    }

    #[test]
    fn multiple_import_specifiers_keep_source_order() {
        let mut files = Files::new(&[
            (
                "js/main.js",
                b"import a from './a.js'; import b from '../b.js'; console.log(a, b);",
            ),
            ("js/a.js", b"export const a = 1;"),
            ("b.js", b"export const b = 2;"),
        ]);
        let embedded = linked_module(&mut files, "js/main.js");
        let module = decoded_module(&embedded.html);
        let mut data = module.split("data:application/javascript;base64,");
        let _ = data.next();
        let first = data.next().expect("a first embedded module");
        let second = data.next().expect("a second embedded module");
        let decode = |chunk: &str| {
            let end = chunk.find(['\'', '"']).unwrap();
            String::from_utf8(STANDARD.decode(&chunk[..end]).unwrap()).unwrap()
        };
        assert_eq!(decode(first), "export const a = 1;");
        assert_eq!(decode(second), "export const b = 2;");
    }

    #[test]
    fn a_comment_containing_an_import_is_not_treated_as_an_import() {
        let mut files = Files::new(&[("main.js", b"// import x from './a.js';\nconsole.log(1);")]);
        let embedded = linked_module(&mut files, "main.js");
        let module = decoded_module(&embedded.html);
        assert!(module.contains("// import x from './a.js';"), "{module}");
        assert_eq!(embedded.embedded, 1);
    }
}
