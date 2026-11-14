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

fn serve(files: &'static [(&'static str, &'static str, &'static [u8])]) -> u16 {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut buffer = [0u8; 4096];
            let read = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..read]).to_string();
            let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
            let found = files.iter().find(|(name, _, _)| *name == path);
            let (status, kind, body): (&str, &str, &[u8]) = match found {
                Some((_, kind, body)) => ("200 OK", kind, body),
                None => ("404 Not Found", "text/plain", b"missing"),
            };
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(body);
        }
    });
    port
}

#[test]
fn files_linked_from_the_web_are_downloaded_and_embedded() {
    let port = serve(&[
        (
            "/fonts/s.css",
            "text/css",
            b".a { color: red; }\n@font-face { font-family: F; src: url(f.woff2); }\n",
        ),
        ("/fonts/f.woff2", "font/woff2", b"font bytes"),
    ]);
    let root = scratch();
    write(
        &root,
        "page.html",
        &page(&format!(
            r#"<link rel="stylesheet" href="http://127.0.0.1:{port}/fonts/s.css">"#
        )),
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
    let html = fs::read_to_string(&out).unwrap();
    assert!(!html.contains("127.0.0.1"), "{html}");
    assert!(
        html.contains("linked files embedded") || html.contains("data:text/css"),
        "{html}"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn no_fetch_leaves_web_links_alone() {
    let root = scratch();
    write(
        &root,
        "page.html",
        &page(r#"<link rel="stylesheet" href="http://127.0.0.1:9/s.css">"#),
    );
    let page_path = root.join("page.html");
    let out = root.join("out.html");
    let output = octavo(&[
        page_path.as_os_str(),
        out.as_os_str(),
        "--no-fetch".as_ref(),
        "--level".as_ref(),
        "safe".as_ref(),
    ]);
    assert!(output.status.success(), "{output:?}");
    assert!(fs::read_to_string(&out).unwrap().contains("127.0.0.1:9"));
    let _ = fs::remove_dir_all(&root);
}
