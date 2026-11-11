use std::{fs, path::Path};

const FORMAT: u32 = 1;

pub(crate) fn key(parts: &[&[u8]]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&FORMAT.to_le_bytes());
    for part in parts {
        hasher.update(&(part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    hasher.finalize().to_hex().to_string()
}

pub(crate) fn load(directory: &Path, key: &str) -> Option<Vec<u8>> {
    fs::read(directory.join(key)).ok()
}

pub(crate) fn store(directory: &Path, key: &str, value: &[u8]) {
    let _ = fs::create_dir_all(directory);
    let partial = directory.join(format!("{key}.{}.partial", std::process::id()));
    if fs::write(&partial, value).is_ok() && fs::rename(&partial, directory.join(key)).is_err() {
        let _ = fs::remove_file(&partial);
    }
}
