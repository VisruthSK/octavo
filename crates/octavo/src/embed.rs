use crate::{
    check::{Origin, Url},
    doc::Doc,
    html::{AttrName, Element, Rel},
    site::reference_spans,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{collections::HashSet, ops::Range};

const DEPTH_LIMIT: usize = 8;

/// A file found by a [`Resources`] provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Loaded {
    /// The file's content.
    pub bytes: Vec<u8>,
    /// A name for the file that identifies it uniquely, such as its absolute
    /// path. Octavo passes it back as `from` when the file refers to other
    /// files, and uses it to stop a stylesheet that imports itself.
    pub id: String,
}

/// Finds the files that a page and its stylesheets link.
pub trait Resources {
    /// Returns the file that `reference` names, or `None` if there is no such
    /// file. `reference` is written exactly as in the source. `from` is the
    /// [`Loaded::id`] of the stylesheet that contains it, or an empty string
    /// when the page itself contains it.
    fn load(&mut self, reference: &str, from: &str) -> Option<Loaded>;
}

/// The result of [`embed_resources`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Embedded {
    /// The document with every file it could find embedded.
    pub html: String,
    /// How many files were embedded, counting each use.
    pub embedded: usize,
    /// The total size in bytes of those files before they were embedded.
    pub resource_bytes: u64,
    /// References to local files that the provider could not find. They are
    /// left as written.
    pub missing: Vec<String>,
}

/// Embeds the local files that a document links, as Quarto's
/// `embed-resources: true` does, so that [`optimize`](crate::optimize) can
/// accept it.
///
/// Scripts, images, stylesheets and icons become `data:` URLs, which keeps
/// every other attribute of the tag, such as `async` or `media`. Inside an
/// embedded stylesheet, the `url()` and `@import` references that it makes
/// are embedded too, relative to the stylesheet. Links to the network and
/// `data:` URLs are left as they are.
///
/// ```
/// use octavo::{embed_resources, Loaded, Resources};
///
/// struct One;
/// impl Resources for One {
///     fn load(&mut self, reference: &str, _from: &str) -> Option<Loaded> {
///         (reference == "app.js").then(|| Loaded { bytes: b"let a = 1;".to_vec(), id: "app.js".into() })
///     }
/// }
///
/// let embedded = embed_resources("<script src=\"app.js\"></script>", &mut One);
/// assert!(embedded.html.starts_with("<script src=\"data:application/javascript;base64,"));
/// assert_eq!(embedded.embedded, 1);
/// ```
pub fn embed_resources(src: &str, resources: &mut dyn Resources) -> Embedded {
    let doc = Doc::new(src);
    let mut state = State {
        resources,
        active: HashSet::new(),
        embedded: 0,
        resource_bytes: 0,
        missing: Vec::new(),
    };
    let mut edits: Vec<(Range<usize>, String)> = Vec::new();
    for tag in doc.tags().iter().filter(|tag| !tag.in_svg) {
        match tag.element {
            Element::Script => {
                if let Some(uri) = tag
                    .attr(AttrName::Src)
                    .and_then(|reference| state.uri(reference, "", 0))
                {
                    let open = tag.open_tag(|name, value| {
                        Some(if *name == AttrName::Src {
                            uri.clone()
                        } else {
                            value.to_string()
                        })
                    });
                    let rest = tag
                        .body
                        .as_ref()
                        .map_or("", |body| &src[body.start..tag.span.end]);
                    edits.push((tag.span.clone(), format!("{open}{rest}")));
                }
            }
            Element::Img => {
                let src_uri = tag
                    .attr(AttrName::Src)
                    .and_then(|reference| state.uri(reference, "", 0));
                let lazy_uri = tag
                    .attr(AttrName::DataSrc)
                    .and_then(|reference| state.uri(reference, "", 0));
                if src_uri.is_some() || lazy_uri.is_some() {
                    let open = tag.open_tag(|name, value| {
                        let new = match name {
                            AttrName::Src => src_uri.as_deref(),
                            AttrName::DataSrc => lazy_uri.as_deref(),
                            _ => None,
                        };
                        Some(new.unwrap_or(value).to_string())
                    });
                    edits.push((tag.span.clone(), open));
                }
            }
            Element::Link => {
                let embeddable = tag.rel().is_some_and(|rel| match rel {
                    Rel::Stylesheet => true,
                    Rel::Other(value) => value.to_ascii_lowercase().contains("icon"),
                });
                if let Some(uri) = embeddable
                    .then(|| tag.attr(AttrName::Href))
                    .flatten()
                    .and_then(|reference| state.uri(reference, "", 0))
                {
                    let open = tag.open_tag(|name, value| {
                        Some(if *name == AttrName::Href {
                            uri.clone()
                        } else {
                            value.to_string()
                        })
                    });
                    edits.push((tag.span.clone(), open));
                }
            }
            Element::Style => {
                if let Some(body) = &tag.body
                    && let Some(css) = state.css(&src[body.clone()], "", 0)
                {
                    edits.push((body.clone(), css));
                }
            }
            Element::Svg => {}
        }
    }
    edits.sort_by_key(|(span, _)| span.start);
    let mut html = String::with_capacity(src.len());
    let mut at = 0;
    for (span, text) in edits {
        if span.start < at {
            continue;
        }
        html.push_str(&src[at..span.start]);
        html.push_str(&text);
        at = span.end;
    }
    html.push_str(&src[at..]);
    Embedded {
        html,
        embedded: state.embedded,
        resource_bytes: state.resource_bytes,
        missing: state.missing,
    }
}

struct State<'a> {
    resources: &'a mut dyn Resources,
    active: HashSet<String>,
    embedded: usize,
    resource_bytes: u64,
    missing: Vec<String>,
}

impl State<'_> {
    fn uri(&mut self, reference: &str, from: &str, depth: usize) -> Option<String> {
        let reference = reference.trim();
        let url = Url::parse(reference)?;
        if url.origin() == Origin::Remote || depth > DEPTH_LIMIT {
            return None;
        }
        let Some(loaded) = self.resources.load(reference, from) else {
            self.missing.push(reference.to_string());
            return None;
        };
        if !self.active.insert(loaded.id.clone()) {
            return None;
        }
        self.resource_bytes += loaded.bytes.len() as u64;
        let mime = mime_of(reference);
        let bytes = if mime == "text/css" {
            match String::from_utf8(loaded.bytes) {
                Ok(text) => self
                    .css(&text, &loaded.id, depth + 1)
                    .unwrap_or(text)
                    .into_bytes(),
                Err(error) => error.into_bytes(),
            }
        } else {
            loaded.bytes
        };
        self.active.remove(&loaded.id);
        self.embedded += 1;
        Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    }

    fn css(&mut self, css: &str, from: &str, depth: usize) -> Option<String> {
        let mut out = String::with_capacity(css.len());
        let mut at = 0;
        let mut changed = false;
        for span in reference_spans(css) {
            if let Some(uri) = self.uri(&css[span.clone()], from, depth) {
                out.push_str(&css[at..span.start]);
                out.push_str(&uri);
                at = span.end;
                changed = true;
            }
        }
        out.push_str(&css[at..]);
        changed.then_some(out)
    }
}

fn mime_of(reference: &str) -> &'static str {
    let end = reference.find(['?', '#']).unwrap_or(reference.len());
    let extension = reference[..end]
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "css" => "text/css",
        "js" | "mjs" => "application/javascript",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}
