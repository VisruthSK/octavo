use std::{fs, path::Path};

pub(crate) const FONTS: &str = "fonts";

const FORMAT: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CacheKey(String);

impl CacheKey {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

pub(crate) fn key(parts: &[&[u8]]) -> CacheKey {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&FORMAT.to_le_bytes());
    for part in parts {
        hasher.update(&(part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    CacheKey(hasher.finalize().to_hex().to_string())
}

pub(crate) fn load(directory: &Path, key: &CacheKey) -> Option<Vec<u8>> {
    fs::read(directory.join(key.as_str())).ok()
}

pub(crate) fn store(directory: &Path, key: &CacheKey, value: &[u8]) {
    let _ = fs::create_dir_all(directory);
    let partial = directory.join(format!("{}.{}.partial", key.as_str(), std::process::id()));
    if fs::write(&partial, value).is_ok()
        && fs::rename(&partial, directory.join(key.as_str())).is_err()
    {
        let _ = fs::remove_file(&partial);
    }
}
