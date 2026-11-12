mod common;

use common::{busy_script, data_uri, packed, page, safe, simplified};
use octavo::{Compression, Mode, Options, Tuning, optimize, simplify};

#[test]
fn css_comments_mentioning_custom_properties_do_not_swallow_rules() {
    let out = safe(&page(
        "<style>/* set --gap: 1rem */ .a{color:red} .b{color:blue}</style>",
        "<p class=\"a b\">",
    ));
    assert!(out.contains(".a{color:red}") && out.contains(".b{color:#00f}"));
}

#[test]
fn important_custom_properties_keep_their_priority() {
    let out = safe(&page(
        "<style>.a{--x:red !important;--x:blue;color:var(--x)}</style>",
        "<p class=a>",
    ));
    assert!(out.contains("--x:red!important"));
}

#[test]
fn custom_property_strings_with_semicolons_survive() {
    let out = safe(&page(
        r#"<style>.a{--s:"a;b}c";--t:url(data:x;base64,AAA);content:var(--s);background:var(--t)}</style>"#,
        "<p class=a>",
    ));
    assert!(out.contains(r#"--s:"a;b}c""#) && out.contains("--t:url(data:x;base64,AAA)"));
}

#[test]
fn layer_blocks_are_never_removed_so_layer_order_is_stable() {
    let css = "@layer base{.unused{top:0}}@layer theme{p{color:blue}}@layer base{p{color:green}}";
    let out = safe(&page(&format!("<style>{css}</style>"), "<p>"));
    assert!(out.find("base").unwrap() < out.find("theme").unwrap());
}

#[test]
fn camel_case_svg_type_selectors_are_kept() {
    let out = safe(&page(
        "<style>foreignObject{overflow:visible}clipPath{opacity:1}</style>",
        "<svg><foreignObject></foreignObject><clipPath></clipPath></svg>",
    ));
    assert!(out.contains("foreignObject") && out.contains("clipPath"));
}

#[test]
fn class_names_with_arbitrary_punctuation_are_reachable() {
    let out = safe(&page(
        r"<style>.w-\[50\%\]{width:50%}.\!mt-0{margin:0}.gone{top:0}</style>",
        "<p class=\"w-[50%] !mt-0\">",
    ));
    assert!(out.contains("50") && out.contains("margin") && !out.contains("gone"));
}

#[test]
fn rules_inside_noscript_do_not_become_pack_sites() {
    let src = page(
        &format!(
            "<noscript><style>{}</style></noscript><script>{}</script>",
            ".k{top:0}".repeat(60),
            busy_script("a")
        ),
        "<p>",
    );
    let out = packed(&src);
    assert!(!out.contains("<noscript><script>"));
    assert!(out.contains("$o(0"));
}

#[test]
fn attribute_values_with_newlines_and_entities_stay_valid_javascript() {
    let src = page(
        &format!(
            "<script data-b=\"line1\nline2\">{}</script>",
            busy_script("b")
        ),
        "<p>",
    );
    let out = packed(&src);
    assert!(!out.contains("line1\nline2") || !out.contains("$o(0,0,"));
    let src = page(
        &format!("<script data-a=\"x &amp; y\">{}</script>", busy_script("c")),
        "<p>",
    );
    assert!(!packed(&src).contains("data-a\":\"x &amp;"));
}

#[test]
fn a_script_matching_two_library_signatures_does_not_panic() {
    let both = format!(
        "/*! Bootstrap v5.3 @popperjs/core v2 */{}",
        "var q=1;".repeat(400)
    );
    let out = safe(&page(&format!("<script>{both}</script>"), "<p>"));
    assert!(!out.contains("var q=1;") && !out.contains("Bootstrap"));
}

#[test]
fn library_signatures_must_appear_in_the_banner() {
    let bundle = format!("{}/* clipboard.js v2.0.11 */", "var q=1;".repeat(400));
    let out = safe(&page(&format!("<script>{bundle}</script>"), "<p>"));
    assert!(out.contains("clipboard.js"));
}

#[test]
fn the_null_object_stub_cannot_collide_with_page_globals() {
    let clipboard = format!("/*! clipboard.js v2.0.11 */{}", "var q=1;".repeat(400));
    let src = page(
        &format!("<script>let n=1</script><script>{clipboard}</script>"),
        "<p>",
    );
    let out = safe(&src);
    assert!(
        out.contains("{let ") && out.contains("new Proxy") && out.contains("window.ClipboardJS=")
    );
}

#[test]
fn font_families_match_case_insensitively() {
    let font =
        "@font-face{font-family:Lato;src:url(data:font/ttf;base64,AAAA)}body{font-family:lato}";
    let out = safe(&page(&format!("<style>{font}</style>"), "<p>"));
    assert!(out.contains("@font-face"));
}

#[test]
fn fonts_used_only_by_inline_svg_styles_are_kept() {
    let face = "@font-face{font-family:\"Fira Code\";src:url(data:font/ttf;base64,AAAA)}";
    let svg = "<svg><style>text{font-family:\"Fira Code\"}</style><text>x</text></svg>";
    assert!(safe(&page(&format!("<style>{face}</style>"), svg)).contains("@font-face"));
}

#[test]
fn unused_fonts_are_dropped_but_variable_referenced_fonts_are_kept() {
    let used = "@font-face{font-family:Vault;src:url(data:font/ttf;base64,AAAA)}:root{--heading:Vault,serif}p{font-family:var(--heading)}";
    assert!(safe(&page(&format!("<style>{used}</style>"), "<p>")).contains("@font-face"));
    let unused = "@font-face{font-family:Ghost;src:url(data:font/ttf;base64,AAAA)}p{color:red}";
    assert!(!safe(&page(&format!("<style>{unused}</style>"), "<p>")).contains("Ghost"));
}

#[test]
fn module_scripts_in_any_case_are_not_packed() {
    for kind in ["Module", "MODULE", "importmap", "speculationrules"] {
        let src = page(
            &format!("<script type=\"{kind}\">{}</script>", busy_script("m")),
            "<p>",
        );
        assert!(!packed(&src).contains("$o("), "{kind}");
    }
}

#[test]
fn script_types_that_merely_contain_javascript_keep_their_type() {
    let src = page(
        &format!(
            "<script type=\"text/x-javascript-template\">{}</script>",
            busy_script("t")
        ),
        "<p>",
    );
    assert!(packed(&src).contains("text/x-javascript-template"));
}

#[test]
fn svg_with_scripts_or_event_handlers_is_not_packed() {
    let shapes: String = (0..120)
        .map(|i| format!("<rect x=\"{i}\" y=\"{}\" width=\"3\" height=\"3\"/>", i * 2))
        .collect();
    for active in ["<script>alert(1)</script>", "<g onclick=\"go()\"></g>"] {
        let src = page("", &format!("<svg>{shapes}{active}</svg>"));
        assert!(!packed(&src).contains("$o("), "{active}");
    }
}

#[test]
fn single_quoted_attribute_values_containing_double_quotes_stay_well_formed() {
    let module = "window.x=1;".repeat(300);
    let encoded = data_uri("text/javascript", module.as_bytes());
    let src = page(
        &format!("<script type=module data-q='say \"hi\"' src=\"{encoded}\"></script>"),
        "<p>",
    );
    let out = safe(&src);
    assert!(out.contains("data-q=\"say &quot;hi&quot;\"") || out.contains("src="));
}

#[test]
fn a_module_data_uri_with_an_upper_case_scheme_is_inlined_like_a_lower_case_one() {
    let module = "window.once=(window.once||0)+1;".repeat(60);
    let encoded = data_uri("text/javascript", module.as_bytes());
    for scheme in ["data:", "DATA:"] {
        let tag = format!(
            "<script type=module src=\"{}\"></script>",
            encoded.replacen("data:", scheme, 1)
        );
        let out = safe(&page(&tag, "<p>"));
        assert!(!out.contains("src="), "{scheme}: {out:.200}");
        assert!(out.contains("window.once"), "{scheme}: {out:.200}");
    }
}

#[test]
fn duplicated_data_uri_modules_are_not_inlined_twice() {
    let module = "window.once=(window.once||0)+1;".repeat(80);
    let encoded = data_uri("text/javascript", module.as_bytes());
    let tag = format!("<script type=module src=\"{encoded}\"></script>");
    let out = safe(&page(&format!("{tag}{tag}"), "<p>"));
    assert_eq!(out.matches("src=").count(), 2);
}

#[test]
fn scanner_survives_stray_angle_brackets_and_unterminated_constructs() {
    for src in [
        "a <3 <script>var x=1;</script>",
        "<script>if (a<b) {}",
        "<style>.a{",
        "<!-- never closed <style>.a{}</style>",
        "<!--><style>.a{color:red}</style>",
        "<script>x</scriptx><script>y</script>",
        "<svg><svg><circle/></svg>",
    ] {
        let _ = simplify(src, Options::default());
    }
}

#[test]
fn every_truncation_of_a_realistic_document_is_handled_without_panicking() {
    let css = ".a{color:red;--x:1}@media print{.b{top:0}}";
    let script = "window.addEventListener('x',function(){el.classList.add('a')});";
    let whole = page(
        &format!(
            "<style>{css}</style><script>{script}</script><link rel=stylesheet href=\"data:text/css,.a%7Bcolor:red%7D\">"
        ),
        "<p class=\"a\">héllo ✓</p><svg><circle r=\"1\"/></svg>",
    );
    for end in (0..whole.len()).filter(|i| whole.is_char_boundary(*i)) {
        let _ = optimize(&whole[..end], Mode::Packed);
    }
}

#[test]
fn unprefixed_backdrop_filter_survives_next_to_its_prefixed_twin() {
    let out = safe(&page(
        "<style>.a{color:red;backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}</style>",
        "<p class=\"a\">",
    ));
    assert!(
        out.contains(";backdrop-filter:blur(5px)")
            || out.contains("{backdrop-filter:blur(5px)")
            || out.contains("red;backdrop-filter:blur(5px)"),
        "{out}"
    );
    assert!(out.contains("-webkit-backdrop-filter:blur(5px)"));
}

#[test]
fn only_textual_data_counts_as_words_the_page_can_use() {
    let hidden_in_pixels = data_uri("image/png", b"onlyinbinary");
    let hidden_in_text = data_uri("text/plain", b"onlyintext");
    let out = safe(&page(
        "<style>.onlyinbinary{color:red}.onlyintext{color:blue}</style>",
        &format!("<img src=\"{hidden_in_pixels}\"><img src=\"{hidden_in_text}\">"),
    ));
    assert!(!out.contains(".onlyinbinary"), "{out}");
    assert!(out.contains(".onlyintext{"), "{out}");
}

#[test]
fn a_font_face_with_legacy_sources_keeps_one_woff2_copy_from_the_last_src() {
    let font = include_bytes!("data/octavo-test.ttf");
    let css = format!(
        "@font-face{{font-family:Octavo Test;src:url({eot});src:url({eot}) format(\"embedded-opentype\"),url({ttf}) format(\"truetype\")}}body{{font-family:Octavo Test}}",
        eot = data_uri("application/vnd.ms-fontobject", b"not a usable font"),
        ttf = data_uri("font/ttf", font),
    );
    let out = safe(&page(&format!("<style>{css}</style>"), "<p>A</p>"));
    assert!(out.contains("data:font/woff2"), "{out}");
    assert!(!out.contains("fontobject"), "{out}");
    assert!(!out.contains("data:font/ttf"), "{out}");
}

#[test]
fn a_rule_the_parser_rejects_is_kept_in_place_while_the_rest_of_the_sheet_is_optimized() {
    let css = ".gone{color:red}\n.a:first{margin-top:12px}\n.keep{color:#0000ff}\n@media print{.gone{color:blue}}";
    let out = safe(&page(
        &format!("<style>{css}</style>"),
        "<p class=\"keep a\">",
    ));
    assert!(out.contains(".a:first{margin-top:12px}"), "{out}");
    assert!(out.contains(".keep{color:#00f}"), "{out}");
    assert!(!out.contains(".gone"), "{out}");
    assert!(
        out.find(".a:first").unwrap() < out.find(".keep").unwrap(),
        "{out}"
    );
}

#[test]
fn several_rejected_rules_and_non_ascii_text_before_them_are_all_restored() {
    let css = ".gone{color:red}\n.a::-moz-bogus-thing{x:y}\n/* é€ */ .b:first{margin:0}\n.keep{color:#0000ff}";
    let out = safe(&page(
        &format!("<style>{css}</style>"),
        "<p class=\"keep a b\">",
    ));
    assert!(out.contains(".a::-moz-bogus-thing{x:y}"), "{out}");
    assert!(out.contains(".b:first{margin:0}"), "{out}");
    assert!(!out.contains(".gone"), "{out}");
}

#[test]
fn arithmetic_that_would_lose_precision_is_left_as_written() {
    let css = ".gone{color:red}.a{font-size:calc(1.6em / .7)}.b{width:calc(100% - 20px)}.keep{color:#0000ff}";
    let out = safe(&page(
        &format!("<style>{css}</style>"),
        "<p class=\"a b keep\">",
    ));
    assert!(out.contains(".a{font-size:calc(1.6em / .7)}"), "{out}");
    assert!(out.contains(".keep{color:#00f}"), "{out}");
    assert!(!out.contains(".gone"), "{out}");
}

#[test]
fn plaintext_content_is_not_markup() {
    let src = page(
        "<style>.witness{margin-left:1px}</style>",
        "<p>before</p><plaintext><script>var x = 1;</script>",
    );
    let out = safe(&src);
    assert!(out.contains("var x = 1;"), "{out}");
    assert!(!out.contains(".witness"), "{out}");
}

#[test]
fn bogus_comments_are_not_markup_and_stay_byte_identical() {
    for (bogus, kept) in [
        ("<![CDATA[ <script>var x = 1;</script> ]]>", "var x = 1;"),
        ("<!garbage <script>var y = 2;</script>", "var y = 2;"),
        ("<?xml <script>var z = 3;</script>", "var z = 3;"),
        ("</ 4 <script>var w = 4;</script>", "var w = 4;"),
    ] {
        let src = page(
            "<style>.witness{margin-left:1px}</style>",
            &format!("<p>before</p>{bogus}"),
        );
        let out = safe(&src);
        assert!(out.contains(kept), "{out}");
        assert!(out.contains(bogus), "{out}");
        assert!(!out.contains(".witness"), "{out}");
    }
}

#[test]
fn an_html_word_inside_a_script_is_not_a_document() {
    for src in [
        "<script>var s = '<html>';</script>",
        "<!-- <html> --><p>x</p>",
    ] {
        assert_eq!(
            optimize(src, Mode::Safe).unwrap_err(),
            octavo::Error::NotHtml,
            "{src}"
        );
    }
}

#[test]
fn a_css_banner_is_printed_exactly_once_unless_licenses_are_stripped() {
    let dead: String = (0..80).map(|i| format!(".dead-{i}{{color:red}}")).collect();
    let src = page(
        &format!(
            "<style>/*! Bootstrap v5.3.3 | Licensed under MIT */\n.keep{{display:block}}\n{dead}</style>"
        ),
        "<p class=\"keep\">",
    );
    let kept = safe(&src);
    assert_eq!(kept.matches("Bootstrap v5.3.3").count(), 1, "{kept}");
    assert!(!kept.contains(".dead-0"), "{kept}");
    let stripped = simplified(
        &src,
        Options {
            strip_licenses: true,
            ..Options::default()
        },
    )
    .pack(Mode::Safe);
    assert!(
        !stripped.html.contains("Bootstrap v5.3.3"),
        "{}",
        stripped.html
    );
}

#[test]
fn an_unterminated_block_is_kept_while_the_rest_of_the_sheet_is_optimized() {
    let css = ".gone{color:red}\n.keep{color:#0000ff}\n.a:first{margin-top:12px";
    let out = safe(&page(
        &format!("<style>{css}</style>"),
        "<p class=\"keep a\">",
    ));
    assert!(out.contains(".a:first{margin-top:12px"), "{out}");
    assert!(out.contains(".keep{color:#00f}"), "{out}");
    assert!(!out.contains(".gone"), "{out}");
}

#[test]
fn a_rejected_rule_inside_media_is_kept_while_the_rest_of_the_sheet_is_optimized() {
    let css = ".gone{color:red}\n@media print{.g2{color:blue}.a:first{margin-top:12px}}\n.keep{color:#0000ff}";
    let out = safe(&page(
        &format!("<style>{css}</style>"),
        "<p class=\"keep a\">",
    ));
    assert!(out.contains("@media print"), "{out}");
    assert!(out.contains(".a:first{margin-top:12px}"), "{out}");
    assert!(out.contains(".keep{color:#00f}"), "{out}");
    assert!(!out.contains(".gone{color:red}"), "{out}");
}

#[test]
fn many_adjacent_rules_that_are_set_aside_all_come_back_in_order() {
    let css = ".gone{color:red}.a{font-size:calc(1.6em / .7)}.b{font-size:calc(2em / .3)}.c::-moz-bogus-thing{x:y}.keep{color:#0000ff}";
    let out = safe(&page(
        &format!("<style>{css}</style>"),
        "<p class=\"a b c keep\">",
    ));
    let a = out.find(".a{font-size:calc(1.6em / .7)}").expect(&out);
    let b = out.find(".b{font-size:calc(2em / .3)}").expect(&out);
    let c = out.find(".c::-moz-bogus-thing{x:y}").expect(&out);
    assert!(a < b && b < c, "{out}");
    assert!(
        out.contains(".keep{color:#00f}") && !out.contains(".gone"),
        "{out}"
    );
}

fn font_page(text: &str) -> String {
    let font = include_bytes!("data/octavo-test.ttf");
    let css = format!(
        "@font-face{{font-family:Octavo Test;src:url({})}}body{{font-family:Octavo Test}}",
        data_uri("font/ttf", font)
    );
    page(&format!("<style>{css}</style>"), &format!("<p>{text}</p>"))
}

fn cache_options(directory: &std::path::Path) -> Options {
    Options {
        subset_text_fonts: false,
        cache_directory: Some(directory.to_path_buf()),
        ..Options::default()
    }
}

fn scratch(name: &str) -> std::path::PathBuf {
    let directory = std::path::PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&directory);
    directory
}

#[test]
fn a_cached_font_gives_exactly_the_same_output_as_a_converted_one() {
    let directory = scratch("font-cache-same");
    let html = font_page("A");
    let whole = Options {
        subset_text_fonts: false,
        ..Options::default()
    };
    let uncached = simplify(&html, whole)
        .expect("supported")
        .pack(Mode::Safe)
        .html;
    let first = simplify(&html, cache_options(&directory)).expect("supported");
    let first = first.pack(Mode::Safe).html;
    assert_eq!(
        std::fs::read_dir(directory.join("fonts"))
            .expect("cache written")
            .count(),
        1
    );
    let second = simplify(&html, cache_options(&directory)).expect("supported");
    let second = second.pack(Mode::Safe).html;
    assert_eq!(first, uncached);
    assert_eq!(second, uncached);
    assert_eq!(
        std::fs::read_dir(directory.join("fonts"))
            .expect("still one entry")
            .count(),
        1
    );
}

#[test]
fn only_whole_fonts_are_cached_and_subsets_never_add_entries() {
    let directory = scratch("font-cache-whole-only");
    let html = font_page("A");
    let subset = Options {
        subset_text_fonts: true,
        ..cache_options(&directory)
    };
    simplify(&font_page("A"), subset.clone()).expect("supported");
    simplify(&font_page("B"), subset).expect("supported");
    assert!(!directory.join("fonts").exists());
    simplify(&html, cache_options(&directory)).expect("supported");
    simplify(&font_page("B"), cache_options(&directory)).expect("supported");
    assert_eq!(
        std::fs::read_dir(directory.join("fonts"))
            .expect("entries")
            .count(),
        1
    );
}

#[test]
fn a_damaged_cache_entry_is_ignored_and_replaced() {
    let directory = scratch("font-cache-damaged");
    let html = font_page("A");
    simplify(&html, cache_options(&directory)).expect("supported");
    let entry = std::fs::read_dir(directory.join("fonts"))
        .expect("entry")
        .next()
        .expect("one")
        .expect("readable")
        .path();
    std::fs::write(&entry, b"not a cache entry").expect("overwrite");
    let out = simplify(&html, cache_options(&directory))
        .expect("supported")
        .pack(Mode::Safe)
        .html;
    assert!(out.contains("data:font/woff2"), "{out}");
    assert!(std::fs::read(&entry).expect("rewritten").len() > 20);
}

fn packed_size(html: &str, compression: Compression) -> usize {
    let options = Options {
        compression,
        ..Options::default()
    };
    simplify(html, options)
        .expect("supported")
        .pack(Mode::Packed)
        .html
        .len()
}

#[test]
fn stronger_compression_is_never_larger() {
    let html = font_page("A");
    let weakest = Compression::Custom(Tuning {
        woff2_quality: 0,
        png_preset: Some(0),
        brotli_quality: Some(0),
    });
    let sizes =
        [Compression::Maximum, Compression::Balanced, weakest].map(|c| packed_size(&html, c));
    assert!(sizes[0] <= sizes[1] && sizes[1] <= sizes[2], "{sizes:?}");
}

#[test]
fn custom_font_quality_has_its_own_cache_entry() {
    let directory = scratch("font-cache-quality");
    let html = font_page("A");
    for woff2_quality in [3, 9, 9, 11] {
        let options = Options {
            compression: Compression::Custom(Tuning {
                woff2_quality,
                ..Tuning::BALANCED
            }),
            ..cache_options(&directory)
        };
        simplify(&html, options).expect("supported");
    }
    assert_eq!(
        std::fs::read_dir(directory.join("fonts"))
            .expect("entries")
            .count(),
        3
    );
}
