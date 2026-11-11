use crate::{
    data,
    doc::{Doc, Edit},
    fonts,
    html::Tag,
    words::Words,
};
use cssparser::{Parser, ParserInput, Token};
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

pub fn optimize(
    css: &str,
    words: &Words,
    referenced: &HashSet<&str>,
    keep_licenses: bool,
) -> Option<String> {
    let notices = if keep_licenses {
        legal_comments(css)
    } else {
        String::new()
    };
    let (css, saved) = shield_custom_properties(css, &|name| {
        words.has("--") || referenced.contains(name) || words.has(name)
    });
    let warnings = Arc::new(RwLock::new(Vec::new()));
    let options = ParserOptions {
        error_recovery: true,
        warnings: Some(warnings.clone()),
        ..Default::default()
    };
    let mut sheet = StyleSheet::parse(&css, options).ok()?;
    if !warnings.read().ok()?.is_empty() {
        return None;
    }
    sheet.visit(&mut Prune { words }).ok()?;
    sheet.minify(MinifyOptions::default()).ok()?;
    sheet.visit(&mut KeepUnprefixed).ok()?;
    let printer = PrinterOptions {
        minify: true,
        ..Default::default()
    };
    Some(notices + &unshield(&sheet.to_css(printer).ok()?.code, &saved))
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

fn shield_custom_properties(css: &str, keep: &dyn Fn(&str) -> bool) -> (String, Vec<String>) {
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

struct Sheet<'a> {
    tag: &'a Tag,
    source: &'a str,
    pruned: Option<&'a str>,
}

pub fn stage(doc: &Doc, subset_text_fonts: bool, keep_licenses: bool) -> Vec<Edit> {
    let sources: Vec<(&Tag, Cow<str>)> = doc
        .tags
        .iter()
        .filter(|t| !t.in_svg)
        .filter_map(|tag| Some((tag, stylesheet(doc, tag)?)))
        .collect();
    let words = doc.words();
    let referenced: HashSet<&str> = sources
        .iter()
        .flat_map(|(_, source)| variable_references(source))
        .collect();
    let unique: HashSet<&str> = sources.iter().map(|(_, source)| source.as_ref()).collect();
    let optimized: HashMap<&str, Option<String>> = unique
        .into_par_iter()
        .map(|source| (source, optimize(source, words, &referenced, keep_licenses)))
        .collect();
    let sheets: Vec<Sheet> = sources
        .iter()
        .map(|(tag, source)| Sheet {
            tag,
            source,
            pruned: optimized[source.as_ref()].as_deref(),
        })
        .collect();
    let embedded: Vec<&str> = doc
        .tags
        .iter()
        .filter(|t| t.in_svg && t.name == "style")
        .filter_map(|t| Some(&doc.src[t.body.clone()?]))
        .collect();
    let all_css = sheets
        .iter()
        .map(|s| s.pruned.unwrap_or(s.source))
        .chain(embedded)
        .collect::<Vec<_>>()
        .join("\n");
    let cx = fonts::Context::new(&all_css, doc, subset_text_fonts, keep_licenses);
    sheets
        .iter()
        .filter_map(|sheet| {
            let css = fonts::rewrite(sheet.pruned?, &cx);
            let tag = sheet.tag;
            let (span, text) = match tag.body.clone() {
                Some(body) => (body, css),
                None => {
                    let href = data::encode_text("text/css", &css);
                    (
                        tag.span.clone(),
                        tag.open_tag(|n, v| {
                            Some(if n == "href" {
                                href.clone()
                            } else {
                                v.to_string()
                            })
                        }),
                    )
                }
            };
            Some(Edit {
                span,
                text,
                transform: "css-reachability",
                target: tag.attr("id").unwrap_or(tag.name).to_string(),
            })
        })
        .filter(Edit::shrinks)
        .collect()
}

fn stylesheet<'a>(doc: &'a Doc, tag: &Tag) -> Option<Cow<'a, str>> {
    match tag.name {
        "style" => Some(Cow::Borrowed(&doc.src[tag.body.clone()?])),
        "link" if tag.attr("rel") == Some("stylesheet") => {
            String::from_utf8(data::decode(tag.attr("href")?)?.bytes)
                .ok()
                .map(Cow::Owned)
        }
        _ => None,
    }
}
