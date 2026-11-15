#[doc = "Independent checks for exact transformations."]
pub mod oracle;

use crate::{doc::{Doc, Edit}, data, fonts, images, html::{AttrName, Element}, Options, Target, Transform, Warning};
use base64::{engine::general_purpose::STANDARD, Engine};
use cssparser::{ParseError, Parser, ParserInput, Token};
use std::ops::Range;

fn urls<'i>(parser: &mut Parser<'i, '_>, in_font: bool, found: &mut Vec<(Range<usize>, bool, usize)>) -> Result<(), ParseError<'i, ()>> {
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
                        found.push((from..from + trimmed.len(), in_font, parser.position().byte_index()));
                    }
                }
            }
            Token::Function(ref name) if name.eq_ignore_ascii_case("url") => {
                let mut span = None;
                parser.parse_nested_block(|inner| {
                    let at = inner.position();
                    if let Ok(Token::QuotedString(value)) = inner.next().cloned() {
                        let slice = inner.slice_from(at);
                        let raw = slice.trim();
                        if raw.len() >= 2 && &raw[1..raw.len() - 1] == &*value && inner.is_exhausted() {
                            let from = at.byte_index() + slice.len() - slice.trim_start().len() + 1;
                            span = Some(from..from + value.len());
                        }
                    }
                    Ok::<_, ParseError<'i, ()>>(())
                })?;
                if let Some(span) = span { found.push((span, in_font, parser.position().byte_index())); }
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

fn comments<'i>(parser: &mut Parser<'i, '_>, strip_licenses: bool, found: &mut Vec<Range<usize>>) -> Result<(), ParseError<'i, ()>> {
    loop {
        let start = parser.position().byte_index();
        let Ok(token) = parser.next_including_whitespace_and_comments().cloned() else { break };
        if token.is_parse_error() { return Err(parser.new_custom_error(())); }
        match token {
            Token::Comment(text) => {
                if strip_licenses || !(text.starts_with('!') || text.contains("@license") || text.contains("@preserve")) {
                    found.push(start..parser.position().byte_index());
                }
            }
            Token::Function(_) | Token::ParenthesisBlock | Token::SquareBracketBlock | Token::CurlyBracketBlock => {
                parser.parse_nested_block(|inner| comments(inner, strip_licenses, found))?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn stylesheet(doc: &Doc, span: Range<usize>, target: Target, options: &Options, edits: &mut Vec<Edit>, warnings: &mut Vec<Warning>) {
    let source = &doc.src()[span.clone()];
    if source.contains("--") { return; }
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let mut found = Vec::new();
    if comments(&mut parser, options.strip_licenses, &mut found).is_err() || found.is_empty() { return; }
    let mut candidate = source.to_string();
    for range in found.iter().rev() { candidate.replace_range(range.clone(), ""); }
    let proven = adopt(source.to_string(), candidate, &oracle::Css);
    if proven.rejected() {
        warnings.push(Warning::OracleRejected { transform: Transform::MinifiedStylesheet, target });
        return;
    }
    let _ = proven.into_inner();
    for range in found {
        edits.push(Edit { span: span.start + range.start..span.start + range.end, text: String::new(), transform: Transform::MinifiedStylesheet, target: target.clone() });
    }
}

fn consider(doc: &Doc, span: Range<usize>, target: Target, in_font: bool, unhinted: bool, image: bool, options: &Options, edits: &mut Vec<Edit>, warnings: &mut Vec<Warning>) {
    let tuning = options.compression.tuning();
    let cache = options.cache_directory.as_deref();
    let value = &doc.src()[span.clone()];
    if image && value.get(..22).is_some_and(|prefix| prefix.eq_ignore_ascii_case("data:image/png;base64,")) && !value.contains('#') {
        if let Some(decoded) = data::decode(value) {
            let memory = (!options.keep_png).then(|| options.image_memory.unwrap_or(Options::DEFAULT_IMAGE_MEMORY));
            let mut best = None;
            for (mime, candidate) in images::exact_candidates(&decoded.bytes, tuning, memory) {
                let transform = if mime == data::Mime::ImageWebp { Transform::ConvertedWebp } else { Transform::RecompressedPng };
                let proven = adopt(decoded.bytes.clone(), candidate, &oracle::Image);
                if proven.rejected() {
                    warnings.push(Warning::OracleRejected { transform, target: target.clone() });
                    continue;
                }
                let text = data::encode_base64(mime, &proven.into_inner());
                if text.len() < span.len() && best.as_ref().is_none_or(|(_, previous): &(Transform, String)| text.len() < previous.len()) {
                    best = Some((transform, text));
                }
            }
            if let Some((transform, text)) = best {
                edits.push(Edit { span, text, transform, target });
                return;
            }
        }
    }
    if in_font && !value.contains('#') {
        if let Some(decoded) = data::decode(value).filter(|d| d.mime == data::Mime::FontWoff2 || unhinted && matches!(d.bytes.get(..4), Some(b"wOFF" | b"OTTO" | b"\x00\x01\x00\x00" | b"true" | b"typ1"))) {
            if let Some(encoded) = fonts::exact_transcode(&decoded.bytes, tuning, cache) {
                if encoded.len() < decoded.bytes.len() {
                    let proven = adopt(decoded.bytes, encoded, &oracle::Font);
                    if proven.rejected() {
                        warnings.push(Warning::OracleRejected { transform: Transform::ReencodedFont, target });
                        return;
                    }
                    if let Some(at) = value.to_ascii_lowercase().find(";base64,") {
                        let prefix = if value[..at + 8].eq_ignore_ascii_case("data:font/woff2;base64,") { &value[..at + 8] } else if unhinted && matches!(value[..at + 8].to_ascii_lowercase().as_str(), "data:font/ttf;base64," | "data:font/otf;base64," | "data:font/woff;base64," | "data:application/font-woff;base64," | "data:application/x-font-ttf;base64,") { "data:font/woff2;base64," } else { return };
                        let text = format!("{}{}", prefix, STANDARD.encode(proven.into_inner()));
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

pub(crate) fn stage(doc: &Doc, options: &Options) -> (Vec<Edit>, Vec<Warning>) {
    let mut edits = Vec::new();
    let mut warnings = Vec::new();
    for tag in doc.tags() {
        for attr in &tag.attrs {
            if matches!(&attr.name, AttrName::Other(name) if name == "style") && !attr.value.contains('&') {
                if let Some(span) = &attr.value_span {
                    stylesheet(doc, span.clone(), Target::Resource(tag.label().to_string()), options, &mut edits, &mut warnings);
                    let mut input = ParserInput::new(&attr.value);
                    let mut parser = Parser::new(&mut input);
                    let mut found = Vec::new();
                    if urls(&mut parser, false, &mut found).is_ok() {
                        for (url, _, _) in found {
                            let range = span.start + url.start..span.start + url.end;
                            consider(doc, range, Target::Resource(tag.label().to_string()), false, false, false, options, &mut edits, &mut warnings);
                        }
                    }
                }
            }
            if !matches!(attr.name, AttrName::Src | AttrName::DataSrc | AttrName::Href) { continue; }
            let Some(span) = attr.value_span.clone() else { continue };
            let target = Target::Resource(tag.label().to_string());
            let image = tag.element == Element::Img && !tag.in_svg && matches!(attr.name, AttrName::Src | AttrName::DataSrc);
            consider(doc, span, target, false, false, image, options, &mut edits, &mut warnings);
        }
        if tag.element == Element::Style {
            if let Some(body) = &tag.body {
                stylesheet(doc, body.clone(), Target::Resource(tag.label().to_string()), options, &mut edits, &mut warnings);
                let mut input = ParserInput::new(&doc.src()[body.clone()]);
                let mut parser = Parser::new(&mut input);
                let mut found = Vec::new();
                if urls(&mut parser, false, &mut found).is_ok() {
                    for (span, in_font, end) in found {
                        let rest = doc.src()[body.start + end..body.end].trim_start_matches(|c: char| c.is_ascii_whitespace());
                        let unhinted = rest.starts_with([';', '}', ',']);
                        let span = body.start + span.start..body.start + span.end;
                        consider(doc, span, Target::Resource(tag.label().to_string()), in_font, unhinted, false, options, &mut edits, &mut warnings);
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
    use image::ImageEncoder;

    fn png_image() -> Vec<u8> {
        let pixels: Vec<u8> = (0..128 * 128).flat_map(|i| [i as u8, (i / 128) as u8, 42, if i % 5 == 0 { 0 } else { 255 }]).collect();
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new_with_quality(&mut bytes, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::NoFilter)
            .write_image(&pixels, 128, 128, image::ExtendedColorType::Rgba8).unwrap();
        bytes
    }

    #[test]
    fn exact_gates_png_and_webp() {
        let png = png_image();
        let html = format!("<html><img src='data:image/png;base64,{}'></html>", STANDARD.encode(&png));
        let mut options = crate::Options::default();
        options.exact = true;
        options.keep_png = true;
        let out = crate::simplify(&html, options).unwrap().pack(Mode::Exact);
        assert!(out.applied.iter().any(|step| step.transform == Transform::RecompressedPng), "{:?}", out.warnings);
        let payload = out.html.split(";base64,").nth(1).unwrap().split('\'').next().unwrap();
        assert!(super::oracle::image(&png, &STANDARD.decode(payload).unwrap()));
        let out = optimize(&html, Mode::Exact).unwrap();
        assert!(out.applied.iter().any(|step| step.transform == Transform::ConvertedWebp), "{:?}", out.warnings);
        let payload = out.html.split(";base64,").nth(1).unwrap().split('\'').next().unwrap();
        assert!(super::oracle::image(&png, &STANDARD.decode(payload).unwrap()));
        assert_eq!(optimize(&out.html, Mode::Exact).unwrap().html, out.html);
    }

    #[test]
    fn image_oracle_rejection_keeps_original() {
        let original = png_image();
        let changed = {
            let mut pixels = image::load_from_memory(&original).unwrap().to_rgba8();
            pixels.get_pixel_mut(0, 0).0[0] ^= 1;
            let mut bytes = Vec::new();
            image::codecs::png::PngEncoder::new(&mut bytes).write_image(pixels.as_raw(), 128, 128, image::ExtendedColorType::Rgba8).unwrap();
            bytes
        };
        let proven = super::adopt(original.clone(), changed, &super::oracle::Image);
        assert!(proven.rejected());
        assert_eq!(proven.into_inner(), original);
    }

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
        let input = "<html><img style=\"background:url('data:image/png;base64,Y Q==')\"></html>";
        let output = optimize(input, Mode::Exact).unwrap();
        assert_eq!(output.html, "<html><img style=\"background:url('data:image/png;base64,YQ==')\"></html>");
    }

    #[test]
    fn exact_removes_only_safe_css_comments() {
        let html = "<html><style>/*x*/a{content:'/*text*/';color:red}</style></html>";
        let output = optimize(html, Mode::Exact).unwrap();
        assert_eq!(output.html, "<html><style>a{content:'/*text*/';color:red}</style></html>");
        assert_eq!(optimize(&output.html, Mode::Exact).unwrap().html, output.html);
        let unsafe_css = "<html><style>a/**/b{color:red}</style></html>";
        let output = optimize(unsafe_css, Mode::Exact).unwrap();
        assert_eq!(output.html, unsafe_css);
        assert!(output.warnings.iter().any(|warning| matches!(warning, crate::Warning::OracleRejected { transform: Transform::MinifiedStylesheet, .. })));
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

    #[test]
    fn exact_reencodes_unhinted_woff_and_sfnt() {
        for (mime, font) in [
            ("font/ttf", include_bytes!("../../tests/data/octavo-test.ttf").as_slice()),
            ("font/woff", include_bytes!("../../tests/data/octavo-test.woff").as_slice()),
        ] {
            let uri = format!("data:{mime};base64,{}", STANDARD.encode(font));
            let html = format!("<html><style>@font-face{{font-family:x;src:url({uri})}}</style></html>");
            let output = optimize(&html, Mode::Exact).unwrap();
            assert!(output.applied.iter().any(|step| step.transform == Transform::ReencodedFont), "{mime}: {:?}", output.warnings);
            let payload = output.html.split("data:font/woff2;base64,").nth(1).unwrap().split(')').next().unwrap();
            assert!(super::oracle::font(font, &STANDARD.decode(payload).unwrap()));
            let hinted = format!("<html><style>@font-face{{font-family:x;src:url({uri}) format('truetype')}}</style></html>");
            assert_eq!(optimize(&hinted, Mode::Exact).unwrap().html, hinted);
        }
    }
}
