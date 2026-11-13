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

pub(crate) struct SkippedEdit {
    pub(crate) transform: Transform,
    pub(crate) target: Target,
    pub(crate) winner: Transform,
}

pub(crate) struct Edits {
    items: Vec<Edit>,
    skipped: Vec<SkippedEdit>,
}

impl Edits {
    pub(crate) fn new(mut edits: Vec<Edit>) -> Edits {
        edits.sort_by_key(|edit| edit.span.start);
        let mut items: Vec<Edit> = Vec::with_capacity(edits.len());
        let mut skipped: Vec<SkippedEdit> = Vec::new();
        for edit in edits {
            match items.last() {
                Some(last) if edit.span.start < last.span.end => skipped.push(SkippedEdit {
                    transform: edit.transform,
                    target: edit.target,
                    winner: last.transform,
                }),
                _ => items.push(edit),
            }
        }
        Edits { items, skipped }
    }

    pub(crate) fn kept(&self) -> &[Edit] {
        &self.items
    }

    pub(crate) fn skipped(&self) -> &[SkippedEdit] {
        &self.skipped
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Target;

    fn edit(span: Range<usize>, text: &str, transform: Transform) -> Edit {
        Edit {
            span,
            text: text.to_string(),
            transform,
            target: Target::Resource("x".to_string()),
        }
    }

    #[test]
    fn two_overlapping_edits_report_the_one_that_lost() {
        let src = "0123456789ab";
        let edits = Edits::new(vec![
            edit(0..6, "a", Transform::MinifiedScript),
            edit(3..9, "b", Transform::PrunedStylesheet),
            edit(9..12, "c", Transform::RecompressedPng),
        ]);
        let kept: Vec<Transform> = edits.kept().iter().map(|edit| edit.transform).collect();
        assert_eq!(
            kept,
            [Transform::MinifiedScript, Transform::RecompressedPng]
        );
        assert_eq!(edits.skipped().len(), 1);
        let skipped = &edits.skipped()[0];
        assert_eq!(skipped.transform, Transform::PrunedStylesheet);
        assert_eq!(skipped.target.to_string(), "x");
        assert_eq!(skipped.winner, Transform::MinifiedScript);
        let out = edits.apply(src);
        assert_eq!(out, "a678c");
        let delta: isize = edits
            .kept()
            .iter()
            .map(|edit| edit.text.len() as isize - edit.span.len() as isize)
            .sum();
        assert_eq!(delta, out.len() as isize - src.len() as isize);
    }

    #[test]
    fn equal_spans_keep_the_first_proposal() {
        let edits = Edits::new(vec![
            edit(2..4, "x", Transform::DeadLibrary),
            edit(2..4, "y", Transform::MinifiedScript),
        ]);
        assert_eq!(edits.kept().len(), 1);
        assert_eq!(
            edits
                .skipped()
                .iter()
                .map(|edit| edit.transform)
                .collect::<Vec<_>>(),
            [Transform::MinifiedScript]
        );
        assert_eq!(edits.skipped()[0].winner, Transform::DeadLibrary);
        assert_eq!(edits.apply("abcdef"), "abxef");
    }
}
