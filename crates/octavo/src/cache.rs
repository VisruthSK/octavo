use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub(crate) const FONTS: &str = "fonts";

static COUNTER: AtomicU64 = AtomicU64::new(0);

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

fn partial_path(directory: &Path, key: &str) -> PathBuf {
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    directory.join(format!("{key}.{}.{id}.partial", std::process::id()))
}

pub(crate) fn store(directory: &Path, key: &str, value: &[u8]) {
    let _ = fs::create_dir_all(directory);
    let partial = partial_path(directory, key);
    if fs::write(&partial, value).is_ok() && fs::rename(&partial, directory.join(key)).is_err() {
        let _ = fs::remove_file(&partial);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_file_name_is_unique_per_call() {
        let dir = Path::new("cache");
        let a = partial_path(dir, "font-key");
        let b = partial_path(dir, "font-key");
        assert_ne!(a, b);
        let pid = std::process::id().to_string();
        assert!(a.to_string_lossy().contains(&pid));
        assert!(b.to_string_lossy().contains(&pid));
    }
}
