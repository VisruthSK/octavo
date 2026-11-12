use crate::{
    Target, Transform, data,
    html::{self, AttrName, Element, Tag},
    words::Words,
};
use rayon::prelude::*;
use std::{borrow::Cow, ops::Range};

pub(crate) struct Edit {
    pub(crate) span: Range<usize>,
    pub(crate) text: String,
    pub(crate) transform: Transform,
    pub(crate) target: Target,
}

impl Edit {
    pub(crate) fn shrinks(&self) -> bool {
        self.text.len() < self.span.len()
    }
}

pub(crate) struct Edits {
    items: Vec<Edit>,
}

impl Edits {
    pub(crate) fn new(mut edits: Vec<Edit>) -> Edits {
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

    pub(crate) fn apply(&self, src: &str) -> String {
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

pub(crate) struct WordParts {
    scripts: Vec<(Range<usize>, Words)>,
    sources: Vec<(Range<usize>, Words)>,
}

pub(crate) struct Doc<'a> {
    src: &'a str,
    tags: Vec<Tag>,
    found_html: bool,
}

impl<'a> Doc<'a> {
    pub(crate) fn new(src: &'a str) -> Self {
        let scan = html::scan(src);
        Doc {
            src,
            tags: scan.tags,
            found_html: scan.found_html,
        }
    }

    pub(crate) fn src(&self) -> &str {
        self.src
    }

    pub(crate) fn tags(&self) -> &[Tag] {
        &self.tags
    }

    pub(crate) fn found_html(&self) -> bool {
        self.found_html
    }

    pub(crate) fn word_parts(&self) -> WordParts {
        let (scripts, sources) = rayon::join(
            || {
                self.tags
                    .par_iter()
                    .filter(|t| t.element == Element::Script)
                    .map(|t| {
                        let mut words = Words::default();
                        words.add_text(&self.src[t.span.clone()]);
                        (t.span.clone(), words)
                    })
                    .collect()
            },
            || {
                self.tags
                    .par_iter()
                    .filter_map(|t| {
                        let text = data::decode_text(t.attr(AttrName::Src)?)?;
                        let mut words = Words::default();
                        words.add_text(&text);
                        Some((t.span.clone(), words))
                    })
                    .collect()
            },
        );
        WordParts { scripts, sources }
    }

    pub(crate) fn words(
        &self,
        mut markup: Words,
        parts: WordParts,
        removed: &[Range<usize>],
    ) -> Words {
        for (span, words) in parts.scripts.into_iter().chain(parts.sources) {
            if !removed.contains(&span) {
                markup.absorb(words);
            }
        }
        markup
    }

    pub(crate) fn markup(&self) -> Words {
        self.collect(|t| matches!(t.element, Element::Script | Element::Style | Element::Link))
    }

    pub(crate) fn script_text(&self, tag: &Tag) -> Option<Cow<'_, str>> {
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
