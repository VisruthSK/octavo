use crate::common::page;
use octavo::{
    Effort, EvidenceClass, ImageEncoding, ImageFormat, Library, Mode, Options, Packaging, Quality,
    Rule, Target, Transform, Warning,
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
        (Mode::Serve, "serve"),
        (Mode::Portable, "portable"),
        (Mode::Archive, "archive"),
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
    assert_eq!(Transform::FontKeptWhole.to_string(), "font-kept-whole");
    assert_eq!(Transform::Packed.to_string(), "packed");
}

#[test]
fn a_remote_resource_warning_carries_the_url() {
    let src = page(
        "<script src=\"https://cdn.example.com/lib.js\"></script>",
        "<p>hi",
    );
    let out = octavo::optimize(&src, Mode::Serve).expect("supported");
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

#[test]
fn each_packaging_has_a_name_and_parses_back() {
    for (packaging, name) in [
        (Packaging::Plain, "plain"),
        (Packaging::Scripts, "scripts"),
        (Packaging::Packed, "packed"),
    ] {
        assert_eq!(packaging.to_string(), name);
        assert_eq!(name.parse::<Packaging>(), Ok(packaging));
    }
    assert!("other".parse::<Packaging>().is_err());
}

#[test]
fn each_effort_has_a_name_and_parses_back() {
    for (effort, name) in [
        (Effort::Fast, "fast"),
        (Effort::Balanced, "balanced"),
        (Effort::Maximum, "maximum"),
    ] {
        assert_eq!(effort.to_string(), name);
        assert_eq!(name.parse::<Effort>(), Ok(effort));
    }
    assert!("extreme".parse::<Effort>().is_err());
}

#[test]
fn each_evidence_class_has_a_name_and_parses_back() {
    for (class, name) in [
        (EvidenceClass::Exact, "exact"),
        (EvidenceClass::Generic, "generic"),
        (EvidenceClass::Quarto1, "quarto1"),
    ] {
        assert_eq!(class.to_string(), name);
        assert_eq!(name.parse::<EvidenceClass>(), Ok(class));
    }
    assert!("speculative".parse::<EvidenceClass>().is_err());
}

#[test]
fn mode_converts_to_and_from_packaging() {
    assert_eq!(Mode::Serve.packaging(), Packaging::Plain);
    assert_eq!(Mode::Portable.packaging(), Packaging::Scripts);
    assert_eq!(Mode::Archive.packaging(), Packaging::Packed);
    assert_eq!(Mode::from(Packaging::Plain), Mode::Serve);
    assert_eq!(Mode::from(Packaging::Scripts), Mode::Portable);
    assert_eq!(Mode::from(Packaging::Packed), Mode::Archive);
}

#[test]
fn each_rule_has_a_name_and_class() {
    for (rule, name, transform, class) in [
        (
            Rule::QuartoDeadLibrary,
            "quarto-dead-library",
            Transform::DeadLibrary,
            EvidenceClass::Quarto1,
        ),
        (
            Rule::ScriptMinified,
            "script-minified",
            Transform::MinifiedScript,
            EvidenceClass::Generic,
        ),
        (
            Rule::StylesheetPruned,
            "stylesheet-pruned",
            Transform::PrunedStylesheet,
            EvidenceClass::Generic,
        ),
        (
            Rule::PngRecompressed,
            "png-recompressed",
            Transform::RecompressedPng,
            EvidenceClass::Generic,
        ),
        (
            Rule::ImageReencoded,
            "image-reencoded",
            Transform::ReencodedImage,
            EvidenceClass::Generic,
        ),
        (
            Rule::FontKeptWhole,
            "font-kept-whole",
            Transform::FontKeptWhole,
            EvidenceClass::Generic,
        ),
        (
            Rule::PackResources,
            "pack-resources",
            Transform::Packed,
            EvidenceClass::Generic,
        ),
    ] {
        assert_eq!(rule.to_string(), name);
        assert_eq!(rule.transform(), transform);
        assert_eq!(rule.evidence_class(), class);
        assert_eq!(Rule::from(transform), rule);
    }
}

#[test]
fn applied_edits_carry_rule_and_evidence() {
    let src = page(
        "<style>.a{color:red}.b{color:blue}</style>",
        "<p class=a>hi",
    );
    let out = octavo::optimize(&src, Mode::Serve).expect("supported");
    for step in &out.applied {
        assert_eq!(step.rule.transform(), step.transform);
        assert_eq!(step.rule.evidence_class(), step.evidence);
    }
}

#[test]
fn simplified_packages_across_independent_packaging() {
    let src = page("<style>.a{color:red}</style>", "<p class=a>hi");
    let simplified = octavo::simplify(&src, Options::default()).expect("supported");
    let plain = simplified.package(Packaging::Plain);
    let packed = simplified.package(Packaging::Packed);
    assert_eq!(plain.html, simplified.pack(Mode::Serve).html);
    assert_eq!(packed.html, simplified.pack(Mode::Archive).html);
}
