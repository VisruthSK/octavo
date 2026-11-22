use crate::common::page;
use octavo::{
    AuditEntry, AuditReport, Config, Effort, EvidenceClass, FontPolicy, ImageEncoding, ImageFormat,
    Library, Licenses, Packaging, PngPolicy, Quality, Rule, Target, Transform, Warning,
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
fn each_packaging_has_a_name_and_parses_back() {
    for (packaging, name) in [
        (Packaging::Plain, "plain"),
        (Packaging::Scripts, "scripts"),
        (Packaging::Packed, "packed"),
    ] {
        assert_eq!(packaging.to_string(), name);
        assert_eq!(name.parse::<Packaging>(), Ok(packaging));
    }
    assert!("serve".parse::<Packaging>().is_err());
    assert!("portable".parse::<Packaging>().is_err());
    assert!("archive".parse::<Packaging>().is_err());
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
    assert!("unknown".parse::<Effort>().is_err());
}

#[test]
fn each_evidence_class_has_a_name_and_parses_back() {
    for (evidence, name) in [
        (EvidenceClass::Exact, "exact"),
        (EvidenceClass::Generic, "generic"),
        (EvidenceClass::Quarto1, "quarto1"),
    ] {
        assert_eq!(evidence.to_string(), name);
        assert_eq!(name.parse::<EvidenceClass>(), Ok(evidence));
    }
    assert!("heuristic".parse::<EvidenceClass>().is_err());
}

#[test]
fn each_font_policy_has_a_name_and_parses_back() {
    for (policy, name) in [
        (FontPolicy::Auto, "auto"),
        (FontPolicy::Force, "force"),
        (FontPolicy::Off, "off"),
    ] {
        assert_eq!(policy.to_string(), name);
        assert_eq!(name.parse::<FontPolicy>(), Ok(policy));
    }
    assert!("none".parse::<FontPolicy>().is_err());
}

#[test]
fn each_licenses_policy_has_a_name_and_parses_back() {
    for (licenses, name) in [(Licenses::Keep, "keep"), (Licenses::Strip, "strip")] {
        assert_eq!(licenses.to_string(), name);
        assert_eq!(name.parse::<Licenses>(), Ok(licenses));
    }
    assert!("drop".parse::<Licenses>().is_err());
}

#[test]
fn each_png_policy_has_a_name_and_parses_back() {
    for (png, name) in [
        (PngPolicy::LosslessWebp, "lossless-webp"),
        (PngPolicy::Preserve, "preserve"),
    ] {
        assert_eq!(png.to_string(), name);
        assert_eq!(name.parse::<PngPolicy>(), Ok(png));
    }
    assert!("webp".parse::<PngPolicy>().is_err());
}

#[test]
fn each_rule_has_a_name_and_authorizing_evidence() {
    for (rule, name, evidence) in [
        (
            Rule::QuartoDeadLibrary,
            "quarto-dead-library",
            EvidenceClass::Quarto1,
        ),
        (Rule::ScriptMinified, "script-minified", EvidenceClass::Exact),
        (
            Rule::StylesheetPruned,
            "stylesheet-pruned",
            EvidenceClass::Generic,
        ),
        (
            Rule::PngRecompressed,
            "png-recompressed",
            EvidenceClass::Generic,
        ),
        (
            Rule::ImageReencoded,
            "image-reencoded",
            EvidenceClass::Generic,
        ),
        (
            Rule::FontKeptWhole,
            "font-kept-whole",
            EvidenceClass::Generic,
        ),
        (
            Rule::FontSubsetted,
            "font-subsetted",
            EvidenceClass::Generic,
        ),
        (Rule::PackResources, "pack-resources", EvidenceClass::Generic),
    ] {
        assert_eq!(rule.to_string(), name);
        assert_eq!(rule.evidence_class(), evidence);
    }
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
    let out = octavo::optimize(&src, Packaging::Plain).expect("supported");
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
fn defaults_use_safe_orthogonal_settings() {
    let config = Config::default();
    assert!(config.images.is_none());
    assert_eq!(config.fonts, FontPolicy::Auto);
    assert_eq!(config.licenses, Licenses::Keep);
    assert_eq!(config.png, PngPolicy::LosslessWebp);
    assert_eq!(config.packaging, Packaging::Plain);
    assert_eq!(config.effort, Effort::Balanced);
    assert_eq!(config.evidence, EvidenceClass::Generic);
    assert!(config.tuning.is_none());
    assert!(config.cache.is_none());
}

#[test]
fn audit_report_aggregates_records() {
    let mut entry = AuditEntry::default();
    entry.count = 2;
    entry.before = 1000;
    entry.after = 400;
    assert_eq!(entry.saved(), 600);

    let src = page(
        "<script>let a = 1; let b = 2;</script>",
        "<p class=\"test\">hello</p>",
    );
    let out = octavo::optimize(&src, Packaging::Plain).expect("supported");
    let report: AuditReport = out.report();
    assert!(report.by_transform.contains_key(&Transform::MinifiedScript));
    assert!(report.by_rule.contains_key(&Rule::ScriptMinified));
    assert!(report.by_evidence.contains_key(&EvidenceClass::Exact));
}
