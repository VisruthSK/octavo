use crate::{
    data::{self, Mime},
    doc::{Doc, Edit},
    fonts,
    html::{AttrName, Element, Rel, Tag},
    words::Words,
    Licenses, Target, Transform,
};
use cssparser::{Parser, ParserInput, Token};
use indexmap::IndexSet;
use lightningcss::{
    properties::Property,
    rules::CssRule,
    selector::{Component, Selector},
    stylesheet::{MinifyOptions, ParserOptions, PrinterOptions, StyleSheet},
    vendor_prefix::VendorPrefix,
    visitor::{Visit, VisitTypes, Visitor},
};
use rayon::prelude::*;
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    convert::Infallible,
    sync::{Arc, RwLock},
};

const PLACEHOLDER: &str = "__octavo";
const KEPT_RULE: &str = "__octavo_keep_";

struct Isolated {
    css: String,
    rules: Vec<String>,
}

fn marker(n: usize) -> String {
    format!("@layer {KEPT_RULE}{n};")
}

struct Shielded<'a> {
    source: &'a str,
    css: String,
    saved: Vec<String>,
    notices: String,
}

fn shield<'a>(
    source: &'a str,
    words: &Words,
    referenced: &HashSet<&str>,
    licenses: Licenses,
) -> Shielded<'a> {
    let (css, saved) = shield_custom_properties(source, |name| {
        words.has("--") || referenced.contains(name) || words.has(name)
    });
    let notices = if licenses == Licenses::Keep {
        legal_comments(source)
    } else {
        String::new()
    };
    Shielded {
        source,
        css,
        saved,
        notices,
    }
}

fn parse(css: &str) -> Result<StyleSheet<'_>, Vec<(u32, u32)>> {
    let warnings = Arc::new(RwLock::new(Vec::new()));
    let options = ParserOptions {
        error_recovery: true,
        warnings: Some(warnings.clone()),
        ..Default::default()
    };
    let sheet = StyleSheet::parse(css, options).map_err(|_| Vec::new())?;
    let found = warnings.read().map_err(|_| Vec::new())?;
    if found.is_empty() {
        return Ok(sheet);
    }
    let places: Vec<(u32, u32)> = found
        .iter()
        .filter_map(|warning| warning.loc.as_ref().map(|loc| (loc.line, loc.column)))
        .collect();
    Err(if places.len() == found.len() {
        places
    } else {
        Vec::new()
    })
}

fn finish<'i>(mut sheet: StyleSheet<'i>, words: &Words) -> Option<StyleSheet<'i>> {
    sheet.visit(&mut Prune { words }).ok()?;
    sheet.minify(MinifyOptions::default()).ok()?;
    sheet.visit(&mut KeepUnprefixed).ok()?;
    Some(sheet)
}

fn isolate(css: &str, places: &[(u32, u32)]) -> Option<Isolated> {
    let offsets: Vec<usize> = places
        .iter()
        .map(|&(line, column)| offset_of(css, line, column))
        .collect::<Option<_>>()?;
    let mut out = String::with_capacity(css.len());
    let mut rules = Vec::new();
    let mut at = 0;
    for item in top_level_items(css) {
        if offsets.iter().any(|offset| item.contains(offset)) {
            out.push_str(&css[at..item.start]);
            out.push_str(&marker(rules.len()));
            rules.push(css[item.clone()].to_string());
            at = item.end;
        }
    }
    out.push_str(&css[at..]);
    (!rules.is_empty()).then_some(Isolated { css: out, rules })
}

fn offset_of(css: &str, line: u32, column: u32) -> Option<usize> {
    let bytes = css.as_bytes();
    let mut start = 0;
    for _ in 0..line {
        let end = start
            + bytes[start..]
                .iter()
                .position(|c| matches!(c, b'\n' | b'\r' | 0x0c))?;
        start = end
            + if bytes[end] == b'\r' && bytes.get(end + 1) == Some(&b'\n') {
                2
            } else {
                1
            };
    }
    let target = column.saturating_sub(1);
    let mut units = 0;
    for (at, character) in css[start..].char_indices() {
        if units >= target {
            return Some(start + at);
        }
        units += character.len_utf16() as u32;
    }
    (units >= target).then_some(css.len())
}

fn top_level_items(css: &str) -> Vec<std::ops::Range<usize>> {
    let b = css.as_bytes();
    let (mut items, mut i) = (Vec::new(), 0);
    while i < b.len() {
        if b[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            i = skip_literal(b, i).min(b.len());
            continue;
        }
        let start = i;
        let (mut braces, mut parens) = (0i32, 0i32);
        while i < b.len() {
            let skipped = skip_literal(b, i);
            if skipped != i {
                i = skipped.min(b.len());
                continue;
            }
            match b[i] {
                b'(' => parens += 1,
                b')' => parens -= 1,
                b'{' => braces += 1,
                b'}' => {
                    braces -= 1;
                    if braces <= 0 {
                        i += 1;
                        break;
                    }
                }
                b';' if braces == 0 && parens <= 0 => {
                    i += 1;
                    break;
                }
                _ => {}
            }
            i += 1;
        }
        items.push(start..i);
    }
    items
}

fn print(
    sheet: &StyleSheet,
    shielded: &Shielded,
    isolated: Option<&Isolated>,
    font_notices: &[String],
) -> Option<String> {
    let printer = PrinterOptions {
        minify: true,
        ..Default::default()
    };
    let mut code = sheet.to_css(printer).ok()?.code;
    for (n, rule) in isolated.iter().flat_map(|i| i.rules.iter()).enumerate() {
        let marker = marker(n);
        if !code.contains(&marker) {
            return None;
        }
        code = code.replacen(&marker, rule, 1);
    }
    let css = unshield(&code, &shielded.saved);
    let mut out = shielded.notices.clone();
    for notice in font_notices {
        out.push_str("/*!");
        out.push_str(notice);
        out.push_str("*/");
    }
    out.push_str(&css);
    Some(out)
}

fn legal_comments(css: &str) -> String {
    let mut input = ParserInput::new(css);
    let mut parser = Parser::new(&mut input);
    let mut notices = String::new();
    while let Ok(token) = parser.next_including_whitespace_and_comments() {
        if let Token::Comment(text) = token {
            if text.starts_with('!') || text.contains("@license") || text.contains("@preserve") {
                notices.push_str(&format!("/*{text}*/"));
            }
        }
    }
    notices
}

fn skip_literal(b: &[u8], i: usize) -> usize {
    match (b[i], b.get(i + 1)) {
        (b'/', Some(b'*')) => b[i + 2..]
            .windows(2)
            .position(|w| w == b"*/")
            .map_or(b.len(), |p| i + 4 + p),
        (q @ (b'"' | b'\''), _) => {
            let mut j = i + 1;
            while j < b.len() && b[j] != q {
                j += 1 + (b[j] == b'\\') as usize;
            }
            j + 1
        }
        _ => i,
    }
}

fn shield_custom_properties(css: &str, keep: impl Fn(&str) -> bool) -> (String, Vec<String>) {
    let b = css.as_bytes();
    let (mut out, mut saved) = (String::with_capacity(css.len()), Vec::new());
    let (mut at, mut i) = (0, 0);
    while i < b.len() {
        let skipped = skip_literal(b, i);
        if skipped != i {
            i = skipped.min(b.len());
            continue;
        }
        let at_name = b[i] == b'-'
            && b.get(i + 1) == Some(&b'-')
            && (i == 0 || matches!(b[i - 1], b'{' | b';') || b[i - 1].is_ascii_whitespace());
        if !at_name {
            i += 1;
            continue;
        }
        let name_end = i + b[i..]
            .iter()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(**c, b'-' | b'_'))
            .count();
        if b.get(name_end) != Some(&b':') {
            i += 1;
            continue;
        }
        let (mut depth, mut end) = (0i32, name_end + 1);
        while end < b.len() {
            let skipped = skip_literal(b, end);
            if skipped != end {
                end = skipped.min(b.len());
                continue;
            }
            match b[end] {
                b'(' => depth += 1,
                b')' => depth -= 1,
                b';' | b'}' if depth <= 0 => break,
                _ => {}
            }
            end += 1;
        }
        if !keep(&css[i..name_end]) {
            out.push_str(&css[at..i]);
            at = end;
            i = end;
            continue;
        }
        let value = css[name_end + 1..end].trim();
        let (value, important) = match value.rfind('!') {
            Some(bang) if value[bang + 1..].trim().eq_ignore_ascii_case("important") => {
                (value[..bang].trim_end(), " !important")
            }
            _ => (value, ""),
        };
        out.push_str(&css[at..=name_end]);
        out.push_str(&format!("{PLACEHOLDER}{}__{important}", saved.len()));
        saved.push(value.to_string());
        at = end;
        i = end;
    }
    out.push_str(&css[at..]);
    (out, saved)
}

fn unshield(css: &str, saved: &[String]) -> String {
    let mut parts = css.split(PLACEHOLDER);
    let mut out = String::from(parts.next().unwrap_or(""));
    for part in parts {
        let digits = part.bytes().take_while(u8::is_ascii_digit).count();
        let tail = (digits + 2).min(part.len());
        match part[..digits]
            .parse::<usize>()
            .ok()
            .and_then(|n| saved.get(n))
        {
            Some(value) => out.push_str(value),
            None => out.push_str(&format!("{PLACEHOLDER}{}", &part[..tail])),
        }
        out.push_str(&part[tail..]);
    }
    out
}

struct KeepUnprefixed;

impl<'i> Visitor<'i> for KeepUnprefixed {
    type Error = Infallible;

    fn visit_types(&self) -> VisitTypes {
        VisitTypes::PROPERTIES
    }

    fn visit_property(&mut self, property: &mut Property<'i>) -> Result<(), Infallible> {
        if let Property::BackdropFilter(_, prefix) = property {
            prefix.insert(VendorPrefix::None);
        }
        Ok(())
    }
}

struct Prune<'a> {
    words: &'a Words,
}

impl<'i> Visitor<'i> for Prune<'_> {
    type Error = Infallible;

    fn visit_types(&self) -> VisitTypes {
        VisitTypes::RULES
    }

    fn visit_rule(&mut self, rule: &mut CssRule<'i>) -> Result<(), Infallible> {
        if let CssRule::Style(style) = rule {
            style.selectors.0.retain(|s| reachable(s, self.words));
            if style.selectors.0.is_empty() {
                *rule = CssRule::Ignored;
            }
            return Ok(());
        }
        rule.visit_children(self)?;
        let hollow = match rule {
            CssRule::Media(r) => r.rules.0.iter().all(is_ignored),
            CssRule::Supports(r) => r.rules.0.iter().all(is_ignored),
            CssRule::Container(r) => r.rules.0.iter().all(is_ignored),
            _ => false,
        };
        if hollow {
            *rule = CssRule::Ignored;
        }
        Ok(())
    }
}

fn is_ignored(rule: &CssRule) -> bool {
    matches!(rule, CssRule::Ignored)
}

fn reachable(selector: &Selector, words: &Words) -> bool {
    selector.iter_raw_match_order().all(|c| match c {
        Component::Class(name) | Component::ID(name) => words.has(name),
        Component::LocalName(local) => words.has_tag(&local.lower_name) || words.has(&local.name),
        Component::Is(list) | Component::Where(list) | Component::Any(_, list) => {
            list.iter().any(|s| reachable(s, words))
        }
        _ => true,
    })
}

fn variable_references(css: &str) -> impl Iterator<Item = &str> {
    css.match_indices("var(").map(|(at, _)| {
        let rest = css[at + 4..].trim_start();
        let end = rest
            .find(|c: char| !(c.is_alphanumeric() || matches!(c, '-' | '_')))
            .unwrap_or(rest.len());
        &rest[..end]
    })
}

pub(crate) fn stage(
    doc: &Doc,
    words: &Words,
    subset_text_fonts: bool,
    licenses: Licenses,
) -> Vec<Edit> {
    let sources: Vec<(&Tag, Cow<str>)> = doc
        .tags()
        .iter()
        .filter(|t| !t.in_svg)
        .filter_map(|tag| Some((tag, stylesheet(doc, tag)?)))
        .collect();
    let referenced: HashSet<&str> = sources
        .iter()
        .flat_map(|(_, source)| variable_references(source))
        .collect();
    let shielded: Vec<Shielded<'_>> = sources
        .iter()
        .map(|(_, source)| source.as_ref())
        .collect::<IndexSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .par_iter()
        .map(|source| shield(source, words, &referenced, licenses))
        .collect();
    let parsed: Vec<_> = shielded
        .par_iter()
        .map(|shielded| parse(&shielded.css))
        .collect();
    let isolated: Vec<Option<Isolated>> = parsed
        .iter()
        .zip(&shielded)
        .map(|(parsed, shielded)| {
            parsed
                .as_ref()
                .err()
                .and_then(|places| isolate(&shielded.css, places))
        })
        .collect();
    let mut sheets: Vec<Option<StyleSheet>> = parsed
        .into_par_iter()
        .zip(&isolated)
        .map(|(parsed, isolated)| {
            let sheet = match (parsed, isolated) {
                (Ok(sheet), _) => sheet,
                (Err(_), Some(isolated)) => parse(&isolated.css).ok()?,
                (Err(_), None) => return None,
            };
            finish(sheet, words)
        })
        .collect();
    let embedded = doc
        .tags()
        .iter()
        .filter(|t| t.in_svg && t.element == Element::Style)
        .filter_map(|t| Some(&doc.src()[t.body.clone()?]));
    let loose: Vec<&str> = shielded
        .iter()
        .flat_map(|s| s.saved.iter().map(String::as_str))
        .chain(
            isolated
                .iter()
                .flatten()
                .flat_map(|i| i.rules.iter().map(String::as_str)),
        )
        .chain(embedded)
        .collect();
    let settings = fonts::Settings {
        src: doc.src(),
        words,
        subset_text_fonts,
        notices: licenses,
    };
    let notices = fonts::rewrite(&mut sheets, &loose, &settings);
    let printed: Vec<Option<String>> = sheets
        .par_iter()
        .zip(&shielded)
        .zip(&isolated)
        .zip(&notices)
        .map(|(((sheet, shielded), isolated), notices)| {
            print(sheet.as_ref()?, shielded, isolated.as_ref(), notices)
        })
        .collect();
    let printed: HashMap<&str, &String> = shielded
        .iter()
        .zip(&printed)
        .filter_map(|(shielded, printed)| printed.as_ref().map(|css| (shielded.source, css)))
        .collect();
    sources
        .iter()
        .filter_map(|(tag, source)| {
            let css: &String = printed.get(source.as_ref())?;
            let (span, text) = match tag.body.clone() {
                Some(body) => (body, css.clone()),
                None => {
                    let href = data::encode_text(Mime::TextCss, css);
                    (
                        tag.span.clone(),
                        tag.open_tag(|name, value| {
                            Some(if *name == AttrName::Href {
                                href.clone()
                            } else {
                                value.to_string()
                            })
                        }),
                    )
                }
            };
            Some(Edit {
                span,
                text,
                transform: Transform::PrunedStylesheet,
                target: Target::Resource(tag.label().to_string()),
            })
        })
        .filter(Edit::shrinks)
        .collect()
}

fn stylesheet<'a>(doc: &'a Doc, tag: &Tag) -> Option<Cow<'a, str>> {
    match tag.element {
        Element::Style => Some(Cow::Borrowed(&doc.src()[tag.body.clone()?])),
        Element::Link if matches!(tag.rel(), Some(Rel::Stylesheet)) => {
            String::from_utf8(data::decode(tag.attr(AttrName::Href)?)?.bytes)
                .ok()
                .map(Cow::Owned)
        }
        Element::Link | Element::Script | Element::Img | Element::Svg => None,
    }
}
