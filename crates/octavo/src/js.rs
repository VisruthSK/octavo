use crate::{
    Licenses, Target, Transform, data,
    doc::{Doc, Edit},
    html::{AttrName, Element, Tag},
};
use oxc::{
    allocator::Allocator,
    codegen::{Codegen, CodegenOptions, CommentOptions, LegalComment},
    mangler::MangleOptions,
    minifier::{CompressOptions, Minifier, MinifierOptions},
    parser::Parser,
    span::SourceType,
};
use rayon::prelude::*;
use std::ops::Range;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ScriptKind {
    Classic,
    Module,
    Special,
    Data,
}

impl ScriptKind {
    pub(crate) fn parse(value: &str) -> ScriptKind {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "text/javascript" | "application/javascript" | "text/ecmascript" => {
                ScriptKind::Classic
            }
            "module" => ScriptKind::Module,
            "importmap" | "speculationrules" => ScriptKind::Special,
            _ => ScriptKind::Data,
        }
    }

    pub(crate) fn of(tag: &Tag) -> ScriptKind {
        ScriptKind::parse(tag.attr(AttrName::Type).unwrap_or(""))
    }
}

pub(crate) fn stage(doc: &Doc, removed: &[Range<usize>], licenses: Licenses) -> Vec<Edit> {
    doc.tags()
        .par_iter()
        .filter(|t| t.element == Element::Script && !t.in_svg && !removed.contains(&t.span))
        .filter_map(|tag| rewrite(doc, tag, licenses))
        .filter(Edit::shrinks)
        .collect()
}

pub(crate) fn minify(code: &str, kind: ScriptKind, licenses: Licenses) -> Option<String> {
    let allocator = Allocator::default();
    let source_type = match kind {
        ScriptKind::Classic => SourceType::default().with_script(true),
        ScriptKind::Module => SourceType::mjs(),
        ScriptKind::Special | ScriptKind::Data => return None,
    };
    let parsed = Parser::new(&allocator, code, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return None;
    }
    let mut program = parsed.program;
    let options = MinifierOptions {
        mangle: Some(MangleOptions::default()),
        mangle_properties: None,
        compress: Some(CompressOptions::smallest()),
    };
    let scoping = Minifier::new(options)
        .minify(&allocator, &mut program)
        .scoping;
    let codegen = CodegenOptions {
        minify: true,
        comments: CommentOptions {
            legal: if licenses == Licenses::Keep {
                LegalComment::Inline
            } else {
                LegalComment::None
            },
            ..CommentOptions::disabled()
        },
        ..CodegenOptions::default()
    };
    Some(
        Codegen::new()
            .with_options(codegen)
            .with_scoping(scoping)
            .build(&program)
            .code,
    )
}

fn rewrite(doc: &Doc, tag: &Tag, licenses: Licenses) -> Option<Edit> {
    let (kind, label) = match ScriptKind::of(tag) {
        ScriptKind::Classic => (ScriptKind::Classic, "script"),
        ScriptKind::Module => (ScriptKind::Module, "module"),
        ScriptKind::Special | ScriptKind::Data => return None,
    };
    let source = tag.attr(AttrName::Src);
    if let Some(src) = source {
        let inlinable =
            kind == ScriptKind::Module && data::is_data_url(src) && unique_source(doc, src);
        if !inlinable {
            return None;
        }
    }
    let code = doc.script_text(tag)?;
    if looks_minified(&code) || source.is_some() && !self_contained(&code) {
        return None;
    }
    let mut text = minify(&code, kind, licenses)?;
    if text.contains("</script") {
        text = text.replace("</script", r"<\/script");
    }
    let target = Target::Resource(tag.attr(AttrName::Id).unwrap_or(label).to_string());
    Some(if source.is_some() {
        let open = tag.open_tag(|name, value| (name != &AttrName::Src).then(|| value.to_string()));
        Edit {
            span: tag.span.clone(),
            text: format!("{open}{text}</script>"),
            transform: Transform::MinifiedScript,
            target,
        }
    } else {
        Edit {
            span: tag.body.clone()?,
            text,
            transform: Transform::MinifiedScript,
            target,
        }
    })
}

fn unique_source(doc: &Doc, source: &str) -> bool {
    doc.tags()
        .iter()
        .filter(|t| t.attr(AttrName::Src) == Some(source))
        .count()
        == 1
}

fn looks_minified(code: &str) -> bool {
    code.len() > 2000 && code.lines().count() * 200 < code.len()
}

fn self_contained(code: &str) -> bool {
    !code
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| word == "import" || word == "export")
}
