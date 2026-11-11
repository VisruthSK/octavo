use crate::{
    doc::{Doc, Edit},
    html::Tag,
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

const CLASSIC_TYPES: [&str; 4] = [
    "",
    "text/javascript",
    "application/javascript",
    "text/ecmascript",
];

#[derive(PartialEq)]
pub enum ScriptKind {
    Classic,
    Module,
    Special,
    Data,
}

impl ScriptKind {
    pub fn of(tag: &Tag) -> Self {
        match tag
            .attr("type")
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            kind if CLASSIC_TYPES.contains(&kind) => ScriptKind::Classic,
            "module" => ScriptKind::Module,
            "importmap" | "speculationrules" => ScriptKind::Special,
            _ => ScriptKind::Data,
        }
    }
}

pub fn is_classic_type(value: &str) -> bool {
    CLASSIC_TYPES.contains(&value.trim().to_ascii_lowercase().as_str())
}

pub fn stage(doc: &Doc, keep_licenses: bool) -> Vec<Edit> {
    doc.tags
        .par_iter()
        .filter(|t| t.name == "script" && !t.in_svg)
        .filter_map(|tag| rewrite(doc, tag, keep_licenses))
        .filter(Edit::shrinks)
        .collect()
}

pub fn minify(code: &str, module: bool, keep_licenses: bool) -> Option<String> {
    let allocator = Allocator::default();
    let source_type = if module {
        SourceType::mjs()
    } else {
        SourceType::default().with_script(true)
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
            legal: if keep_licenses {
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

fn rewrite(doc: &Doc, tag: &Tag, keep_licenses: bool) -> Option<Edit> {
    let module = match ScriptKind::of(tag) {
        ScriptKind::Classic => false,
        ScriptKind::Module => true,
        _ => return None,
    };
    let source = tag.attr("src");
    if source.is_some() && !(module && source?.starts_with("data:") && unique_source(doc, source?))
    {
        return None;
    }
    let code = doc.script_text(tag)?;
    if looks_minified(&code) || source.is_some() && !self_contained(&code) {
        return None;
    }
    let mut text = minify(&code, module, keep_licenses)?;
    if text.contains("</script") {
        text = text.replace("</script", r"<\/script");
    }
    let target = tag
        .attr("id")
        .unwrap_or(if module { "module" } else { "script" })
        .to_string();
    Some(if source.is_some() {
        let open = tag.open_tag(|name, value| (name != "src").then(|| value.to_string()));
        Edit {
            span: tag.span.clone(),
            text: format!("{open}{text}</script>"),
            transform: "js-minify",
            target,
        }
    } else {
        Edit {
            span: tag.body.clone()?,
            text,
            transform: "js-minify",
            target,
        }
    })
}

fn unique_source(doc: &Doc, source: &str) -> bool {
    doc.tags
        .iter()
        .filter(|t| t.attr("src") == Some(source))
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
