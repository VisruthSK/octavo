mod common;

use common::page;
use octavo::{
    ImageEncoding, ImageFormat, Library, Mode, Options, Quality, Target, Transform, Warning,
};
use std::num::{NonZeroU32, NonZeroUsize};

#[test]
fn a_quality_outside_one_to_one_hundred_is_refused() {
    assert!(Quality::new(0).is_none());
    assert!(Quality::new(101).is_none());
    assert!(Quality::new(255).is_none());
}

#[test]
fn a_quality_inside_one_to_one_hundred_is_kept() {
    for quality in [1, 60, 100] {
        assert_eq!(Quality::new(quality).map(Quality::get), Some(quality));
    }
}

#[test]
fn each_format_has_its_own_default_quality() {
    assert_eq!(ImageEncoding::new(ImageFormat::Avif).quality.get(), 60);
    assert_eq!(ImageEncoding::new(ImageFormat::Webp).quality.get(), 80);
}

#[test]
fn each_mode_has_a_name_and_parses_back() {
    for (mode, name) in [
        (Mode::Safe, "safe"),
        (Mode::Scripts, "scripts"),
        (Mode::Packed, "packed"),
    ] {
        assert_eq!(mode.to_string(), name);
        assert_eq!(name.parse::<Mode>(), Ok(mode));
    }
    assert!("verbose".parse::<Mode>().is_err());
}

#[test]
fn each_image_format_has_a_name_and_parses_back() {
    for (format, name) in [(ImageFormat::Avif, "avif"), (ImageFormat::Webp, "webp")] {
        assert_eq!(format.to_string(), name);
        assert_eq!(name.parse::<ImageFormat>(), Ok(format));
    }
    assert!("tiff".parse::<ImageFormat>().is_err());
}

#[test]
fn the_default_encoding_caps_the_longest_side_at_3840_pixels() {
    for format in [ImageFormat::Avif, ImageFormat::Webp] {
        assert_eq!(ImageEncoding::new(format).max_side, NonZeroU32::new(3840));
    }
}

#[test]
fn a_target_names_what_it_changed() {
    assert_eq!(Target::Library(Library::Tippy).to_string(), "tippy");
    assert_eq!(Target::Resource("style".to_string()).to_string(), "style");
    assert_eq!(
        Target::Resources(NonZeroUsize::new(1).expect("non-zero")).to_string(),
        "1 resources"
    );
}

#[test]
fn every_library_names_the_global_it_defines() {
    for (library, global) in [
        (Library::Tippy, "tippy"),
        (Library::Bootstrap, "bootstrap"),
        (Library::Popper, "Popper"),
        (Library::Clipboard, "ClipboardJS"),
        (Library::Anchor, "AnchorJS"),
    ] {
        assert_eq!(library.name(), global);
        assert_eq!(library.to_string(), global);
    }
}

#[test]
fn each_transform_has_a_name() {
    assert_eq!(Transform::DeadLibrary.to_string(), "dead-library");
    assert_eq!(Transform::MinifiedScript.to_string(), "script-minified");
    assert_eq!(Transform::PrunedStylesheet.to_string(), "stylesheet-pruned");
    assert_eq!(Transform::RecompressedPng.to_string(), "png-recompressed");
    assert_eq!(Transform::ReencodedImage.to_string(), "image-reencoded");
    assert_eq!(Transform::Packed.to_string(), "packed");
}

#[test]
fn a_remote_resource_warning_carries_the_url() {
    let src = page(
        "<script src=\"https://cdn.example.com/lib.js\"></script>",
        "<p>hi",
    );
    let out = octavo::optimize(&src, Mode::Safe).expect("supported");
    let [warning] = out.warnings.as_slice() else {
        panic!("expected one warning");
    };
    let Warning::RemoteResource(url) = warning else {
        panic!("expected a remote resource warning");
    };
    assert_eq!(url.as_str(), "https://cdn.example.com/lib.js");
    assert!(
        warning
            .to_string()
            .contains("https://cdn.example.com/lib.js")
    );
}

#[test]
fn defaults_are_lossless_and_subset_text_fonts() {
    let options = Options::default();
    assert!(options.images.is_none());
    assert!(options.subset_text_fonts);
    assert!(!options.strip_licenses);
}
