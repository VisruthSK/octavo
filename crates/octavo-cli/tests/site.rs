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

/// The directories a run left beside the output.
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

#[cfg(unix)]
fn lock(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o000)).unwrap();
}

#[cfg(windows)]
fn lock(path: &Path) -> fs::File {
    use std::os::windows::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(path)
        .unwrap()
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

#[test]
fn the_staging_directory_is_gone_after_a_run() {
    let root = scratch();
    let input = root.join("_site");
    fs::create_dir_all(&input).unwrap();
    site(&input);
    let output = root.join("_site.min");
    let run = octavo(&[input.as_os_str(), output.as_os_str()]);
    assert!(run.status.success(), "{run:?}");
    assert!(output.join("index.html").exists());
    assert!(leftovers(&output).is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn the_staging_directory_is_gone_after_a_failed_run() {
    let root = scratch();
    let input = root.join("_site");
    fs::create_dir_all(&input).unwrap();
    site(&input);
    let output = root.join("_site.min");
    let run = {
        #[cfg(unix)]
        lock(&input.join("index.html"));
        #[cfg(windows)]
        let _locked = lock(&input.join("index.html"));
        octavo(&[input.as_os_str(), output.as_os_str()])
    };
    assert!(!run.status.success(), "{run:?}");
    assert!(leftovers(&output).is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_file_of_an_earlier_run_does_not_survive() {
    let root = scratch();
    let input = root.join("_site");
    fs::create_dir_all(&input).unwrap();
    site(&input);
    let output = root.join("_site.min");
    fs::create_dir_all(&output).unwrap();
    fs::write(output.join("stale.html"), "<p>old</p>").unwrap();
    let run = octavo(&[input.as_os_str(), output.as_os_str()]);
    assert!(run.status.success(), "{run:?}");
    assert!(!output.join("stale.html").exists());
    assert!(output.join("index.html").exists());
    assert!(output.join("style.css").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_failed_run_leaves_the_output_untouched() {
    let root = scratch();
    let input = root.join("_site");
    fs::create_dir_all(&input).unwrap();
    site(&input);
    let output = root.join("_site.min");
    fs::create_dir_all(&output).unwrap();
    fs::write(output.join("marker.txt"), "keep me").unwrap();
    fs::write(output.join("old.html"), "<p>old</p>").unwrap();
    let before = tree(&output);
    let run = {
        #[cfg(unix)]
        lock(&input.join("index.html"));
        #[cfg(windows)]
        let _locked = lock(&input.join("index.html"));
        octavo(&[input.as_os_str(), output.as_os_str()])
    };
    assert!(!run.status.success(), "{run:?}");
    let stderr = String::from_utf8_lossy(&run.stderr);
    assert!(stderr.contains("index.html"), "{stderr}");
    assert_eq!(tree(&output), before);
    assert!(leftovers(&output).is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn a_symlink_that_points_outside_the_site_is_refused() {
    let root = scratch();
    let input = root.join("_site");
    fs::create_dir_all(&input).unwrap();
    site(&input);
    let outside = root.join("outside.txt");
    fs::write(&outside, "outside").unwrap();
    std::os::unix::fs::symlink(&outside, input.join("link.txt")).unwrap();
    let output = root.join("_site.min");
    let run = octavo(&[input.as_os_str(), output.as_os_str()]);
    assert!(!run.status.success(), "{run:?}");
    let stderr = String::from_utf8_lossy(&run.stderr);
    assert!(stderr.contains("link.txt"), "{stderr}");
    assert!(!output.exists());
    assert!(leftovers(&output).is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn a_symlink_that_points_inside_the_site_is_copied_as_a_file() {
    let root = scratch();
    let input = root.join("_site");
    fs::create_dir_all(&input).unwrap();
    site(&input);
    fs::write(input.join("real.txt"), "inside").unwrap();
    std::os::unix::fs::symlink(input.join("real.txt"), input.join("link.txt")).unwrap();
    let output = root.join("_site.min");
    let run = octavo(&[input.as_os_str(), output.as_os_str()]);
    assert!(run.status.success(), "{run:?}");
    assert_eq!(fs::read(output.join("link.txt")).unwrap(), b"inside");
    assert!(
        fs::symlink_metadata(output.join("link.txt"))
            .unwrap()
            .is_file()
    );
    let _ = fs::remove_dir_all(&root);
}
