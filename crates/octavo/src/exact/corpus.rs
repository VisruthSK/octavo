use crate::{
    Mode, Options, Transform, Warning,
    doc::{Doc, Edits},
    optimize,
};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Default)]
struct Counts {
    applied: usize,
    rejected: usize,
    unchanged: usize,
    saved: usize,
}

fn html_files(path: &Path, output: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            html_files(&path, output);
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("html"))
        {
            output.push(path);
        }
    }
}

#[test]
#[ignore]
fn exact_corpus_and_byte_price() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let manifest: Vec<serde_json::Value> =
        serde_json::from_slice(&fs::read(root.join("corpus/manifest.json")).unwrap()).unwrap();
    let mut fixture_paths = Vec::new();
    let mut expected_rejections = BTreeMap::new();
    for row in &manifest {
        let id = row["id"].as_str().unwrap();
        let path = root.join("corpus/.cache/docs").join(format!("{id}.html"));
        assert!(path.is_file(), "missing fixture {id}");
        expected_rejections.insert(
            path.clone(),
            row["expect"]["outcome"].as_str() == Some("rejects"),
        );
        fixture_paths.push(path);
    }
    let upstream = std::env::var_os("OCTAVO_EXACT_UPSTREAM_CACHE")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("corpus/.cache/rendered"));
    let mut upstream_paths = Vec::new();
    if upstream.is_dir() {
        html_files(&upstream, &mut upstream_paths);
    }
    upstream_paths.sort();
    let transforms = [
        Transform::NormalizedDataUrl,
        Transform::ReencodedFont,
        Transform::RecompressedPng,
        Transform::ConvertedWebp,
        Transform::MinifiedStylesheet,
        Transform::MinifiedScript,
        Transform::StrippedDefaultAttr,
        Transform::CollapsedCssWhitespace,
        Transform::ShortenedCssValues,
        Transform::RemovedCssRules,
        Transform::NormalizedAttrQuotes,
    ];
    let mut counts: BTreeMap<Transform, Counts> = transforms
        .into_iter()
        .map(|t| (t, Counts::default()))
        .collect();
    let mut refused = 0usize;
    let mut rejections = 0usize;
    let mut fixture_bytes = (0usize, 0usize, 0usize, 0usize);
    let mut upstream_bytes = (0usize, 0usize, 0usize, 0usize);
    let mut upstream_grew = 0usize;
    for (index, (is_upstream, path)) in fixture_paths
        .iter()
        .map(|p| (false, p))
        .chain(upstream_paths.iter().map(|p| (true, p)))
        .enumerate()
    {
        if index % 25 == 0 {
            eprintln!("processed {index} documents");
        }
        let source = fs::read_to_string(path).unwrap();
        let expected_rejection = expected_rejections.get(path).copied().unwrap_or(false);
        let output = match optimize(&source, Mode::Exact) {
            Ok(output) => {
                assert!(!expected_rejection, "expected refusal: {}", path.display());
                output
            }
            Err(error) => {
                assert!(
                    is_upstream || expected_rejection,
                    "unexpected refusal: {}: {error}",
                    path.display()
                );
                refused += 1;
                continue;
            }
        };
        let doc = Doc::new(&source);
        let options = Options {
            exact: true,
            ..Default::default()
        };
        let (edits, _) = super::stage(&doc, &options);
        assert_eq!(
            Edits::new(edits).apply(&source),
            output.html,
            "outside validated spans: {}",
            path.display()
        );
        for step in &output.applied {
            assert!(
                step.after < step.before,
                "non-shrinking {} in {}",
                step.transform,
                path.display()
            );
        }
        for transform in transforms {
            let applied = output
                .applied
                .iter()
                .filter(|step| step.transform == transform)
                .count();
            let rejected = output.warnings.iter().filter(|warning| matches!(warning, Warning::OracleRejected { transform: t, .. } if *t == transform)).count();
            if rejected != 0 {
                eprintln!("oracle rejected {transform} for {}", path.display());
            }
            let entry = counts.get_mut(&transform).unwrap();
            entry.applied += applied;
            entry.saved += output
                .applied
                .iter()
                .filter(|step| step.transform == transform)
                .map(|step| step.before - step.after)
                .sum::<usize>();
            entry.rejected += rejected;
            if applied == 0 && rejected == 0 {
                entry.unchanged += 1;
            }
            rejections += rejected;
        }
        let totals = if is_upstream {
            &mut upstream_bytes
        } else {
            &mut fixture_bytes
        };
        if !is_upstream || totals.0 < 20 {
            if is_upstream && output.html.len() > source.len() {
                upstream_grew += 1;
            }
            let safe = optimize(&source, Mode::Serve).unwrap();
            totals.0 += 1;
            totals.1 += source.len();
            totals.2 += output.html.len();
            totals.3 += safe.html.len();
        }
    }
    println!(
        "fixtures={} upstream={} refused={refused}",
        fixture_paths.len(),
        upstream_paths.len()
    );
    for (transform, count) in counts {
        println!(
            "{transform}: applied={} rejected={} unchanged_documents={} bytes_saved={}",
            count.applied, count.rejected, count.unchanged, count.saved
        );
    }
    for (label, (count, input, exact, safe)) in [
        ("fixtures", fixture_bytes),
        ("upstream sample", upstream_bytes),
    ] {
        println!(
            "{label}: documents={count} input={input} exact={exact} safe={safe} exact_minus_safe={}",
            exact as i128 - safe as i128
        );
    }
    println!("upstream sample grew={upstream_grew}");
    assert_eq!(rejections, 0, "oracle rejected candidates in corpus");
    assert_eq!(upstream_grew, 0, "exact output grew in upstream sample");
    assert!(
        upstream_bytes.0 >= 20,
        "fewer than 20 usable upstream documents"
    );
}
