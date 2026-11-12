use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);

fn scratch() -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "octavo-cli-embed-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    fs::create_dir_all(&directory).unwrap();
    directory
}

fn write(root: &Path, path: &str, content: &str) {
    let full = root.join(path);
    fs::create_dir_all(full.parent().unwrap()).unwrap();
    fs::write(full, content).unwrap();
}

fn octavo(arguments: &[&std::ffi::OsStr]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_octavo"))
        .args(arguments)
        .output()
        .expect("the binary runs")
}

fn page(head: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html><head><title>t</title>{head}</head><body><p class="a">x</p></body></html>"#
    )
}

#[test]
fn a_page_that_links_local_files_is_embedded_then_optimized() {
    let root = scratch();
    write(
        &root,
        "style.css",
        ".a { color: red; }\n.unused { color: blue; }\n",
    );
    write(&root, "app.js", "let counter = 1;\nconsole.log(counter);\n");
    write(
        &root,
        "page.html",
        &page(r#"<link rel="stylesheet" href="style.css"><script src="app.js"></script>"#),
    );
    let page_path = root.join("page.html");
    let out = root.join("out.html");
    let output = octavo(&[
        page_path.as_os_str(),
        out.as_os_str(),
        "--level".as_ref(),
        "safe".as_ref(),
    ]);
    assert!(output.status.success(), "{output:?}");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("linked files embedded"), "{stdout}");
    let html = fs::read_to_string(&out).unwrap();
    assert!(
        !html.contains("style.css") && !html.contains("app.js"),
        "{html}"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_root_relative_site_libs_link_is_found_in_a_parent_directory() {
    let root = scratch();
    write(&root, "site_libs/x.css", ".a { color: red; }\n");
    write(
        &root,
        "posts/one/page.html",
        &page(r#"<link rel="stylesheet" href="/site_libs/x.css">"#),
    );
    let page_path = root.join("posts/one/page.html");
    let out = root.join("out.html");
    let output = octavo(&[
        page_path.as_os_str(),
        out.as_os_str(),
        "--level".as_ref(),
        "safe".as_ref(),
    ]);
    assert!(output.status.success(), "{output:?}");
    assert!(
        !fs::read_to_string(&out)
            .unwrap()
            .contains("/site_libs/x.css")
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_quarto_files_directory_is_found_beside_the_page() {
    let root = scratch();
    write(&root, "report_files/libs/x.css", ".a { color: red; }\n");
    write(
        &root,
        "report.html",
        &page(r#"<link rel="stylesheet" href="report_files/libs/x.css">"#),
    );
    let page_path = root.join("report.html");
    let out = root.join("out.html");
    let output = octavo(&[
        page_path.as_os_str(),
        out.as_os_str(),
        "--level".as_ref(),
        "safe".as_ref(),
    ]);
    assert!(output.status.success(), "{output:?}");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn resource_path_says_where_to_look() {
    let root = scratch();
    write(
        &root,
        "pages/page.html",
        &page(r#"<link rel="stylesheet" href="libs/style.css">"#),
    );
    write(&root, "elsewhere/libs/style.css", ".a { color: red; }\n");
    let page_path = root.join("pages/page.html");
    let out = root.join("out.html");
    let refused = octavo(&[page_path.as_os_str(), out.as_os_str()]);
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("--resource-path"));
    let elsewhere = root.join("elsewhere");
    let found = octavo(&[
        page_path.as_os_str(),
        out.as_os_str(),
        "--resource-path".as_ref(),
        elsewhere.as_os_str(),
        "--level".as_ref(),
        "safe".as_ref(),
    ]);
    assert!(found.status.success(), "{found:?}");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_file_that_cannot_be_found_is_named_in_the_error() {
    let root = scratch();
    write(
        &root,
        "page.html",
        &page(r#"<link rel="stylesheet" href="nothing.css">"#),
    );
    let page_path = root.join("page.html");
    let out = root.join("out.html");
    let output = octavo(&[page_path.as_os_str(), out.as_os_str()]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("nothing.css"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn resource_path_is_refused_for_a_directory() {
    let root = scratch();
    write(&root, "index.html", &page(""));
    let other = root.join("other");
    let output = octavo(&[
        root.as_os_str(),
        "--resource-path".as_ref(),
        other.as_os_str(),
    ]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("--resource-path"));
    let _ = fs::remove_dir_all(&root);
}
