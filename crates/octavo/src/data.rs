use base64::{Engine, engine::general_purpose::STANDARD};
use data_url::DataUrl;
use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};
use std::fmt;

use crate::ascii::starts_with_ignore_case;

const TEXT: &AsciiSet = &CONTROLS.add(b'%').add(b'#').add(b'"').add(b'&');

pub(crate) const DATA_URL_PREFIX: &str = "data:";

pub(crate) fn is_data_url(value: &str) -> bool {
    starts_with_ignore_case(value, DATA_URL_PREFIX)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Mime {
    TextCss,
    ImagePng,
    ImageJpeg,
    ImageAvif,
    ImageWebp,
    FontWoff2,
    Other(String),
}

impl Mime {
    pub(crate) fn as_str(&self) -> &str {
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

    pub(crate) fn is_text(&self) -> bool {
        match self {
            Mime::TextCss => true,
            Mime::ImagePng
            | Mime::ImageJpeg
            | Mime::ImageAvif
            | Mime::ImageWebp
            | Mime::FontWoff2 => false,
            Mime::Other(name) => {
                name.starts_with("text/")
                    || name.ends_with("+json")
                    || name.ends_with("+xml")
                    || matches!(
                        name.as_str(),
                        "application/json"
                            | "application/xml"
                            | "application/javascript"
                            | "application/ecmascript"
                    )
            }
        }
    }

    pub(crate) fn parse(value: &str) -> Mime {
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

pub(crate) struct DataUri {
    pub(crate) mime: Mime,
    pub(crate) bytes: Vec<u8>,
}

fn mime_of(url: &DataUrl) -> Mime {
    let mime = url.mime_type();
    Mime::parse(&format!("{}/{}", mime.type_, mime.subtype))
}

pub(crate) fn decode(uri: &str) -> Option<DataUri> {
    let url = DataUrl::process(uri).ok()?;
    Some(DataUri {
        mime: mime_of(&url),
        bytes: url.decode_to_vec().ok()?.0,
    })
}

pub(crate) fn decode_text(uri: &str) -> Option<String> {
    let url = DataUrl::process(uri).ok()?;
    if !mime_of(&url).is_text() {
        return None;
    }
    Some(String::from_utf8_lossy(&url.decode_to_vec().ok()?.0).into_owned())
}

pub(crate) fn encode_text(mime: Mime, text: &str) -> String {
    format!(
        "data:{mime};charset=utf-8,{}",
        utf8_percent_encode(text, TEXT)
    )
}

pub(crate) fn encode_base64(mime: Mime, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}
