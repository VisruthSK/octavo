#[doc = "Independent checks for exact transformations."]
pub mod oracle;

use crate::{doc::{Doc, Edit}, data, fonts, html::{AttrName, Element}, Target, Transform, Tuning, Warning};
use base64::{engine::general_purpose::STANDARD, Engine};
use cssparser::{ParseError, Parser, ParserInput, Token};
use std::{ops::Range, path::Path};

fn urls<'i>(parser: &mut Parser<'i, '_>, in_font: bool, found: &mut Vec<(Range<usize>, bool)>) -> Result<(), ParseError<'i, ()>> {
    let mut font_rule = false;
    loop {
        let start = parser.position();
        let Ok(token) = parser.next_including_whitespace_and_comments().cloned() else { break };
        match token {
            Token::AtKeyword(name) => font_rule = name.eq_ignore_ascii_case("font-face"),
            Token::Semicolon => font_rule = false,
            Token::UnquotedUrl(value) => {
                let raw = parser.slice_from(start);
                if raw.len() >= 5 && raw[..4].eq_ignore_ascii_case("url(") && raw.ends_with(')') {
                    let content = &raw[4..raw.len() - 1];
                    let trimmed = content.trim_matches(|c: char| c.is_ascii_whitespace());
                    if trimmed == &*value {
                        let from = start.byte_index() + 4 + content.len() - content.trim_start_matches(|c: char| c.is_ascii_whitespace()).len();
                        found.push((from..from + trimmed.len(), in_font));
                    }
                }
            }
            Token::Function(ref name) if name.eq_ignore_ascii_case("url") => {
                parser.parse_nested_block(|inner| {
                    let at = inner.position();
                    if let Ok(Token::QuotedString(value)) = inner.next().cloned() {
                        let slice = inner.slice_from(at);
                        let raw = slice.trim();
                        if raw.len() >= 2 && &raw[1..raw.len() - 1] == &*value && inner.is_exhausted() {
                            let from = at.byte_index() + slice.len() - slice.trim_start().len() + 1;
                            found.push((from..from + value.len(), in_font));
                        }
                    }
                    Ok::<_, ParseError<'i, ()>>(())
                })?;
            }
            Token::CurlyBracketBlock => {
                let child_font = in_font || font_rule;
                font_rule = false;
                parser.parse_nested_block(|inner| urls(inner, child_font, found))?;
            }
            Token::Function(_) | Token::ParenthesisBlock | Token::SquareBracketBlock => {
                parser.parse_nested_block(|inner| urls(inner, in_font, found))?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn consider(doc: &Doc, span: Range<usize>, target: Target, in_font: bool, tuning: Tuning, cache: Option<&Path>, edits: &mut Vec<Edit>, warnings: &mut Vec<Warning>) {
    let value = &doc.src()[span.clone()];
    if in_font && !value.contains('#') {
        if let Some(decoded) = data::decode(value).filter(|d| d.mime == data::Mime::FontWoff2) {
            if let Some(encoded) = fonts::exact_transcode(&decoded.bytes, tuning, cache) {
                if encoded.len() < decoded.bytes.len() {
                    let proven = adopt(decoded.bytes, encoded, &oracle::Font);
                    if proven.rejected() {
                        warnings.push(Warning::OracleRejected { transform: Transform::ReencodedFont, target });
                        return;
                    }
                    if let Some(at) = value.to_ascii_lowercase().find(";base64,") {
                        let text = format!("{}{}", &value[..at + 8], STANDARD.encode(proven.into_inner()));
                        if text.len() < span.len() {
                            edits.push(Edit { span, text, transform: Transform::ReencodedFont, target });
                        }
                        return;
                    }
                }
            }
        }
    }
    let Some(candidate) = data::normalize(value) else { return };
    let proven = adopt(value.to_string(), candidate, &oracle::Base64);
    if proven.rejected() {
        warnings.push(Warning::OracleRejected { transform: Transform::NormalizedDataUrl, target });
    } else {
        edits.push(Edit { span, text: proven.into_inner(), transform: Transform::NormalizedDataUrl, target });
    }
}

pub(crate) fn stage(doc: &Doc, tuning: Tuning, cache: Option<&Path>) -> (Vec<Edit>, Vec<Warning>) {
    let mut edits = Vec::new();
    let mut warnings = Vec::new();
    for tag in doc.tags() {
        for attr in &tag.attrs {
            if !matches!(attr.name, AttrName::Src | AttrName::DataSrc | AttrName::Href) { continue; }
            let Some(span) = attr.value_span.clone() else { continue };
            let target = Target::Resource(tag.label().to_string());
            consider(doc, span, target, false, tuning, cache, &mut edits, &mut warnings);
        }
        if tag.element == Element::Style {
            if let Some(body) = &tag.body {
                let mut input = ParserInput::new(&doc.src()[body.clone()]);
                let mut parser = Parser::new(&mut input);
                let mut found = Vec::new();
                if urls(&mut parser, false, &mut found).is_ok() {
                    for (span, in_font) in found {
                        let span = body.start + span.start..body.start + span.end;
                        consider(doc, span, Target::Resource(tag.label().to_string()), in_font, tuning, cache, &mut edits, &mut warnings);
                    }
                }
            }
        }
    }
    (edits, warnings)
}

#[doc = "An independent equivalence check for a proposed transformation."]
pub trait Oracle<T> {
    #[doc = "Returns whether the candidate is equivalent to the original."]
    fn equivalent(&self, original: &T, candidate: &T) -> bool;
}

#[doc = "A value selected by an equivalence oracle."]
pub struct Proven<T> {
    value: T,
    rejected: bool,
}

impl<T> Proven<T> {
    #[doc = "Returns the selected value."]
    pub fn into_inner(self) -> T { self.value }

    #[doc = "Returns whether the candidate was rejected."]
    pub fn rejected(&self) -> bool { self.rejected }
}

#[doc = "Selects the candidate only when the oracle accepts it."]
pub fn adopt<T>(original: T, candidate: T, oracle: &impl Oracle<T>) -> Proven<T> {
    let accepted = oracle.equivalent(&original, &candidate);
    Proven { value: if accepted { candidate } else { original }, rejected: !accepted }
}

#[cfg(test)]
mod tests {
    use crate::{optimize, Mode, Transform};
    use base64::{engine::general_purpose::STANDARD, Engine};

    #[test]
    fn exact_normalizes_attribute_base64_and_is_idempotent() {
        let input = "<html><img src='data:image/png;base64,Y Q=='></html>";
        let output = optimize(input, Mode::Exact).unwrap();
        assert_eq!(output.html, "<html><img src='data:image/png;base64,YQ=='></html>");
        assert_eq!(output.applied[0].transform, Transform::NormalizedDataUrl);
        assert_eq!(optimize(&output.html, Mode::Exact).unwrap().html, output.html);
        assert_eq!(optimize(input, Mode::Exact).unwrap().html, output.html);
    }

    #[test]
    fn exact_preserves_data_url_fragment() {
        let input = "<html><img src='data:image/png;base64,Y Q==#frag'></html>";
        let output = optimize(input, Mode::Exact).unwrap();
        assert_eq!(output.html, "<html><img src='data:image/png;base64,YQ==#frag'></html>");
        assert!(output.warnings.is_empty());
    }

    #[test]
    fn exact_completes_base64_padding() {
        let input = "<html><img src='data:image/png;base64,YQ'></html>";
        let output = optimize(input, Mode::Exact).unwrap();
        assert_eq!(output.html, "<html><img src='data:image/png;base64,YQ=='></html>");
    }

    #[test]
    fn exact_normalizes_css_urls() {
        let input = "<html><style>a{background:url('data:image/png;base64,Y Q==')}</style></html>";
        let output = optimize(input, Mode::Exact).unwrap();
        assert_eq!(output.html, "<html><style>a{background:url('data:image/png;base64,YQ==')}</style></html>");
        assert_eq!(optimize(&output.html, Mode::Exact).unwrap().html, output.html);
    }

    #[test]
    fn exact_pack_does_not_return_heuristic_edits() {
        let input = "<html><style>.unused{color:red}</style><body></body></html>";
        let simplified = crate::simplify(input, crate::Options::default()).unwrap();
        assert_eq!(simplified.pack(Mode::Exact).html, input);
    }

    #[test]
    fn exact_reencodes_whole_woff2() {
        let font = include_bytes!("../../tests/data/octavo-test.ttf");
        let encoded = ttf2woff2::encode_with_options(font, ttf2woff2::EncodeOptions {
            quality: ttf2woff2::BrotliQuality::from(0),
            transform_glyf_loca: false,
            threads: None,
        }).unwrap();
        let html = format!("<html><style>@font-face{{font-family:x;src:url(data:font/woff2;base64,{}) format('woff2')}}</style></html>", STANDARD.encode(&encoded));
        let output = optimize(&html, Mode::Exact).unwrap();
        assert!(output.applied.iter().any(|step| step.transform == Transform::ReencodedFont), "warnings: {:?}", output.warnings);
        let payload = output.html.split(";base64,").nth(1).unwrap().split(')').next().unwrap();
        let result = STANDARD.decode(payload).unwrap();
        assert!(super::oracle::font(&encoded, &result));
        assert_eq!(optimize(&output.html, Mode::Exact).unwrap().html, output.html);
    }
}
