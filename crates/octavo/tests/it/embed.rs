use base64::{Engine, engine::general_purpose::STANDARD};
use octavo::{Loaded, Mode, Resources, embed_resources, is_self_contained, optimize};
use std::collections::HashMap;

struct Files(HashMap<&'static str, Vec<u8>>);

impl Files {
    fn new(files: &[(&'static str, &[u8])]) -> Files {
        Files(
            files
                .iter()
                .map(|(name, bytes)| (*name, bytes.to_vec()))
                .collect(),
        )
    }
}

impl Resources for Files {
    fn load(&mut self, reference: &str, from: &str) -> Option<Loaded> {
        let end = reference.find(['?', '#']).unwrap_or(reference.len());
        let mut parts: Vec<&str> = from.split('/').filter(|part| !part.is_empty()).collect();
        parts.pop();
        for piece in reference[..end].split('/') {
            match piece {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                other => parts.push(other),
            }
        }
        let id = parts.join("/");
        self.0.get(id.as_str()).map(|bytes| Loaded {
            bytes: bytes.clone(),
            id,
            content_type: None,
        })
    }
}

fn page(body: &str) -> String {
    format!("<!DOCTYPE html><html><head><title>t</title></head><body>{body}</body></html>")
}

fn decoded(html: &str, prefix: &str) -> String {
    let start = html.find(prefix).expect("a data URL") + prefix.len();
    let end = start + html[start..].find('"').unwrap();
    String::from_utf8(STANDARD.decode(&html[start..end]).unwrap()).unwrap()
}

#[test]
fn linked_files_become_data_urls_and_keep_the_other_attributes() {
    let mut files = Files::new(&[
        ("style.css", b".a { background: url(img/dot.png); }"),
        ("img/dot.png", b"not really a png"),
        ("app.js", b"let a = 1;"),
    ]);
    let src = page(
        r#"<link rel="stylesheet" href="style.css" media="print"><script src="app.js" defer></script><img src="img/dot.png" alt="x">"#,
    );
    let embedded = embed_resources(&src, &mut files);
    assert!(is_self_contained(&embedded.html));
    assert!(embedded.missing.is_empty());
    assert_eq!(embedded.embedded, 4);
    assert!(embedded.html.contains(r#"media="print""#) && embedded.html.contains("defer"));
    assert!(
        embedded
            .html
            .contains("data:application/javascript;base64,")
    );
    let css = decoded(&embedded.html, r#"href="data:text/css;base64,"#);
    assert!(css.contains("data:image/png;base64,"));
}

#[test]
fn references_inside_a_stylesheet_are_relative_to_the_stylesheet() {
    let mut files = Files::new(&[
        ("css/style.css", b".a { background: url(../img/dot.png); }"),
        ("img/dot.png", b"pixels"),
    ]);
    let embedded = embed_resources(
        &page(r#"<link rel="stylesheet" href="css/style.css">"#),
        &mut files,
    );
    assert_eq!(embedded.embedded, 2);
    assert!(decoded(&embedded.html, r#"href="data:text/css;base64,"#).contains("data:image/png"));
}

#[test]
fn a_missing_file_is_reported_and_its_tag_is_left_as_written() {
    let mut files = Files::new(&[]);
    let src = page(r#"<link rel="stylesheet" href="nothing.css">"#);
    let embedded = embed_resources(&src, &mut files);
    assert_eq!(embedded.html, src);
    assert_eq!(embedded.missing, ["nothing.css"]);
    assert!(!is_self_contained(&embedded.html));
}

#[test]
fn remote_and_data_urls_are_left_alone() {
    let mut files = Files::new(&[]);
    let src = page(
        r#"<script src="https://cdn.example.com/x.js"></script><img src="data:image/png;base64,AAAA">"#,
    );
    let embedded = embed_resources(&src, &mut files);
    assert_eq!(embedded.html, src);
    assert_eq!(embedded.embedded, 0);
    assert!(embedded.missing.is_empty());
}

#[test]
fn a_stylesheet_that_imports_itself_does_not_loop() {
    let mut files = Files::new(&[("a.css", b"@import url(a.css); .x { color: red; }")]);
    let embedded = embed_resources(&page(r#"<link rel="stylesheet" href="a.css">"#), &mut files);
    assert!(is_self_contained(&embedded.html));
}

#[test]
fn urls_in_an_inline_style_are_embedded() {
    let mut files = Files::new(&[("img/dot.png", b"pixels")]);
    let embedded = embed_resources(
        &page("<style>.a { background: url(img/dot.png); }</style>"),
        &mut files,
    );
    assert!(embedded.html.contains("data:image/png;base64,"));
    assert!(!embedded.html.contains("img/dot.png"));
}

#[test]
fn an_embedded_page_can_be_optimized() {
    let mut files = Files::new(&[(
        "style.css",
        b".used { color: red; } .unused { color: blue; }",
    )]);
    let embedded = embed_resources(
        &page(r#"<link rel="stylesheet" href="style.css"><p class="used">x</p>"#),
        &mut files,
    );
    let out = optimize(&embedded.html, Mode::Safe).expect("self-contained after embedding");
    assert!(
        out.html.contains(".used{color:red}") && !out.html.contains("unused"),
        "{}",
        out.html
    );
}

#[test]
fn an_import_becomes_part_of_the_stylesheet() {
    let mut files = Files::new(&[
        (
            "theme.css",
            b"@import 'fonts/face.css';\n.theme { color: red; }",
        ),
        ("fonts/face.css", b"@font-face { src: url(f.woff2); }"),
        ("fonts/f.woff2", b"font bytes"),
    ]);
    let embedded = embed_resources(
        &page(r#"<link rel="stylesheet" href="theme.css">"#),
        &mut files,
    );
    let css = decoded(&embedded.html, r#"href="data:text/css;base64,"#);
    assert!(!css.contains("@import"), "{css}");
    assert!(
        css.contains(".theme") && css.contains("@font-face"),
        "{css}"
    );
    assert!(css.contains("data:font/woff2;base64,"), "{css}");
    assert_eq!(embedded.embedded, 3);
}

#[test]
fn an_import_with_a_media_query_stays_an_import() {
    let mut files = Files::new(&[
        ("theme.css", b"@import url(print.css) print;"),
        ("print.css", b".p { color: red; }"),
    ]);
    let embedded = embed_resources(
        &page(r#"<link rel="stylesheet" href="theme.css">"#),
        &mut files,
    );
    let css = decoded(&embedded.html, r#"href="data:text/css;base64,"#);
    assert!(
        css.contains("@import") && css.contains("data:text/css;base64,"),
        "{css}"
    );
}

#[test]
fn a_plain_script_is_inlined_and_a_deferred_one_keeps_a_data_url() {
    let mut files = Files::new(&[
        ("a.js", b"let a = 1;"),
        ("b.js", b"let b = 2;"),
        ("c.js", b"let c = \"</script>\";"),
    ]);
    let embedded = embed_resources(
        &page(
            r#"<script src="a.js" integrity="x" crossorigin="anonymous"></script><script src="b.js" defer></script><script src="c.js"></script>"#,
        ),
        &mut files,
    );
    assert!(
        embedded.html.contains("<script>let a = 1;</script>"),
        "{}",
        embedded.html
    );
    assert!(
        embedded
            .html
            .contains(r#"<script src="data:application/javascript;base64,"#)
    );
    assert_eq!(
        embedded.html.matches("data:application/javascript").count(),
        2
    );
    assert!(is_self_contained(&embedded.html));
}

#[test]
fn relative_imports_in_a_module_become_data_urls() {
    let mut files = Files::new(&[
        (
            "main.js",
            b"import { a } from './lib/a.js';\nimport './side.js';\nexport * from \"./lib/a.js\";\nconst b = await import('./side.js');\nimport x from 'bare';",
        ),
        ("lib/a.js", b"export const a = 1;"),
        ("side.js", b"console.log(1);"),
    ]);
    let embedded = embed_resources(
        &page(r#"<script type="module" src="main.js"></script>"#),
        &mut files,
    );
    let module = decoded(
        &embedded.html,
        r#"src="data:application/javascript;base64,"#,
    );
    assert!(
        !module.contains("./lib/a.js") && !module.contains("./side.js"),
        "{module}"
    );
    assert!(module.contains("from 'bare'"), "{module}");
    assert_eq!(
        module
            .matches("data:application/javascript;base64,")
            .count(),
        4,
        "{module}"
    );
}
