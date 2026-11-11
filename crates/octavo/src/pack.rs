use crate::{
    ascii::contains_ignore_case,
    data::{self, Mime},
    html::{AttrName, Attribute, Element, Rel, Scanned, Tag},
    js::{self, ScriptKind},
    Licenses, Mode, Tuning,
};
use base91::{
    codemap::{xml_friendly::ENCODE_MAP, XmlFriendly},
    iter::EncodeGenericIterator,
};
use brotli::enc::BrotliEncoderParams;
use indexmap::IndexSet;
use libdeflater::{CompressionLvl, Compressor};
use std::{borrow::Cow, collections::BTreeMap, num::NonZeroUsize, ops::Range, sync::OnceLock};

const MIN_BLOB: usize = 256;
const MIN_FRAGMENT: usize = 1024;
const PROBE_QUALITY: u8 = 5;
const DEFAULT_QUALITY: u8 = 9;
const QUALITY_9_TYPICAL_RATIO_TO_PROBE: f64 = 0.98;
const SMALLEST_WORTHWHILE_BROTLI_GAIN: f64 = 0.01;
const LOADER: &str = include_str!("../loader/loader.js");
const BROTLI_DECODER: &str = include_str!("../loader/brotli.js");

#[derive(Clone, Copy)]
#[repr(u8)]
enum Kind {
    Script = 0,
    Style = 1,
    Link = 2,
    Fragment = 3,
}

struct Candidate<'a> {
    kind: Kind,
    text: Cow<'a, str>,
    attrs: Vec<Attribute>,
}

struct Site {
    span: Range<usize>,
    call: String,
}

pub(crate) struct Packed {
    pub(crate) html: String,
    pub(crate) blobs: NonZeroUsize,
}

pub(crate) fn run(scanned: &Scanned, mode: Mode, tuning: Tuning) -> Option<Packed> {
    let src = scanned.html();
    if mode == Mode::Safe || contains_ignore_case(src, "content-security-policy") {
        return None;
    }
    let mut blobs = Blobs::default();
    let mut sites: Vec<Site> = Vec::new();
    for tag in scanned.tags().iter().filter(|t| !t.in_svg) {
        if let Some(c) = candidate(src, tag, mode) {
            sites.push(Site {
                span: tag.span.clone(),
                call: call_site(blobs.add(c.text), c.kind, &c.attrs),
            });
        }
    }
    if sites.is_empty() {
        return None;
    }
    let loader = blobs.loader(tuning);
    let mut out = String::with_capacity(src.len());
    let mut at = 0;
    for (n, site) in sites.iter().enumerate() {
        out.push_str(&src[at..site.span.start]);
        if n == 0 {
            out.push_str("<script>");
            out.push_str(&loader);
            out.push_str("</script>");
        }
        out.push_str(&site.call);
        at = site.span.end;
    }
    out.push_str(&src[at..]);
    Some(Packed {
        html: out,
        blobs: NonZeroUsize::new(blobs.texts.len())?,
    })
}

fn candidate<'a>(src: &'a str, tag: &Tag, mode: Mode) -> Option<Candidate<'a>> {
    let styles = mode == Mode::Packed;
    let (kind, text) = match tag.element {
        Element::Script
            if tag.attr(AttrName::Src).is_none()
                && matches!(ScriptKind::of(tag), ScriptKind::Classic | ScriptKind::Data) =>
        {
            (Kind::Script, Cow::Borrowed(&src[tag.body.clone()?]))
        }
        Element::Svg | Element::Img if styles => {
            (Kind::Fragment, Cow::Borrowed(&src[tag.span.clone()]))
        }
        Element::Style if styles => (Kind::Style, Cow::Borrowed(&src[tag.body.clone()?])),
        Element::Link if styles && matches!(tag.rel(), Some(Rel::Stylesheet)) => (
            Kind::Link,
            Cow::Owned(String::from_utf8(data::decode(tag.attr(AttrName::Href)?)?.bytes).ok()?),
        ),
        Element::Script | Element::Style | Element::Link | Element::Svg | Element::Img => {
            return None
        }
    };
    let minimum = if matches!(kind, Kind::Fragment) {
        MIN_FRAGMENT
    } else {
        MIN_BLOB
    };
    if text.len() < minimum
        || tag.attrs.iter().any(|attr| attr.value.contains('&'))
        || !restorable(kind, &text)
    {
        return None;
    }
    let redundant = |name: &AttrName, value: &str| match kind {
        Kind::Script => *name == AttrName::Type && ScriptKind::parse(value) == ScriptKind::Classic,
        Kind::Style => *name == AttrName::Type && Mime::parse(value) == Mime::TextCss,
        Kind::Link => *name == AttrName::Href,
        Kind::Fragment => true,
    };
    let attrs = tag
        .attrs
        .iter()
        .filter(|attr| !redundant(&attr.name, &attr.value))
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

fn call_site(index: usize, kind: Kind, attrs: &[Attribute]) -> String {
    let attrs: BTreeMap<&str, &str> = attrs
        .iter()
        .map(|attr| (attr.name.as_str(), attr.value.as_str()))
        .collect();
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

    fn loader(&self, tuning: Tuning) -> String {
        let all: String = self.texts.iter().map(|text| text.as_ref()).collect();
        let sizes: Vec<String> = self
            .texts
            .iter()
            .map(|t| t.encode_utf16().count().to_string())
            .collect();
        let bytes = all.as_bytes();
        let (deflated, brotlied) = match tuning.brotli_quality {
            Some(quality) => {
                let (deflated, brotlied) =
                    rayon::join(|| deflate(bytes), || brotli(bytes, quality.min(11)));
                (deflated, Some(brotlied))
            }
            None => {
                let (deflated, probe) =
                    rayon::join(|| deflate(bytes), || brotli(bytes, PROBE_QUALITY));
                let best_case = (probe.len() as f64 * QUALITY_9_TYPICAL_RATIO_TO_PROBE) as usize
                    + brotli_decoder_deflated().len();
                let worthwhile = deflated.len() as f64 * (1.0 - SMALLEST_WORTHWHILE_BROTLI_GAIN);
                let brotlied =
                    ((best_case as f64) < worthwhile).then(|| brotli(bytes, DEFAULT_QUALITY));
                (deflated, brotlied)
            }
        };
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

fn brotli_decoder_deflated() -> &'static [u8] {
    static DEFLATED: OnceLock<Vec<u8>> = OnceLock::new();
    DEFLATED.get_or_init(|| deflate(BROTLI_DECODER.as_bytes()))
}

fn brotli_decoder() -> &'static str {
    static EXPRESSION: OnceLock<String> = OnceLock::new();
    EXPRESSION.get_or_init(|| {
        format!(
            "new Function(new TextDecoder().decode(inflate(bytes({}), {})) + \";return BR.default\")()",
            literal(brotli_decoder_deflated()),
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
    js::minify(&source, ScriptKind::Classic, Licenses::Strip)
        .expect("loader template is valid JavaScript")
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

fn brotli(data: &[u8], quality: u8) -> Vec<u8> {
    let params = BrotliEncoderParams {
        quality: i32::from(quality),
        lgwin: 24,
        size_hint: data.len(),
        ..Default::default()
    };
    let mut out = Vec::new();
    brotli::BrotliCompress(&mut &data[..], &mut out, &params).expect("in-memory compression");
    out
}
