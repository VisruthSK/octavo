use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

fn fixture(name: &str, contents: &str) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create fixture directory");
    let path = dir.join("page.html");
    fs::write(&path, contents).expect("write fixture");
    path
}

fn shrinkable() -> String {
    let rules: String = (0..200)
        .map(|i| format!(".unused{i}{{margin-left:{i}px}}"))
        .collect();
    format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>{rules}</style></head><body><p>hello</p></body></html>"
    )
}

fn optimize(path: &Path, extra: &[&str]) {
    let status = Command::new(env!("CARGO_BIN_EXE_octavo"))
        .arg(path)
        .arg(path)
        .args(extra)
        .output()
        .expect("run octavo")
        .status;
    assert!(status.success());
}

fn leftovers(path: &Path) -> Vec<String> {
    fs::read_dir(path.parent().expect("parent"))
        .expect("list directory")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .filter(|name| name != "page.html")
        .collect()
}

#[test]
fn a_failing_verifier_leaves_an_in_place_input_untouched() {
    let original = shrinkable();
    let path = fixture("failing-verifier", &original);
    optimize(&path, &["--verify", "exit 1"]);
    assert_eq!(fs::read_to_string(&path).expect("read"), original);
    assert!(leftovers(&path).is_empty(), "{:?}", leftovers(&path));
}

#[test]
fn the_verifier_sees_the_original_and_the_candidate_as_different_files() {
    let original = shrinkable();
    let path = fixture("distinct-files", &original);
    let differ = if cfg!(windows) {
        "fc /b {original} {optimized} >nul 2>&1 & (if errorlevel 1 if not errorlevel 2 exit 0) & exit 1"
    } else {
        "! cmp -s {original} {optimized}"
    };
    optimize(&path, &["--verify", differ]);
    let optimized = fs::read_to_string(&path).expect("read");
    assert!(optimized.len() < original.len());
    assert!(leftovers(&path).is_empty(), "{:?}", leftovers(&path));
}

#[test]
fn an_input_that_cannot_shrink_is_left_as_it_was_when_written_over_itself() {
    let original = "<!DOCTYPE html><html><head></head><body><p>hello</p></body></html>";
    let path = fixture("nothing-to-gain", original);
    optimize(&path, &[]);
    assert_eq!(fs::read_to_string(&path).expect("read"), original);
    assert!(leftovers(&path).is_empty(), "{:?}", leftovers(&path));
}

#[test]
fn a_separate_output_leaves_the_input_alone() {
    let original = shrinkable();
    let path = fixture("separate-output", &original);
    let output = path.with_file_name("out.html");
    let status = Command::new(env!("CARGO_BIN_EXE_octavo"))
        .arg(&path)
        .arg(&output)
        .output()
        .expect("run octavo")
        .status;
    assert!(status.success());
    assert_eq!(fs::read_to_string(&path).expect("read"), original);
    assert!(fs::read_to_string(&output).expect("read").len() < original.len());
}

#[test]
fn audit_reports_without_writing_anything() {
    let original = shrinkable();
    let path = fixture("audit", &original);
    let output = Command::new(env!("CARGO_BIN_EXE_octavo"))
        .arg("--audit")
        .arg(&path)
        .output()
        .expect("run octavo");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("transformation"));
    assert_eq!(fs::read_to_string(&path).expect("read"), original);
    assert!(leftovers(&path).is_empty(), "{:?}", leftovers(&path));
}
