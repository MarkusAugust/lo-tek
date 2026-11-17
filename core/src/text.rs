//! Text as UTF-16, the way JavaScript and Kotlin see it.
//!
//! The whole core works on UTF-16 units, not on Rust's UTF-8. That way every
//! position in a finding is the same index `String.slice` in JavaScript and
//! `String.substring` in Kotlin use, without conversion, also with "æøå" and
//! emoji in front. The helpers here do what the regular expressions in the
//! TypeScript version did, with the same rules for what counts as
//! whitespace, word characters and upper case.

pub type Utf16 = Vec<u16>;

/// `\s` in JavaScript: spaces and line breaks, including those outside ASCII.
pub fn is_space(c: u16) -> bool {
    matches!(
        c,
        0x09..=0x0D
            | 0x20
            | 0xA0
            | 0x1680
            | 0x2000..=0x200A
            | 0x2028
            | 0x2029
            | 0x202F
            | 0x205F
            | 0x3000
            | 0xFEFF
    )
}

/// `\w` in JavaScript, which `\b` builds on: ASCII letters, digits and `_`.
pub fn is_word(c: u16) -> bool {
    is_ascii_letter(c) || is_digit(c) || c == b'_' as u16
}

pub fn is_ascii_letter(c: u16) -> bool {
    (b'a' as u16..=b'z' as u16).contains(&c) || (b'A' as u16..=b'Z' as u16).contains(&c)
}

pub fn is_digit(c: u16) -> bool {
    (b'0' as u16..=b'9' as u16).contains(&c)
}

/// `[a-z0-9-]` with the `i` flag. Without the `u` flag, `i` only matches ASCII.
pub fn is_name_char(c: u16) -> bool {
    is_ascii_letter(c) || is_digit(c) || c == b'-' as u16
}

/// Whether a tag name, as it is written, is a component in a framework and
/// not HTML: `<Label>` is a component, `<INPUT>` is HTML in capitals.
pub fn is_component_name(written: &[u16]) -> bool {
    let upper = |c: &u16| (b'A' as u16..=b'Z' as u16).contains(c);
    written.first().is_some_and(upper)
        && !written
            .iter()
            .all(|c| upper(c) || !(b'a' as u16..=b'z' as u16).contains(c))
}

pub fn ascii_lower(c: u16) -> u16 {
    if (b'A' as u16..=b'Z' as u16).contains(&c) {
        c + 32
    } else {
        c
    }
}

pub fn utf16(s: &str) -> Utf16 {
    s.encode_utf16().collect()
}

/// To a Rust string for a message. A lone surrogate becomes `U+FFFD`.
pub fn lossy(t: &[u16]) -> String {
    String::from_utf16_lossy(t)
}

pub fn equals(t: &[u16], s: &str) -> bool {
    t.iter().copied().eq(s.encode_utf16())
}

/// Whether `t` has `pattern` (lower-case ASCII letters) at `at`, ignoring
/// case, like a regular expression with the `i` flag.
pub fn starts_at_ci(t: &[u16], at: usize, pattern: &str) -> bool {
    let m = pattern.as_bytes();
    at + m.len() <= t.len()
        && m.iter()
            .enumerate()
            .all(|(i, &b)| ascii_lower(t[at + i]) == b as u16)
}

pub fn starts_at(t: &[u16], at: usize, pattern: &str) -> bool {
    let m = pattern.encode_utf16();
    let mut rest = t.iter().skip(at);
    for c in m {
        if rest.next() != Some(&c) {
            return false;
        }
    }
    true
}

/// `indexOf`.
pub fn find_at(t: &[u16], from: usize, pattern: &str) -> Option<usize> {
    let m = utf16(pattern);
    if m.is_empty() {
        return Some(from.min(t.len()));
    }
    (from..t.len().saturating_sub(m.len() - 1)).find(|&i| t[i..].starts_with(&m))
}

pub fn find_unit(t: &[u16], from: usize, c: u16) -> Option<usize> {
    (from..t.len()).find(|&i| t[i] == c)
}

pub fn contains_str(t: &[u16], pattern: &str) -> bool {
    find_at(t, 0, pattern).is_some()
}

/// Like [`contains_str`], ignoring ASCII case.
pub fn contains_ci(t: &[u16], pattern: &str) -> bool {
    (0..t.len()).any(|i| starts_at_ci(t, i, pattern))
}

/// `toLowerCase()`: all of Unicode, with the same rules as JavaScript, also
/// for a final sigma in a word. A lone surrogate is left untouched.
pub fn lowercase(t: &[u16]) -> Utf16 {
    if t.iter().all(|&c| c < 0x80) {
        return t.iter().map(|&c| ascii_lower(c)).collect();
    }
    match String::from_utf16(t) {
        Ok(json_string) => utf16(&json_string.to_lowercase()),
        Err(_) => {
            let mut out = Vec::with_capacity(t.len());
            for chars_ in char::decode_utf16(t.iter().copied()) {
                match chars_ {
                    Ok(c) => {
                        let mut buf = [0u16; 2];
                        for l in c.to_lowercase() {
                            out.extend_from_slice(l.encode_utf16(&mut buf));
                        }
                    }
                    Err(e) => out.push(e.unpaired_surrogate()),
                }
            }
            out
        }
    }
}

/// `trim()`.
pub fn trimmed(t: &[u16]) -> &[u16] {
    let from = t.iter().position(|&c| !is_space(c)).unwrap_or(t.len());
    let to = t
        .iter()
        .rposition(|&c| !is_space(c))
        .map_or(from, |i| i + 1);
    &t[from..to]
}

/// The parts of `t` separated by whitespace, with the position of each: `/\S+/g`.
pub fn words(t: &[u16]) -> Vec<(usize, &[u16])> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < t.len() {
        if is_space(t[i]) {
            i += 1;
            continue;
        }
        let from = i;
        while i < t.len() && !is_space(t[i]) {
            i += 1;
        }
        out.push((from, &t[from..i]));
    }
    out
}

/// Replaces every character with a space, except line breaks, so the positions stay.
pub fn blank(t: &mut [u16]) {
    for c in t.iter_mut() {
        if *c != b'\n' as u16 {
            *c = b' ' as u16;
        }
    }
}

/// How many UTF-16 units a Rust string is, like `length` in JavaScript.
pub fn length(s: &str) -> usize {
    s.encode_utf16().count()
}

pub const LT: u16 = b'<' as u16;
pub const GT: u16 = b'>' as u16;
pub const SLASH: u16 = b'/' as u16;
pub const EQUALS: u16 = b'=' as u16;
pub const DOUBLE_QUOTE: u16 = b'"' as u16;
pub const SINGLE_QUOTE: u16 = b'\'' as u16;
pub const BACKTICK: u16 = b'`' as u16;
