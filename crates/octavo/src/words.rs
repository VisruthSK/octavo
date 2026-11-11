use crate::data;
use std::collections::HashSet;

const MAX_WORD: usize = 128;

#[derive(Default)]
pub(crate) struct Words {
    set: HashSet<String>,
    prefixes: HashSet<String>,
}

impl Words {
    pub(crate) fn add_text(&mut self, text: &str) {
        let separators = |c: char| c.is_whitespace() || "\"'`<>=(){}[],;".contains(c);
        let not_word = |c: char| !(c.is_alphanumeric() || matches!(c, '_' | '-'));
        for token in text.split(separators) {
            if data::is_data_url(token) {
                continue;
            }
            self.insert(token);
            for word in token.split(not_word) {
                if word.len() >= 3 && word.ends_with(['-', '_']) && !self.prefixes.contains(word) {
                    self.prefixes.insert(word.to_string());
                }
                self.insert(word);
            }
        }
    }

    fn insert(&mut self, token: &str) {
        if token.is_empty() || token.len() > MAX_WORD {
            return;
        }
        if !self.set.contains(token) {
            self.set.insert(token.to_string());
        }
        if token.chars().any(char::is_uppercase) {
            let lower = token.to_lowercase();
            if !self.set.contains(&lower) {
                self.set.insert(lower);
            }
        }
    }

    pub(crate) fn has(&self, word: &str) -> bool {
        self.set.contains(word)
            || (3..=word.len()).any(|end| {
                word.is_char_boundary(end)
                    && matches!(word.as_bytes()[end - 1], b'-' | b'_')
                    && self.prefixes.contains(&word[..end])
            })
    }

    pub(crate) fn has_tag(&self, tag: &str) -> bool {
        self.set.contains(tag) || self.set.contains(&tag.to_ascii_uppercase())
    }

    pub(crate) fn mentions(&self, phrase: &str) -> bool {
        phrase
            .split_whitespace()
            .all(|part| self.set.contains(&part.to_lowercase()))
    }

    pub(crate) fn any_starting_with(&self, prefix: &str) -> bool {
        self.set.iter().any(|w| w.starts_with(prefix))
    }
}
