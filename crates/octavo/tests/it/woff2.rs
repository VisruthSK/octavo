use crate::common::{data_uri, page};
use base64::{Engine, engine::general_purpose::STANDARD};
use octavo::{Mode, Options, simplify};
use std::borrow::Cow;

const OVERSIZED_GLYF: usize = 131_071;
const GLYF_KNOWN_TAG: u32 = 10;
const LOCA_KNOWN_TAG: u32 = 11;

fn font_page_with(font: &[u8]) -> String {
    let css = format!(
        "@font-face{{font-family:Octavo Test;src:url({})}}body{{font-family:Octavo Test}}",
        data_uri("font/ttf", font)
    );
    page(&format!("<style>{css}</style>"), "<p>A</p>")
}

fn whole_font() -> Options {
    Options {
        subset_text_fonts: false,
        ..Options::default()
    }
}

fn woff2_from(html: &str) -> Vec<u8> {
    const MARKER: &str = "data:font/woff2;base64,";
    let start = html.find(MARKER).expect("a woff2 copy") + MARKER.len();
    let end = html[start..]
        .find(['"', ')', '\''])
        .map(|end| start + end)
        .expect("the end of the uri");
    STANDARD.decode(&html[start..end]).expect("valid base64")
}

fn read_base128(data: &[u8], at: &mut usize) -> u32 {
    let mut value = 0u32;
    for _ in 0..5 {
        let byte = *data.get(*at).expect("a base128 byte");
        *at += 1;
        value = (value << 7) | u32::from(byte & 0x7F);
        if byte & 0x80 == 0 {
            return value;
        }
    }
    panic!("an overlong base128 integer");
}

fn glyf_transform_version(woff2: &[u8]) -> u8 {
    assert_eq!(&woff2[..4], b"wOF2");
    let num_tables = u16::from_be_bytes(woff2[12..14].try_into().expect("numTables")) as usize;
    let mut at = 48usize;
    for _ in 0..num_tables {
        let flags = u32::from(woff2[at]);
        at += 1;
        let transform = u8::try_from((flags >> 6) & 0x03).expect("two transform bits");
        let tag = match flags & 0x3F {
            0x3F => {
                let tag: [u8; 4] = woff2[at..at + 4].try_into().expect("an explicit tag");
                at += 4;
                Some(tag)
            }
            GLYF_KNOWN_TAG => Some(*b"glyf"),
            LOCA_KNOWN_TAG => Some(*b"loca"),
            _ => None,
        };
        let _orig_length = read_base128(woff2, &mut at);
        let transformed = match tag {
            Some(tag) if tag == *b"glyf" || tag == *b"loca" => transform == 0,
            _ => transform != 0,
        };
        if transformed {
            let _transform_length = read_base128(woff2, &mut at);
        }
        if tag == Some(*b"glyf") {
            return transform;
        }
    }
    panic!("a glyf entry");
}

fn sfnt_with_glyf_beyond_the_short_loca_range() -> Vec<u8> {
    let font = include_bytes!("../data/octavo-test.ttf");
    let num_tables = u16::from_be_bytes(font[4..6].try_into().expect("numTables")) as usize;
    let mut tables: Vec<([u8; 4], Cow<'_, [u8]>)> = Vec::with_capacity(num_tables);
    for index in 0..num_tables {
        let record = 12 + 16 * index;
        let tag: [u8; 4] = font[record..record + 4].try_into().expect("a tag");
        let offset =
            u32::from_be_bytes(font[record + 8..record + 12].try_into().expect("an offset"))
                as usize;
        let length =
            u32::from_be_bytes(font[record + 12..record + 16].try_into().expect("a length"))
                as usize;
        tables.push((tag, Cow::Borrowed(&font[offset..offset + length])));
    }
    tables.sort_by_key(|(tag, _)| *tag);
    for (tag, data) in &mut tables {
        if tag == b"glyf" {
            let mut grown = data.to_vec();
            grown.resize(OVERSIZED_GLYF, 0);
            *data = Cow::Owned(grown);
        }
    }
    let mut output = Vec::with_capacity(OVERSIZED_GLYF + 4096);
    output.extend_from_slice(&0x00010000u32.to_be_bytes());
    output.extend_from_slice(&(tables.len() as u16).to_be_bytes());
    let mut entry_selector = 0u16;
    while (1u16 << (entry_selector + 1)) <= tables.len() as u16 {
        entry_selector += 1;
    }
    let search_range = (1u16 << entry_selector) * 16;
    let range_shift = tables.len() as u16 * 16 - search_range;
    output.extend_from_slice(&search_range.to_be_bytes());
    output.extend_from_slice(&entry_selector.to_be_bytes());
    output.extend_from_slice(&range_shift.to_be_bytes());
    let directory = output.len();
    output.resize(directory + 16 * tables.len(), 0);
    for (index, (tag, data)) in tables.iter().enumerate() {
        let padding = (4 - output.len() % 4) % 4;
        output.resize(output.len() + padding, 0);
        let offset = output.len() as u32;
        output.extend_from_slice(data);
        let record = directory + 16 * index;
        output[record..record + 4].copy_from_slice(tag);
        output[record + 8..record + 12].copy_from_slice(&offset.to_be_bytes());
        output[record + 12..record + 16].copy_from_slice(&(data.len() as u32).to_be_bytes());
    }
    output
}

#[test]
fn a_small_glyf_table_is_encoded_with_the_transform() {
    let font = include_bytes!("../data/octavo-test.ttf");
    let html = font_page_with(font);
    let out = simplify(&html, whole_font())
        .expect("supported")
        .pack(Mode::Safe)
        .html;
    let woff2 = woff2_from(&out);
    assert_eq!(glyf_transform_version(&woff2), 0);
}

#[test]
fn a_glyf_table_beyond_the_short_loca_range_is_stored_without_the_transform() {
    let font = sfnt_with_glyf_beyond_the_short_loca_range();
    let html = font_page_with(&font);
    let out = simplify(&html, whole_font())
        .expect("supported")
        .pack(Mode::Safe)
        .html;
    let woff2 = woff2_from(&out);
    assert_eq!(glyf_transform_version(&woff2), 3);
}
