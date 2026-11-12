use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);

fn scratch() -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "octavo-cli-site-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    fs::create_dir_all(&directory).unwrap();
    directory
}

fn site(root: &Path) {
    fs::write(
        root.join("style.css"),
        ".a { color: red; }\n.unused { color: blue; }\n",
    )
    .unwrap();
    fs::write(
        root.join("index.html"),
        r#"<!DOCTYPE html><html><head><title>t</title><link rel="stylesheet" href="style.css"></head><body><p class="a">x</p></body></html>"#,
    )
    .unwrap();
}

fn octavo(arguments: &[&std::ffi::OsStr]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_octavo"))
        .args(arguments)
        .output()
        .expect("the binary runs")
}

#[test]
fn a_directory_is_optimized_into_a_sibling_ending_in_min() {
    let root = scratch();
    let input = root.join("_site");
    fs::create_dir_all(&input).unwrap();
    site(&input);
    let output = octavo(&[input.as_os_str()]);
    assert!(output.status.success(), "{output:?}");
    let written = root.join("_site.min");
    assert!(written.join("index.html").exists());
    assert!(
        fs::read_to_string(written.join("style.css")).unwrap().len()
            < fs::read_to_string(input.join("style.css")).unwrap().len()
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("stylesheets"), "{stdout}");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_named_output_directory_is_used() {
    let root = scratch();
    let input = root.join("in");
    fs::create_dir_all(&input).unwrap();
    site(&input);
    let target = root.join("elsewhere");
    let output = octavo(&[input.as_os_str(), target.as_os_str()]);
    assert!(output.status.success(), "{output:?}");
    assert!(target.join("style.css").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn audit_and_lossy_images_are_refused_for_a_directory() {
    let root = scratch();
    site(&root);
    for flag in ["--audit", "--lossy-images"] {
        let output = octavo(&[root.as_os_str(), flag.as_ref()]);
        assert!(!output.status.success(), "{flag}");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(stderr.contains(flag), "{stderr}");
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rewriting_a_directory_in_place_needs_the_flag() {
    let root = scratch();
    site(&root);
    let before = fs::read_to_string(root.join("style.css")).unwrap();
    let refused = octavo(&[root.as_os_str(), root.as_os_str()]);
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("--in-place"));
    assert_eq!(fs::read_to_string(root.join("style.css")).unwrap(), before);
    let allowed = octavo(&[root.as_os_str(), root.as_os_str(), "--in-place".as_ref()]);
    assert!(allowed.status.success(), "{allowed:?}");
    assert!(fs::read_to_string(root.join("style.css")).unwrap().len() < before.len());
    let _ = fs::remove_dir_all(&root);
}
