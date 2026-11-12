mod common;

use common::{busy_script, optimized, page, safe, simplified};
use octavo::{Mode, Options, Target, Transform};
use std::num::NonZeroUsize;

#[test]
fn unreachable_rules_are_removed_and_reachable_kept() {
    let out = safe(&page(
        "<style>.used{color:red}.unused{color:blue}</style>",
        "<p class=used>x</p>",
    ));
    assert!(out.contains(".used{color:red}") && !out.contains("unused"));
}

#[test]
fn classes_added_by_scripts_stay_reachable() {
    let src = page(
        "<style>.shown{display:block}.hidden-x{display:none}.col-md-6{width:50%}.never{top:0}</style>",
        "<script>el.classList.add('shown');el.className='col-'+'md-6'</script>",
    );
    let out = safe(&src);
    assert!(
        out.contains(".shown")
            && out.contains(".col-md-6")
            && !out.contains(".never")
            && !out.contains(".hidden-x")
    );
}

#[test]
fn selector_lists_keep_only_reachable_members() {
    let out = safe(&page("<style>.a,.b{margin:0}</style>", "<p class=a>"));
    assert!(out.contains(".a{margin:0}") && !out.contains(".b"));
}

#[test]
fn custom_property_values_are_preserved_verbatim() {
    let out = safe(&page(
        "<style>:root{--c: rgb(153, 115.8, 4.2);--d: #ffffff}.a{color:var(--c);background:var(--d)}</style>",
        "<p class=a>",
    ));
    assert!(out.contains("--c:rgb(153, 115.8, 4.2)") && out.contains("--d:#ffffff"));
}

#[test]
fn unreferenced_custom_properties_are_removed_unless_a_script_reads_them() {
    let style = "<style>:root{--used:1;--dead:2;--dynamic-x:3}.a{margin:var(--used)}</style>";
    let out = safe(&page(style, "<p class=a>"));
    assert!(out.contains("--used:1") && !out.contains("--dead"));
    let read = safe(&page(
        &format!(
            "{style}<script>getComputedStyle(document.body).getPropertyValue('--dead')</script>"
        ),
        "<p class=a>",
    ));
    assert!(read.contains("--dead:2"));
}

#[test]
fn media_blocks_emptied_by_pruning_disappear() {
    let out = safe(&page(
        "<style>@media print{.gone{color:red}}.kept{top:0}</style>",
        "<p class=kept>",
    ));
    assert!(!out.contains("@media") && out.contains(".kept"));
}

#[test]
fn invalid_css_passes_through_unchanged() {
    let src = page("<style>@@@ {{{ not css</style>", "<p>");
    assert_eq!(safe(&src), src);
}

#[test]
fn packing_replaces_large_scripts_with_call_sites() {
    let big = "window.counter=(window.counter||0)+1;".repeat(80);
    let src = page(&format!("<script>{big}</script>"), "<p>");
    let out = optimized(&src, Mode::Packed).html;
    assert!(
        out.contains("$o(0")
            && !out.contains("window.counter=(window.counter||0)+1;window.counter")
    );
    assert!(out.len() < src.len());
}

#[test]
fn identical_resources_share_one_blob() {
    let script: String = (0..400)
        .map(|i| format!("window.v{i}=Math.sqrt({});", i * 31))
        .collect();
    let tag = format!("<script>{script}</script>");
    let out = optimized(&page(&format!("{tag}{tag}{tag}"), "<p>"), Mode::Packed);
    assert!(out.applied.iter().any(|a| a.transform == Transform::Packed
        && a.target == Target::Resources(NonZeroUsize::new(1).expect("non-zero"))));
}

#[test]
fn content_security_policy_disables_packing() {
    let big = "var a=1;".repeat(300);
    let src = page(
        &format!(
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'\"><script>{big}</script>"
        ),
        "<p>",
    );
    assert!(!optimized(&src, Mode::Packed).html.contains("$o("));
}

#[test]
fn keep_styles_leaves_stylesheets_untouched_by_the_packer() {
    let rules: String = (0..60)
        .map(|i| format!(".k{{width:{i}px;height:{}px}}", i * 7))
        .collect();
    let script = (0..800)
        .map(|i| format!("window.v{i}=Math.sqrt({});", i * 31))
        .collect::<String>();
    let src = page(
        &format!("<style>{rules}</style><script>{script}</script>"),
        &(0..60)
            .map(|i| format!("<p class=k>{i}"))
            .collect::<String>(),
    );
    let out = optimized(&src, Mode::Scripts).html;
    assert!(out.contains("<style>") && out.matches("$o(").count() == 1);
}

#[test]
fn dead_quarto_libraries_are_removed_and_stubbed() {
    let clipboard = format!("/*! clipboard.js v2.0.11 */{}", "var q=1;".repeat(400));
    let runtime = "window.addEventListener('x',()=>{new window.ClipboardJS('.code-copy-button')})";
    let src = page(
        &format!(
            "<script>{clipboard}</script><script id=\"quarto-html-after-body\">{runtime}</script>"
        ),
        "<p>no code here</p>",
    );
    let out = optimized(&src, Mode::Safe).html;
    assert!(!out.contains("clipboard.js v2") && out.contains("window.ClipboardJS="));
}

#[test]
fn quarto_libraries_stay_when_markup_needs_them() {
    let clipboard = format!("/*! clipboard.js v2.0.11 */{}", "var q=1;".repeat(400));
    let out = optimized(
        &page(
            &format!("<script>{clipboard}</script>"),
            "<button class=\"code-copy-button\"></button>",
        ),
        Mode::Safe,
    )
    .html;
    assert!(out.contains("var q=1;") || out.contains("q=1"));
}

fn big_svg() -> String {
    let paths: String = (0..400)
        .map(|i| format!("<path d=\"M{i} {} L{} {}\"/>", i * 3, i + 9, i * 7))
        .collect();
    format!("<svg viewBox=\"0 0 10 10\">{paths}</svg>")
}

#[test]
fn large_inline_svg_is_packed_only_when_javascript_is_required() {
    let src = page("", &format!("<div>{}</div>", big_svg()));
    assert!(optimized(&src, Mode::Packed).html.contains("$o(0,3)"));
    assert!(optimized(&src, Mode::Scripts).html.contains("<path"));
}

#[test]
fn inert_data_scripts_keep_their_type_when_packed() {
    let data: String = (0..300)
        .map(|i| format!("{{\"k{i}\":{}}},", i * 17))
        .collect();
    let src = page(
        "",
        &format!("<script type=\"application/json\" data-for=\"w\">[{data}0]</script>"),
    );
    let out = optimized(&src, Mode::Scripts).html;
    assert!(out.contains(r#"$o(0,0,{"data-for":"w","type":"application/json"})"#));
}

#[test]
fn inline_modules_are_never_packed() {
    let body = (0..300)
        .map(|i| format!("window.m{i}={i};"))
        .collect::<String>();
    let src = page(&format!("<script type=\"module\">{body}</script>"), "<p>");
    assert!(!optimized(&src, Mode::Packed).html.contains("$o("));
}

#[test]
fn code_annotations_keep_tippy_and_popper() {
    let tippy = format!(
        "/*! require(\"@popperjs/core\") */{}",
        "var t=1;".repeat(400)
    );
    let out = optimized(
        &page(
            &format!("<script>{tippy}</script>"),
            "<a class=\"code-annotation-anchor\" data-target-annotation=\"1\"></a>",
        ),
        Mode::Safe,
    )
    .html;
    assert!(out.contains("t=1"));
}

fn packable() -> String {
    page(
        &format!("<script>{}</script>", busy_script("a")),
        "<p>x</p>",
    )
}

#[test]
fn an_accepted_first_choice_is_returned_untouched() {
    let simplified = simplified(&packable(), Options::default());
    let mut tried = Vec::new();
    let (mode, output) = simplified
        .pack_checked(Mode::Packed, |mode, _| {
            tried.push(mode);
            true
        })
        .expect("accepted");
    assert_eq!((mode, tried), (Mode::Packed, vec![Mode::Packed]));
    assert_eq!(output.html, simplified.pack(Mode::Packed).html);
}

#[test]
fn a_rejected_mode_steps_down_one_level_at_a_time() {
    let simplified = simplified(&packable(), Options::default());
    let mut tried = Vec::new();
    let (mode, output) = simplified
        .pack_checked(Mode::Packed, |mode, _| {
            tried.push(mode);
            mode == Mode::Scripts
        })
        .expect("scripts accepted");
    assert_eq!(tried, [Mode::Packed, Mode::Scripts]);
    assert_eq!(mode, Mode::Scripts);
    assert_eq!(output.html, simplified.pack(Mode::Scripts).html);
}

#[test]
fn rejecting_every_mode_returns_nothing_after_trying_each_once() {
    let simplified = simplified(&packable(), Options::default());
    let mut tried = Vec::new();
    let result = simplified.pack_checked(Mode::Packed, |mode, _| {
        tried.push(mode);
        false
    });
    assert!(result.is_none());
    assert_eq!(tried, [Mode::Packed, Mode::Scripts, Mode::Safe]);
}

#[test]
fn modes_riskier_than_the_requested_one_are_never_tried() {
    let simplified = simplified(&packable(), Options::default());
    for (start, expected) in [
        (Mode::Scripts, vec![Mode::Scripts, Mode::Safe]),
        (Mode::Safe, vec![Mode::Safe]),
    ] {
        let mut tried = Vec::new();
        let _ = simplified.pack_checked(start, |mode, _| {
            tried.push(mode);
            false
        });
        assert_eq!(tried, expected);
    }
}

#[test]
fn the_check_sees_the_document_that_would_be_written() {
    let simplified = simplified(&packable(), Options::default());
    let mut seen = None;
    let _ = simplified.pack_checked(Mode::Packed, |_, output| {
        seen = Some(output.html.clone());
        true
    });
    assert_eq!(seen.expect("checked"), simplified.pack(Mode::Packed).html);
}
