mod common;

use common::page;
use octavo::{optimize, Mode};
use proptest::{prelude::*, test_runner::FileFailurePersistence};
use regex::Regex;
use std::sync::LazyLock;

const MODES: [Mode; 3] = [
    Mode::Safe,
    Mode::Packed { styles: false },
    Mode::Packed { styles: true },
];

static TARGETS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)<script\b.*?</script\s*>|<style\b.*?</style\s*>|<svg\b.*?</svg\s*>|<link\b[^>]*>|<img\b[^>]*>")
        .expect("valid pattern")
});

fn outside_targets(html: &str) -> String {
    TARGETS.replace_all(html, "").into_owned()
}

fn fragment() -> impl Strategy<Value = String> {
    prop_oneof![
        "[a-zA-Z0-9 .,;:!?'-]{0,60}".prop_map(|text| format!("<p>{text}</p>")),
        "[a-z]{1,8}".prop_map(|class| format!("<p class=\"{class} extra\">text</p>")),
        Just(
            "<!-- a comment with <script>not real</script> and <style>.x{}</style> -->".to_string()
        ),
        Just("<P CLASS=\"Shout\">Upper case tags</P>".to_string()),
        Just("<a href=\"#x\" title=\"a > b\">greater-than in an attribute</a>".to_string()),
        Just("<pre>&lt;script&gt; &amp; entities &copy; é ligature fi</pre>".to_string()),
        Just("<textarea><script>never runs</script></textarea>".to_string()),
        Just(
            "<svg viewBox=\"0 0 10 10\"><path d=\"M0 0L10 10\"/><style>.s{fill:red}</style></svg>"
                .to_string()
        ),
        Just("<style>.unused{color:red}.shown{color:blue}</style>".to_string()),
        Just(
            "<style>@media print{.p{display:none}}:root{--a:1;--b:2}.q{margin:var(--a)}</style>"
                .to_string()
        ),
        Just(
            "<script>window.n=(window.n||0)+1;if(1<2){document.write('</div>')}</script>"
                .to_string()
        ),
        Just(
            "<script type=\"application/json\">{\"a\":[1,2,3],\"b\":\"</p>\"}</script>".to_string()
        ),
        Just("<script type=\"module\">export const x = 1;</script>".to_string()),
        Just("<img alt=\"pixel\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\">".to_string()),
        Just("<link rel=\"stylesheet\" href=\"data:text/css,p%7Bcolor:red%7D\">".to_string()),
    ]
}

fn document() -> impl Strategy<Value = String> {
    (
        proptest::collection::vec(fragment(), 0..6),
        proptest::collection::vec(fragment(), 1..10),
    )
        .prop_map(|(head, body)| page(&head.concat(), &body.concat()))
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 96, failure_persistence: Some(Box::new(FileFailurePersistence::Off)), ..ProptestConfig::default() })]

    #[test]
    fn everything_outside_the_targeted_elements_is_left_exactly_as_it_was(src in document()) {
        let out = optimize(&src, Mode::Safe).expect("supported").html;
        prop_assert_eq!(outside_targets(&out), outside_targets(&src));
    }

    #[test]
    fn output_is_never_larger_and_never_panics_in_any_mode(src in document()) {
        for mode in MODES {
            let out = optimize(&src, mode).expect("supported");
            prop_assert!(out.html.len() <= src.len(), "{mode:?}: {} > {}", out.html.len(), src.len());
        }
    }

    #[test]
    fn optimizing_is_deterministic(src in document()) {
        for mode in MODES {
            let first = optimize(&src, mode).expect("supported").html;
            let second = optimize(&src, mode).expect("supported").html;
            prop_assert_eq!(first, second);
        }
    }

    #[test]
    fn a_second_pass_never_makes_the_output_larger(src in document()) {
        for mode in MODES {
            let once = optimize(&src, mode).expect("supported").html;
            let twice = optimize(&once, mode).expect("the output is still supported").html;
            prop_assert!(twice.len() <= once.len(), "{mode:?}: {} > {}", twice.len(), once.len());
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Use {
    Nowhere,
    InMarkup,
    ClassListAdd,
    BuiltAtRuntime,
}

fn usage() -> impl Strategy<Value = Vec<Use>> {
    proptest::collection::vec(
        prop_oneof![
            Just(Use::Nowhere),
            Just(Use::InMarkup),
            Just(Use::ClassListAdd),
            Just(Use::BuiltAtRuntime),
        ],
        1..8,
    )
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 96, failure_persistence: Some(Box::new(FileFailurePersistence::Off)), ..ProptestConfig::default() })]

    #[test]
    fn css_pruning_keeps_exactly_the_rules_something_can_reach(uses in usage()) {
        let mut rules = String::new();
        let mut markup = String::new();
        let mut script = String::new();
        for (i, usage) in uses.iter().enumerate() {
            match usage {
                Use::Nowhere => rules.push_str(&format!(".gone{i}{{margin-left:{i}px}}")),
                Use::InMarkup => {
                    rules.push_str(&format!(".markup{i}{{margin-left:{i}px}}"));
                    markup.push_str(&format!("<p class=\"markup{i}\">x</p>"));
                }
                Use::ClassListAdd => {
                    rules.push_str(&format!(".added{i}{{margin-left:{i}px}}"));
                    script.push_str(&format!("document.body.classList.add('added{i}');"));
                }
                Use::BuiltAtRuntime => {
                    rules.push_str(&format!(".built-{i}{{margin-left:{i}px}}"));
                    script.push_str(&format!("document.body.className='built-'+{i};"));
                }
            }
        }
        let head = format!("<style>{rules}</style><script>{script}</script>");
        let out = optimize(&page(&head, &markup), Mode::Safe).expect("supported").html;
        for (i, usage) in uses.iter().enumerate() {
            let (name, kept) = match usage {
                Use::Nowhere => (format!(".gone{i}{{"), false),
                Use::InMarkup => (format!(".markup{i}{{"), true),
                Use::ClassListAdd => (format!(".added{i}{{"), true),
                Use::BuiltAtRuntime => (format!(".built-{i}{{"), true),
            };
            prop_assert_eq!(out.contains(&name), kept, "{:?} {}", usage, name);
        }
    }
}
