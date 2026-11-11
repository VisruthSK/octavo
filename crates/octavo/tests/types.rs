use octavo::{ImageEncoding, ImageFormat, Quality, Target};

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
fn a_target_names_what_it_changed() {
    assert_eq!(Target::Library("tippy".to_string()).to_string(), "tippy");
    assert_eq!(Target::Resource("style".to_string()).to_string(), "style");
    assert_eq!(Target::Resources(1).to_string(), "1 resources");
}
