use std::collections::HashSet;

#[derive(Default)]
pub struct Words {
    set: HashSet<String>,
    prefixes: HashSet<String>,
}

impl Words {
    pub fn add_text(&mut self, text: &str) {
        let separators = |c: char| c.is_whitespace() || "\"'`<>=(){}[],;".contains(c);
        for token in text.split(separators).filter(|t| t.len() <= 128) {
            self.insert(token);
        }
        for token in text
            .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-'))
            .filter(|t| t.len() <= 128)
        {
            if token.len() >= 3 && token.ends_with(['-', '_']) {
                self.prefixes.insert(token.to_string());
            }
            self.insert(token);
        }
    }

    fn insert(&mut self, token: &str) {
        if token.is_empty() {
            return;
        }
        if token.chars().any(char::is_uppercase) {
            self.remember(token.to_lowercase());
        }
        if !self.set.contains(token) {
            self.set.insert(token.to_string());
        }
    }

    fn remember(&mut self, word: String) {
        self.set.insert(word);
    }

    pub fn has(&self, word: &str) -> bool {
        self.set.contains(word) || self.prefixes.iter().any(|p| word.starts_with(p.as_str()))
    }

    pub fn has_tag(&self, tag: &str) -> bool {
        self.set.contains(tag) || self.set.contains(&tag.to_ascii_uppercase())
    }

    pub fn mentions(&self, phrase: &str) -> bool {
        phrase
            .split_whitespace()
            .all(|part| self.set.contains(&part.to_lowercase()))
    }

    pub fn any_starting_with(&self, prefix: &str) -> bool {
        self.set.iter().any(|w| w.starts_with(prefix))
    }
}
