use image::{ColorType, ImageEncoder, codecs::png};
use octavo::{Options, SiteError, SiteKind, optimize_directory};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Scratch {
        let directory = std::env::temp_dir().join(format!(
            "octavo-site-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&directory).unwrap();
        Scratch(directory)
    }

    fn write(&self, path: &str, content: impl AsRef<[u8]>) {
        let full = self.0.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }

    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.0.join(path)).unwrap()
    }

    fn bytes(&self, path: &str) -> Vec<u8> {
        fs::read(self.0.join(path)).unwrap()
    }

    fn exists(&self, path: &str) -> bool {
        self.0.join(path).exists()
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn page(head: &str, body: &str) -> String {
    format!("<!DOCTYPE html><html><head><title>t</title>{head}</head><body>{body}</body></html>")
}

fn run(site: &Scratch) -> (Scratch, octavo::SiteReport) {
    let out = Scratch::new();
    let report = optimize_directory(site.path(), out.path(), &Options::default()).unwrap();
    (out, report)
}

#[test]
fn a_rule_survives_when_any_page_needs_it() {
    let site = Scratch::new();
    site.write(
        "style.css",
        ".alpha { color: red; }\n.beta { color: blue; }\n.gamma { color: green; }\n",
    );
    site.write(
        "index.html",
        page(
            r#"<link rel="stylesheet" href="style.css">"#,
            r#"<p class="alpha">one</p>"#,
        ),
    );
    site.write(
        "docs/other.html",
        page(
            r#"<link rel="stylesheet" href="../style.css">"#,
            r#"<p class="beta">two</p>"#,
        ),
    );
    let (out, report) = run(&site);
    let css = out.read("style.css");
    assert!(css.contains("alpha") && css.contains("beta") && !css.contains("gamma"));
    assert!(
        report
            .changes
            .iter()
            .any(|change| change.kind == SiteKind::Stylesheet && change.after < change.before)
    );
}

#[test]
fn pages_and_unreferenced_files_are_copied_unchanged() {
    let site = Scratch::new();
    site.write(
        "style.css",
        ".a { color: red; }\n.unused { color: blue; }\n",
    );
    site.write("loose.css", ".never { color: red; }\n");
    site.write("data.json", r#"{ "a": 1 }"#);
    site.write(
        "index.html",
        page(
            r#"<link rel="stylesheet" href="style.css">"#,
            r#"<p class="a">x</p>"#,
        ),
    );
    let (out, report) = run(&site);
    assert_eq!(out.bytes("index.html"), site.bytes("index.html"));
    assert_eq!(out.bytes("loose.css"), site.bytes("loose.css"));
    assert_eq!(out.bytes("data.json"), site.bytes("data.json"));
    assert_eq!(report.pages, 1);
    assert_eq!(report.files, 4);
}

#[test]
fn a_class_that_a_script_file_creates_is_kept() {
    let site = Scratch::new();
    site.write(
        "style.css",
        ".dyn { color: red; }\n.dead { color: blue; }\n",
    );
    site.write(
        "app.js",
        "const el = document.createElement('div');\nel.className = 'dyn';\ndocument.body.append(el);\n",
    );
    site.write(
        "index.html",
        page(
            r#"<link rel="stylesheet" href="style.css"><script src="app.js"></script>"#,
            "<p>x</p>",
        ),
    );
    let (out, _) = run(&site);
    let css = out.read("style.css");
    assert!(css.contains("dyn") && !css.contains("dead"));
}

#[test]
fn a_script_is_minified_as_the_kind_the_page_loads() {
    let site = Scratch::new();
    site.write(
        "plain.js",
        "// a comment that costs bytes\nfunction add(first, second) {\n    return first + second;\n}\nconsole.log(add(1, 2));\n",
    );
    site.write(
        "mod.js",
        "// a comment that costs bytes\nexport const answer = 40 + 2;\nexport function twice(value) {\n    return value * 2;\n}\n",
    );
    site.write(
        "index.html",
        page(
            r#"<script src="plain.js"></script><script type="module" src="mod.js"></script>"#,
            "<p>x</p>",
        ),
    );
    let (out, report) = run(&site);
    assert!(out.read("plain.js").len() < site.read("plain.js").len());
    assert!(!out.read("plain.js").contains("a comment"));
    let module = out.read("mod.js");
    assert!(module.contains("export") && module.len() < site.read("mod.js").len());
    assert_eq!(
        report
            .changes
            .iter()
            .filter(|change| change.kind == SiteKind::Script)
            .count(),
        2
    );
}

#[test]
fn a_font_becomes_woff2_and_the_stylesheet_follows() {
    let site = Scratch::new();
    site.write(
        "style.css",
        "@font-face { font-family: 'Octavo Test'; src: url(fonts/t.ttf) format('truetype'); }\nbody { font-family: 'Octavo Test'; }\n",
    );
    site.write("fonts/t.ttf", include_bytes!("../data/octavo-test.ttf"));
    site.write(
        "index.html",
        page(
            r#"<link rel="stylesheet" href="style.css">"#,
            r#"<p style="font-family: 'Octavo Test'">x</p>"#,
        ),
    );
    let (out, report) = run(&site);
    assert!(out.bytes("fonts/t.woff2").starts_with(b"wOF2"));
    let css = out.read("style.css");
    assert!(css.contains("t.woff2") && !css.contains("t.ttf"));
    assert!(!out.exists("fonts/t.ttf"));
    assert!(
        report
            .changes
            .iter()
            .any(|change| change.kind == SiteKind::Font)
    );
}

#[test]
fn a_font_that_another_file_names_stays_beside_the_woff2() {
    let site = Scratch::new();
    site.write(
        "style.css",
        "@font-face { font-family: 'Octavo Test'; src: url(fonts/t.ttf) format('truetype'); }\nbody { font-family: 'Octavo Test'; }\n",
    );
    site.write("fonts/t.ttf", include_bytes!("../data/octavo-test.ttf"));
    site.write(
        "index.html",
        page(
            r#"<link rel="stylesheet" href="style.css"><a href="fonts/t.ttf">download</a>"#,
            r#"<p style="font-family: 'Octavo Test'">x</p>"#,
        ),
    );
    let (out, _) = run(&site);
    assert!(out.exists("fonts/t.woff2") && out.exists("fonts/t.ttf"));
}

#[test]
fn a_png_is_recompressed_without_changing_a_pixel() {
    let width = 96u32;
    let height = 96u32;
    let pixels: Vec<u8> = (0..width * height)
        .flat_map(|i| [(i % width) as u8, (i / width) as u8, 128, 255])
        .collect();
    let mut encoded = Vec::new();
    png::PngEncoder::new_with_quality(
        &mut encoded,
        png::CompressionType::Fast,
        png::FilterType::NoFilter,
    )
    .write_image(&pixels, width, height, ColorType::Rgba8.into())
    .unwrap();
    let site = Scratch::new();
    site.write("figure.png", &encoded);
    site.write("index.html", page("", r#"<img src="figure.png">"#));
    let (out, report) = run(&site);
    let after = out.bytes("figure.png");
    assert!(after.len() < encoded.len());
    let decode = |bytes: &[u8]| {
        image::load_from_memory(bytes)
            .unwrap()
            .to_rgba8()
            .into_raw()
    };
    assert_eq!(decode(&after), decode(&encoded));
    assert!(
        report
            .changes
            .iter()
            .any(|change| change.kind == SiteKind::Image)
    );
}

#[test]
fn in_place_rewrites_the_directory_and_leaves_no_temporary_file() {
    let site = Scratch::new();
    site.write(
        "style.css",
        ".a { color: red; }\n.unused { color: blue; }\n",
    );
    site.write(
        "index.html",
        page(
            r#"<link rel="stylesheet" href="style.css">"#,
            r#"<p class="a">x</p>"#,
        ),
    );
    let before = site.read("style.css");
    optimize_directory(site.path(), site.path(), &Options::default()).unwrap();
    assert!(site.read("style.css").len() < before.len());
    let leftovers = fs::read_dir(site.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".octavo-tmp"))
        .count();
    assert_eq!(leftovers, 0);
}

#[test]
fn an_output_that_overlaps_the_input_is_refused() {
    let site = Scratch::new();
    site.write("index.html", page("", "<p>x</p>"));
    let inside = site.path().join("copy");
    let error = optimize_directory(site.path(), &inside, &Options::default()).unwrap_err();
    assert!(matches!(error, SiteError::OverlappingPaths { .. }));
}

#[test]
fn an_input_that_is_a_file_is_refused() {
    let site = Scratch::new();
    site.write("index.html", page("", "<p>x</p>"));
    let file = site.path().join("index.html");
    let out = Scratch::new();
    let error = optimize_directory(&file, out.path(), &Options::default()).unwrap_err();
    assert!(matches!(error, SiteError::NotADirectory(_)));
}

#[test]
fn a_stylesheet_that_a_stylesheet_imports_is_followed() {
    let site = Scratch::new();
    site.write("main.css", "@import url(part.css);\n.a { color: red; }\n");
    site.write(
        "part.css",
        ".b { color: blue; }\n.never { color: green; }\n",
    );
    site.write(
        "index.html",
        page(
            r#"<link rel="stylesheet" href="main.css">"#,
            r#"<p class="a b">x</p>"#,
        ),
    );
    let (out, _) = run(&site);
    let part = out.read("part.css");
    assert!(part.contains('b') && !part.contains("never"));
}
