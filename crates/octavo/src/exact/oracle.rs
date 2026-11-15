use base64::{engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig}, alphabet, Engine};
use cssparser::{ParseError, Parser, ParserInput, Token};
use std::{borrow::Cow, collections::BTreeMap};

#[doc = "Compares decoded data URL payloads."]
pub struct Base64;

impl super::Oracle<String> for Base64 {
    fn equivalent(&self, original: &String, candidate: &String) -> bool {
        base64(original, candidate)
    }
}

#[doc = "Compares decoded sfnt tables."]
pub struct Font;

impl super::Oracle<Vec<u8>> for Font {
    fn equivalent(&self, original: &Vec<u8>, candidate: &Vec<u8>) -> bool {
        font(original, candidate)
    }
}

#[doc = "Compares CSS token streams conservatively."]
pub struct Css;

impl super::Oracle<String> for Css {
    fn equivalent(&self, original: &String, candidate: &String) -> bool {
        css(original, candidate)
    }
}

fn number_key(raw: &str, integer: bool) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut at = usize::from(matches!(bytes.first(), Some(b'+' | b'-')));
    let sign = &raw[..at];
    let mut digits = String::new();
    while bytes.get(at).is_some_and(u8::is_ascii_digit) {
        digits.push(bytes[at] as char);
        at += 1;
    }
    let mut fraction = 0i64;
    if bytes.get(at) == Some(&b'.') && bytes.get(at + 1).is_some_and(u8::is_ascii_digit) {
        at += 1;
        while bytes.get(at).is_some_and(u8::is_ascii_digit) {
            digits.push(bytes[at] as char);
            fraction += 1;
            at += 1;
        }
    }
    if digits.is_empty() { return None; }
    let mut exponent = 0i64;
    if matches!(bytes.get(at), Some(b'e' | b'E')) {
        let mut end = at + 1;
        if matches!(bytes.get(end), Some(b'+' | b'-')) { end += 1; }
        let first = end;
        while bytes.get(end).is_some_and(u8::is_ascii_digit) { end += 1; }
        if end > first {
            exponent = raw[at + 1..end].parse().ok()?;
            at = end;
        }
    }
    let trimmed = digits.trim_start_matches('0').trim_end_matches('0');
    let scale = exponent.checked_sub(fraction)?.checked_add((digits.trim_start_matches('0').len() - trimmed.len()) as i64)?;
    Some(format!("number:{sign}:{trimmed}:{scale}:{integer}:{}", &raw[at..]))
}

#[doc = "Compares lossless image pixels and rendering metadata."]
pub struct Image;

impl super::Oracle<Vec<u8>> for Image {
    fn equivalent(&self, original: &Vec<u8>, candidate: &Vec<u8>) -> bool {
        image(original, candidate)
    }
}

fn png_metadata(bytes: &[u8]) -> Option<(u8, u8, Vec<([u8; 4], Vec<u8>)>)> {
    if bytes.get(..8)? != b"\x89PNG\r\n\x1a\n" { return None; }
    let mut pos = 8usize;
    let mut header = None;
    let mut metadata = Vec::new();
    while pos < bytes.len() {
        let length = u32::from_be_bytes(bytes.get(pos..pos.checked_add(4)?)?.try_into().ok()?) as usize;
        let tag: [u8; 4] = bytes.get(pos + 4..pos + 8)?.try_into().ok()?;
        let start = pos.checked_add(8)?;
        let end = start.checked_add(length)?;
        let data = bytes.get(start..end)?;
        pos = end.checked_add(4)?;
        bytes.get(end..pos)?;
        if &tag == b"IHDR" {
            if header.is_some() || data.len() != 13 { return None; }
            header = Some((data[8], data[9]));
        }
        if matches!(&tag, b"acTL" | b"fcTL" | b"fdAT") { return None; }
        if !matches!(&tag, b"IHDR" | b"IDAT" | b"IEND") {
            metadata.push((tag, data.to_vec()));
        }
        if &tag == b"IEND" {
            if pos != bytes.len() { return None; }
            let (depth, color) = header?;
            return Some((depth, color, metadata));
        }
    }
    None
}

fn webp_pixels(bytes: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    if bytes.get(..4)? != b"RIFF" || bytes.get(8..16)? != b"WEBPVP8L" { return None; }
    let length = u32::from_le_bytes(bytes.get(16..20)?.try_into().ok()?) as usize;
    if length.checked_add(20 + length % 2)? != bytes.len() { return None; }
    let riff_length = u32::from_le_bytes(bytes.get(4..8)?.try_into().ok()?) as usize;
    if riff_length.checked_add(8)? != bytes.len() { return None; }
    let decoded = webp::Decoder::new(bytes).decode()?;
    let rgba = if decoded.is_alpha() {
        decoded.to_vec()
    } else {
        decoded.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect()
    };
    Some((decoded.width(), decoded.height(), rgba))
}

pub(crate) fn webp_eligible(bytes: &[u8]) -> bool {
    matches!(png_metadata(bytes), Some((8, 2 | 6, metadata)) if metadata.is_empty())
}

#[doc = "Checks decoded pixels, PNG depth and color type, and rendering metadata."]
pub fn image(input: &[u8], output: &[u8]) -> bool {
    let png_a = png_metadata(input);
    let png_b = png_metadata(output);
    if let (Some(a), Some(b)) = (&png_a, &png_b) {
        let Ok(original) = image::load_from_memory_with_format(input, image::ImageFormat::Png) else { return false };
        let Ok(candidate) = image::load_from_memory_with_format(output, image::ImageFormat::Png) else { return false };
        return a == b && original.to_rgba16() == candidate.to_rgba16();
    }
    if let (Some(a), Some(b)) = (webp_pixels(input), webp_pixels(output)) { return a == b; }
    let (png, webp, metadata) = match (png_a, png_b) {
        (Some(meta), None) => (input, output, meta),
        (None, Some(meta)) => (output, input, meta),
        _ => return false,
    };
    if metadata.0 != 8 || !matches!(metadata.1, 2 | 6) || !metadata.2.is_empty() { return false; }
    let Ok(decoded) = image::load_from_memory_with_format(png, image::ImageFormat::Png) else { return false };
    let Some((width, height, pixels)) = webp_pixels(webp) else { return false };
    let rgba = decoded.to_rgba8();
    rgba.width() == width && rgba.height() == height && rgba.as_raw() == &pixels
        && rgba.pixels().all(|p| matches!(p[3], 0 | 255))
}

fn css_tokens<'i>(parser: &mut Parser<'i, '_>, output: &mut Vec<String>) -> Result<(), ParseError<'i, ()>> {
    loop {
        let start = parser.position();
        let Ok(token) = parser.next_including_whitespace_and_comments().cloned() else { break };
        if token.is_parse_error() {
            return Err(parser.new_custom_error(()));
        }
        match token {
            Token::Comment(_) => {}
            Token::WhiteSpace(_) => output.push("space".to_string()),
            Token::Ident(ref name) if name.starts_with("--") => output.push(format!("custom:{name}")),
            Token::Function(_) | Token::ParenthesisBlock | Token::SquareBracketBlock | Token::CurlyBracketBlock => {
                let close = match token {
                    Token::CurlyBracketBlock => '}',
                    Token::SquareBracketBlock => ']',
                    _ => ')',
                };
                output.push(format!("{token:?}"));
                let start = parser.position();
                parser.parse_nested_block(|inner| css_tokens(inner, output))?;
                if !parser.slice_from(start).ends_with(close) {
                    return Err(parser.new_custom_error(()));
                }
                output.push(format!("end:{close}"));
            }
            Token::Number { int_value, .. } | Token::Percentage { int_value, .. } | Token::Dimension { int_value, .. } => {
                let raw = parser.slice_from(start);
                output.push(number_key(raw, int_value.is_some()).unwrap_or_else(|| format!("raw:{raw}")));
            }
            _ => output.push(format!("{token:?}")),
        }
    }
    Ok(())
}

fn color_key(token: &str) -> Option<String> {
    let value = token.strip_prefix("IDHash(\"").or_else(|| token.strip_prefix("Hash(\""))?.strip_suffix("\")")?;
    if !value.bytes().all(|b| b.is_ascii_hexdigit()) { return None; }
    let mut color = match value.len() {
        3 | 4 => value.chars().flat_map(|c| [c.to_ascii_lowercase(), c.to_ascii_lowercase()]).collect::<String>(),
        6 | 8 => value.to_ascii_lowercase(),
        _ => return None,
    };
    if color.len() == 6 { color.push_str("ff"); }
    Some(format!("color:{color}"))
}

fn normalize_css_tokens(tokens: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        let previous = i.checked_sub(1).and_then(|n| tokens.get(n)).map(String::as_str);
        let next = tokens.get(i + 1).map(String::as_str);
        if token == "space" && (previous.is_none() || next.is_none() || matches!(previous, Some("CurlyBracketBlock" | "end:}" | "Semicolon" | "Comma"))
            || matches!(next, Some("CurlyBracketBlock" | "end:}" | "end:)" | "Semicolon" | "Comma"))) {
            continue;
        }
        let before: Vec<&str> = tokens[..i].iter().rev().map(String::as_str).filter(|t| *t != "space").take(3).collect();
        let after = tokens[i + 1..].iter().map(String::as_str).find(|t| *t != "space");
        if matches!(before.as_slice(), ["Colon", property, "CurlyBracketBlock" | "Semicolon"]
            if matches!(*property, "Ident(\"color\")" | "Ident(\"background-color\")" | "Ident(\"border-color\")" | "Ident(\"outline-color\")" | "Ident(\"fill\")" | "Ident(\"stroke\")"))
            && matches!(after, Some("Semicolon" | "end:}")) {
            if let Some(color) = color_key(token) { result.push(color); continue; }
        }
        result.push(token.clone());
    }
    result
}

fn reduce_css_rules(source: &str) -> Option<(String, usize)> {
    let mut input = ParserInput::new(source);
    let mut parser = Parser::new(&mut input);
    let mut start: Option<usize> = None;
    let mut at_rule = false;
    let mut removable_group = false;
    let mut previous: Option<&str> = None;
    let mut removals = Vec::new();
    loop {
        let position = parser.position();
        let Ok(token) = parser.next_including_whitespace_and_comments().cloned() else { break };
        if token.is_parse_error() { return None; }
        match token {
            Token::WhiteSpace(_) | Token::Comment(_) if start.is_none() => {}
            Token::CurlyBracketBlock => {
                let from = start.take()?;
                let block = parser.position();
                let empty = parser.parse_nested_block(|inner| {
                    let mut empty = true;
                    while let Ok(token) = inner.next_including_whitespace_and_comments().cloned() {
                        if !matches!(token, Token::WhiteSpace(_) | Token::Comment(_)) {
                            empty = false;
                        }
                    }
                    Ok::<_, ParseError<'_, ()>>(empty)
                }).ok()?;
                if !parser.slice_from(block).ends_with('}') { return None; }
                let end = parser.position().byte_index();
                let current = &source[from..end];
                if empty && (!at_rule || removable_group) || !at_rule && previous == Some(current) {
                    removals.push(from..end);
                } else {
                    previous = (!at_rule).then_some(current);
                }
                at_rule = false;
                removable_group = false;
            }
            Token::Semicolon => { start = None; at_rule = false; removable_group = false; previous = None; }
            Token::AtKeyword(name) if start.is_none() => {
                start = Some(position.byte_index());
                at_rule = true;
                removable_group = ["media", "supports", "container"].iter().any(|group| name.eq_ignore_ascii_case(group));
            }
            _ => { if start.is_none() { start = Some(position.byte_index()); } }
        }
    }
    let count = removals.len();
    let mut output = String::with_capacity(source.len());
    let mut from = 0;
    for span in removals {
        output.push_str(&source[from..span.start]);
        from = span.end;
    }
    output.push_str(&source[from..]);
    Some((output, count))
}

#[doc = "Checks whether two stylesheets have the same conservative token stream."]
pub fn css(input: &str, output: &str) -> bool {
    if input == output { return true; }
    if input.contains("--") || output.contains("--") {
        return false;
    }
    let tokenize = |s: &str| {
        let mut input = ParserInput::new(s);
        let mut parser = Parser::new(&mut input);
        let mut tokens = Vec::new();
        css_tokens(&mut parser, &mut tokens).ok()?;
        Some(normalize_css_tokens(&tokens))
    };
    if matches!((tokenize(input), tokenize(output)), (Some(a), Some(b)) if a == b && !a.iter().any(|token| token.starts_with("custom:"))) {
        return true;
    }
    let Some((reduced_input, _)) = reduce_css_rules(input) else { return false };
    let Some((reduced_output, output_reductions)) = reduce_css_rules(output) else { return false };
    if output_reductions != 0 { return false; }
    matches!((tokenize(&reduced_input), tokenize(&reduced_output)), (Some(a), Some(b)) if a == b && !a.iter().any(|token| token.starts_with("custom:")))
}

#[doc = "Checks that two data URLs have equal decoded payloads."]
pub fn base64(input: &str, output: &str) -> bool {
    let decode = |s: &str| {
        let (header, body) = s.split_once(',')?;
        if !header.get(..5)?.eq_ignore_ascii_case("data:") || !header.get(header.len().checked_sub(7)?..)?.eq_ignore_ascii_case(";base64") { return None; }
        let (payload, fragment) = body.split_once('#').map_or((body, None), |(body, fragment)| (body, Some(fragment)));
        let mut bytes: Vec<u8> = percent_encoding::percent_decode_str(payload)
            .filter(|b| !matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0c))
            .collect();
        if bytes.len() % 4 == 0 {
            if bytes.last() == Some(&b'=') { bytes.pop(); }
            if bytes.last() == Some(&b'=') { bytes.pop(); }
        }
        if bytes.len() % 4 == 1 || bytes.contains(&b'=') { return None; }
        let engine = GeneralPurpose::new(&alphabet::STANDARD, GeneralPurposeConfig::new()
            .with_decode_padding_mode(DecodePaddingMode::RequireNone)
            .with_decode_allow_trailing_bits(true));
        Some((header.to_string(), engine.decode(bytes).ok()?, fragment.map(str::to_owned)))
    };
    matches!((decode(input), decode(output)), (Some(a), Some(b)) if a == b)
}

fn sfnt(bytes: &[u8]) -> Option<Cow<'_, [u8]>> {
    match bytes.get(..4)? {
        b"wOF2" => Some(Cow::Owned(wuff::decompress_woff2(bytes).ok()?)),
        b"wOFF" => Some(Cow::Owned(wuff::decompress_woff1(bytes).ok()?)),
        _ => Some(Cow::Borrowed(bytes)),
    }
}

fn tables(bytes: &[u8]) -> Option<BTreeMap<[u8; 4], ([u8; 4], &[u8])>> {
    if !matches!(bytes.get(..4)?, b"\x00\x01\x00\x00" | b"OTTO" | b"true" | b"typ1") {
        return None;
    }
    let count = u16::from_be_bytes(bytes.get(4..6)?.try_into().ok()?) as usize;
    if count == 0 { return None; }
    let mut tables = BTreeMap::new();
    for i in 0..count {
        let entry = bytes.get(12 + i * 16..28 + i * 16)?;
        let tag = entry[0..4].try_into().ok()?;
        let checksum = entry[4..8].try_into().ok()?;
        let offset = u32::from_be_bytes(entry[8..12].try_into().ok()?) as usize;
        let length = u32::from_be_bytes(entry[12..16].try_into().ok()?) as usize;
        let table = bytes.get(offset..offset.checked_add(length)?)?;
        if tables.insert(tag, (checksum, table)).is_some() {
            return None;
        }
    }
    Some(tables)
}

#[doc = "Checks that two font containers decode to the same sfnt tables."]
pub fn font(input: &[u8], output: &[u8]) -> bool {
    let Some(a) = sfnt(input) else { return false };
    let Some(b) = sfnt(output) else { return false };
    if a.get(..12) != b.get(..12) { return false; }
    let (Some(a), Some(b)) = (tables(&a), tables(&b)) else { return false };
    if a.len() != b.len() { return false; }
    a.iter().all(|(tag, (checksum, table))| {
        let Some((other_checksum, other)) = b.get(tag) else { return false };
        if tag != b"head" { return checksum == other_checksum && table == other; }
        if table.len() != other.len() || table.len() < 18 { return false; }
        let flags = u16::from_be_bytes([table[16], table[17]]);
        let other_flags = u16::from_be_bytes([other[16], other[17]]);
        let adjusted_checksum = u32::from_be_bytes(*checksum).wrapping_sub(u32::from(flags & 0x0800) << 16);
        let other_adjusted_checksum = u32::from_be_bytes(*other_checksum).wrapping_sub(u32::from(other_flags & 0x0800) << 16);
        adjusted_checksum == other_adjusted_checksum && (flags ^ other_flags) & !0x0800 == 0
            && table[..8] == other[..8] && table[12..16] == other[12..16] && table[18..] == other[18..]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_rejects_changed_and_invalid_payloads() {
        assert!(base64("data:;base64,YQ==", "data:;base64,YQ"));
        assert!(!base64("data:;base64,YQ==", "data:;base64,Yg=="));
        assert!(!base64("data:;base64,YQ==", "data:;base64,!"));
        assert!(base64("data:;base64,Y%51%3d%3d", "data:;base64,YQ"));
        assert!(!base64("data:;base64,YQ==#one", "data:;base64,YQ==#two"));
        assert!(!base64("data:text/plain;base64,YQ==", "data:text/html;base64,YQ=="));
        assert!(!base64("data:;base64,YQ===", "data:;base64,YQ=="));
        let original = "data:;base64,YQ==".to_string();
        let proven = super::super::adopt(original.clone(), "data:;base64,Yg==".to_string(), &Base64);
        assert!(proven.rejected());
        assert_eq!(proven.into_inner(), original);
    }

    #[test]
    fn font_rejects_changed_tables() {
        let mut a = vec![0; 32];
        a[..4].copy_from_slice(b"OTTO");
        a[5] = 1;
        a[12..16].copy_from_slice(b"test");
        a[23] = 28;
        a[27] = 4;
        a[28..].copy_from_slice(b"abcd");
        let mut b = a.clone();
        assert!(font(&a, &b));
        b[31] = b'e';
        assert!(!font(&a, &b));
        assert!(!font(&a, &b[..30]));
        let mut moved = vec![0; 40];
        moved[..28].copy_from_slice(&a[..28]);
        moved[23] = 36;
        moved[36..40].copy_from_slice(b"abcd");
        assert!(font(&a, &moved));
        moved[16] = 1;
        assert!(!font(&a, &moved));
        moved[16] = 0;
        moved[0] = 1;
        assert!(!font(&a, &moved));
    }

    #[test]
    fn font_compares_woff2_decoded_tables() {
        let source = include_bytes!("../../tests/data/octavo-test.ttf");
        let encoded = ttf2woff2::encode_with_options(source, ttf2woff2::EncodeOptions {
            quality: ttf2woff2::BrotliQuality::from(5),
            transform_glyf_loca: false,
            threads: None,
        }).unwrap();
        let decoded = sfnt(&encoded).unwrap();
        assert!(font(source, &encoded));
        assert!(font(&decoded, &encoded));
        let mut changed = decoded.to_vec();
        let (offset, _) = {
            let entry = &changed[12..28];
            (u32::from_be_bytes(entry[8..12].try_into().unwrap()) as usize,
             u32::from_be_bytes(entry[12..16].try_into().unwrap()) as usize)
        };
        changed[offset] ^= 1;
        assert!(!font(&changed, &encoded));
    }

    #[test]
    fn font_head_allows_only_checksum_adjustment_and_flag_eleven() {
        let source = include_bytes!("../../tests/data/octavo-test.ttf");
        let count = u16::from_be_bytes(source[4..6].try_into().unwrap()) as usize;
        let entry = (0..count).map(|i| 12 + 16 * i).find(|i| &source[*i..*i + 4] == b"head").unwrap();
        let offset = u32::from_be_bytes(source[entry + 8..entry + 12].try_into().unwrap()) as usize;
        let mut candidate = source.to_vec();
        candidate[offset + 8] ^= 1;
        assert!(font(source, &candidate));
        candidate[offset + 16] ^= 8;
        let checksum = u32::from_be_bytes(source[entry + 4..entry + 8].try_into().unwrap());
        let adjusted = if source[offset + 16] & 8 == 0 { checksum.wrapping_add(0x08000000) } else { checksum.wrapping_sub(0x08000000) };
        candidate[entry + 4..entry + 8].copy_from_slice(&adjusted.to_be_bytes());
        assert!(font(source, &candidate));
        candidate[offset + 17] ^= 1;
        assert!(!font(source, &candidate));
        candidate[offset + 17] ^= 1;
        candidate[offset + 20] ^= 1;
        assert!(!font(source, &candidate));
    }

    #[test]
    fn css_rejects_changed_selectors_values_and_spacing() {
        assert!(css("a{color:red}", "a{color:/*x*/red}"));
        assert!(!css("a{color:red}", "b{color:red}"));
        assert!(!css("a{color:red}", "a{color:blue}"));
        assert!(!css("a :hover{color:red}", "a:hover{color:red}"));
        assert!(css("a, b { color:red; }", "a,b{color:red;}"));
        assert!(!css("a + b{color:red}", "a+b{color:red}"));
        assert!(css("a{color:#aabbcc}", "a{color:#abc}"));
        assert!(!css("a{color:#aabbcc}", "a{color:#abd}"));
        assert!(!css("#aabbcc{color:red}", "#abc{color:red}"));
        assert!(css("a{}b{color:red}", "b{color:red}"));
        assert!(css("a{} b{color:red}", "b{color:red}"));
        assert!(css("a{color:red}a{color:red}", "a{color:red}"));
        assert!(css("@media screen{}", ""));
        assert!(!css("@layer x{}", ""));
        assert!(!css("a{color:red}", "a{}a{color:red}"));
        assert!(!css("a{color:red}b{color:blue}a{color:red}", "a{color:red}b{color:blue}"));
        assert!(!css("a{--x: a b}", "a{--x: ab}"));
        assert!(css("a{opacity:0.5}", "a{opacity:.5}"));
        assert!(!css("a{opacity:0.50000001}", "a{opacity:0.5}"));
        assert!(!css("a:nth-child(+1){color:red}", "a:nth-child(1){color:red}"));
    }

    #[test]
    fn image_rejects_changed_transparent_pixel() {
        let encode = |pixel: [u8; 4]| {
            let image = image::RgbaImage::from_raw(1, 1, pixel.to_vec()).unwrap();
            let mut bytes = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(image).write_to(&mut bytes, image::ImageFormat::Png).unwrap();
            bytes.into_inner()
        };
        let a = encode([1, 2, 3, 0]);
        let b = encode([2, 2, 3, 0]);
        assert!(image(&a, &a));
        assert!(!image(&a, &b));
        assert!(!image(&a, b"bad"));
        let mut gamma = a.clone();
        let at = 33;
        gamma.splice(at..at, [0, 0, 0, 4, b'g', b'A', b'M', b'A', 0, 0, 0xb1, 0x8f, 0x0b, 0xfc, 0x61, 0x05]);
        assert!(image(&gamma, &gamma));
        assert!(!image(&a, &gamma));
        let opaque = [10, 20, 30, 255];
        let changed = [10, 20, 31, 255];
        let webp_a = webp::Encoder::from_rgba(&opaque, 1, 1).encode_lossless();
        let webp_b = webp::Encoder::from_rgba(&changed, 1, 1).encode_lossless();
        let png = encode(opaque);
        assert!(image(&png, &webp_a));
        assert!(image(&webp_a, &png));
        assert!(image(&webp_a, &webp_a));
        assert!(!image(&webp_a, &webp_b));
    }
}
