#![allow(dead_code)]

use octavo::{Mode, Options, Output, Simplified, optimize, simplify};

pub fn page(head: &str, body: &str) -> String {
    format!("<!DOCTYPE html><html><head>{head}</head><body>{body}</body></html>")
}

pub fn safe(src: &str) -> String {
    optimized(src, Mode::Safe).html
}

pub fn packed(src: &str) -> String {
    optimized(src, Mode::Packed).html
}

pub fn optimized(src: &str, mode: Mode) -> Output {
    optimize(src, mode).expect("a supported document")
}

pub fn simplified(src: &str, options: Options) -> Simplified {
    simplify(src, options).expect("a supported document")
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
