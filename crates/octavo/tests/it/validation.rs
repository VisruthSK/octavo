use crate::common::{optimized, page};
use octavo::{Error, Mode, Options, Url, Warning, optimize, simplify};

#[test]
fn text_that_is_not_html_is_rejected() {
    assert_eq!(
        optimize("just some words", Mode::Safe).unwrap_err(),
        Error::NotHtml
    );
    assert_eq!(optimize("", Mode::Safe).unwrap_err(), Error::NotHtml);
}

#[test]
fn documents_linking_local_files_are_rejected_with_the_links() {
    let src = page(
        "<link rel=\"stylesheet\" href=\"site_libs/bootstrap.min.css\"><script src=\"site_libs/quarto.js\"></script>",
        "<img src=\"figure.png\">",
    );
    let Error::NotSelfContained(links) = optimize(&src, Mode::Safe).unwrap_err() else {
        panic!("expected NotSelfContained");
    };
    let links: Vec<&str> = links.iter().map(Url::as_str).collect();
    assert_eq!(
        links,
        [
            "site_libs/bootstrap.min.css",
            "site_libs/quarto.js",
            "figure.png"
        ]
    );
}

#[test]
fn the_error_names_the_problem_and_the_fix() {
    let src = page("<script src=\"a.js\"></script>", "");
    let message = optimize(&src, Mode::Safe).unwrap_err().to_string();
    assert!(
        message.contains("a.js") && message.contains("embed-resources"),
        "{message}"
    );
}

#[test]
fn remote_resources_only_warn() {
    let src = page(
        "<script src=\"https://cdn.example.com/lib.js\"></script><link rel=stylesheet href=\"//fonts.example.com/a.css\">",
        "<p>hi",
    );
    let out = optimized(&src, Mode::Safe);
    assert_eq!(out.warnings.len(), 2);
    let urls: Vec<&str> = out
        .warnings
        .iter()
        .filter_map(|warning| match warning {
            Warning::RemoteResource(url) => Some(url.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        urls,
        [
            "https://cdn.example.com/lib.js",
            "//fonts.example.com/a.css"
        ]
    );
    assert!(out.warnings.iter().any(|warning| {
        warning
            .to_string()
            .contains("https://cdn.example.com/lib.js")
    }));
}

#[test]
fn simplified_exposes_the_same_warnings_as_the_output() {
    let src = page(
        "<script src=\"https://cdn.example.com/lib.js\"></script>",
        "<p>hi",
    );
    let simplified = simplify(&src, Options::default()).expect("supported");
    assert_eq!(simplified.warnings().len(), 1);
    let out = simplified.pack(Mode::Safe);
    assert_eq!(out.warnings.as_slice(), simplified.warnings());
}

#[test]
fn embedded_data_and_in_page_links_are_fine() {
    let src = page(
        "<link rel=stylesheet href=\"data:text/css,p%7Bcolor:red%7D\">",
        "<a href=\"#top\">top</a><img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\">",
    );
    assert!(optimized(&src, Mode::Safe).warnings.is_empty());
}
