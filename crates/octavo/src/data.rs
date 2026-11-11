use base64::{engine::general_purpose::STANDARD, Engine};
use data_url::DataUrl;
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use std::fmt;

const TEXT: &AsciiSet = &CONTROLS.add(b'%').add(b'#').add(b'"').add(b'&');

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mime {
    TextCss,
    ImagePng,
    ImageJpeg,
    ImageAvif,
    ImageWebp,
    FontWoff2,
    Other(String),
}

impl Mime {
    pub fn as_str(&self) -> &str {
        match self {
            Mime::TextCss => "text/css",
            Mime::ImagePng => "image/png",
            Mime::ImageJpeg => "image/jpeg",
            Mime::ImageAvif => "image/avif",
            Mime::ImageWebp => "image/webp",
            Mime::FontWoff2 => "font/woff2",
            Mime::Other(name) => name,
        }
    }

    pub fn parse(value: &str) -> Mime {
        match value {
            "text/css" => Mime::TextCss,
            "image/png" => Mime::ImagePng,
            "image/jpeg" => Mime::ImageJpeg,
            "image/avif" => Mime::ImageAvif,
            "image/webp" => Mime::ImageWebp,
            "font/woff2" => Mime::FontWoff2,
            _ => Mime::Other(value.to_string()),
        }
    }
}

impl fmt::Display for Mime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.pad(self.as_str())
    }
}

pub struct DataUri {
    pub mime: Mime,
    pub bytes: Vec<u8>,
}

pub fn decode(uri: &str) -> Option<DataUri> {
    let url = DataUrl::process(uri).ok()?;
    let mime = url.mime_type();
    Some(DataUri {
        mime: Mime::parse(&format!("{}/{}", mime.type_, mime.subtype)),
        bytes: url.decode_to_vec().ok()?.0,
    })
}

pub fn encode_text(mime: Mime, text: &str) -> String {
    format!(
        "data:{mime};charset=utf-8,{}",
        utf8_percent_encode(text, TEXT)
    )
}

pub fn encode_base64(mime: Mime, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}
