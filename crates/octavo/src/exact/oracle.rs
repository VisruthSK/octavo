use data_url::DataUrl;
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

#[doc = "Checks decoded pixels, PNG depth and color type, and rendering metadata."]
pub fn image(input: &[u8], output: &[u8]) -> bool {
    let Some((depth, color, metadata)) = png_metadata(input) else { return false };
    let Ok(original) = image::load_from_memory_with_format(input, image::ImageFormat::Png) else { return false };
    if let Some((other_depth, other_color, other_metadata)) = png_metadata(output) {
        let Ok(candidate) = image::load_from_memory_with_format(output, image::ImageFormat::Png) else { return false };
        return depth == other_depth && color == other_color && metadata == other_metadata
            && original.to_rgba16() == candidate.to_rgba16();
    }
    if depth != 8 || !matches!(color, 2 | 6) || !metadata.is_empty()
        || output.get(..4) != Some(b"RIFF".as_slice()) || output.get(8..16) != Some(b"WEBPVP8L".as_slice()) {
        return false;
    }
    let Some(length) = output.get(16..20).and_then(|b| <[u8; 4]>::try_from(b).ok()).map(u32::from_le_bytes) else { return false };
    if (length as usize).checked_add(20 + (length as usize % 2)) != Some(output.len()) { return false; }
    let Some(riff_length) = output.get(4..8).and_then(|b| <[u8; 4]>::try_from(b).ok()).map(u32::from_le_bytes) else { return false };
    if (riff_length as usize).checked_add(8) != Some(output.len()) { return false; }
    let Some(candidate) = webp::Decoder::new(output).decode() else { return false };
    let original = original.to_rgba8();
    if original.width() != candidate.width() || original.height() != candidate.height() { return false; }
    if candidate.is_alpha() {
        original.as_raw().as_slice() == &*candidate
    } else {
        original.pixels().zip(candidate.chunks_exact(3)).all(|(a, b)| a.0 == [b[0], b[1], b[2], 255])
    }
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
                output.push("end".to_string());
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

#[doc = "Checks whether two stylesheets have the same conservative token stream."]
pub fn css(input: &str, output: &str) -> bool {
    if input.contains("--") || output.contains("--") {
        return input == output;
    }
    let tokenize = |s: &str| {
        let mut input = ParserInput::new(s);
        let mut parser = Parser::new(&mut input);
        let mut tokens = Vec::new();
        css_tokens(&mut parser, &mut tokens).ok()?;
        Some(tokens)
    };
    matches!((tokenize(input), tokenize(output)), (Some(a), Some(b)) if a == b && (input == output || !a.iter().any(|token| token.starts_with("custom:"))))
}

#[doc = "Checks that two data URLs have equal decoded payloads."]
pub fn base64(input: &str, output: &str) -> bool {
    let decode = |s: &str| DataUrl::process(s).ok()?.decode_to_vec().ok().map(|v| v.0);
    matches!((decode(input), decode(output)), (Some(a), Some(b)) if a == b)
}

fn sfnt(bytes: &[u8]) -> Option<Cow<'_, [u8]>> {
    match bytes.get(..4)? {
        b"wOF2" => Some(Cow::Owned(wuff::decompress_woff2(bytes).ok()?)),
        b"wOFF" => Some(Cow::Owned(wuff::decompress_woff1(bytes).ok()?)),
        _ => Some(Cow::Borrowed(bytes)),
    }
}

fn tables(bytes: &[u8]) -> Option<BTreeMap<[u8; 4], &[u8]>> {
    if !matches!(bytes.get(..4)?, b"\x00\x01\x00\x00" | b"OTTO" | b"true" | b"typ1") {
        return None;
    }
    let count = u16::from_be_bytes(bytes.get(4..6)?.try_into().ok()?) as usize;
    if count == 0 { return None; }
    let mut tables = BTreeMap::new();
    for i in 0..count {
        let entry = bytes.get(12 + i * 16..28 + i * 16)?;
        let tag = entry[0..4].try_into().ok()?;
        let offset = u32::from_be_bytes(entry[8..12].try_into().ok()?) as usize;
        let length = u32::from_be_bytes(entry[12..16].try_into().ok()?) as usize;
        let table = bytes.get(offset..offset.checked_add(length)?)?;
        if tables.insert(tag, table).is_some() {
            return None;
        }
    }
    Some(tables)
}

#[doc = "Checks that two font containers decode to the same sfnt tables."]
pub fn font(input: &[u8], output: &[u8]) -> bool {
    let Some(a) = sfnt(input) else { return false };
    let Some(b) = sfnt(output) else { return false };
    if a.get(..4) != b.get(..4) { return false; }
    matches!((tables(&a), tables(&b)), (Some(a), Some(b)) if a == b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_rejects_changed_and_invalid_payloads() {
        assert!(base64("data:;base64,YQ==", "data:;base64,YQ"));
        assert!(!base64("data:;base64,YQ==", "data:;base64,Yg=="));
        assert!(!base64("data:;base64,YQ==", "data:;base64,!"));
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
    }

    #[test]
    fn css_rejects_changed_selectors_values_and_spacing() {
        assert!(css("a{color:red}", "a{color:/*x*/red}"));
        assert!(!css("a{color:red}", "b{color:red}"));
        assert!(!css("a{color:red}", "a{color:blue}"));
        assert!(!css("a :hover{color:red}", "a:hover{color:red}"));
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
    }
}
