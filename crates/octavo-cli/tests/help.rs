use octavo::{ImageEncoding, ImageFormat, Tuning};
use std::process::Command;

fn help() -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_octavo"))
        .arg("--help")
        .output()
        .expect("the binary runs");
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn the_help_quotes_the_defaults_the_library_uses() {
    let help = help();
    let avif = ImageEncoding::new(ImageFormat::Avif);
    let webp = ImageEncoding::new(ImageFormat::Webp);
    let expected = [
        format!(
            "[default: {} for avif, {} for webp]",
            avif.quality.get(),
            webp.quality.get()
        ),
        format!(
            "[default: {}]",
            avif.max_side.expect("a default side").get()
        ),
        format!(
            "[default: {}, slowest: {}]",
            Tuning::BALANCED.woff2_quality,
            Tuning::MAXIMUM.woff2_quality
        ),
        format!(
            "[default: chosen by image size, slowest: {}]",
            Tuning::MAXIMUM.png_preset.expect("a maximum preset")
        ),
        format!(
            "[default: {}, slowest: {}]",
            Tuning::DEFAULT_BROTLI_QUALITY,
            Tuning::MAXIMUM.brotli_quality.expect("a maximum quality")
        ),
    ];
    for quoted in expected {
        assert!(help.contains(&quoted), "the help does not contain {quoted}");
    }
}

#[test]
fn the_completions_carry_the_same_help_as_the_help_screen() {
    let output = Command::new(env!("CARGO_BIN_EXE_octavo"))
        .args(["--completions", "nushell"])
        .output()
        .expect("the binary runs");
    let script = String::from_utf8_lossy(&output.stdout);
    let quality = format!("[default: {}, slowest: 11]", Tuning::DEFAULT_BROTLI_QUALITY);
    assert!(
        script.contains(&quality),
        "the completions do not contain {quality}"
    );
}
