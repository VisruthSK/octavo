use crate::{
    ascii::contains_ignore_case,
    data,
    doc::Doc,
    html::Tag,
    js::{self, ScriptKind},
};
use base91::{
    codemap::{xml_friendly::ENCODE_MAP, XmlFriendly},
    iter::EncodeGenericIterator,
};
use brotli::enc::BrotliEncoderParams;
use indexmap::IndexSet;
use libdeflater::{CompressionLvl, Compressor};
use std::{borrow::Cow, collections::BTreeMap, ops::Range, sync::OnceLock};

const MIN_BLOB: usize = 256;
const MIN_FRAGMENT: usize = 1024;
const BROTLI_THRESHOLD: usize = 1 << 17;
const THOROUGH_LIMIT: usize = 3 << 19;
const LOADER: &str = include_str!("../../../loader/loader.js");
const BROTLI_DECODER: &str = include_str!("../../../loader/brotli.js");

#[derive(Clone, Copy)]
enum Kind {
    Script,
    Style,
    Link,
    Fragment,
}

struct Candidate<'a> {
    kind: Kind,
    text: Cow<'a, str>,
    attrs: Vec<(String, String)>,
}

pub struct Packed {
    pub html: String,
    pub blobs: usize,
}

pub fn run(doc: &Doc, styles: bool) -> Option<Packed> {
    if contains_ignore_case(doc.src, "content-security-policy") {
        return None;
    }
    let mut blobs = Blobs::default();
    let mut sites: Vec<(Range<usize>, String)> = Vec::new();
    for tag in doc.tags.iter().filter(|t| !t.in_svg) {
        if let Some(c) = candidate(doc.src, tag, styles) {
            sites.push((
                tag.span.clone(),
                call_site(blobs.add(c.text), c.kind, &c.attrs),
            ));
        }
    }
    if sites.is_empty() {
        return None;
    }
    let loader = blobs.loader();
    let mut out = String::with_capacity(doc.src.len());
    let mut at = 0;
    for (n, (span, call)) in sites.iter().enumerate() {
        out.push_str(&doc.src[at..span.start]);
        if n == 0 {
            out.push_str("<script>");
            out.push_str(&loader);
            out.push_str("</script>");
        }
        out.push_str(call);
        at = span.end;
    }
    out.push_str(&doc.src[at..]);
    Some(Packed {
        html: out,
        blobs: blobs.texts.len(),
    })
}

fn candidate<'a>(src: &'a str, tag: &Tag, styles: bool) -> Option<Candidate<'a>> {
    let (kind, text) = match tag.name {
        "script"
            if tag.attr("src").is_none()
                && matches!(ScriptKind::of(tag), ScriptKind::Classic | ScriptKind::Data) =>
        {
            (Kind::Script, Cow::Borrowed(&src[tag.body.clone()?]))
        }
        "svg" | "img" if styles => (Kind::Fragment, Cow::Borrowed(&src[tag.span.clone()])),
        "style" if styles => (Kind::Style, Cow::Borrowed(&src[tag.body.clone()?])),
        "link" if styles && tag.attr("rel") == Some("stylesheet") => (
            Kind::Link,
            Cow::Owned(String::from_utf8(data::decode(tag.attr("href")?)?.bytes).ok()?),
        ),
        _ => return None,
    };
    let minimum = if matches!(kind, Kind::Fragment) {
        MIN_FRAGMENT
    } else {
        MIN_BLOB
    };
    if text.len() < minimum
        || tag.attrs.iter().any(|(_, v)| v.contains('&'))
        || !restorable(kind, &text)
    {
        return None;
    }
    let redundant = |name: &str, value: &str| match kind {
        Kind::Script => name == "type" && js::is_classic_type(value),
        Kind::Style => name == "type" && value == "text/css",
        Kind::Link => name == "href",
        Kind::Fragment => true,
    };
    let attrs = tag
        .attrs
        .iter()
        .filter(|(k, v)| !redundant(k, v))
        .cloned()
        .collect();
    Some(Candidate { kind, text, attrs })
}

fn restorable(kind: Kind, text: &str) -> bool {
    match kind {
        Kind::Script => {
            !(contains_ignore_case(text, "<!--") && contains_ignore_case(text, "<script"))
        }
        Kind::Fragment => !contains_ignore_case(text, "<script") && !has_event_handler(text),
        Kind::Style | Kind::Link => true,
    }
}

fn has_event_handler(text: &str) -> bool {
    text.match_indices(' ').any(|(at, _)| {
        let rest = &text.as_bytes()[at + 1..];
        rest.get(..2)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"on"))
            && rest[2..].iter().find(|byte| !byte.is_ascii_alphabetic()) == Some(&b'=')
    })
}

fn call_site(index: usize, kind: Kind, attrs: &[(String, String)]) -> String {
    let attrs: BTreeMap<_, _> = attrs.iter().cloned().collect();
    let extra = match (kind, attrs.is_empty()) {
        (Kind::Script, true) => String::new(),
        (_, true) => format!(",{}", kind as u8),
        (_, false) => format!(
            ",{},{}",
            kind as u8,
            serde_json::to_string(&attrs)
                .expect("string maps serialize")
                .replace('<', "\\u003c")
        ),
    };
    format!("<script>$o({index}{extra})</script>")
}

#[derive(Default)]
struct Blobs<'a> {
    texts: IndexSet<Cow<'a, str>>,
}

impl<'a> Blobs<'a> {
    fn add(&mut self, text: Cow<'a, str>) -> usize {
        self.texts.insert_full(text).0
    }

    fn loader(&self) -> String {
        let all: String = self.texts.iter().map(|text| text.as_ref()).collect();
        let sizes: Vec<String> = self
            .texts
            .iter()
            .map(|t| t.encode_utf16().count().to_string())
            .collect();
        let (deflated, brotlied) = rayon::join(
            || deflate(all.as_bytes()),
            || (all.len() >= BROTLI_THRESHOLD).then(|| brotli(all.as_bytes())),
        );
        let plain = assemble(
            &format!("inflate(bytes({}), {})", literal(&deflated), all.len()),
            &sizes,
        );
        let Some(brotlied) = brotlied else {
            return plain;
        };
        let compact = assemble(
            &format!("{}(bytes({}))", brotli_decoder(), literal(&brotlied)),
            &sizes,
        );
        if compact.len() < plain.len() {
            compact
        } else {
            plain
        }
    }
}

fn brotli_decoder() -> &'static str {
    static EXPRESSION: OnceLock<String> = OnceLock::new();
    EXPRESSION.get_or_init(|| {
        format!(
            "new Function(new TextDecoder().decode(inflate(bytes({}), {})) + \";return BR.default\")()",
            literal(&deflate(BROTLI_DECODER.as_bytes())),
            BROTLI_DECODER.len()
        )
    })
}

fn assemble(unpack: &str, sizes: &[String]) -> String {
    let alphabet = String::from_utf8(ENCODE_MAP.to_vec()).expect("ascii alphabet");
    let source = LOADER
        .replace("SIZES", &format!("[{}]", sizes.join(",")))
        .replace(
            "ALPHABET",
            &serde_json::to_string(&alphabet).expect("strings serialize"),
        )
        .replace("UNPACK", unpack);
    js::minify(&source, false, false).expect("loader template is valid JavaScript")
}

fn literal(data: &[u8]) -> String {
    let text: String = EncodeGenericIterator::<XmlFriendly, _>::new(data.iter().copied())
        .as_char_iter()
        .collect();
    serde_json::to_string(&text).expect("strings serialize")
}

fn deflate(data: &[u8]) -> Vec<u8> {
    let mut compressor = Compressor::new(CompressionLvl::best());
    let mut out = vec![0; compressor.deflate_compress_bound(data.len())];
    let written = compressor
        .deflate_compress(data, &mut out)
        .expect("buffer sized to the compress bound");
    out.truncate(written);
    out
}

fn brotli(data: &[u8]) -> Vec<u8> {
    let params = BrotliEncoderParams {
        quality: if data.len() <= THOROUGH_LIMIT { 11 } else { 9 },
        lgwin: 24,
        size_hint: data.len(),
        ..Default::default()
    };
    let mut out = Vec::new();
    brotli::BrotliCompress(&mut &data[..], &mut out, &params).expect("in-memory compression");
    out
}
