use std::ops::Range;

pub struct Tag {
    pub name: &'static str,
    pub span: Range<usize>,
    pub attrs: Vec<(String, String)>,
    pub body: Option<Range<usize>>,
    pub in_svg: bool,
}

impl Tag {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    pub fn open_tag(&self, mut rewrite: impl FnMut(&str, &str) -> Option<String>) -> String {
        let attrs: String = self
            .attrs
            .iter()
            .filter_map(|(name, value)| {
                rewrite(name, value).map(|v| format!(" {name}=\"{}\"", v.replace('"', "&quot;")))
            })
            .collect();
        format!("<{}{attrs}>", self.name)
    }
}

const RAW_TEXT: [&str; 10] = [
    "script", "style", "textarea", "title", "noscript", "template", "iframe", "noembed",
    "noframes", "xmp",
];
const TRACKED: [&str; 4] = ["script", "style", "link", "img"];
const ELEMENTS: [&str; 13] = [
    "script", "style", "link", "img", "svg", "textarea", "title", "noscript", "template", "iframe",
    "noembed", "noframes", "xmp",
];

struct Svg {
    start: usize,
    attrs: Vec<(String, String)>,
    body_start: usize,
}

pub fn scan(src: &str) -> Vec<Tag> {
    let mut tags = Vec::new();
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
        let known = ELEMENTS
            .iter()
            .copied()
            .find(|element| element.eq_ignore_ascii_case(written));
        let (attrs, tag_end, self_closing) =
            parse_attrs(src, name_start + name_len, known.is_some());
        let Some(name) = known else {
            i = tag_end;
            continue;
        };
        if name == "svg" {
            if closing {
                svg_depth = svg_depth.saturating_sub(1);
                if let (0, Some(open)) = (svg_depth, svg.take()) {
                    tags.push(Tag {
                        name,
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
        if RAW_TEXT.contains(&name) {
            let close = find_close(src, tag_end, name);
            body = Some(tag_end..close);
            span.end = src[close..].find('>').map_or(src.len(), |e| close + e + 1);
        }
        if TRACKED.contains(&name) {
            tags.push(Tag {
                name,
                span: span.clone(),
                attrs,
                body,
                in_svg: svg_depth > 0,
            });
        }
        i = span.end;
    }
    tags.sort_by_key(|t| t.span.start);
    tags
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

fn parse_attrs(src: &str, mut i: usize, collect: bool) -> (Vec<(String, String)>, usize, bool) {
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
                    attrs.push((name.to_ascii_lowercase(), value.to_string()));
                }
            }
        }
    }
    (attrs, b.len(), self_closing)
}
