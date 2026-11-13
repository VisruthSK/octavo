use image::{ColorType, ImageEncoder, codecs::png};
use octavo::{Options, SiteError, SiteFileKind, SiteKind, optimize_directory, plan_directory};
use skrifa::{FontRef, MetadataProvider};
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

/// A directory with an input and an output beside each other, so the
/// staging directory of a write is inside it.
struct Case(PathBuf);

impl Case {
    fn new() -> Case {
        let directory = std::env::temp_dir().join(format!(
            "octavo-site-case-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&directory).unwrap();
        Case(directory)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn output(&self) -> PathBuf {
        self.0.join("output")
    }
}

impl Drop for Case {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn site_in(root: &Path) -> PathBuf {
    let input = root.join("input");
    fs::create_dir_all(&input).unwrap();
    fs::write(
        input.join("style.css"),
        ".a { color: red; }\n.unused { color: blue; }\n",
    )
    .unwrap();
    fs::write(
        input.join("index.html"),
        page(
            r#"<link rel="stylesheet" href="style.css">"#,
            r#"<p class="a">x</p>"#,
        ),
    )
    .unwrap();
    fs::write(input.join("data.json"), r#"{ "a": 1 }"#).unwrap();
    input
}

fn tree(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut found = Vec::new();
    walk(root, root, &mut found);
    found.sort();
    found
}

fn walk(root: &Path, directory: &Path, found: &mut Vec<(String, Vec<u8>)>) {
    let mut entries: Vec<_> = fs::read_dir(directory)
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    entries.sort_by_key(fs::DirEntry::path);
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            walk(root, &path, found);
        } else {
            let key = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            found.push((key, fs::read(&path).unwrap()));
        }
    }
}

/// The directories a write left beside the output.
fn leftovers(output: &Path) -> Vec<PathBuf> {
    let parent = output.parent().unwrap();
    let name = output.file_name().unwrap().to_string_lossy().to_string();
    fs::read_dir(parent)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(&format!("{name}.octavo-"))
        })
        .collect()
}

fn page(head: &str, body: &str) -> String {
    format!("<!DOCTYPE html><html><head><title>t</title>{head}</head><body>{body}</body></html>")
}

/// A TrueType font whose cmap maps `chars`, in order, to glyphs after
/// `.notdef`. Every glyph is empty; only the character map matters here.
fn font_with(chars: &[char]) -> Vec<u8> {
    let mut sorted: Vec<char> = chars.to_vec();
    sorted.sort();
    sorted.dedup();
    let glyphs = sorted.len() + 1;
    let head = {
        let mut table = Vec::new();
        table.extend(0x0001_0000u32.to_be_bytes());
        table.extend(0x0001_0000u32.to_be_bytes());
        table.extend(0u32.to_be_bytes());
        table.extend(0x5F0F3CF5u32.to_be_bytes());
        table.extend(0u16.to_be_bytes());
        table.extend(1000u16.to_be_bytes());
        table.extend([0u8; 16]);
        for value in [0i16, 0, 1000, 1000] {
            table.extend(value.to_be_bytes());
        }
        table.extend(0u16.to_be_bytes());
        table.extend(8u16.to_be_bytes());
        table.extend(2i16.to_be_bytes());
        table.extend(0i16.to_be_bytes());
        table.extend(0i16.to_be_bytes());
        table
    };
    let hhea = {
        let mut table = Vec::new();
        table.extend(0x0001_0000u32.to_be_bytes());
        for value in [800i16, -200, 0] {
            table.extend(value.to_be_bytes());
        }
        table.extend(1000u16.to_be_bytes());
        for value in [0i16, 0, 1000] {
            table.extend(value.to_be_bytes());
        }
        table.extend(1i16.to_be_bytes());
        table.extend(0i16.to_be_bytes());
        table.extend([0u8; 10]);
        table.extend(0i16.to_be_bytes());
        table.extend((glyphs as u16).to_be_bytes());
        table
    };
    let mut hmtx = Vec::new();
    for _ in 0..glyphs {
        hmtx.extend(1000u16.to_be_bytes());
        hmtx.extend(0i16.to_be_bytes());
    }
    let mut maxp = vec![0u8; 32];
    maxp[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
    maxp[4..6].copy_from_slice(&(glyphs as u16).to_be_bytes());
    let mut glyf = Vec::new();
    for _ in 0..glyphs {
        glyf.extend([0u8; 12]);
    }
    let mut loca = Vec::new();
    for index in 0..=glyphs {
        loca.extend(((index * 6) as u16).to_be_bytes());
    }
    let mut segments: Vec<(u32, u16)> = sorted
        .iter()
        .enumerate()
        .map(|(index, c)| (u32::from(*c), index as u16 + 1))
        .collect();
    segments.push((0xFFFF, 0));
    let count = segments.len();
    let mut subtable = Vec::new();
    subtable.extend(4u16.to_be_bytes());
    subtable.extend(((16 + 8 * count) as u16).to_be_bytes());
    subtable.extend(0u16.to_be_bytes());
    subtable.extend(((2 * count) as u16).to_be_bytes());
    let mut span = 1usize;
    while span * 2 <= count {
        span *= 2;
    }
    subtable.extend(((2 * span) as u16).to_be_bytes());
    subtable.extend((span.trailing_zeros() as u16).to_be_bytes());
    subtable.extend(((2 * count - 2 * span) as u16).to_be_bytes());
    for (code, _) in &segments {
        subtable.extend((*code as u16).to_be_bytes());
    }
    subtable.extend(0u16.to_be_bytes());
    for (code, _) in &segments {
        subtable.extend((*code as u16).to_be_bytes());
    }
    for (code, glyph) in &segments {
        subtable.extend(glyph.wrapping_sub(*code as u16).to_be_bytes());
    }
    for _ in &segments {
        subtable.extend(0u16.to_be_bytes());
    }
    let mut cmap = Vec::new();
    cmap.extend(0u16.to_be_bytes());
    cmap.extend(2u16.to_be_bytes());
    for (platform, encoding) in [(0u16, 3u16), (3, 1)] {
        cmap.extend(platform.to_be_bytes());
        cmap.extend(encoding.to_be_bytes());
        cmap.extend((4 + 16u32).to_be_bytes());
    }
    cmap.extend(&subtable);
    let text: Vec<u8> = "Octavo Test"
        .encode_utf16()
        .flat_map(|unit| unit.to_be_bytes())
        .collect();
    let mut name = Vec::new();
    name.extend(0u16.to_be_bytes());
    name.extend(4u16.to_be_bytes());
    name.extend(((6 + 4 * 12) as u16).to_be_bytes());
    for (index, id) in [1u16, 2, 4, 6].into_iter().enumerate() {
        name.extend(3u16.to_be_bytes());
        name.extend(1u16.to_be_bytes());
        name.extend(0x0409u16.to_be_bytes());
        name.extend(id.to_be_bytes());
        name.extend((text.len() as u16).to_be_bytes());
        name.extend(((index * text.len()) as u16).to_be_bytes());
    }
    name.extend(&text);
    let mut post = vec![0u8; 32];
    post[0..4].copy_from_slice(&0x0003_0000u32.to_be_bytes());
    let mut os2 = vec![0u8; 96];
    os2[0..2].copy_from_slice(&4u16.to_be_bytes());
    os2[4..6].copy_from_slice(&400u16.to_be_bytes());
    let mut tables: Vec<(&[u8; 4], Vec<u8>)> = vec![
        (b"OS/2", os2),
        (b"cmap", cmap),
        (b"glyf", glyf),
        (b"head", head),
        (b"hhea", hhea),
        (b"hmtx", hmtx),
        (b"loca", loca),
        (b"maxp", maxp),
        (b"name", name),
        (b"post", post),
    ];
    tables.sort_unstable();
    let count = tables.len();
    let mut span = 1usize;
    while span * 2 <= count {
        span *= 2;
    }
    let mut font = Vec::new();
    font.extend(0x0001_0000u32.to_be_bytes());
    font.extend((count as u16).to_be_bytes());
    font.extend(((span * 16) as u16).to_be_bytes());
    font.extend((span.trailing_zeros() as u16).to_be_bytes());
    font.extend(((count * 16 - span * 16) as u16).to_be_bytes());
    let mut body = Vec::new();
    let directory = 12 + 16 * count;
    for (tag, table) in &tables {
        font.extend_from_slice(*tag);
        font.extend(0u32.to_be_bytes());
        font.extend(((directory + body.len()) as u32).to_be_bytes());
        font.extend((table.len() as u32).to_be_bytes());
        body.extend(table);
        while body.len() % 4 != 0 {
            body.push(0);
        }
    }
    font.extend(body);
    font
}

fn maps(font: &[u8], c: char) -> bool {
    let sfnt = wuff::decompress_woff2(font).expect("valid woff2");
    FontRef::new(&sfnt)
        .expect("valid sfnt")
        .charmap()
        .map(u32::from(c))
        .is_some()
}

fn font_site(site: &Scratch) {
    site.write(
        "style.css",
        "@font-face { font-family: 'Octavo Test'; src: url(fonts/t.ttf) format('truetype'); }\nbody { font-family: 'Octavo Test'; }\n",
    );
    site.write("fonts/t.ttf", font_with(&['A', 'Ω']));
    site.write(
        "index.html",
        page(r#"<link rel="stylesheet" href="style.css">"#, "<p>x</p>"),
    );
}

fn subset_options() -> Options {
    Options {
        subset_text_fonts: true,
        ..Options::default()
    }
}

fn publish(site: &Scratch, options: &Options) -> Scratch {
    let out = Scratch::new();
    plan_directory(site.path(), options)
        .unwrap()
        .write(out.path())
        .unwrap();
    out
}

#[test]
fn a_subset_keeps_the_text_that_only_search_json_shows() {
    let site = Scratch::new();
    font_site(&site);
    site.write("search.json", r#"{ "entries": [] }"#);
    let options = subset_options();
    let without = publish(&site, &options);
    site.write("search.json", r#"{ "entries": [ { "title": "Ω" } ] }"#);
    let with = publish(&site, &options);
    let whole = publish(&site, &Options::default());
    let plain = whole.bytes("fonts/t.woff2");
    let kept = without.bytes("fonts/t.woff2");
    let found = with.bytes("fonts/t.woff2");
    assert!(kept.len() < plain.len(), "the font was not subsetted");
    assert!(maps(&kept, 'A') && !maps(&kept, 'Ω'), "{kept:?}");
    assert!(maps(&found, 'A') && maps(&found, 'Ω'), "{found:?}");
    assert!(found.len() > kept.len());
}

#[test]
fn an_unreadable_json_file_keeps_text_fonts_whole() {
    let site = Scratch::new();
    font_site(&site);
    site.write("search.json", r#"{ "entries": [ { "title": "Ω" } ] }"#);
    fs::write(site.path().join("bad.json"), [0xFF, 0xFE]).unwrap();
    let whole = publish(&site, &Options::default());
    let subset = publish(&site, &subset_options());
    assert_eq!(subset.bytes("fonts/t.woff2"), whole.bytes("fonts/t.woff2"));
    let plan = plan_directory(site.path(), &subset_options()).unwrap();
    assert!(
        plan.report()
            .warnings
            .iter()
            .any(|warning| warning.contains("bad.json"))
    );
}

#[test]
fn an_unreadable_script_keeps_text_fonts_whole() {
    let site = Scratch::new();
    font_site(&site);
    site.write(
        "index.html",
        page(
            r#"<link rel="stylesheet" href="style.css"><script src="app.js"></script>"#,
            "<p>x</p>",
        ),
    );
    fs::write(site.path().join("app.js"), [0xFF, 0xFE]).unwrap();
    let whole = publish(&site, &Options::default());
    let subset = publish(&site, &subset_options());
    assert_eq!(subset.bytes("fonts/t.woff2"), whole.bytes("fonts/t.woff2"));
    let plan = plan_directory(site.path(), &subset_options()).unwrap();
    assert!(
        plan.report()
            .warnings
            .iter()
            .any(|warning| warning.contains("app.js"))
    );
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
    assert!(leftovers(site.path()).is_empty());
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

#[test]
fn a_plan_writes_nothing() {
    let case = Case::new();
    let input = site_in(case.path());
    let before = tree(&input);
    let plan = plan_directory(&input, &Options::default()).unwrap();
    assert_eq!(tree(&input), before);
    assert!(!case.output().exists());
    assert!(leftovers(&case.output()).is_empty());
    assert_eq!(plan.files().len(), 3);
    assert_eq!(plan.report().files, 3);
    assert_eq!(plan.report().pages, 1);
}

#[test]
fn a_plan_knows_every_output_file() {
    let case = Case::new();
    let input = site_in(case.path());
    let plan = plan_directory(&input, &Options::default()).unwrap();
    let kinds: Vec<_> = plan
        .files()
        .iter()
        .map(|file| (file.path.clone(), file.kind))
        .collect();
    assert_eq!(
        kinds,
        [
            (PathBuf::from("data.json"), SiteFileKind::Other),
            (PathBuf::from("index.html"), SiteFileKind::Page),
            (PathBuf::from("style.css"), SiteFileKind::Stylesheet),
        ]
    );
    let page = plan
        .files()
        .iter()
        .find(|file| file.path.ends_with("index.html"))
        .unwrap();
    assert_eq!(
        page.size,
        fs::metadata(input.join("index.html")).unwrap().len()
    );
}

#[test]
fn the_staging_directory_is_gone_after_a_successful_write() {
    let case = Case::new();
    let input = site_in(case.path());
    let output = case.output();
    let plan = plan_directory(&input, &Options::default()).unwrap();
    plan.write(&output).unwrap();
    assert!(output.join("index.html").exists());
    assert!(leftovers(&output).is_empty());
}

#[test]
fn the_staging_directory_is_gone_after_a_failed_write() {
    let case = Case::new();
    let input = site_in(case.path());
    let output = case.output();
    fs::create_dir_all(&output).unwrap();
    fs::write(output.join("marker.txt"), b"keep me").unwrap();
    let before = tree(&output);
    let plan = plan_directory(&input, &Options::default()).unwrap();
    fs::remove_file(input.join("data.json")).unwrap();
    let error = plan.write(&output).unwrap_err();
    assert!(matches!(error, SiteError::Io { .. }), "{error:?}");
    assert!(leftovers(&output).is_empty());
    assert_eq!(tree(&output), before);
}

#[test]
fn a_file_of_an_earlier_run_does_not_survive() {
    let case = Case::new();
    let input = site_in(case.path());
    let output = case.output();
    fs::create_dir_all(&output).unwrap();
    fs::write(output.join("stale.html"), "<p>old</p>").unwrap();
    let plan = plan_directory(&input, &Options::default()).unwrap();
    plan.write(&output).unwrap();
    assert!(!output.join("stale.html").exists());
    assert!(output.join("index.html").exists());
}

#[test]
fn writing_in_place_keeps_the_directory_and_drops_the_old_tree() {
    let case = Case::new();
    let input = site_in(case.path());
    let before = fs::read_to_string(input.join("style.css")).unwrap();
    let plan = plan_directory(&input, &Options::default()).unwrap();
    plan.write(&input).unwrap();
    assert!(input.join("index.html").exists());
    assert!(input.join("data.json").exists());
    assert!(fs::read_to_string(input.join("style.css")).unwrap().len() < before.len());
    assert!(leftovers(&input).is_empty());
}

#[cfg(unix)]
#[test]
fn a_symlink_that_points_outside_the_input_is_refused() {
    let case = Case::new();
    let input = site_in(case.path());
    let outside = case.path().join("outside.txt");
    fs::write(&outside, b"outside").unwrap();
    std::os::unix::fs::symlink(&outside, input.join("link.txt")).unwrap();
    let error = plan_directory(&input, &Options::default()).unwrap_err();
    match error {
        SiteError::Symlink(path) => assert!(path.ends_with("link.txt"), "{path:?}"),
        other => panic!("{other:?}"),
    }
}

#[cfg(unix)]
#[test]
fn a_symlink_that_points_inside_the_input_is_copied_as_a_file() {
    let case = Case::new();
    let input = site_in(case.path());
    fs::write(input.join("real.txt"), b"inside").unwrap();
    std::os::unix::fs::symlink(input.join("real.txt"), input.join("link.txt")).unwrap();
    let output = case.output();
    let plan = plan_directory(&input, &Options::default()).unwrap();
    plan.write(&output).unwrap();
    assert_eq!(fs::read(output.join("link.txt")).unwrap(), b"inside");
    assert!(
        fs::symlink_metadata(output.join("link.txt"))
            .unwrap()
            .is_file()
    );
}
