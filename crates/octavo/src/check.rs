use crate::{
    ascii::starts_with_ignore_case,
    data,
    doc::Doc,
    html::{AttrName, Element},
};
use indexmap::IndexSet;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Origin {
    Local,
    Remote,
}

/// A URL found in the document, kept exactly as written.
///
/// Carries where the URL points, so the optimizer can tell a document that
/// is not self-contained from one whose resources merely live on the
/// network.
///
/// ```
/// use octavo::{optimize, Error, Mode};
///
/// let src = "<html><head><script src=\"a.js\"></script></head></html>";
/// let Err(Error::NotSelfContained(links)) = optimize(src, Mode::Safe) else {
///     panic!("expected a self-containment error");
/// };
/// assert_eq!(links[0].as_str(), "a.js");
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Url {
    text: String,
    origin: Origin,
}

impl Url {
    fn parse(text: &str) -> Option<Url> {
        if text.is_empty() {
            return None;
        }
        let origin = match Scheme::of(text) {
            Some(scheme) if scheme.is_inline() => return None,
            Some(scheme) if scheme.is_remote() => Origin::Remote,
            _ => Origin::Local,
        };
        Some(Url {
            text: text.to_string(),
            origin,
        })
    }

    pub(crate) fn origin(&self) -> Origin {
        self.origin
    }

    /// The URL as written in the document.
    ///
    /// ```
    /// use octavo::{optimize, Error, Mode};
    ///
    /// let src = "<html><head><script src=\"a.js\"></script></head></html>";
    /// let Err(Error::NotSelfContained(links)) = optimize(src, Mode::Safe) else {
    ///     panic!("expected a self-containment error");
    /// };
    /// assert_eq!(links[0].as_str(), "a.js");
    /// ```
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.text
    }
}

impl fmt::Display for Url {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(&self.text)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Scheme {
    Data,
    Blob,
    About,
    Fragment,
    Http,
    Https,
    ProtocolRelative,
}

impl Scheme {
    const ALL: [Scheme; 7] = [
        Scheme::Data,
        Scheme::Blob,
        Scheme::About,
        Scheme::Fragment,
        Scheme::Http,
        Scheme::Https,
        Scheme::ProtocolRelative,
    ];

    fn prefix(self) -> &'static str {
        match self {
            Scheme::Data => data::DATA_URL_PREFIX,
            Scheme::Blob => "blob:",
            Scheme::About => "about:",
            Scheme::Fragment => "#",
            Scheme::Http => "http:",
            Scheme::Https => "https:",
            Scheme::ProtocolRelative => "//",
        }
    }

    fn of(text: &str) -> Option<Scheme> {
        Scheme::ALL
            .into_iter()
            .find(|scheme| starts_with_ignore_case(text, scheme.prefix()))
    }

    fn is_inline(self) -> bool {
        matches!(
            self,
            Scheme::Data | Scheme::Blob | Scheme::About | Scheme::Fragment
        )
    }

    fn is_remote(self) -> bool {
        matches!(
            self,
            Scheme::Http | Scheme::Https | Scheme::ProtocolRelative
        )
    }
}

#[derive(Default)]
pub(crate) struct Links {
    urls: IndexSet<Url>,
}

impl Links {
    pub(crate) fn local(&self) -> impl Iterator<Item = &Url> {
        self.urls.iter().filter(|url| url.origin() == Origin::Local)
    }

    pub(crate) fn remote(&self) -> impl Iterator<Item = &Url> {
        self.urls
            .iter()
            .filter(|url| url.origin() == Origin::Remote)
    }

    pub(crate) fn is_self_contained(&self) -> bool {
        self.local().next().is_none()
    }
}

pub(crate) fn is_html(src: &str) -> bool {
    src.match_indices('<')
        .any(|(at, _)| starts_with_ignore_case(&src[at..], "<html"))
}

pub(crate) fn links(doc: &Doc) -> Links {
    let mut urls = IndexSet::new();
    for tag in doc.tags().iter().filter(|t| !t.in_svg) {
        let url = match tag.element {
            Element::Script | Element::Img => tag.attr(AttrName::Src),
            Element::Link if tag.rel().is_some_and(|rel| rel.is_stylesheet()) => {
                tag.attr(AttrName::Href)
            }
            Element::Link | Element::Style | Element::Svg => None,
        };
        let Some(url) = url.map(str::trim) else {
            continue;
        };
        if let Some(url) = Url::parse(url) {
            urls.insert(url);
        }
    }
    Links { urls }
}
