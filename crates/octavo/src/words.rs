use crate::data;
use std::{
    collections::HashSet,
    hash::{DefaultHasher, Hash, Hasher},
};

const MAX_STORED_WORD: usize = 128;

fn is_separator(c: char) -> bool {
    match c {
        '\t'..='\r'
        | ' '
        | '"'
        | '\''
        | '`'
        | '<'
        | '>'
        | '='
        | '('
        | ')'
        | '{'
        | '}'
        | '['
        | ']'
        | ','
        | ';' => true,
        _ if c.is_ascii() => false,
        _ => c.is_whitespace(),
    }
}

fn is_not_word(c: char) -> bool {
    !(c.is_alphanumeric() || matches!(c, '_' | '-'))
}

fn fingerprint(word: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    word.hash(&mut hasher);
    hasher.finish()
}

#[derive(Default)]
pub(crate) struct Words {
    set: HashSet<String>,
    long: HashSet<u64>,
    prefixes: HashSet<String>,
}

impl Words {
    pub(crate) fn add_text(&mut self, text: &str) {
        for token in text.split(is_separator) {
            if data::is_data_url(token) {
                continue;
            }
            self.insert(token);
            for word in token.split(is_not_word) {
                if word.len() >= 3 && word.ends_with(['-', '_']) && !self.prefixes.contains(word) {
                    self.prefixes.insert(word.to_string());
                }
                self.insert(word);
            }
        }
    }

    fn insert(&mut self, token: &str) {
        if token.is_empty() {
            return;
        }
        if token.len() > MAX_STORED_WORD {
            self.long.insert(fingerprint(token));
            if token.chars().any(char::is_uppercase) {
                self.long.insert(fingerprint(&token.to_lowercase()));
            }
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

    pub(crate) fn absorb(&mut self, other: Words) {
        self.set.extend(other.set);
        self.long.extend(other.long);
        self.prefixes.extend(other.prefixes);
    }

    pub(crate) fn has(&self, word: &str) -> bool {
        if word.len() > MAX_STORED_WORD && self.long.contains(&fingerprint(word)) {
            return true;
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_separator_match_agrees_with_the_string_search_for_every_char() {
        let listed = "\"'`<>=(){}[],;";
        for c in (0..=char::MAX as u32).filter_map(char::from_u32) {
            assert_eq!(
                is_separator(c),
                c.is_whitespace() || listed.contains(c),
                "disagree on U+{:04X}",
                c as u32
            );
        }
    }

    #[test]
    fn absorbing_words_keeps_every_kind_of_entry() {
        let mut left = Words::default();
        left.add_text("alpha beta-");
        let mut right = Words::default();
        right.add_text(&format!("gamma {} Delta", "x".repeat(200)));
        left.absorb(right);
        assert!(left.has("alpha") && left.has("gamma") && left.has("delta"));
        assert!(left.has(&"x".repeat(200)));
        assert!(left.has("beta-suffix"));
    }
}
