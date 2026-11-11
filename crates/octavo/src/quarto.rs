use crate::{
    doc::{Doc, Edit},
    html::{AttrName, Element, Tag},
    Library, Target, Transform,
};
use std::borrow::Cow;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fate {
    Stub,
    Remove,
}

struct Bundled {
    global: Library,
    signature: &'static str,
    needed_by: &'static [&'static [&'static str]],
    fate: Fate,
}

const NOTE_LINKS: &[&str] = &[
    "doc-noteref",
    "quarto-xref",
    "doc-biblioref",
    "code-annotation",
];
const BOOTSTRAP_API: &[&str] = &["data-bs-", "code-copy-button"];

const LIBRARIES: [Bundled; 5] = [
    Bundled {
        global: Library::Tippy,
        signature: "require(\"@popperjs/core\")",
        needed_by: &[NOTE_LINKS],
        fate: Fate::Stub,
    },
    Bundled {
        global: Library::Bootstrap,
        signature: "Bootstrap v5",
        needed_by: &[BOOTSTRAP_API],
        fate: Fate::Remove,
    },
    Bundled {
        global: Library::Popper,
        signature: "@popperjs/core v",
        needed_by: &[NOTE_LINKS, BOOTSTRAP_API],
        fate: Fate::Remove,
    },
    Bundled {
        global: Library::Clipboard,
        signature: "clipboard.js v",
        needed_by: &[&["code-copy-button"]],
        fate: Fate::Stub,
    },
    Bundled {
        global: Library::Anchor,
        signature: "AnchorJS - v",
        needed_by: &[&["anchored"]],
        fate: Fate::Stub,
    },
];

const NULL_OBJECT: &str = "let n=new Proxy(function(){},{get:(_,k)=>k==Symbol.toPrimitive?()=>\"\":n,apply:()=>n,construct:()=>n});";
const BANNER_BYTES: usize = 300;
const MIN_LIBRARY_BYTES: usize = 2000;

pub(crate) fn stage(doc: &Doc) -> Vec<Edit> {
    let scripts: Vec<(&Tag, Cow<str>)> = doc
        .tags()
        .iter()
        .filter(|t| t.element == Element::Script)
        .filter_map(|t| doc.script_text(t).map(|text| (t, text)))
        .collect();
    let markup = doc.markup();
    let mut dead: Vec<(&Bundled, &Tag)> = Vec::new();
    for lib in &LIBRARIES {
        let alive =
            |tag: &Tag, dead: &[(&Bundled, &Tag)]| dead.iter().all(|(_, d)| d.span != tag.span);
        let Some((tag, _)) = scripts.iter().find(|(t, text)| {
            alive(t, &dead)
                && text.len() > MIN_LIBRARY_BYTES
                && banner(text).contains(lib.signature)
        }) else {
            continue;
        };
        let wanted = lib
            .needed_by
            .iter()
            .copied()
            .flatten()
            .any(|word| markup.any_starting_with(word));
        let referenced = scripts.iter().any(|(other, text)| {
            alive(other, &dead)
                && other.span != tag.span
                && !is_runtime(other)
                && text.contains(lib.global.name())
        });
        if !wanted && !referenced {
            dead.push((lib, tag));
        }
    }
    let stubs: Vec<&(&Bundled, &Tag)> = dead
        .iter()
        .filter(|(lib, _)| lib.fate == Fate::Stub)
        .collect();
    let stub_at = stubs.iter().map(|(_, tag)| tag.span.start).min();
    let assignments: String = stubs
        .iter()
        .map(|(lib, _)| format!("window.{}=n;", lib.global.name()))
        .collect();
    dead.iter()
        .map(|(lib, tag)| Edit {
            span: tag.span.clone(),
            text: if Some(tag.span.start) == stub_at {
                format!("<script>{{{NULL_OBJECT}{assignments}}}</script>")
            } else {
                String::new()
            },
            transform: Transform::DeadLibrary,
            target: Target::Library(lib.global),
        })
        .collect()
}

fn banner(text: &str) -> &str {
    &text[..text.floor_char_boundary(BANNER_BYTES)]
}

fn is_runtime(tag: &Tag) -> bool {
    tag.attr(AttrName::Id)
        .is_some_and(|id| id.starts_with("quarto-html-"))
}
