use crate::{
    Licenses, Tuning, cache,
    data::{self, Mime},
    words::Words,
};
use cssparser::{ParseError, Parser, ParserInput, Token};
use hb_subset::{Blob, FontFace, SubsetInput, Tag};
use lightningcss::{
    properties::{Property, font::FontFamily},
    rules::{
        CssRule,
        font_face::{FontFaceProperty, FontFaceRule, FontFormat, Source},
        style::StyleRule,
    },
    selector::PseudoElement,
    stylesheet::{PrinterOptions, StyleSheet},
    traits::ToCss,
    values::string::CowArcStr,
    visitor::{Visit, VisitTypes, Visitor},
};
use rayon::prelude::*;
use skrifa::{FontRef, MetadataProvider, raw::TableProvider, string::StringId};
use std::{borrow::Cow, collections::HashSet, convert::Infallible, ops::Range, path::Path};

const WESTERN_TEXT: [Range<u32>; 3] = [0x20..0x250, 0x2000..0x2070, 0x20A0..0x20D0];
const QUOTES: [char; 2] = ['"', '\''];

struct Face {
    family: String,
    uri: String,
}

enum Decision {
    Keep,
    Drop,
    Replace { uri: String, notice: Option<String> },
}

struct RuleFacts {
    pseudo_only: bool,
    declared: Vec<String>,
    text: String,
}

struct Usage {
    rules: Vec<RuleFacts>,
    loose: String,
}

impl Usage {
    fn of(&self, family: &str) -> Option<bool> {
        let mut used = false;
        let mut pseudo_only = true;
        for rule in self.rules.iter().filter(|r| r.text.contains(family)) {
            used = true;
            pseudo_only &= rule.pseudo_only
                && rule.declared.iter().any(|name| name == family)
                && rule.text.matches(family).count() == 1;
        }
        if self.loose.contains(family) {
            used = true;
            pseudo_only = false;
        }
        used.then_some(pseudo_only)
    }
}

struct Chars {
    icons: HashSet<char>,
    text: Option<HashSet<char>>,
}

pub(crate) struct Settings<'a> {
    pub(crate) src: &'a str,
    pub(crate) words: &'a Words,
    pub(crate) subset_text_fonts: bool,
    pub(crate) notices: Licenses,
    pub(crate) cache: Option<&'a Path>,
    pub(crate) tuning: Tuning,
}

pub(crate) fn rewrite(
    sheets: &mut [Option<StyleSheet<'_>>],
    loose: &[&str],
    settings: &Settings,
) -> Vec<Vec<String>> {
    let faces: Vec<Vec<Option<Face>>> = sheets
        .par_iter_mut()
        .map(|sheet| {
            let mut collect = CollectFaces(Vec::new());
            if let Some(sheet) = sheet {
                let _ = sheet.visit(&mut collect);
            }
            collect.0
        })
        .collect();
    if faces.iter().all(Vec::is_empty) {
        return vec![Vec::new(); sheets.len()];
    }
    let usage = collect_usage(sheets, loose);
    let surviving: Vec<String> = sheets
        .par_iter()
        .filter_map(|sheet| Some(sheet.as_ref()?.to_css(PrinterOptions::default()).ok()?.code))
        .collect();
    let surviving: Vec<&str> = surviving.iter().map(String::as_str).collect();
    let chars = collect_chars(&surviving, loose, settings);
    let decisions: Vec<Vec<Decision>> = faces
        .par_iter()
        .map(|sheet_faces| {
            sheet_faces
                .par_iter()
                .map(|face| match face {
                    Some(face) => decide(face, &usage, &chars, settings),
                    None => Decision::Keep,
                })
                .collect()
        })
        .collect();
    sheets
        .par_iter_mut()
        .zip(&decisions)
        .map(|(sheet, decisions)| {
            let mut apply = Apply {
                decisions: decisions.iter(),
                notices: Vec::new(),
            };
            if let Some(sheet) = sheet {
                let _ = sheet.visit(&mut apply);
            }
            apply.notices
        })
        .collect()
}

fn collect_usage(sheets: &mut [Option<StyleSheet<'_>>], loose: &[&str]) -> Usage {
    let rules = sheets
        .par_iter_mut()
        .flat_map(|sheet| {
            let mut collect = CollectRules(Vec::new());
            if let Some(sheet) = sheet {
                let _ = sheet.visit(&mut collect);
            }
            collect.0
        })
        .collect();
    Usage {
        rules,
        loose: loose.join("\n").to_lowercase(),
    }
}

fn collect_chars(css: &[&str], loose: &[&str], settings: &Settings) -> Chars {
    let mut icons = document_chars(settings.src);
    for text in css.iter().chain(loose) {
        icons.extend(content_chars(text));
    }
    let text = settings.subset_text_fonts.then(|| {
        let cased: Vec<char> = icons
            .iter()
            .flat_map(|c| c.to_uppercase().chain(c.to_lowercase()))
            .collect();
        let western = WESTERN_TEXT
            .into_iter()
            .flatten()
            .filter_map(char::from_u32);
        icons.iter().copied().chain(western).chain(cased).collect()
    });
    Chars { icons, text }
}

fn decide(face: &Face, usage: &Usage, chars: &Chars, settings: &Settings) -> Decision {
    let plain = face
        .family
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_'));
    if !plain {
        return Decision::Keep;
    }
    let in_markup = settings.words.mentions(&face.family);
    let Some(pseudo_only) = usage
        .of(&face.family.to_lowercase())
        .or(in_markup.then_some(false))
    else {
        return Decision::Drop;
    };
    let Some(font) = data::decode(&face.uri) else {
        return Decision::Keep;
    };
    let subset = if pseudo_only && !in_markup {
        Some(&chars.icons)
    } else {
        chars.text.as_ref()
    };
    match transcode(
        &font.bytes,
        subset,
        settings.notices,
        settings.cache,
        settings.tuning,
    ) {
        Some(transcoded) => Decision::Replace {
            uri: data::encode_base64(Mime::FontWoff2, &transcoded.woff2),
            notice: transcoded.notice,
        },
        None => Decision::Keep,
    }
}

struct CollectFaces(Vec<Option<Face>>);

impl<'i> Visitor<'i> for CollectFaces {
    type Error = Infallible;

    fn visit_types(&self) -> VisitTypes {
        VisitTypes::RULES
    }

    fn visit_rule(&mut self, rule: &mut CssRule<'i>) -> Result<(), Infallible> {
        if let CssRule::FontFace(face) = rule {
            self.0.push(describe(face));
            return Ok(());
        }
        rule.visit_children(self)
    }
}

fn describe(face: &FontFaceRule) -> Option<Face> {
    let family = face.properties.iter().find_map(|property| match property {
        FontFaceProperty::FontFamily(FontFamily::FamilyName(name)) => {
            name.to_css_string(PrinterOptions::default()).ok()
        }
        _ => None,
    })?;
    let sources = face
        .properties
        .iter()
        .rev()
        .find_map(|property| match property {
            FontFaceProperty::Source(sources) => Some(sources),
            _ => None,
        })?;
    let uri = sources
        .iter()
        .filter_map(|source| match source {
            Source::Url(url) if data::is_data_url(url.url.url.as_ref()) => {
                preference(url.format.as_ref()).map(|rank| (rank, url.url.url.to_string()))
            }
            _ => None,
        })
        .min_by_key(|(rank, _)| *rank)
        .map(|(_, uri)| uri)?;
    Some(Face {
        family: family.trim_matches(QUOTES).to_string(),
        uri,
    })
}

fn preference(format: Option<&FontFormat>) -> Option<u8> {
    match format {
        Some(FontFormat::WOFF2) => Some(0),
        Some(FontFormat::WOFF) => Some(1),
        Some(FontFormat::TrueType | FontFormat::OpenType) | None => Some(2),
        Some(
            FontFormat::EmbeddedOpenType
            | FontFormat::Collection
            | FontFormat::SVG
            | FontFormat::String(_),
        ) => None,
    }
}

struct Apply<'a> {
    decisions: std::slice::Iter<'a, Decision>,
    notices: Vec<String>,
}

impl<'i> Visitor<'i> for Apply<'_> {
    type Error = Infallible;

    fn visit_types(&self) -> VisitTypes {
        VisitTypes::RULES
    }

    fn visit_rule(&mut self, rule: &mut CssRule<'i>) -> Result<(), Infallible> {
        let CssRule::FontFace(face) = rule else {
            return rule.visit_children(self);
        };
        match self.decisions.next() {
            Some(Decision::Drop) => *rule = CssRule::Ignored,
            Some(Decision::Replace { uri, notice }) => {
                keep_one_source(face, uri);
                if let Some(notice) = notice.as_ref().filter(|n| !self.notices.contains(n)) {
                    self.notices.push(notice.clone());
                }
            }
            Some(Decision::Keep) | None => {}
        }
        Ok(())
    }
}

fn keep_one_source(face: &mut FontFaceRule<'_>, uri: &str) {
    let last = face
        .properties
        .iter()
        .rposition(|property| matches!(property, FontFaceProperty::Source(_)));
    let mut index = 0;
    face.properties.retain(|property| {
        let superseded = matches!(property, FontFaceProperty::Source(_)) && Some(index) != last;
        index += 1;
        !superseded
    });
    for property in &mut face.properties {
        let FontFaceProperty::Source(sources) = property else {
            continue;
        };
        let mut replaced = false;
        let kept = std::mem::take(sources)
            .into_iter()
            .filter_map(|source| match source {
                Source::Url(mut url) if !replaced && data::is_data_url(url.url.url.as_ref()) => {
                    replaced = true;
                    url.url.url = CowArcStr::from(uri.to_string());
                    url.format = Some(FontFormat::WOFF2);
                    url.tech.clear();
                    Some(Source::Url(url))
                }
                Source::Url(_) => None,
                local => Some(local),
            })
            .collect();
        *sources = kept;
    }
}

struct CollectRules(Vec<RuleFacts>);

impl<'i> Visitor<'i> for CollectRules {
    type Error = Infallible;

    fn visit_types(&self) -> VisitTypes {
        VisitTypes::RULES
    }

    fn visit_rule(&mut self, rule: &mut CssRule<'i>) -> Result<(), Infallible> {
        if let CssRule::Style(style) = rule {
            self.0.push(facts(style));
        }
        rule.visit_children(self)
    }
}

fn facts(style: &StyleRule) -> RuleFacts {
    let block = &style.declarations;
    let declared = block
        .declarations
        .iter()
        .chain(&block.important_declarations)
        .filter_map(|property| match property {
            Property::FontFamily(families) => Some(families),
            _ => None,
        })
        .flatten()
        .filter_map(|family| match family {
            FontFamily::FamilyName(name) => Some(
                name.to_css_string(PrinterOptions::default())
                    .ok()?
                    .trim_matches(QUOTES)
                    .to_lowercase(),
            ),
            FontFamily::Generic(_) => None,
        })
        .collect();
    RuleFacts {
        pseudo_only: style.selectors.0.iter().all(|s| {
            matches!(
                s.pseudo_element(),
                Some(PseudoElement::Before | PseudoElement::After)
            )
        }),
        declared,
        text: block
            .to_css_string(PrinterOptions::default())
            .unwrap_or_default()
            .to_lowercase(),
    }
}

fn content_chars(css: &str) -> HashSet<char> {
    let mut chars = HashSet::new();
    let mut input = ParserInput::new(css);
    string_literals(&mut Parser::new(&mut input), &mut chars);
    if css.contains("attr(") || css.contains("counter") {
        chars.extend(' '..='~');
    }
    chars
}

fn document_chars(src: &str) -> HashSet<char> {
    let decoded = html_escape::decode_html_entities(src);
    let mut chars: HashSet<char> = decoded.chars().filter(|c| !c.is_ascii()).collect();
    for (at, _) in src.match_indices("\\u") {
        let digits: String = src[at + 2..]
            .trim_start_matches('{')
            .chars()
            .take(6)
            .take_while(char::is_ascii_hexdigit)
            .collect();
        chars.extend(
            u32::from_str_radix(&digits, 16)
                .ok()
                .and_then(char::from_u32),
        );
    }
    chars
}

fn string_literals<'i>(parser: &mut Parser<'i, '_>, chars: &mut HashSet<char>) {
    while let Ok(token) = parser.next_including_whitespace_and_comments().cloned() {
        match token {
            Token::QuotedString(text) => chars.extend(text.chars()),
            Token::Function(name) if name.eq_ignore_ascii_case("url") => {}
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                let _ = parser.parse_nested_block(|inner| {
                    string_literals(inner, chars);
                    Ok::<_, ParseError<'i, ()>>(())
                });
            }
            _ => {}
        }
    }
}

struct Transcoded {
    woff2: Vec<u8>,
    notice: Option<String>,
}

fn transcode(
    bytes: &[u8],
    chars: Option<&HashSet<char>>,
    notices: Licenses,
    cache: Option<&Path>,
    tuning: Tuning,
) -> Option<Transcoded> {
    let quality = tuning.woff2_quality.min(11);
    let (Some(root), None) = (cache, chars) else {
        return convert(bytes, chars, notices, quality);
    };
    let directory = root.join(cache::FONTS);
    let key = cache::key(&[bytes, &[quality]]);
    if let Some(entry) = cache::load(&directory, &key).and_then(|entry| Transcoded::decode(&entry))
    {
        return Some(entry);
    }
    let converted = convert(bytes, chars, notices, quality)?;
    cache::store(&directory, &key, &converted.encode());
    Some(converted)
}

impl Transcoded {
    fn encode(&self) -> Vec<u8> {
        let notice = self.notice.as_deref().unwrap_or("").as_bytes();
        let mut out = Vec::with_capacity(4 + notice.len() + self.woff2.len());
        out.extend_from_slice(&(notice.len() as u32).to_le_bytes());
        out.extend_from_slice(notice);
        out.extend_from_slice(&self.woff2);
        out
    }

    fn decode(entry: &[u8]) -> Option<Transcoded> {
        let length = u32::from_le_bytes(entry.get(..4)?.try_into().ok()?) as usize;
        let notice = entry.get(4..4 + length)?;
        let woff2 = entry.get(4 + length..)?;
        (woff2.starts_with(b"wOF2")).then(|| Transcoded {
            woff2: woff2.to_vec(),
            notice: (!notice.is_empty()).then(|| String::from_utf8_lossy(notice).into_owned()),
        })
    }
}

pub(crate) fn woff2_file(bytes: &[u8], cache: Option<&Path>, tuning: Tuning) -> Option<Vec<u8>> {
    transcode(bytes, None, Licenses::Keep, cache, tuning).map(|converted| converted.woff2)
}

fn convert(
    bytes: &[u8],
    chars: Option<&HashSet<char>>,
    notices: Licenses,
    quality: u8,
) -> Option<Transcoded> {
    let sfnt: Cow<[u8]> = match bytes.get(..4)? {
        b"wOFF" => Cow::Owned(wuff::decompress_woff1(bytes).ok()?),
        b"wOF2" => Cow::Owned(wuff::decompress_woff2(bytes).ok()?),
        _ => Cow::Borrowed(bytes),
    };
    let subset = chars.and_then(|chars| subsetted(&sfnt, chars));
    let notice = subset.as_ref().and_then(|_| {
        if notices == Licenses::Keep {
            notice(&sfnt)
        } else {
            None
        }
    });
    let sfnt = subset.map_or(sfnt, Cow::Owned);
    Some(Transcoded {
        woff2: woofwoof::compress(&sfnt, "", usize::from(quality), true)?,
        notice,
    })
}

fn subsetted(sfnt: &[u8], chars: &HashSet<char>) -> Option<Vec<u8>> {
    let font = FontFace::new(Blob::from_bytes(sfnt).ok()?).ok()?;
    let mut input = SubsetInput::new().ok()?;
    let mut unicodes = input.unicode_set();
    for &c in chars {
        unicodes.insert(c);
    }
    let mut features = input.layout_feature_tag_set();
    for tag in layout_features(sfnt) {
        features.insert(Tag::new(tag));
    }
    let subset = input.subset_font(&font).ok()?.underlying_blob().to_vec();
    (!has_positioning(sfnt) || has_positioning(&subset)).then_some(subset)
}

fn layout_features(sfnt: &[u8]) -> Vec<[u8; 4]> {
    let Ok(font) = FontRef::new(sfnt) else {
        return Vec::new();
    };
    let substitution = font
        .gsub()
        .ok()
        .and_then(|table| table.feature_list().ok())
        .map(|list| {
            list.feature_records()
                .iter()
                .map(|record| record.feature_tag().to_be_bytes())
                .collect::<Vec<_>>()
        });
    let positioning = font
        .gpos()
        .ok()
        .and_then(|table| table.feature_list().ok())
        .map(|list| {
            list.feature_records()
                .iter()
                .map(|record| record.feature_tag().to_be_bytes())
                .collect::<Vec<_>>()
        });
    let mut tags: Vec<[u8; 4]> = substitution
        .into_iter()
        .chain(positioning)
        .flatten()
        .collect();
    tags.sort_unstable();
    tags.dedup();
    tags
}

fn has_positioning(sfnt: &[u8]) -> bool {
    FontRef::new(sfnt).is_ok_and(|font| font.gpos().is_ok())
}

fn notice(sfnt: &[u8]) -> Option<String> {
    let font = FontRef::new(sfnt).ok()?;
    let lines: Vec<String> = [
        StringId::COPYRIGHT_NOTICE,
        StringId::LICENSE_DESCRIPTION,
        StringId::LICENSE_URL,
    ]
    .into_iter()
    .filter_map(|id| font.localized_strings(id).english_or_first())
    .map(|text| text.to_string().replace("*/", "* /"))
    .collect();
    (!lines.is_empty()).then(|| format!(" {} ", lines.join(" ")))
}

#[cfg(test)]
mod tests {
    use super::{has_positioning, layout_features};

    fn sfnt_with(tag: &[u8; 4], table: &[u8]) -> Vec<u8> {
        let mut font = vec![0, 1, 0, 0, 0, 1, 0, 16, 0, 0, 0, 0];
        font.extend_from_slice(tag);
        font.extend_from_slice(&[0; 4]);
        font.extend_from_slice(&28u32.to_be_bytes());
        font.extend_from_slice(&(table.len() as u32).to_be_bytes());
        font.extend_from_slice(table);
        font
    }

    #[test]
    fn every_feature_of_a_font_is_listed_once_in_order() {
        let gsub = [
            0, 1, 0, 0, 0, 10, 0, 12, 0, 34, 0, 0, 0, 2, b't', b'n', b'u', b'm', 0, 10, b's', b'm',
            b'c', b'p', 0, 14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        let tags = layout_features(&sfnt_with(b"GSUB", &gsub));
        assert_eq!(tags, [*b"smcp", *b"tnum"]);
    }

    #[test]
    fn a_font_with_no_layout_tables_lists_no_features() {
        assert!(layout_features(&sfnt_with(b"head", &[0; 16])).is_empty());
        assert!(layout_features(b"not a font").is_empty());
    }

    #[test]
    fn a_font_with_a_gpos_table_has_positioning() {
        let gpos = [0, 1, 0, 0, 0, 10, 0, 12, 0, 14, 0, 0, 0, 0, 0, 0];
        assert!(has_positioning(&sfnt_with(b"GPOS", &gpos)));
    }

    #[test]
    fn a_font_without_one_or_with_no_font_at_all_has_none() {
        assert!(!has_positioning(&sfnt_with(b"head", &[0; 16])));
        assert!(!has_positioning(b"not a font"));
    }
}
