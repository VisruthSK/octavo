#![allow(dead_code)]

use octavo::{Config, Output, Packaging, Simplified, optimize, simplify};

pub fn page(head: &str, body: &str) -> String {
    format!("<!DOCTYPE html><html><head>{head}</head><body>{body}</body></html>")
}

pub fn plain(src: &str) -> String {
    optimized(src, Packaging::Plain).html
}

pub fn serve(src: &str) -> String {
    plain(src)
}

pub fn archive(src: &str) -> String {
    packed(src)
}

pub fn packed(src: &str) -> String {
    optimized(src, Packaging::Packed).html
}

pub fn optimized(src: &str, packaging: Packaging) -> Output {
    optimize(src, packaging).expect("a supported document")
}

pub fn simplified(src: &str, config: Config) -> Simplified {
    simplify(src, config).expect("a supported document")
}

pub fn busy_script(prefix: &str) -> String {
    (0..400)
        .map(|i| format!("window.{prefix}{i}=Math.sqrt({});", i * 31))
        .collect()
}

pub fn data_uri(mime: &str, bytes: &[u8]) -> String {
    use base64::{Engine, engine::general_purpose::STANDARD};
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}
