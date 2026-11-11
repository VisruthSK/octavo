use crate::{
    data,
    html::{self, Element, Tag},
    words::Words,
    Transform,
};
use std::{borrow::Cow, ops::Range};

pub struct Edit {
    pub span: Range<usize>,
    pub text: String,
    pub transform: Transform,
    pub target: String,
}

impl Edit {
    pub fn shrinks(&self) -> bool {
        self.text.len() < self.span.len()
    }
}

pub struct Doc<'a> {
    pub src: &'a str,
    pub tags: Vec<Tag>,
}

impl<'a> Doc<'a> {
    pub fn new(src: &'a str) -> Self {
        Doc {
            src,
            tags: html::scan(src),
        }
    }

    pub fn words(&self, removed: &[Range<usize>]) -> Words {
        let gone = |tag: &Tag| removed.contains(&tag.span);
        let mut words =
            self.collect(|t| matches!(t.element, Element::Style | Element::Link) || gone(t));
        for decoded in self
            .tags
            .iter()
            .filter(|t| !gone(t))
            .filter_map(|t| t.attr("src"))
            .filter_map(data::decode)
        {
            words.add_text(&String::from_utf8_lossy(&decoded.bytes));
        }
        words
    }

    pub fn markup(&self) -> Words {
        self.collect(|t| matches!(t.element, Element::Script | Element::Style | Element::Link))
    }

    pub fn script_text(&self, tag: &Tag) -> Option<Cow<'_, str>> {
        match (tag.attr("src"), &tag.body) {
            (Some(src), _) => data::decode(src)
                .and_then(|d| String::from_utf8(d.bytes).ok())
                .map(Cow::Owned),
            (None, Some(body)) => Some(Cow::Borrowed(&self.src[body.clone()])),
            _ => None,
        }
    }

    fn collect(&self, skip: impl Fn(&Tag) -> bool) -> Words {
        let mut words = Words::default();
        let mut at = 0;
        for tag in self.tags.iter().filter(|t| skip(t)) {
            if tag.span.start < at {
                continue;
            }
            words.add_text(&self.src[at..tag.span.start]);
            at = tag.span.end;
        }
        words.add_text(&self.src[at..]);
        words
    }
}

pub fn apply(src: &str, mut edits: Vec<Edit>) -> String {
    edits.sort_by_key(|e| e.span.start);
    let mut out = String::with_capacity(src.len());
    let mut at = 0;
    for edit in edits {
        if edit.span.start < at {
            continue;
        }
        out.push_str(&src[at..edit.span.start]);
        out.push_str(&edit.text);
        at = edit.span.end;
    }
    out.push_str(&src[at..]);
    out
}
