//! The wiring on a whole page: that every id pointed at exists, and that
//! every field and every text is wired.
//!
//! The rules were first written in TypeScript, in `references.ts`, and were
//! translated here with the same messages. The TypeScript version is gone:
//! the core is the one implementation, and TypeScript, Kotlin and the
//! editors call it.

use std::collections::{HashMap, HashSet};

use crate::diagnose::{followed_by_end, read_attributes, tag_end, ReadAttribute};
use crate::text::*;
use crate::types::*;

const LINK: &str = "https://lo-tek.sobernetics.no/components/field/";
const SUMMARY_LINK: &str = "https://lo-tek.sobernetics.no/components/error-summary/";

const HOW: &str = "Write for on the label and id on the field in the template, or put the label around the field. If the code that renders the markup can call a builder function, lt.field({ id }) or Lt.field(id = ...) does it.";

/// The attributes that point at ids, and what the screen reader loses when they miss.
const REFERENCES: &[(&str, &str)] = &[
    ("for", "the label"),
    ("aria-describedby", "the description"),
    ("aria-labelledby", "the name"),
    ("aria-controls", "the wiring to what the element controls"),
];

const LABELABLE: &[&str] = &[
    "button", "input", "meter", "output", "progress", "select", "textarea",
];

pub(crate) const VOID: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

const RAW_TEXT: &[&str] = &["script", "style", "textarea", "template"];

pub(crate) struct Node {
    pub(crate) name: String,
    pub(crate) name_start: usize,
    pub(crate) name_end: usize,
    pub(crate) attributes: Vec<ReadAttribute>,
    pub(crate) parent: Option<usize>,
}

pub(crate) fn value<'a>(node: &'a Node, name: &str) -> Option<&'a ReadAttribute> {
    node.attributes.iter().find(|a| equals(&a.name, name))
}

pub(crate) fn non_empty<'a>(node: &'a Node, name: &str) -> Option<&'a Utf16> {
    value(node, name).and_then(|a| a.non_empty_value())
}

pub(crate) fn has_class(node: &Node, test: impl Fn(&[u16]) -> bool) -> bool {
    value(node, "class")
        .and_then(|a| a.value.as_deref())
        .is_some_and(|v| words(v).iter().any(|(_, t)| test(t)))
}

/// The node itself or an ancestor that meets the condition.
pub(crate) fn within(nodes: &[Node], node: usize, test: impl Fn(&Node) -> bool) -> bool {
    let mut n = Some(node);
    while let Some(i) = n {
        if test(&nodes[i]) {
            return true;
        }
        n = nodes[i].parent;
    }
    false
}

/// Whether the browser hides the node, itself or through an ancestor.
fn is_hidden(nodes: &[Node], node: usize) -> bool {
    let name = nodes[node].name.as_str();
    let mut n = Some(node);
    while let Some(i) = n {
        let m = &nodes[i];
        let hidden = value(m, "hidden").is_some()
            || (m.name == "dialog" && value(m, "open").is_none())
            || (m.name == "details"
                && i != node
                && value(m, "open").is_none()
                && name != "summary");
        if hidden {
            return true;
        }
        n = m.parent;
    }
    false
}

const ENTITIES: &[(&str, char)] = &[
    ("amp", '&'),
    ("lt", '<'),
    ("gt", '>'),
    ("quot", '"'),
    ("apos", '\''),
    ("nbsp", '\u{a0}'),
];

/// A code point as UTF-16. A surrogate stays on its own, as
/// `String.fromCodePoint` does.
fn push_code_point(out: &mut Utf16, kode: u32) {
    if kode >= 0x10000 {
        let k = kode - 0x10000;
        out.push(0xD800 + (k >> 10) as u16);
        out.push(0xDC00 + (k & 0x3FF) as u16);
    } else {
        out.push(kode as u16);
    }
}

/// The number in an entity, or `None` when it is not a character.
fn parse_code(digits: &[u16], radix: u32) -> Option<u32> {
    let mut v: u64 = 0;
    for &c in digits {
        v = v * radix as u64 + (c as u8 as char).to_digit(radix)? as u64;
        if v > 0x10FFFF {
            return None;
        }
    }
    (v > 0).then_some(v as u32)
}

/// An attribute value as the browser reads it, with the entities decoded:
/// `/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi`.
pub(crate) fn decode(t: &[u16]) -> Utf16 {
    let mut out = Vec::with_capacity(t.len());
    let mut i = 0;
    while i < t.len() {
        if t[i] != b'&' as u16 {
            out.push(t[i]);
            i += 1;
            continue;
        }
        let run = |from: usize, test: fn(u16) -> bool| {
            let mut j = from;
            while j < t.len() && test(t[j]) {
                j += 1;
            }
            j
        };
        let is_hex = |c: u16| c < 0x80 && (c as u8).is_ascii_hexdigit();
        let semicolon = |j: usize| t.get(j) == Some(&(b';' as u16));
        let mut hit: Option<(usize, Option<Utf16>)> = None;
        if starts_at(t, i + 1, "#")
            && t.get(i + 2)
                .is_some_and(|&c| c == b'x' as u16 || c == b'X' as u16)
        {
            let j = run(i + 3, is_hex);
            if j > i + 3 && semicolon(j) {
                let mut chars_ = Vec::new();
                if let Some(k) = parse_code(&t[i + 3..j], 16) {
                    push_code_point(&mut chars_, k);
                }
                hit = Some((j + 1, (!chars_.is_empty()).then_some(chars_)));
            }
        }
        if hit.is_none() && starts_at(t, i + 1, "#") {
            let j = run(i + 2, is_digit);
            if j > i + 2 && semicolon(j) {
                let mut chars_ = Vec::new();
                if let Some(k) = parse_code(&t[i + 2..j], 10) {
                    push_code_point(&mut chars_, k);
                }
                hit = Some((j + 1, (!chars_.is_empty()).then_some(chars_)));
            }
        }
        if hit.is_none() {
            let j = run(i + 1, is_ascii_letter);
            if j > i + 1 && semicolon(j) {
                let name = lowercase(&t[i + 1..j]);
                let chars_ = ENTITIES
                    .iter()
                    .find(|(n, _)| equals(&name, n))
                    .map(|(_, c)| utf16(&c.to_string()));
                hit = Some((j + 1, chars_));
            }
        }
        match hit {
            Some((end, chars_)) => {
                match chars_ {
                    Some(chars_) => out.extend(chars_),
                    None => out.extend_from_slice(&t[i..end]),
                }
                i = end;
            }
            None => {
                out.push(t[i]);
                i += 1;
            }
        }
    }
    out
}

/// `decodeURIComponent`, or `None` where it throws `URIError`.
fn decode_uri_component(t: &[u16]) -> Option<Utf16> {
    let hex = |i: usize| -> Option<u8> {
        if t.get(i)? != &(b'%' as u16) {
            return None;
        }
        let h = |c: u16| (c < 0x80).then(|| (c as u8 as char).to_digit(16)).flatten();
        Some((h(*t.get(i + 1)?)? * 16 + h(*t.get(i + 2)?)?) as u8)
    };
    let mut out = Vec::with_capacity(t.len());
    let mut i = 0;
    while i < t.len() {
        if t[i] != b'%' as u16 {
            out.push(t[i]);
            i += 1;
            continue;
        }
        let first = hex(i)?;
        i += 3;
        let count = match first {
            0x00..=0x7F => {
                out.push(first as u16);
                continue;
            }
            0xC0..=0xDF => 2,
            0xE0..=0xEF => 3,
            0xF0..=0xF7 => 4,
            _ => return None,
        };
        let mut bytes = vec![first];
        for _ in 1..count {
            let b = hex(i)?;
            if b & 0xC0 != 0x80 {
                return None;
            }
            bytes.push(b);
            i += 3;
        }
        // Rust rejects the same sequences as JavaScript: overlong
        // encodings, surrogates and code points above U+10FFFF.
        let chars_ = std::str::from_utf8(&bytes).ok()?;
        out.extend(chars_.encode_utf16());
    }
    Some(out)
}

/// The id a link like `href="#f%C3%B8dselsdato"` goes to.
pub(crate) fn fragment(href: &[u16]) -> Utf16 {
    match decode_uri_component(href) {
        Some(d) => decode(&d),
        None => decode(href),
    }
}

/// `<(\/?)([a-z][a-z0-9-]*)(?=[\s/>])` at `i`: whether it is a closing tag,
/// and where the name starts and ends.
pub(crate) fn tag_at(t: &[u16], i: usize) -> Option<(bool, usize, usize)> {
    if t.get(i) != Some(&LT) {
        return None;
    }
    let closer = t.get(i + 1) == Some(&SLASH);
    let name_start = i + 1 + usize::from(closer);
    if !t.get(name_start).is_some_and(|&c| is_ascii_letter(c)) {
        return None;
    }
    let mut j = name_start + 1;
    while j < t.len() && is_name_char(t[j]) {
        j += 1;
    }
    followed_by_end(t, j).then_some((closer, name_start, j))
}

/// The page as it is read as a whole page, with the same length.
pub fn page_source(text: &[u16]) -> Utf16 {
    hidden(text, true)
}

/// Like [`page_source`], but with the comments untouched. This is what
/// `<!-- lotek-ignore-next -->` is read from on a whole page: a comment in a
/// `<textarea>`, a `<template>` or an attribute value is text, and
/// suppresses nothing.
pub fn page_source_with_comments(text: &[u16]) -> Utf16 {
    hidden(text, false)
}

/// The text with what is not part of the page blanked out, and the comments
/// too when `comments` is true.
fn hidden(text: &[u16], comments: bool) -> Utf16 {
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    let mut i = 0;
    while i < text.len() {
        let Some(lt) = find_unit(text, i, LT) else {
            break;
        };
        if starts_at(text, lt, "<!--") {
            let end = find_at(text, lt + 4, "-->").map_or(text.len(), |c| c + 3);
            if comments {
                ranges.push((lt, end));
            }
            i = end;
            continue;
        }
        let Some((closer, name_start, name_end)) = tag_at(text, lt) else {
            i = lt + 1;
            continue;
        };
        let Some(end) = tag_end(text, name_end) else {
            break;
        };
        i = end + 1;
        if closer {
            continue;
        }
        for a in read_attributes(&text[name_end..end], name_end) {
            if let Some(v) = &a.value {
                if v.contains(&LT) {
                    ranges.push((a.value_start, a.value_start + v.len()));
                }
            }
        }
        let name = lossy(&lowercase(&text[name_start..name_end]));
        if RAW_TEXT.contains(&name.as_str()) {
            let close = raw_close(text, end + 1, &name).unwrap_or(text.len());
            ranges.push((end + 1, close));
            i = close;
        }
    }

    let mut out = text.to_vec();
    for (from, to) in ranges {
        blank(&mut out[from..to.max(from)]);
    }
    out
}

/// `</name\s*>` from `from`.
fn raw_close(t: &[u16], from: usize, name: &str) -> Option<usize> {
    (from..t.len()).find(|&i| {
        t[i] == LT && starts_at(t, i + 1, "/") && starts_at_ci(t, i + 2, name) && {
            let mut j = i + 2 + name.len();
            while j < t.len() && is_space(t[j]) {
                j += 1;
            }
            t.get(j) == Some(&GT)
        }
    })
}

/// Whether the tag ends with `/>`: `/(^|[\s"'])\/$/`.
fn self_closing(b: &[u16]) -> bool {
    b.last() == Some(&SLASH)
        && (b.len() == 1 || {
            let c = b[b.len() - 2];
            is_space(c) || c == DOUBLE_QUOTE || c == SINGLE_QUOTE
        })
}

/// The elements on the page as a tree, in the order they appear.
pub(crate) fn tree(source: &[u16]) -> Vec<Node> {
    walk(source).0
}

/// What the page holds, in document order: an element by its index in the
/// list of nodes, or the text between two tags.
pub(crate) enum Item {
    Element(usize),
    Text {
        parent: Option<usize>,
        start: usize,
        end: usize,
    },
}

/// The elements as [`tree`] reads them, and the text between them. The one
/// reading of a page's structure in the core: the checks use the elements,
/// and the accessibility tree the text as well.
pub(crate) fn walk(source: &[u16]) -> (Vec<Node>, Vec<Item>) {
    let mut nodes: Vec<Node> = Vec::new();
    let mut items: Vec<Item> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut text_start = 0;
    let mut i = 0;
    while i < source.len() {
        let Some((closer, name_start, name_end)) = tag_at(source, i) else {
            i += 1;
            continue;
        };
        let Some(end) = tag_end(source, name_end) else {
            break;
        };
        if i > text_start {
            items.push(Item::Text {
                parent: stack.last().copied(),
                start: text_start,
                end: i,
            });
        }
        text_start = end + 1;
        i = end + 1;
        let name = lossy(&lowercase(&source[name_start..name_end]));
        if closer {
            if let Some(at) = stack.iter().rposition(|&n| nodes[n].name == name) {
                stack.truncate(at);
            }
            continue;
        }
        let b = &source[name_end..end];
        let self_closes = self_closing(b);
        let foreign = name == "svg"
            || name == "math"
            || stack
                .iter()
                .any(|&n| nodes[n].name == "svg" || nodes[n].name == "math");
        nodes.push(Node {
            name_start,
            name_end: name_start + (name_end - name_start),
            attributes: read_attributes(if self_closes { &b[..b.len() - 1] } else { b }, name_end),
            parent: stack.last().copied(),
            name,
        });
        let index = nodes.len() - 1;
        items.push(Item::Element(index));
        if !VOID.contains(&nodes[index].name.as_str()) && !(self_closes && foreign) {
            stack.push(index);
        }
    }
    if source.len() > text_start {
        items.push(Item::Text {
            parent: stack.last().copied(),
            start: text_start,
            end: source.len(),
        });
    }
    (nodes, items)
}

fn findings(
    rule: &'static str,
    start: usize,
    end: usize,
    severity: Severity,
    link: &str,
    message: String,
) -> Finding {
    Finding {
        rule,
        start,
        end,
        severity,
        link: link.into(),
        message,
        fix: None,
    }
}

/// All findings about the wiring on the page, in the order they appear.
///
/// `page` is the page as [`page_source`] reads it. `diagnose_page` already
/// has it, and does not make it again for every call.
pub fn check_references(page: &[u16]) -> Vec<Finding> {
    let nodes = tree(page);
    let mut out = Vec::new();
    let mut ids: HashMap<Utf16, usize> = HashMap::new();
    let mut described_by: HashSet<Utf16> = HashSet::new();

    for (n, node) in nodes.iter().enumerate() {
        if let Some(id) = value(node, "id").filter(|a| a.non_empty_value().is_some()) {
            let v = id.value.as_ref().unwrap();
            let decoded = decode(v);
            if let std::collections::hash_map::Entry::Vacant(ledig) = ids.entry(decoded) {
                ledig.insert(n);
            } else {
                out.push(findings(
                    "duplicate-id",
                    id.value_start,
                    id.value_start + v.len(),
                    Severity::Error,
                    LINK,
                    format!(
                        "id=\"{}\" appears more than once on the page. for and aria-describedby then point at the first element, and the wiring to this one is broken. Every id must be unique.",
                        lossy(v)
                    ),
                ));
            }
        }
        if let Some(v) = value(node, "aria-describedby").and_then(|a| a.value.as_deref()) {
            for (_, part) in words(&decode(v)) {
                described_by.insert(part.to_vec());
            }
        }
    }

    for (n, node) in nodes.iter().enumerate() {
        for (name, loses) in REFERENCES {
            let Some(a) = value(node, name).filter(|a| a.non_empty_value().is_some()) else {
                continue;
            };
            let v = a.value.as_ref().unwrap();
            for (offset, target) in words(v) {
                let at = a.value_start + offset;
                match ids.get(&decode(target)) {
                    None => out.push(findings(
                    "id-not-found",
                        at,
                        at + target.len(),
                        Severity::Error,
                        LINK,
                        format!(
                            "{name}=\"{}\" points at the id \"{}\", which does not exist on the page. The screen reader loses {loses}.{}",
                            lossy(v),
                            lossy(target),
                            // The advice is about a field, not what
                            // aria-controls controls, and the space only
                            // comes with it.
                            if *name == "aria-controls" { String::new() } else { format!(" {HOW}") }
                        ),
                    )),
                    Some(&found) => {
                        let f = &nodes[found].name;
                        if *name == "for" && node.name == "label" && !LABELABLE.contains(&f.as_str()) && !f.contains('-') {
                            out.push(findings(
                    "for-points-nowhere",
                                at,
                                at + target.len(),
                                Severity::Error,
                                LINK,
                                format!(
                                    "for=\"{}\" points at a <{f}>, which cannot have a label. for must point at the field itself: <input>, <select>, <textarea> or a button. {HOW}",
                                    lossy(v)
                                ),
                            ));
                        }
                    }
                }
            }
        }

        if node.name == "a"
            && within(&nodes, n, |m| {
                m.name == "lt-error-summary" || has_class(m, |c| equals(c, "lt-error-summary"))
            })
        {
            if let Some(href) = value(node, "href") {
                let v = href.value.as_deref().unwrap_or(&[]);
                let target = if starts_at(v, 0, "#") {
                    &v[1..]
                } else {
                    &[][..]
                };
                if !target.is_empty() && !ids.contains_key(&fragment(target)) {
                    out.push(findings(
                    "summary-points-nowhere",
                        href.value_start + 1,
                        href.value_start + target.len() + 1,
                        Severity::Error,
                        SUMMARY_LINK,
                        format!(
                            "The link in the error summary goes to \"#{}\", which does not exist on the page. It must go to the field that failed, so the user lands where the error can be fixed.",
                            lossy(target)
                        ),
                    ));
                }
            }
        }

        if within(&nodes, n, |m| m.name == "lt-field") {
            continue;
        }

        let kind = if has_class(node, |c| equals(c, "lt-error-text")) {
            Some("The error text")
        } else if has_class(node, |c| equals(c, "lt-help-text")) {
            Some("The help text")
        } else {
            None
        };
        let role = value(node, "role")
            .and_then(|a| a.value.as_deref())
            .unwrap_or(&[]);
        let live =
            equals(role, "status") || equals(role, "alert") || value(node, "aria-live").is_some();
        if let Some(kind) = kind {
            if !live && !is_hidden(&nodes, n) {
                let id = non_empty(node, "id");
                if id.is_none_or(|id| !described_by.contains(&decode(id))) {
                    let middle = match id {
                        Some(id) => format!(
                            "its id \"{}\" is not in aria-describedby on any field. ",
                            lossy(id)
                        ),
                        None => "it has no id, so no aria-describedby can point at it. ".into(),
                    };
                    out.push(findings(
                    "text-not-wired",
                        node.name_start,
                        node.name_end,
                        Severity::Warning,
                        LINK,
                        format!("{kind} is not wired to any field: {middle}A screen reader does not announce it together with the field. {HOW}"),
                    ));
                }
            }
        }
    }

    out.sort_by_key(|f| f.start);
    out
}
