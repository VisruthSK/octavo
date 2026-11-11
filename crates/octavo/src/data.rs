use base64::{engine::general_purpose::STANDARD, Engine};
use data_url::DataUrl;
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};

const TEXT: &AsciiSet = &CONTROLS.add(b'%').add(b'#').add(b'"').add(b'&');

pub struct DataUri {
    pub mime: String,
    pub bytes: Vec<u8>,
}

pub fn decode(uri: &str) -> Option<DataUri> {
    let url = DataUrl::process(uri).ok()?;
    let mime = url.mime_type();
    Some(DataUri {
        mime: format!("{}/{}", mime.type_, mime.subtype),
        bytes: url.decode_to_vec().ok()?.0,
    })
}

pub fn encode_text(mime: &str, text: &str) -> String {
    format!(
        "data:{mime};charset=utf-8,{}",
        utf8_percent_encode(text, TEXT)
    )
}

pub fn encode_base64(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}
