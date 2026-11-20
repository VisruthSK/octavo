#[doc = "Independent checks for exact transformations."]
pub mod oracle;

#[cfg(test)]
mod corpus;

use crate::{doc::{Doc, Edit}, data, fonts, images, html::{AttrName, Element}, Options, Target, Transform, Warning};
use base64::{engine::general_purpose::STANDARD, Engine};
use cssparser::{ParseError, Parser, ParserInput, Token};
use std::ops::Range;

fn urls<'i>(parser: &mut Parser<'i, '_>, in_font: bool, found: &mut Vec<(Range<usize>, bool, usize)>) -> Result<(), ParseError<'i, ()>> {
    let mut font_rule = false;
    let mut declaration_start = true;
    let mut pending_src = false;
    let mut in_src = false;
    loop {
        let start = parser.position();
        let Ok(token) = parser.next_including_whitespace_and_comments().cloned() else { break };
        if in_font {
            match &token {
                Token::WhiteSpace(_) | Token::Comment(_) => {}
                Token::Semicolon => { declaration_start = true; pending_src = false; in_src = false; }
                Token::Ident(name) if declaration_start => { declaration_start = false; pending_src = name.eq_ignore_ascii_case("src"); }
                Token::Colon if pending_src => { in_src = true; pending_src = false; }
                _ if pending_src => { pending_src = false; }
                _ => {}
            }
        }
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
                        found.push((from..from + trimmed.len(), in_font && in_src, parser.position().byte_index()));
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
                if let Some(span) = span { found.push((span, in_font && in_src, parser.position().byte_index())); }
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

fn font_hint(source: &str, offset: usize) -> Option<(Range<usize>, String)> {
    let mut input = ParserInput::new(source.get(offset..)?);
    let mut parser = Parser::new(&mut input);
    let Token::Function(name) = parser.next().ok()?.clone() else { return None };
    if !name.eq_ignore_ascii_case("format") { return None; }
    parser.parse_nested_block(|inner| {
        let start = inner.position();
        let token = inner.next().ok().cloned();
        let slice = inner.slice_from(start);
        let raw = slice.trim();
        let leading = slice.len() - slice.trim_start().len();
        let (value, quote) = match token {
            Some(Token::QuotedString(value)) if raw.len() >= 2 && &raw[1..raw.len() - 1] == &*value => (value.to_string(), 1),
            Some(Token::Ident(value)) if raw == &*value => (value.to_string(), 0),
            _ => return Ok::<_, ParseError<'_, ()>>(None),
        };
        if !inner.is_exhausted() { return Ok(None); }
        let from = offset + start.byte_index() + leading + quote;
        Ok(Some((from..from + value.len(), value)))
    }).ok()?
}

fn css_rewrites<'i>(
    parser: &mut Parser<'i, '_>,
    source: &str,
    strip_licenses: bool,
    math_depth: usize,
    comments: &mut Vec<Range<usize>>,
    zero_units: &mut Vec<Range<usize>>,
    ws: &mut Vec<(Range<usize>, &'static str)>,
) -> Result<(), ParseError<'i, ()>> {
    let mut prev_token: Option<String> = None;
    let mut pending_ws: Option<(Range<usize>, usize)> = None;
    loop {
        let start = parser.position().byte_index();
        let Ok(token) = parser.next_including_whitespace_and_comments().cloned() else { break };
        if token.is_parse_error() { return Err(parser.new_custom_error(())); }
        match &token {
            Token::Comment(text) => {
                if strip_licenses || !(text.starts_with('!') || text.contains("@license") || text.contains("@preserve")) {
                    comments.push(start..parser.position().byte_index());
                }
            }
            Token::WhiteSpace(slice) => {
                pending_ws = Some((start..parser.position().byte_index(), slice.len()));
            }
            _ => {
                if let Some((ws_range, len)) = pending_ws.take() {
                    let is_prev_structural = matches!(prev_token.as_deref(), None | Some("CurlyBracketBlock" | "end:}" | "Semicolon" | "Comma" | "Colon"));
                    let is_next_structural = matches!(&token, Token::CurlyBracketBlock | Token::Semicolon | Token::Comma);
                    if is_prev_structural || is_next_structural {
                        ws.push((ws_range, ""));
                    } else if len > 1 {
                        ws.push((ws_range, " "));
                    }
                }
                match &token {
                    Token::Dimension { value, unit, .. } => {
                        let end = parser.position().byte_index();
                        if *value == 0.0 && math_depth == 0 && oracle::LENGTH_UNITS.iter().any(|u| unit.eq_ignore_ascii_case(u))
                            && source[start..end].starts_with('0') {
                            zero_units.push(start..end);
                        }
                        prev_token = Some("Dimension".to_string());
                    }
                    Token::CurlyBracketBlock => {
                        let start = parser.position();
                        parser.parse_nested_block(|inner| css_rewrites(inner, source, strip_licenses, math_depth, comments, zero_units, ws))?;
                        if !parser.slice_from(start).ends_with('}') {
                            return Err(parser.new_custom_error(()));
                        }
                        prev_token = Some("end:}".to_string());
                    }
                    Token::Function(name) => {
                        let is_math = ["calc", "min", "max", "clamp"].iter().any(|m| name.eq_ignore_ascii_case(m));
                        let next_depth = if is_math { math_depth + 1 } else { math_depth };
                        let start = parser.position();
                        parser.parse_nested_block(|inner| css_rewrites(inner, source, strip_licenses, next_depth, comments, zero_units, ws))?;
                        if !parser.slice_from(start).ends_with(')') {
                            return Err(parser.new_custom_error(()));
                        }
                        prev_token = Some("end:)".to_string());
                    }
                    Token::ParenthesisBlock | Token::SquareBracketBlock => {
                        let close = if matches!(&token, Token::SquareBracketBlock) { ']' } else { ')' };
                        let start = parser.position();
                        parser.parse_nested_block(|inner| css_rewrites(inner, source, strip_licenses, math_depth, comments, zero_units, ws))?;
                        if !parser.slice_from(start).ends_with(close) {
                            return Err(parser.new_custom_error(()));
                        }
                        prev_token = Some("end:)".to_string());
                    }
                    Token::Semicolon => { prev_token = Some("Semicolon".to_string()); }
                    Token::Comma => { prev_token = Some("Comma".to_string()); }
                    Token::Colon => { prev_token = Some("Colon".to_string()); }
                    _ => { prev_token = Some("Other".to_string()); }
                }
            }
        }
    }
    if let Some((ws_range, _)) = pending_ws.take() {
        ws.push((ws_range, ""));
    }
    Ok(())
}

fn stylesheet(doc: &Doc, span: Range<usize>, target: Target, options: &Options, edits: &mut Vec<Edit>, warnings: &mut Vec<Warning>) {
    let source = &doc.src()[span.clone()];
    if source.contains("--") { return; }
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let mut comments = Vec::new();
    let mut zero_units = Vec::new();
    let mut ws = Vec::new();
    if css_rewrites(&mut parser, source, options.strip_licenses, 0, &mut comments, &mut zero_units, &mut ws).is_err() { return; }
    if comments.is_empty() && zero_units.is_empty() && ws.is_empty() { return; }
    let mut edits_to_apply = Vec::new();
    for r in &comments { edits_to_apply.push((r.clone(), "")); }
    for r in &zero_units { edits_to_apply.push((r.clone(), "0")); }
    for (r, text) in &ws { edits_to_apply.push((r.clone(), *text)); }
    edits_to_apply.sort_by_key(|(r, _)| r.start);
    let mut candidate = String::with_capacity(source.len());
    let mut cur = 0;
    for (r, repl) in &edits_to_apply {
        if r.start < cur { return; }
        candidate.push_str(&source[cur..r.start]);
        candidate.push_str(repl);
        cur = r.end;
    }
    candidate.push_str(&source[cur..]);
    let proven = adopt(source.to_string(), candidate, &oracle::Css);
    if proven.rejected() {
        warnings.push(Warning::OracleRejected { transform: Transform::MinifiedStylesheet, target });
        return;
    }
    let _ = proven.into_inner();
    for r in comments {
        edits.push(Edit { span: span.start + r.start..span.start + r.end, text: String::new(), transform: Transform::MinifiedStylesheet, target: target.clone() });
    }
    for r in zero_units {
        edits.push(Edit { span: span.start + r.start..span.start + r.end, text: "0".to_string(), transform: Transform::StrippedZeroUnits, target: target.clone() });
    }
    for (r, repl) in ws {
        edits.push(Edit { span: span.start + r.start..span.start + r.end, text: repl.to_string(), transform: Transform::CollapsedCssWhitespace, target: target.clone() });
    }
}

fn consider(doc: &Doc, span: Range<usize>, target: Target, in_font: bool, unhinted: bool, hint: Option<&(Range<usize>, String)>, image: bool, options: &Options, edits: &mut Vec<Edit>, warnings: &mut Vec<Warning>) {
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
        if let Some(decoded) = data::decode(value).filter(|d| {
            let expected = match d.bytes.get(..4) {
                Some(b"wOF2") => "woff2",
                Some(b"wOFF") => "woff",
                Some(b"OTTO") => "opentype",
                Some(b"\x00\x01\x00\x00" | b"true" | b"typ1") => "truetype",
                _ => return false,
            };
            (unhinted || hint.is_some_and(|(_, actual)| actual.eq_ignore_ascii_case(expected))) &&
                (d.mime == data::Mime::FontWoff2 || matches!(d.mime, data::Mime::Other(_)))
        }) {
            if let Some(encoded) = fonts::exact_transcode(&decoded.bytes, tuning, cache) {
                if encoded.len() < decoded.bytes.len() {
                    let proven = adopt(decoded.bytes, encoded, &oracle::Font);
                    if proven.rejected() {
                        warnings.push(Warning::OracleRejected { transform: Transform::ReencodedFont, target });
                        return;
                    }
                    if let Some(at) = value.to_ascii_lowercase().find(";base64,") {
                        let prefix = if value[..at + 8].eq_ignore_ascii_case("data:font/woff2;base64,") { &value[..at + 8] } else if matches!(value[..at + 8].to_ascii_lowercase().as_str(), "data:font/ttf;base64," | "data:font/otf;base64," | "data:font/woff;base64," | "data:application/font-woff;base64," | "data:application/x-font-ttf;base64,") { "data:font/woff2;base64," } else { return };
                        let uri = format!("{}{}", prefix, STANDARD.encode(proven.into_inner()));
                        let (span, text) = if let Some((hint_span, _)) = hint.filter(|(_, kind)| !kind.eq_ignore_ascii_case("woff2")) {
                            let text = format!("{}{}woff2", uri, &doc.src()[span.end..hint_span.start]);
                            (span.start..hint_span.end, text)
                        } else { (span, uri) };
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
    if candidate.len() >= span.len() { return; }
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
                            consider(doc, range, Target::Resource(tag.label().to_string()), false, false, None, false, options, &mut edits, &mut warnings);
                        }
                    }
                }
            }
            if !matches!(attr.name, AttrName::Src | AttrName::DataSrc | AttrName::Href) { continue; }
            let Some(span) = attr.value_span.clone() else { continue };
            let target = Target::Resource(tag.label().to_string());
            let image = tag.element == Element::Img && !tag.in_svg && matches!(attr.name, AttrName::Src | AttrName::DataSrc);
            consider(doc, span, target, false, false, None, image, options, &mut edits, &mut warnings);
        }
        if matches!(tag.element, Element::Script | Element::Style) {
            if let Some(attr) = tag.attrs.iter().find(|a| {
                a.name == AttrName::Type && (
                    (tag.element == Element::Script && a.value.trim().eq_ignore_ascii_case("text/javascript")) ||
                    (tag.element == Element::Style && a.value.trim().eq_ignore_ascii_case("text/css"))
                )
            }) {
                let open_end = tag.body.as_ref().map_or(tag.span.end, |b| b.start);
                let open_tag = &doc.src()[tag.span.start..open_end];
                let ws_start = doc.src()[..attr.span.start].trim_end_matches(|c: char| c.is_ascii_whitespace()).len().max(tag.span.start);
                let edit_span = ws_start..attr.span.end;
                let rel_start = ws_start - tag.span.start;
                let rel_end = attr.span.end - tag.span.start;
                let candidate = format!("{}{}", &open_tag[..rel_start], &open_tag[rel_end..]);
                let proven = adopt(open_tag.to_string(), candidate, &oracle::DefaultAttr);
                let target = Target::Resource(tag.label().to_string());
                if proven.rejected() {
                    warnings.push(Warning::OracleRejected { transform: Transform::StrippedDefaultAttr, target });
                } else {
                    edits.push(Edit { span: edit_span, text: String::new(), transform: Transform::StrippedDefaultAttr, target });
                }
            }
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
                        let hint = font_hint(&doc.src()[body.clone()], end).map(|(range, name)| (body.start + range.start..body.start + range.end, name));
                        let span = body.start + span.start..body.start + span.end;
                        consider(doc, span, Target::Resource(tag.label().to_string()), in_font, unhinted, hint.as_ref(), false, options, &mut edits, &mut warnings);
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
    fn palette_opaque_transparency_entries_are_equivalent() {
        let original = include_bytes!("../../tests/data/palette-transparency.png");
        let candidates = crate::images::exact_candidates(original, crate::Tuning::BALANCED, None);
        assert_eq!(candidates.len(), 1);
        assert!(super::oracle::image(original, &candidates[0].1));
        let mut changed = original.to_vec();
        let at = changed.windows(4).position(|bytes| bytes == b"tRNS").unwrap();
        changed[at + 4] ^= 1;
        let mut crc = flate2::Crc::new();
        crc.update(&changed[at..at + 7]);
        changed[at + 7..at + 11].copy_from_slice(&crc.sum().to_be_bytes());
        assert!(!super::oracle::image(original, &changed));
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
    fn exact_keeps_base64_when_padding_would_grow() {
        let input = "<html><img src='data:image/png;base64,YQ'></html>";
        let output = optimize(input, Mode::Exact).unwrap();
        assert_eq!(output.html, input);
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
            let format = if mime == "font/woff" { "woff" } else { "truetype" };
            let hinted = format!("<html><style>@font-face{{font-family:x;src:url({uri}) format('{format}')}}</style></html>");
            let output = optimize(&hinted, Mode::Exact).unwrap();
            assert!(output.applied.iter().any(|step| step.transform == Transform::ReencodedFont));
            assert!(output.html.contains("format('woff2')"));
            assert_eq!(optimize(&output.html, Mode::Exact).unwrap().html, output.html);
            let wrong = format!("<html><style>@font-face{{font-family:x;src:url({uri}) format('not-a-font')}}</style></html>");
            assert_eq!(optimize(&wrong, Mode::Exact).unwrap().html, wrong);
            let descriptor = format!("<html><style>@font-face{{font-family:url({uri}) format('{format}')}}</style></html>");
            assert_eq!(optimize(&descriptor, Mode::Exact).unwrap().html, descriptor);
        }
    }

    #[test]
    fn exact_strips_default_type_attributes() {
        let input = "<html><script type=\"text/javascript\">console.log(1);</script><style type='text/css'>a{color:red}</style></html>";
        let out = optimize(input, Mode::Exact).unwrap();
        assert_eq!(out.html, "<html><script>console.log(1);</script><style>a{color:red}</style></html>");
        assert_eq!(out.applied.iter().filter(|s| s.transform == Transform::StrippedDefaultAttr).count(), 2);
        assert_eq!(optimize(&out.html, Mode::Exact).unwrap().html, out.html);
    }

    proptest::proptest! {
        #[test]
        fn default_attr_property_test(
            whitespace in " [ ]{1,4}",
            quote in "['\"]",
            extra_attr in "(id|class|data-x)",
            extra_val in "[a-z0-9_-]{1,8}"
        ) {
            let html = format!("<html><script{whitespace}{extra_attr}={quote}{extra_val}{quote}{whitespace}type={quote}text/javascript{quote}>1;</script></html>");
            let out = optimize(&html, Mode::Exact).unwrap();
            proptest::prop_assert!(!out.html.contains("type="));
            proptest::prop_assert!(out.applied.iter().any(|s| s.transform == Transform::StrippedDefaultAttr));
            proptest::prop_assert_eq!(optimize(&out.html, Mode::Exact).unwrap().html, out.html);
        }
    }

    #[test]
    fn exact_strips_zero_length_units() {
        let input = "<html><style>a{margin:0px;padding:0em;line-height:1;width:10px;height:0}</style></html>";
        let out = optimize(input, Mode::Exact).unwrap();
        assert_eq!(out.html, "<html><style>a{margin:0;padding:0;line-height:1;width:10px;height:0}</style></html>");
        assert_eq!(out.applied.iter().filter(|s| s.transform == Transform::StrippedZeroUnits).count(), 2);
        assert_eq!(optimize(&out.html, Mode::Exact).unwrap().html, out.html);
    }

    proptest::proptest! {
        #[test]
        fn zero_units_property_test(
            unit in "(px|em|rem|vw|vh|cm|mm|pt|in)"
        ) {
            let html = format!("<html><style>a{{margin:0{unit};}}</style></html>");
            let out = optimize(&html, Mode::Exact).unwrap();
            proptest::prop_assert_eq!(&out.html, "<html><style>a{margin:0;}</style></html>");
            proptest::prop_assert!(out.applied.iter().any(|s| s.transform == Transform::StrippedZeroUnits));
            proptest::prop_assert_eq!(optimize(&out.html, Mode::Exact).unwrap().html, out.html);
        }
    }

    #[test]
    fn exact_collapses_css_whitespace() {
        let input = "<html><style>  a , b  {  color: red ;  }  </style></html>";
        let out = optimize(input, Mode::Exact).unwrap();
        assert_eq!(out.html, "<html><style>a,b{color:red;}</style></html>");
        assert!(out.applied.iter().any(|s| s.transform == Transform::CollapsedCssWhitespace));
        assert_eq!(optimize(&out.html, Mode::Exact).unwrap().html, out.html);
    }

    proptest::proptest! {
        #[test]
        fn css_whitespace_property_test(
            ws1 in " [ ]{1,4}",
            ws2 in " [ ]{1,4}",
            ws3 in " [ ]{1,4}"
        ) {
            let html = format!("<html><style>a{ws1}{{{ws2}color:red;{ws3}}}</style></html>");
            let out = optimize(&html, Mode::Exact).unwrap();
            proptest::prop_assert_eq!(&out.html, "<html><style>a{color:red;}</style></html>");
            proptest::prop_assert!(out.applied.iter().any(|s| s.transform == Transform::CollapsedCssWhitespace));
            proptest::prop_assert_eq!(optimize(&out.html, Mode::Exact).unwrap().html, out.html);
        }
    }
}
