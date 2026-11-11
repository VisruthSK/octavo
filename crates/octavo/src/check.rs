use crate::{ascii::starts_with_ignore_case, doc::Doc};

#[derive(Default)]
pub struct Links {
    pub local: Vec<String>,
    pub remote: Vec<String>,
}

pub fn is_html(src: &str) -> bool {
    src.match_indices('<')
        .any(|(at, _)| starts_with_ignore_case(&src[at..], "<html"))
}

pub fn links(doc: &Doc) -> Links {
    let mut links = Links::default();
    for tag in doc.tags.iter().filter(|t| !t.in_svg) {
        let url = match tag.name {
            "script" | "img" => tag.attr("src"),
            "link" if tag.attr("rel").is_some_and(is_stylesheet) => tag.attr("href"),
            _ => None,
        };
        let Some(url) = url.map(str::trim).filter(|url| !url.is_empty()) else {
            continue;
        };
        if ["data:", "blob:", "about:", "#"]
            .iter()
            .any(|p| starts_with_ignore_case(url, p))
        {
            continue;
        }
        let remote = ["http:", "https:", "//"]
            .iter()
            .any(|p| starts_with_ignore_case(url, p));
        let list = if remote {
            &mut links.remote
        } else {
            &mut links.local
        };
        if !list.iter().any(|seen| seen == url) {
            list.push(url.to_string());
        }
    }
    links
}

fn is_stylesheet(rel: &str) -> bool {
    rel.split_whitespace()
        .any(|word| word.eq_ignore_ascii_case("stylesheet"))
}
