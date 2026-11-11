use crate::ascii::starts_with_ignore_case;
use std::ops::Range;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Element {
    Script,
    Style,
    Link,
    Img,
    Svg,
}

impl Element {
    const ALL: [Element; 5] = [
        Element::Script,
        Element::Style,
        Element::Link,
        Element::Img,
        Element::Svg,
    ];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Element::Script => "script",
            Element::Style => "style",
            Element::Link => "link",
            Element::Img => "img",
            Element::Svg => "svg",
        }
    }

    fn parse(written: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|element| element.name().eq_ignore_ascii_case(written))
    }

    fn raw_text_name(self) -> Option<&'static str> {
        match self {
            Element::Script => Some("script"),
            Element::Style => Some("style"),
            Element::Link | Element::Img | Element::Svg => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RawText {
    Textarea,
    Title,
    Noscript,
    Template,
    Iframe,
    Noembed,
    Noframes,
    Xmp,
}

impl RawText {
    const ALL: [RawText; 8] = [
        RawText::Textarea,
        RawText::Title,
        RawText::Noscript,
        RawText::Template,
        RawText::Iframe,
        RawText::Noembed,
        RawText::Noframes,
        RawText::Xmp,
    ];

    fn name(self) -> &'static str {
        match self {
            RawText::Textarea => "textarea",
            RawText::Title => "title",
            RawText::Noscript => "noscript",
            RawText::Template => "template",
            RawText::Iframe => "iframe",
            RawText::Noembed => "noembed",
            RawText::Noframes => "noframes",
            RawText::Xmp => "xmp",
        }
    }

    fn parse(written: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|raw| raw.name().eq_ignore_ascii_case(written))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum AttrName {
    Src,
    DataSrc,
    Href,
    Rel,
    Type,
    Id,
    Other(String),
}

impl AttrName {
    pub(crate) fn as_str(&self) -> &str {
        match self {
            AttrName::Src => "src",
            AttrName::DataSrc => "data-src",
            AttrName::Href => "href",
            AttrName::Rel => "rel",
            AttrName::Type => "type",
            AttrName::Id => "id",
            AttrName::Other(name) => name,
        }
    }

    fn parse(written: &str) -> Self {
        if written.eq_ignore_ascii_case("src") {
            AttrName::Src
        } else if written.eq_ignore_ascii_case("data-src") {
            AttrName::DataSrc
        } else if written.eq_ignore_ascii_case("href") {
            AttrName::Href
        } else if written.eq_ignore_ascii_case("rel") {
            AttrName::Rel
        } else if written.eq_ignore_ascii_case("type") {
            AttrName::Type
        } else if written.eq_ignore_ascii_case("id") {
            AttrName::Id
        } else {
            AttrName::Other(written.to_ascii_lowercase())
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Attribute {
    pub(crate) name: AttrName,
    pub(crate) value: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Rel<'a> {
    Stylesheet,
    Other(&'a str),
}

impl Rel<'_> {
    pub(crate) fn is_stylesheet(&self) -> bool {
        match self {
            Rel::Stylesheet => true,
            Rel::Other(value) => value
                .split_whitespace()
                .any(|word| word.eq_ignore_ascii_case("stylesheet")),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Tag {
    pub(crate) element: Element,
    pub(crate) span: Range<usize>,
    pub(crate) attrs: Vec<Attribute>,
    pub(crate) body: Option<Range<usize>>,
    pub(crate) in_svg: bool,
}

impl Tag {
    pub(crate) fn attr(&self, name: AttrName) -> Option<&str> {
        self.attrs
            .iter()
            .find(|attr| attr.name == name)
            .map(|attr| attr.value.as_str())
    }

    pub(crate) fn rel(&self) -> Option<Rel<'_>> {
        self.attr(AttrName::Rel).map(|value| {
            if value == "stylesheet" {
                Rel::Stylesheet
            } else {
                Rel::Other(value)
            }
        })
    }

    pub(crate) fn label(&self) -> &str {
        self.attr(AttrName::Id)
            .unwrap_or_else(|| self.element.name())
    }

    pub(crate) fn open_tag(
        &self,
        mut rewrite: impl FnMut(&AttrName, &str) -> Option<String>,
    ) -> String {
        let attrs: String = self
            .attrs
            .iter()
            .filter_map(|attr| {
                rewrite(&attr.name, &attr.value).map(|value| {
                    format!(
                        " {}=\"{}\"",
                        attr.name.as_str(),
                        value.replace('"', "&quot;")
                    )
                })
            })
            .collect();
        format!("<{}{attrs}>", self.element.name())
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Scan {
    pub(crate) tags: Vec<Tag>,
    pub(crate) found_html: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct Scanned {
    html: String,
    tags: Vec<Tag>,
}

impl Scanned {
    pub(crate) fn new(html: String) -> Self {
        let scan = scan(&html);
        Scanned {
            html,
            tags: scan.tags,
        }
    }

    pub(crate) fn html(&self) -> &str {
        &self.html
    }

    pub(crate) fn tags(&self) -> &[Tag] {
        &self.tags
    }
}

struct Svg {
    start: usize,
    attrs: Vec<Attribute>,
    body_start: usize,
}

fn bogus_comment(src: &str) -> bool {
    if src.starts_with("<!") {
        return !starts_with_ignore_case(src, "<!doctype");
    }
    if src.starts_with("<?") {
        return true;
    }
    if let Some(rest) = src.strip_prefix("</") {
        return !rest.starts_with(|c: char| c.is_ascii_alphabetic());
    }
    false
}

pub(crate) fn scan(src: &str) -> Scan {
    let mut tags = Vec::new();
    let mut found_html = false;
    let mut svg_depth = 0usize;
    let mut svg: Option<Svg> = None;
    let mut i = 0;
    while let Some(off) = src[i..].find('<') {
        i += off;
        if src[i..].starts_with("<!--") {
            let body = i + 4;
            i = if src[body..].starts_with('>') {
                body + 1
            } else if src[body..].starts_with("->") {
                body + 2
            } else {
                src[body..].find("-->").map_or(src.len(), |e| body + e + 3)
            };
            continue;
        }
        if bogus_comment(&src[i..]) {
            i = src[i..].find('>').map_or(src.len(), |e| i + e + 1);
            continue;
        }
        let closing = src[i + 1..].starts_with('/');
        let name_start = i + 1 + closing as usize;
        let name_len = src[name_start..]
            .bytes()
            .take_while(|b| b.is_ascii_alphanumeric() || *b == b'-')
            .count();
        if !src[name_start..].starts_with(|c: char| c.is_ascii_alphabetic()) {
            i += 1;
            continue;
        }
        let written = &src[name_start..name_start + name_len];
        if !closing && written.eq_ignore_ascii_case("html") {
            found_html = true;
        }
        if !closing && written.eq_ignore_ascii_case("plaintext") {
            break;
        }
        let element = Element::parse(written);
        let raw = RawText::parse(written);
        let (attrs, tag_end, self_closing) =
            parse_attrs(src, name_start + name_len, element.is_some());
        if element.is_none() && raw.is_none() {
            i = tag_end;
            continue;
        }
        if element == Some(Element::Svg) {
            if closing {
                svg_depth = svg_depth.saturating_sub(1);
                if let (0, Some(open)) = (svg_depth, svg.take()) {
                    tags.push(Tag {
                        element: Element::Svg,
                        span: open.start..tag_end,
                        attrs: open.attrs,
                        body: Some(open.body_start..i),
                        in_svg: false,
                    });
                }
            } else if !self_closing {
                if svg_depth == 0 {
                    svg = Some(Svg {
                        start: i,
                        attrs: attrs.clone(),
                        body_start: tag_end,
                    });
                }
                svg_depth += 1;
            }
        }
        if closing {
            i = tag_end;
            continue;
        }
        let mut span = i..tag_end;
        let mut body = None;
        let close_name = match element {
            Some(element) => element.raw_text_name(),
            None => raw.map(RawText::name),
        };
        if let Some(name) = close_name {
            let close = find_close(src, tag_end, name);
            body = Some(tag_end..close);
            span.end = src[close..].find('>').map_or(src.len(), |e| close + e + 1);
        }
        if let Some(element) = element {
            tags.push(Tag {
                element,
                span: span.clone(),
                attrs,
                body,
                in_svg: svg_depth > 0,
            });
        }
        i = span.end;
    }
    tags.sort_by_key(|t| t.span.start);
    Scan { tags, found_html }
}

fn find_close(src: &str, from: usize, name: &str) -> usize {
    let closes_here = |at: usize| {
        let after = at + 2 + name.len();
        src.get(at + 2..after)
            .is_some_and(|n| n.eq_ignore_ascii_case(name))
            && src[after..].starts_with(|c: char| c.is_ascii_whitespace() || c == '/' || c == '>')
    };
    src[from..]
        .match_indices("</")
        .map(|(i, _)| from + i)
        .find(|&at| closes_here(at))
        .unwrap_or(src.len())
}

fn parse_attrs(src: &str, mut i: usize, collect: bool) -> (Vec<Attribute>, usize, bool) {
    let b = src.as_bytes();
    let mut attrs = Vec::new();
    let mut self_closing = false;
    while i < b.len() {
        match b[i] {
            b'>' => return (attrs, i + 1, self_closing),
            b'/' => {
                self_closing = b.get(i + 1) == Some(&b'>');
                i += 1;
            }
            c if c.is_ascii_whitespace() => i += 1,
            _ => {
                let start = i;
                while i < b.len()
                    && !b[i].is_ascii_whitespace()
                    && !matches!(b[i], b'=' | b'>' | b'/')
                {
                    i += 1;
                }
                let name = &src[start..i];
                while i < b.len() && b[i].is_ascii_whitespace() {
                    i += 1;
                }
                let mut value = "";
                if b.get(i) == Some(&b'=') {
                    i += 1;
                    while i < b.len() && b[i].is_ascii_whitespace() {
                        i += 1;
                    }
                    if matches!(b.get(i), Some(b'"') | Some(b'\'')) {
                        let q = b[i];
                        let end = b[i + 1..]
                            .iter()
                            .position(|c| *c == q)
                            .map_or(b.len(), |p| i + 1 + p);
                        value = &src[i + 1..end];
                        i = end + 1;
                    } else {
                        let s = i;
                        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' {
                            i += 1;
                        }
                        value = &src[s..i];
                    }
                }
                if collect {
                    attrs.push(Attribute {
                        name: AttrName::parse(name),
                        value: value.to_string(),
                    });
                }
            }
        }
    }
    (attrs, b.len(), self_closing)
}
