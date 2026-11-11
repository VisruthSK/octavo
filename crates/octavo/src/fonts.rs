use crate::{data, doc::Doc, words::Words};
use cssparser::{ParseError, Parser, ParserInput, Token};
use rayon::prelude::*;
use skrifa::{string::StringId, FontRef, MetadataProvider};
use std::{borrow::Cow, collections::HashSet, ops::Range};

const WESTERN_TEXT: [Range<u32>; 3] = [0x20..0x250, 0x2000..0x2070, 0x20A0..0x20D0];
const QUOTES: [char; 2] = ['"', '\''];
const PSEUDO_ELEMENTS: [&str; 4] = ["::before", "::after", ":before", ":after"];

struct Block {
    selector: Range<usize>,
    body: Range<usize>,
}

pub struct Context<'a> {
    css: String,
    blocks: Vec<Block>,
    icon_chars: HashSet<char>,
    text_chars: Option<HashSet<char>>,
    keep_notices: bool,
    words: &'a Words,
}

impl<'a> Context<'a> {
    pub fn new(all_css: &str, doc: &'a Doc, subset_text_fonts: bool, keep_notices: bool) -> Self {
        let mut icon_chars = document_chars(doc.src);
        icon_chars.extend(content_chars(all_css));
        let text_chars = subset_text_fonts.then(|| {
            let cased: Vec<char> = icon_chars
                .iter()
                .flat_map(|c| c.to_uppercase().chain(c.to_lowercase()))
                .collect();
            let western = WESTERN_TEXT
                .into_iter()
                .flatten()
                .filter_map(char::from_u32);
            icon_chars
                .iter()
                .copied()
                .chain(western)
                .chain(cased)
                .collect()
        });
        let css = all_css.to_lowercase();
        Context {
            blocks: leaf_blocks(&css),
            css,
            icon_chars,
            text_chars,
            keep_notices,
            words: doc.words(),
        }
    }

    fn usage(&self, family: &str) -> Option<bool> {
        let mut used = false;
        let mut pseudo_only = true;
        for block in &self.blocks {
            let (selector, body) = (
                &self.css[block.selector.clone()],
                &self.css[block.body.clone()],
            );
            if selector.starts_with("@font-face") || !body.contains(family) {
                continue;
            }
            let declared = declaration(body, "font-family").is_some_and(|v| v.contains(family));
            let pseudo = selector
                .split(',')
                .all(|s| PSEUDO_ELEMENTS.iter().any(|p| s.trim().ends_with(p)));
            used = true;
            pseudo_only &= declared && pseudo && body.matches(family).count() == 1;
        }
        used.then_some(pseudo_only)
    }
}

pub fn rewrite(css: &str, cx: &Context) -> String {
    let mut faces = Vec::new();
    let mut at = 0;
    while let Some(start) = css[at..].find("@font-face{").map(|off| at + off) {
        let Some(end) = css[start..].find('}').map(|e| start + e + 1) else {
            break;
        };
        faces.push(start..end);
        at = end;
    }
    let rewritten: Vec<(String, Option<String>)> = faces
        .par_iter()
        .map(|face| {
            font_face(&css[face.clone()], cx)
                .unwrap_or_else(|| (css[face.clone()].to_string(), None))
        })
        .collect();
    let mut out = String::with_capacity(css.len());
    let mut at = 0;
    let mut noticed: Vec<&str> = Vec::new();
    for (face, (text, notice)) in faces.iter().zip(&rewritten) {
        out.push_str(&css[at..face.start]);
        if let Some(notice) = notice.as_deref().filter(|n| !noticed.contains(n)) {
            noticed.push(notice);
            out.push_str("/*!");
            out.push_str(notice);
            out.push_str("*/");
        }
        out.push_str(text);
        at = face.end;
    }
    out.push_str(&css[at..]);
    out
}

fn font_face(block: &str, cx: &Context) -> Option<(String, Option<String>)> {
    let family = declaration(block, "font-family")?.trim_matches(QUOTES);
    if family.contains('\\') {
        return None;
    }
    let url_start = block.find("url(")?;
    let url_end = url_start + block[url_start..].find(')')?;
    let font = data::decode(block[url_start + 4..url_end].trim_matches(QUOTES))?;
    let in_markup = cx.words.mentions(family);
    let Some(pseudo_only) = cx
        .usage(&family.to_lowercase())
        .or(in_markup.then_some(false))
    else {
        return Some((String::new(), None));
    };
    let subset = if pseudo_only && !in_markup {
        Some(&cx.icon_chars)
    } else {
        cx.text_chars.as_ref()
    };
    let (woff2, notice) = transcode(&font.bytes, subset, cx.keep_notices)?;
    let format_end = block[url_end..].find("format(").map_or(url_end + 1, |f| {
        url_end + f + block[url_end + f..].find(')').map_or(0, |e| e + 1)
    });
    let uri = data::encode_base64("font/woff2", &woff2);
    let rule = format!(
        "{}url({uri})format(\"woff2\"){}",
        &block[..url_start],
        &block[format_end..]
    );
    Some((rule, notice))
}

fn declaration<'a>(block: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("{name}:");
    let start = block.find(&key)? + key.len();
    let end = block[start..]
        .find(';')
        .map_or(block.len() - 1, |e| start + e);
    Some(block[start..end].trim())
}

fn content_chars(css: &str) -> HashSet<char> {
    let mut chars = HashSet::new();
    string_literals(&mut Parser::new(&mut ParserInput::new(css)), &mut chars);
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

fn leaf_blocks(css: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut open: Vec<(usize, usize, bool)> = Vec::new();
    let mut selector_start = 0;
    let mut quote = None;
    for (i, c) in css.char_indices() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '{') => {
                if let Some(parent) = open.last_mut() {
                    parent.2 = true;
                }
                open.push((selector_start, i, false));
                selector_start = i + 1;
            }
            (None, '}') => {
                if let Some((start, brace, false)) = open.pop() {
                    blocks.push(Block {
                        selector: trimmed(css, start..brace),
                        body: brace + 1..i,
                    });
                }
                selector_start = i + 1;
            }
            (None, ';') if open.is_empty() => selector_start = i + 1,
            _ => {}
        }
    }
    blocks
}

fn trimmed(text: &str, range: Range<usize>) -> Range<usize> {
    let slice = &text[range.clone()];
    let start = range.start + slice.len() - slice.trim_start().len();
    start..start + slice.trim().len()
}

fn transcode(
    bytes: &[u8],
    chars: Option<&HashSet<char>>,
    keep_notice: bool,
) -> Option<(Vec<u8>, Option<String>)> {
    let sfnt: Cow<[u8]> = match bytes.get(..4)? {
        b"wOFF" => Cow::Owned(wuff::decompress_woff1(bytes).ok()?),
        b"wOF2" => Cow::Owned(wuff::decompress_woff2(bytes).ok()?),
        _ => Cow::Borrowed(bytes),
    };
    let notice = chars.and_then(|_| keep_notice.then(|| notice(&sfnt)).flatten());
    let sfnt = match chars {
        Some(chars) => Cow::Owned(fontcull::subset_font_data(&sfnt, chars, &[]).ok()?),
        None => sfnt,
    };
    Some((fontcull::compress_to_woff2(&sfnt).ok()?, notice))
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
