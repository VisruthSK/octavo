use crate::{
    data,
    html::{self, AttrName, Element, Tag},
    words::Words,
    Target, Transform,
};
use std::{borrow::Cow, ops::Range};

pub struct Edit {
    pub span: Range<usize>,
    pub text: String,
    pub transform: Transform,
    pub target: Target,
}

impl Edit {
    pub fn shrinks(&self) -> bool {
        self.text.len() < self.span.len()
    }
}

pub struct Edits {
    items: Vec<Edit>,
}

impl Edits {
    pub fn new(mut edits: Vec<Edit>) -> Edits {
        edits.sort_by_key(|edit| edit.span.start);
        let mut items: Vec<Edit> = Vec::with_capacity(edits.len());
        for edit in edits {
            if items
                .last()
                .is_some_and(|last| edit.span.start < last.span.end)
            {
                continue;
            }
            items.push(edit);
        }
        Edits { items }
    }

    pub fn apply(&self, src: &str) -> String {
        let mut out = String::with_capacity(src.len());
        let mut at = 0;
        for edit in &self.items {
            out.push_str(&src[at..edit.span.start]);
            out.push_str(&edit.text);
            at = edit.span.end;
        }
        out.push_str(&src[at..]);
        out
    }
}

pub struct Doc<'a> {
    src: &'a str,
    tags: Vec<Tag>,
}

impl<'a> Doc<'a> {
    pub fn new(src: &'a str) -> Self {
        Doc {
            src,
            tags: html::scan(src),
        }
    }

    pub fn src(&self) -> &str {
        self.src
    }

    pub fn tags(&self) -> &[Tag] {
        &self.tags
    }

    pub fn words(&self, removed: &[Range<usize>]) -> Words {
        let gone = |tag: &Tag| removed.contains(&tag.span);
        let mut words =
            self.collect(|t| matches!(t.element, Element::Style | Element::Link) || gone(t));
        for decoded in self
            .tags
            .iter()
            .filter(|t| !gone(t))
            .filter_map(|t| t.attr(AttrName::Src))
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
        match (tag.attr(AttrName::Src), &tag.body) {
            (Some(src), _) => data::decode(src)
                .and_then(|d| String::from_utf8(d.bytes).ok())
                .map(Cow::Owned),
            (None, Some(body)) => Some(Cow::Borrowed(&self.src[body.clone()])),
            (None, None) => None,
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
