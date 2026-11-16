use crate::{
    Licenses, Tuning,
    data,
    fonts,
};
use base64::Engine;
use std::{ops::Range, path::Path};

const LENGTH_UNITS: [&str; 31] = [
    "px", "em", "rem", "ex", "ch", "vw", "vh", "vi", "vb", "vmin", "vmax", "cm", "mm", "in", "pt",
    "pc", "q", "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax", "lh", "rlh", "svw", "svh", "lvw",
    "lvh", "dvw", "dvh",
];
const MATH_FUNCTIONS: [&str; 4] = ["calc", "min", "max", "clamp"];
const DESCRIPTOR_AT_RULES: [&str; 5] = [
    "font-face",
    "page",
    "counter-style",
    "property",
    "position-try",
];
const RECURSING_AT_RULES: [&str; 4] = ["media", "supports", "container", "layer"];

#[derive(Debug)]
enum Piece<'a> {
    Comment(&'a str, Range<usize>),
    Space(Range<usize>),
    Text(Range<usize>),
    Number {
        range: Range<usize>,
        unit: Option<Range<usize>>,
    },
    Url(Range<usize>),
    Block {
        open: usize,
        close: usize,
        kind: u8,
        pieces: Vec<Piece<'a>>,
    },
}

impl Piece<'_> {
    fn start(&self) -> usize {
        match self {
            Piece::Comment(_, r) | Piece::Space(r) | Piece::Text(r) | Piece::Url(r) => r.start,
            Piece::Number { range, .. } => range.start,
            Piece::Block { open, .. } => *open,
        }
    }

    fn end(&self) -> usize {
        match self {
            Piece::Comment(_, r) | Piece::Space(r) | Piece::Text(r) | Piece::Url(r) => r.end,
            Piece::Number { unit: Some(unit), .. } => unit.end,
            Piece::Number { range, .. } => range.end,
            Piece::Block { close, .. } => *close + 1,
        }
    }
}

struct Scanner<'a> {
    src: &'a str,
    b: &'a [u8],
    at: usize,
}

fn is_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0c)
}

fn is_name(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'\\') || b >= 0x80
}

fn is_digit(b: u8) -> bool {
    b.is_ascii_digit()
}

fn is_hex(b: u8) -> bool {
    b.is_ascii_hexdigit()
}

impl<'a> Scanner<'a> {
    fn peek(&self, at: usize) -> u8 {
        self.b.get(at).copied().unwrap_or(0)
    }

    fn ident_from(&self, at: usize) -> usize {
        let mut i = at;
        while i < self.b.len() {
            let b = self.b[i];
            if b == b'\\' {
                i += 2;
            } else if is_name(b) {
                i += 1;
            } else {
                break;
            }
        }
        i.min(self.src.len())
    }

    fn number_from(&self, at: usize) -> Option<(Range<usize>, Option<Range<usize>>)> {
        let mut i = at;
        if matches!(self.b.get(i), Some(b'+') | Some(b'-')) {
            i += 1;
        }
        let mantissa_start = i;
        while is_digit(self.peek(i)) {
            i += 1;
        }
        if self.peek(i) == b'.' {
            i += 1;
            let digits = i;
            while is_digit(self.peek(i)) {
                i += 1;
            }
            if i == digits && i == mantissa_start {
                return None;
            }
        } else if i == mantissa_start {
            return None;
        }
        let mut end = i;
        if matches!(self.peek(i), Some(b'e') | Some(b'E')) {
            let mut j = i + 1;
            if matches!(self.peek(j), Some(b'+') | Some(b'-')) {
                j += 1;
            }
            let exp_start = j;
            while is_digit(self.peek(j)) {
                j += 1;
            }
            if j > exp_start {
                end = j;
            }
        }
        let number = at..end;
        let mut unit = None;
        if end < self.b.len() && is_name(self.b[end]) && self.b[end] != b'\\' {
            let unit_end = self.ident_from(end);
            let unit_src = &self.src[end..unit_end];
            if !unit_src.contains('\\') {
                unit = Some(end..unit_end);
            }
        }
        Some((number, unit))
    }

    fn scan_block(&mut self, open: usize) -> Option<Piece<'a>> {
        let kind = self.b[open];
        let close_of = match kind {
            b'(' => b')',
            b'[' => b']',
            _ => b'}',
        };
        let mut pieces = Vec::new();
        let mut at = open + 1;
        let mut depth = 0usize;
        while at < self.b.len() {
            if self.b[at] == close_of && depth == 0 {
                return Some(Piece::Block {
                    open,
                    close: at,
                    kind,
                    pieces,
                });
            }
            let piece = self.scan_one(at, &mut depth)?;
            at = piece.end();
            pieces.push(piece);
        }
        None
    }

    fn scan_one(&mut self, at: usize, depth: &mut usize) -> Option<Piece<'a>> {
        let b = self.b[at];
        if is_space(b) {
            let mut i = at + 1;
            while i < self.b.len() && is_space(self.b[i]) {
                i += 1;
            }
            return Some(Piece::Space(at..i));
        }
        if b == b'/' && self.peek(at + 1) == b'*' {
            let end = self.src[at + 2..]
                .find("*/")
                .map_or(self.src.len(), |p| at + 4 + p);
            return Some(Piece::Comment(&self.src[at + 2..end.saturating_sub(2).max(at + 2)], at..end.min(self.src.len())));
        }
        if b == b'"' || b == b'\'' {
            let mut i = at + 1;
            while i < self.b.len() {
                match self.b[i] {
                    b'\\' => i += 2,
                    c if c == b => return Some(Piece::Text(at..i + 1)),
                    b'\n' | b'\r' => return None,
                    _ => i += 1,
                }
            }
            return None;
        }
        if b == b'(' || b == b'[' || b == b'{' {
            *depth += 1;
            return self.scan_block(at);
        }
        if b == b')' || b == b']' || b == b'}' {
            *depth = depth.saturating_sub(1);
            return Some(Piece::Text(at..at + 1));
        }
        if b == b'u' || b == b'U' {
            if self.peek(at + 1) == b'r'
                && self.peek(at + 2) == b'l'
                && self.peek(at + 3) == b'('
            {
                let mut i = at + 4;
                while i < self.b.len() {
                    match self.b[i] {
                        b')' => return Some(Piece::Url(at..i + 1)),
                        b'"' | b'\'' | b'(' => return None,
                        b'\\' => i += 2,
                        _ => i += 1,
                    }
                }
                return None;
            }
        }
        if is_digit(b) || ((b == b'+' || b == b'-') && is_digit(self.peek(at + 1)))
            || ((b == b'+' || b == b'-' || b == b'.') && self.peek(at + 1) == b'.' && is_digit(self.peek(at + 2)))
            || (b == b'.' && is_digit(self.peek(at + 1)))
        {
            let (range, unit) = self.number_from(at)?;
            return Some(Piece::Number { range, unit });
        }
        if b.is_ascii_alphabetic() || b == b'-' || b == b'_' || b >= 0x80 || b == b'\\' {
            let end = self.ident_from(at);
            if end > at {
                return Some(Piece::Text(at..end));
            }
        }
        if b == b'@' {
            let end = self.ident_from(at + 1);
            return Some(Piece::Text(at..end.max(at + 1)));
        }
        if b == b'#' {
            let end = self.ident_from(at + 1);
            return Some(Piece::Text(at..end.max(at + 1)));
        }
        Some(Piece::Text(at..at + 1))
    }
}

fn scan(src: &str) -> Option<Vec<Piece<'_>>> {
    let mut scanner = Scanner {
        src,
        b: src.as_bytes(),
        at: 0,
    };
    let mut pieces = Vec::new();
    let mut depth = 0usize;
    let mut at = 0;
    while at < src.len() {
        let piece = scanner.scan_one(at, &mut depth)?;
        at = piece.end();
        pieces.push(piece);
    }
    Some(pieces)
}

fn is_legal(comment: &str) -> bool {
    comment.starts_with('!') || comment.contains("@license") || comment.contains("@preserve")
}

struct Emitter<'a> {
    src: &'a str,
    out: String,
    math: usize,
}

fn last_char(out: &str) -> Option<char> {
    out.chars().next_back()
}

fn joins(prev: Option<char>, next: u8) -> bool {
    let structural_end = |c: char| matches!(c, '{' | '}' | ';' | ',');
    let structural_start = |b: u8| matches!(b, b'{' | b'}' | b';' | b',' | b')' | b':');
    !prev.map(structural_end).unwrap_or(true) && !structural_start(next)
}

impl<'a> Emitter<'a> {
    fn separator(&mut self, gap_end: usize, next_start: usize) {
        let prev = last_char(&self.out);
        let next = self.src.as_bytes().get(next_start).copied().unwrap_or(0);
        if prev.is_none() {
            return;
        }
        if gap_end == next_start {
            return;
        }
        if prev.is_some_and(|c| matches!(c, '{' | '}' | ';' | ',')) {
            return;
        }
        if matches!(next, b'{' | b'}' | b';' | b',' | b')') {
            return;
        }
        if joins(prev, next) || gap_end > next_start {
            self.out.push(' ');
        }
    }

    fn emit_number(&mut self, piece: &Piece<'_>, allow_unit_drop: bool) {
        let Piece::Number { range, unit } = piece else {
            return;
        };
        let text = &self.src[range.clone()];
        let mut number = rewrite_number(text).into_owned();
        if let Some(unit) = unit {
            let unit_text = &self.src[unit.clone()];
            if allow_unit_drop
                && number == "0"
                && !text.starts_with('-')
                && LENGTH_UNITS.contains(&unit_text.to_ascii_lowercase().as_str())
            {
                self.out.push_str("0");
                return;
            }
            number.push_str(unit_text);
        } else if let Some(unit) = unit {
            self.out.push_str(&number);
            self.out.push_str(&self.src[unit.clone()]);
            return;
        }
        self.out.push_str(&number);
    }

    fn emit_linear(&mut self, pieces: &[Piece<'a>], custom: bool) {
        let mut at = 0usize;
        for piece in pieces {
            let start = piece.start();
            let end = piece.end();
            self.handle_gap(at, start, piece, custom);
            match piece {
                Piece::Comment(comment, _) => {
                    if *comment == "" {
                        unreachable!()
                    }
                    if is_legal(comment) && self.licenses == Licenses::Keep {
                        self.separator(at, start);
                        self.out.push_str(&self.src[start..end]);
                        at = end;
                        continue;
                    }
                    self.out.push_str(&self.src[start..end]);
                    at = end;
                }
                Piece::Space(_) => {
                    self.separator(at, start);
                    at = end;
                }
                _ => {
                    self.separator(at, start);
                    at = end;
                }
            }
            at = end;
        }
    }

    fn handle_gap(&mut self, prev_end: usize, start: usize, piece: &Piece<'_>, custom: bool) {
        if prev_end >= start {
            return;
        }
        self.separator(prev_end, start);
    }
}

fn rewrite_number(text: &str) -> std::borrow::Cow<'_, str> {
    if text.starts_with('-') || text.is_empty() {
        return std::borrow::Cow::Borrowed(text);
    }
    let (mantissa, exponent) = match text.find(['e', 'E']) {
        Some(at) if text[..at].contains('.') || !text[..at].is_empty() => {
            let exp = &text[at..];
            let valid = {
                let mut rest = &exp[1..];
                if rest.starts_with('+') || rest.starts_with('-') {
                    rest = &rest[1..];
                }
                !rest.is_empty() && rest.bytes().all(is_digit)
            };
            if !valid {
                return std::borrow::Cow::Borrowed(text);
            }
            (&text[..at], exp)
        }
        _ => (text, ""),
    };
    let mut digits = mantissa;
    if let Some(rest) = digits.strip_prefix('+') {
        digits = rest;
    }
    if !digits.bytes().all(|b| is_digit(b) || b == b'.') || digits.matches('.').count() > 1 {
        return std::borrow::Cow::Borrowed(text);
    }
    let (whole, fraction) = match digits.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (digits, None),
    };
    if whole.is_empty() && fraction.map_or(true, str::is_empty) {
        return std::borrow::Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(mantissa.len());
    if !whole.is_empty() && whole != "0" {
        out.push_str(whole);
    } else if whole.is_empty() {
        out.push('0');
    }
    if let Some(fraction) = fraction {
        let trimmed = fraction.trim_end_matches('0');
        if !trimmed.is_empty() {
            out.push('.');
            out.push_str(trimmed);
        }
    }
    if out.is_empty() || out == "." {
        return std::borrow::Cow::Borrowed(text);
    }
    if out != mantissa {
        out.push_str(exponent);
        std::borrow::Cow::Owned(out)
    } else {
        std::borrow::Cow::Borrowed(text)
    }
}

pub(crate) fn rewrite(
    css: &str,
    licenses: Licenses,
    tuning: Tuning,
    cache: Option<&Path>,
) -> Option<String> {
    let pieces = scan(css)?;
    let mut out = Emitter {
        src: css,
        out: String::new(),
        math: 0,
    };
    out.emit_linear(&pieces, false);
    Some(out.out)
}
