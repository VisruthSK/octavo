mod common;

use common::{optimized, page};
use octavo::{optimize, Error, Mode};

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
    assert!(out.warnings[0].contains("https://cdn.example.com/lib.js"));
}

#[test]
fn embedded_data_and_in_page_links_are_fine() {
    let src = page(
        "<link rel=stylesheet href=\"data:text/css,p%7Bcolor:red%7D\">",
        "<a href=\"#top\">top</a><img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\">",
    );
    assert!(optimized(&src, Mode::Safe).warnings.is_empty());
}
