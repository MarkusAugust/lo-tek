//! The vocabulary: elements, attributes, classes and values.
//!
//! The rules were first written in TypeScript, in `diagnostics.ts`, and were
//! translated here function by function with the same messages. The
//! TypeScript version is gone: the core is the one implementation, and
//! TypeScript, Kotlin and the editors call it. Every regular expression from
//! that time is written out as a loop, with the same answer.

use std::collections::HashMap;

use crate::styles::Styles;
use crate::text::*;
use crate::types::*;

pub const DOCS: &str = "https://lo-tek.sobernetics.no/components/";

const GLOBAL: &[&str] = &[
    "accesskey",
    "autocapitalize",
    "autocorrect",
    "autofocus",
    "class",
    "contenteditable",
    "dir",
    "draggable",
    "enterkeyhint",
    "exportparts",
    "headingoffset",
    "hidden",
    "id",
    "inert",
    "inputmode",
    "is",
    "itemid",
    "itemprop",
    "itemref",
    "itemscope",
    "itemtype",
    "lang",
    "nonce",
    "part",
    "popover",
    "role",
    "slot",
    "spellcheck",
    "style",
    "tabindex",
    "title",
    "translate",
    "writingsuggestions",
    "xmlns",
];

fn is_global(name: &[u16]) -> bool {
    GLOBAL.iter().any(|g| equals(name, g))
        || equals(name, "_")
        || ["data-", "aria-", "on", "hx-", "x-", "v-", "i18n"]
            .iter()
            .any(|p| starts_at(name, 0, p))
        || name
            .iter()
            .any(|&c| c < 0x80 && b":@*[](){}%$#?".contains(&(c as u8)))
}

/// `/\{\{|\{%|\{#|<\?|<%|\$\{|@\(/`: Go, Jinja, PHP, ASP, JS templates and Razor.
pub fn is_templated(t: &[u16]) -> bool {
    ["{{", "{%", "{#", "<?", "<%", "${", "@("]
        .iter()
        .any(|m| contains_str(t, m))
}

/// A template that writes the value as text: Go, Jinja, Handlebars, PHP and
/// ERB/ASP. There a boolean attribute stays even when the template writes
/// "false" or nothing.
///
/// Not `{…}`, `@(…)` and `${…}`: Astro, Svelte, JSX, Razor and JTE remove a
/// boolean attribute with a false value themselves.
pub fn is_text_template(t: &[u16]) -> bool {
    ["{{", "{%", "<?", "<%"].iter().any(|m| contains_str(t, m))
}

/// Whether the tag has a condition in the template language outside the
/// values, like `{{ if .Open }} open="{{ .Open }}" {{ end }}`. Then the
/// attribute is inside the condition, and the template in the value is not
/// what turns the flag on. A condition inside the value does not help: the
/// attribute is there regardless.
fn has_condition(body: &[u16], offset: usize, attributes: &[ReadAttribute]) -> bool {
    let inside = |i: usize| {
        attributes.iter().any(|a| {
            a.value.as_ref().is_some_and(|v| {
                i + offset >= a.value_start && i + offset < a.value_start + v.len()
            })
        })
    };
    let compact: Utf16 = body
        .iter()
        .enumerate()
        .filter(|&(i, &c)| !is_space(c) && !inside(i))
        .map(|(_, &c)| c)
        .collect();
    [
        "{{if",
        "{{-if",
        "{{#if",
        "{{#unless",
        "{{^",
        "{%if",
        "{%-if",
        "<%if",
        "<?phpif",
        "<?if",
        "@if",
    ]
    .iter()
    .any(|m| contains_str(&compact, m))
}

/// A value in braces is Astro or Svelte, and an expression: `/^\s*[@{]/`.
pub fn is_templated_value(t: &[u16]) -> bool {
    is_templated(t)
        || t.iter()
            .find(|&&c| !is_space(c))
            .is_some_and(|&c| c == b'@' as u16 || c == b'{' as u16)
}

/// Razor in the content, outside the tags.
pub(crate) fn is_templated_content(t: &[u16]) -> bool {
    if is_templated(t) {
        return true;
    }
    // `text.replace(/<[^>]*>/g, " ")`
    let mut stripped = Vec::with_capacity(t.len());
    let mut i = 0;
    while i < t.len() {
        if t[i] == LT {
            if let Some(gt) = find_unit(t, i + 1, GT) {
                stripped.push(b' ' as u16);
                i = gt + 1;
                continue;
            }
        }
        stripped.push(t[i]);
        i += 1;
    }
    // `/(^|\s)@[A-Za-z]/`
    (0..stripped.len()).any(|i| {
        stripped[i] == b'@' as u16
            && (i == 0 || is_space(stripped[i - 1]))
            && i + 1 < stripped.len()
            && is_ascii_letter(stripped[i + 1])
    })
}

/// The name without hyphens and upper case, to recognise typos.
fn normalized(t: &[u16]) -> Utf16 {
    lowercase(t)
        .into_iter()
        .filter(|&c| c != b'-' as u16 && c != b'_' as u16)
        .collect()
}

/// The edit distance, with a swap of two adjacent characters counting as one.
fn distance(a: &[u16], b: &[u16]) -> usize {
    let mut before: Vec<usize> = vec![0; b.len() + 1];
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut current = vec![i; b.len() + 1];
        for j in 1..=b.len() {
            let mut d = (previous[j] + 1)
                .min(current[j - 1] + 1)
                .min(previous[j - 1] + usize::from(a[i - 1] != b[j - 1]));
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d = d.min(before[j - 2] + 1);
            }
            current[j] = d;
        }
        before = previous;
        previous = current;
    }
    previous[b.len()]
}

fn common_prefix(a: &[u16], b: &[u16]) -> usize {
    a.iter().zip(b).take_while(|(x, y)| x == y).count()
}

pub type Cache = HashMap<Utf16, Option<(String, bool)>>;

/// The closest known name, when it is close enough to be a typo.
pub fn closest(
    name: &[u16],
    candidates: &[&str],
    cache: Option<&mut Cache>,
) -> Option<(String, bool)> {
    if let Some(h) = &cache {
        if let Some(respond) = h.get(name) {
            return respond.clone();
        }
    }
    let respond = find_closest(name, candidates);
    if let Some(h) = cache {
        h.insert(name.to_vec(), respond.clone());
    }
    respond
}

fn find_closest(name: &[u16], candidates: &[&str]) -> Option<(String, bool)> {
    let wanted = normalized(name);
    if let Some(same) = candidates.iter().find(|k| normalized(&utf16(k)) == wanted) {
        return Some((same.to_string(), true));
    }
    let lower = lowercase(name);
    let max = if name.len() >= 8 { 2 } else { 1 };
    let mut best: Option<(&str, Utf16)> = None;
    let mut best_distance = max + 1;
    for &candidate in candidates {
        let k = utf16(candidate);
        if k.len().abs_diff(lower.len()) > max {
            continue;
        }
        let d = distance(&lower, &k);
        let better = d < best_distance
            || (d == best_distance
                && best
                    .as_ref()
                    .is_some_and(|(_, b)| common_prefix(&lower, &k) > common_prefix(&lower, b)));
        if better {
            best_distance = d;
            best = Some((candidate, k));
        }
    }
    best.map(|(name, _)| (name.to_string(), false))
}

/// `[\s\S]*?` up to the first match of `end`, or to the end of the text.
fn blank_range(out: &mut [u16], from: usize, to: usize) {
    blank(&mut out[from..to]);
}

/// `<script\b` and `<style\b`: the name ignoring case, and no word
/// character after it.
fn opens(t: &[u16], i: usize, name: &str) -> bool {
    starts_at(t, i, "<")
        && starts_at_ci(t, i + 1, name)
        && t.get(i + 1 + name.len()).is_none_or(|&c| !is_word(c))
}

/// The first `</name\s*>` from `from`, with the index where it ends.
fn closer(t: &[u16], from: usize, name: &str) -> Option<(usize, usize)> {
    let mut i = from;
    while i < t.len() {
        if t[i] == LT && starts_at(t, i + 1, "/") && starts_at_ci(t, i + 2, name) {
            let mut j = i + 2 + name.len();
            while j < t.len() && is_space(t[j]) {
                j += 1;
            }
            if j < t.len() && t[j] == GT {
                return Some((i, j + 1));
            }
        }
        i += 1;
    }
    None
}

/// The comments in the template languages: what is inside them is not rendered.
///
/// Blade `{{-- --}}`, Go `{{/* */}}`, Jinja, Twig and Nunjucks `{# #}`, Razor
/// `@* *@`, and JSP and ASP `<%-- --%>`. Unlike an HTML comment they are
/// only blanked when they are closed: `{#` also opens a block in Svelte,
/// like `{#if}`, and an unclosed comment would then blank the rest of the file.
const TEMPLATE_COMMENTS: [(&str, &str); 5] = [
    ("{{--", "--}}"),
    ("{{/*", "*/}}"),
    ("{#", "#}"),
    ("@*", "*@"),
    ("<%--", "--%>"),
];

/// The text without comments, scripts and style sheets, with the same length.
pub fn without_hidden(text: &[u16]) -> Utf16 {
    let mut out = text.to_vec();
    // The comments first, then the scripts and style sheets in what is left.
    let mut i = 0;
    while let Some(start) = find_at(&out, i, "<!--") {
        let end = find_at(&out, start + 4, "-->").map_or(out.len(), |e| e + 3);
        blank_range(&mut out, start, end);
        i = end.max(start + 1);
    }
    for (open, close) in TEMPLATE_COMMENTS {
        let mut i = 0;
        while let Some(start) = find_at(&out, i, open) {
            i = start + 1;
            // `{#if}` in Svelte is no comment: Jinja writes a space or `-`
            // after `{#`.
            if open == "{#"
                && !out
                    .get(start + 2)
                    .is_some_and(|&c| is_space(c) || c == b'-' as u16)
            {
                continue;
            }
            let Some(end) = find_at(&out, start + open.len(), close) else {
                continue;
            };
            let end = end + close.len();
            blank_range(&mut out, start, end);
            i = end;
        }
    }
    for name in ["script", "style"] {
        let mut i = 0;
        while i < out.len() {
            if opens(&out, i, name) {
                let end = closer(&out, i + 1 + name.len(), name).map_or(out.len(), |(_, e)| e);
                blank_range(&mut out, i, end);
                i = end.max(i + 1);
            } else {
                i += 1;
            }
        }
    }
    out
}

/// Where the tag that starts at `from` ends: the index of `>`.
pub fn tag_end(t: &[u16], from: usize) -> Option<usize> {
    let mut quote: Option<u16> = None;
    let mut i = from;
    while i < t.len() {
        let c = t[i];
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if c == DOUBLE_QUOTE || c == SINGLE_QUOTE {
            quote = Some(c);
        } else if c == LT && (starts_at(t, i + 1, "?") || starts_at(t, i + 1, "%")) {
            let close = [t[i + 1], GT];
            let found = (i + 2..t.len().saturating_sub(1)).find(|&k| t[k..k + 2] == close)?;
            i = found + 1;
        } else if c == GT {
            return Some(i);
        }
        i += 1;
    }
    None
}

#[derive(Clone, Debug)]
pub struct ReadAttribute {
    pub name: Utf16,
    pub value: Option<Utf16>,
    pub start: usize,
    /// Where the name ends.
    pub end: usize,
    /// Where the whole attribute ends, with value and quotes.
    pub value_end: usize,
    /// Where the whitespace before the attribute starts.
    pub space_start: usize,
    /// Where the value itself is, without quotes.
    pub value_start: usize,
}

impl ReadAttribute {
    pub fn non_empty_value(&self) -> Option<&Utf16> {
        self.value.as_ref().filter(|v| !v.is_empty())
    }
}

/// The attributes in a tag, read from the text between the name and `>`.
pub fn read_attributes(body: &[u16], offset: usize) -> Vec<ReadAttribute> {
    let mut out = Vec::new();
    let mut i = 0;
    let skip_space = |i: &mut usize| {
        while *i < body.len() && is_space(body[*i]) {
            *i += 1;
        }
    };
    while i < body.len() {
        let space_start = i;
        skip_space(&mut i);
        let name_start = i;
        while i < body.len()
            && !is_space(body[i])
            && !matches!(
                body[i],
                DOUBLE_QUOTE | SINGLE_QUOTE | EQUALS | LT | GT | SLASH
            )
        {
            i += 1;
        }
        if i == name_start {
            i += 1;
            continue;
        }
        let name = &body[name_start..i];
        let mut value: Option<Utf16> = None;
        let mut value_start = i;
        let after_name = i;
        skip_space(&mut i);
        if i < body.len() && body[i] == EQUALS {
            i += 1;
            skip_space(&mut i);
            let open = body.get(i).copied();
            if open == Some(DOUBLE_QUOTE) || open == Some(SINGLE_QUOTE) {
                let close = find_unit(body, i + 1, open.unwrap());
                value_start = i + 1;
                let to = close.unwrap_or(body.len());
                value = Some(body[value_start.min(to)..to].to_vec());
                i = close.map_or(body.len(), |l| l + 1);
            } else if open == Some(b'{' as u16) {
                value_start = i;
                i = braces_end(body, i);
                value = Some(body[value_start..i].to_vec());
            } else {
                value_start = i;
                while i < body.len()
                    && !is_space(body[i])
                    && !matches!(
                        body[i],
                        DOUBLE_QUOTE | SINGLE_QUOTE | EQUALS | LT | GT | BACKTICK
                    )
                {
                    i += 1;
                }
                value = Some(body[value_start..i].to_vec());
            }
        } else {
            i = after_name;
        }
        let has_value = value.is_some();
        out.push(ReadAttribute {
            name: lowercase(name),
            value,
            start: offset + name_start,
            end: offset + name_start + name.len(),
            value_end: offset + if has_value { i } else { after_name },
            space_start: offset + space_start,
            value_start: offset + if has_value { value_start } else { after_name },
        });
    }
    out
}

fn braces_end(t: &[u16], from: usize) -> usize {
    let mut depth = 0i32;
    let mut quote: Option<u16> = None;
    for (i, &c) in t.iter().enumerate().skip(from) {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            continue;
        }
        if c == DOUBLE_QUOTE || c == SINGLE_QUOTE || c == BACKTICK {
            quote = Some(c);
        } else if c == b'{' as u16 {
            depth += 1;
        } else if c == b'}' as u16 {
            depth -= 1;
            if depth == 0 {
                return i + 1;
            }
        }
    }
    t.len()
}

fn list<'a>(names: impl IntoIterator<Item = &'a str>) -> String {
    names.into_iter().collect::<Vec<_>>().join(", ")
}

/// `Number(value)` in JavaScript, and empty is not a number.
fn is_number(value: &[u16]) -> bool {
    let t = trimmed(value);
    if t.is_empty() || t.iter().any(|&c| c >= 0x80) {
        return false;
    }
    let s: String = t.iter().map(|&c| c as u8 as char).collect();
    let b = s.as_bytes();
    // Hexadecimal, octal and binary, without a sign.
    if b.len() > 2 && b[0] == b'0' {
        let siffer = &s[2..];
        let valid = match b[1] {
            b'x' | b'X' => siffer.bytes().all(|c| c.is_ascii_hexdigit()),
            b'o' | b'O' => siffer.bytes().all(|c| (b'0'..=b'7').contains(&c)),
            b'b' | b'B' => siffer.bytes().all(|c| c == b'0' || c == b'1'),
            _ => return is_decimal(&s),
        };
        return valid;
    }
    is_decimal(&s)
}

/// StrDecimalLiteral: sign, `Infinity`, digits with a point and an exponent.
fn is_decimal(s: &str) -> bool {
    let s = s.strip_prefix(['+', '-']).unwrap_or(s);
    if s == "Infinity" {
        return true;
    }
    let (mantissa, exponent) = match s.find(['e', 'E']) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let (integer, fraction) = match mantissa.find('.') {
        Some(i) => (&mantissa[..i], &mantissa[i + 1..]),
        None => (mantissa, ""),
    };
    let digits = |x: &str| x.bytes().all(|c| c.is_ascii_digit());
    if !digits(integer) || !digits(fraction) || (integer.is_empty() && fraction.is_empty()) {
        return false;
    }
    match exponent {
        None => true,
        Some(e) => {
            let e = e.strip_prefix(['+', '-']).unwrap_or(e);
            !e.is_empty() && digits(e)
        }
    }
}

fn find_attribute<'a>(element: &'a Element, name: &[u16]) -> Option<&'a Attribute> {
    element
        .attributes
        .iter()
        .find(|(n, _)| equals(name, n))
        .map(|(_, a)| a)
}

fn check_attribute(
    tag: &str,
    element: &Element,
    a: &ReadAttribute,
    templated_tag: bool,
    conditional: bool,
) -> Option<Finding> {
    let name = lossy(&a.name);
    let findings = |rule, severity, message: String, fix| Finding {
        start: a.start,
        end: a.end,
        severity,
        link: element.link.clone(),
        message,
        fix,
        rule,
    };
    let Some(known) = find_attribute(element, &a.name) else {
        let norm = normalized(&a.name);
        if let Some((meant, _)) = element
            .attributes
            .iter()
            .find(|(k, _)| normalized(&utf16(k)) == norm)
        {
            return Some(findings(
                "unknown-attribute",
                Severity::Warning,
                format!("<{tag}> has no attribute \"{name}\". Did you mean {meant}?"),
                Some(Fix::one(
                    format!("Change to {meant}"),
                    a.start,
                    a.end,
                    meant.clone(),
                    true,
                )),
            ));
        }
        if templated_tag || is_global(&a.name) {
            return None;
        }
        return Some(findings(
            "unknown-attribute",
            Severity::Warning,
            format!(
                "<{tag}> has no attribute \"{name}\", and the component does not read it. The attributes are {}.",
                list(element.attributes.iter().map(|(n, _)| n.as_str()))
            ),
            None,
        ));
    };
    if a.value.as_deref().is_some_and(is_templated_value) {
        if matches!(known, Attribute::Flag)
            && !conditional
            && a.value.as_deref().is_some_and(is_text_template)
        {
            return Some(findings(
                "boolean-with-value",
                Severity::Warning,
                format!(
                    "{name} is a boolean attribute, and the template writes the value as text: \"false\" and an empty value turn it on too. Write the whole attribute inside a condition in the template."
                ),
                None,
            ));
        }
        return None;
    }
    match known {
        Attribute::Flag => {
            let value = a.value.as_deref()?;
            if name == "hidden" && equals(value, "until-found") {
                return None;
            }
            if !value.is_empty() && lowercase(value) != a.name {
                let v = lossy(value);
                return Some(findings(
                    "boolean-with-value",
                    Severity::Warning,
                    format!(
                        "{name} is a boolean attribute: it is either there or not. {name}=\"{v}\" means the same as {name}. Remove it to turn it off."
                    ),
                    Some(Fix::one(
format!("Remove {name}"),
a.space_start,
a.value_end,
String::new(),
true,
)),
                ));
            }
            None
        }
        Attribute::Values(values) => {
            let valid = a
                .value
                .as_deref()
                .is_some_and(|v| values.iter().any(|k| equals(v, k)));
            if valid {
                return None;
            }
            let v = a.value.as_deref().map(lossy).unwrap_or_default();
            Some(findings(
                "invalid-value",
                Severity::Error,
                format!(
                    "{name} cannot be \"{v}\". Valid values: {}.",
                    list(values.iter().map(String::as_str))
                ),
                None,
            ))
        }
        Attribute::Number => match a.value.as_deref() {
            Some(v) if !is_number(v) => Some(findings(
                "not-a-number",
                Severity::Error,
                format!("{name} must be a number, not \"{}\".", lossy(v)),
                None,
            )),
            _ => None,
        },
        Attribute::Text => None,
    }
}

/// `/<(input|textarea|select)(?=[\s/>])/gi`, and the first control that is
/// not `type="hidden"`.
fn find_control(content: &[u16]) -> Option<Vec<ReadAttribute>> {
    let mut i = 0;
    while i < content.len() {
        if content[i] != LT {
            i += 1;
            continue;
        }
        let hit = ["input", "textarea", "select"].into_iter().find(|name| {
            starts_at_ci(content, i + 1, name) && followed_by_end(content, i + 1 + name.len())
        });
        let Some(name) = hit else {
            i += 1;
            continue;
        };
        let from = i + 1 + name.len();
        i = from;
        let Some(to) = tag_end(content, from) else {
            continue;
        };
        let attributes = read_attributes(&content[from..to], 0);
        let type_ = attributes
            .iter()
            .find(|a| equals(&a.name, "type"))
            .and_then(|a| a.value.as_deref());
        if name == "input" && type_.is_some_and(|t| lowercase(t) == utf16("hidden")) {
            continue;
        }
        return Some(attributes);
    }
    None
}

/// `(?=[\s/>])`
pub fn followed_by_end(t: &[u16], i: usize) -> bool {
    t.get(i)
        .is_some_and(|&c| is_space(c) || c == SLASH || c == GT)
}

/// `/<name(?=[\s/>])/i`
fn has_tag(t: &[u16], name: &str) -> bool {
    (0..t.len()).any(|i| {
        t[i] == LT && starts_at_ci(t, i + 1, name) && followed_by_end(t, i + 1 + name.len())
    })
}

/// `field-without-control`: an `<lt-field>` with nothing to wire. Whether the
/// control has a label is `without-name`'s.
fn check_field(
    tag: &str,
    name_start: usize,
    name_end: usize,
    content: &[u16],
    link: &str,
) -> Vec<Finding> {
    let has_element = (0..content.len())
        .any(|i| content[i] == LT && content.get(i + 1).is_some_and(|&c| is_ascii_letter(c)));
    if !has_element || is_templated_content(content) || find_control(content).is_some() {
        return vec![];
    }
    vec![Finding {
        start: name_start,
        end: name_end,
        severity: Severity::Warning,
        link: link.to_string(),
        message: format!(
            "<{tag}> found no control to wire up. The label, help text and error text have no field, so the wiring cannot be made. Add an <input>, <textarea> or <select>."
        ),
        fix: None,
        rule: "field-without-control",
    }]
}

fn check_session_timeout(
    tag: &str,
    name_start: usize,
    name_end: usize,
    content: &[u16],
    link: &str,
) -> Vec<Finding> {
    if is_templated_content(content) || has_tag(content, "dialog") {
        return vec![];
    }
    vec![Finding {
        start: name_start,
        end: name_end,
        severity: Severity::Warning,
        link: link.to_string(),
        message: format!(
            "<{tag}> found no <dialog>. The warning cannot be shown, and the session times out without warning."
        ),
        fix: None,
        rule: "timeout-without-dialog",
    }]
}

/// The name of the block a class belongs to: `app-button` for `app-button--primary`.
fn block(name: &str) -> &str {
    let end = [name.find("__"), name.find("--")]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(name.len());
    &name[..end]
}

/// Whether a class should be checked against the vocabulary.
///
/// Everything that starts with `lt-` is LO-TEK's. A taken-over component has
/// another name, like `app-button`, and then only that block is checked, with
/// elements and variants: the rest of the project's `app-*` classes are not
/// LO-TEK's business.
fn checked_class(vocabulary: &Vocabulary, token: &[u16]) -> bool {
    if starts_at(token, 0, "lt-") {
        // Bootstrap's `lt-1` to `lt-6` (font size) are not ours.
        let rest = &token[3..];
        return !(!rest.is_empty()
            && rest
                .iter()
                .all(|&c| (b'0' as u16..=b'9' as u16).contains(&c)));
    }
    vocabulary
        .classes
        .iter()
        .filter(|c| !c.name.starts_with("lt-"))
        .any(|c| {
            let block = block(&c.name);
            starts_at(token, 0, block)
                && (token.len() == block.encode_utf16().count()
                    || starts_at(token, block.encode_utf16().count(), "--")
                    || starts_at(token, block.encode_utf16().count(), "__"))
        })
}

/// Whether a tag that starts at `at` is one of the elements in the vocabulary
/// not named `lt-…`, like a taken-over `<app-dialog>`.
fn own_element_at(vocabulary: &Vocabulary, source: &[u16], at: usize) -> bool {
    vocabulary
        .elements
        .iter()
        .filter(|e| !e.tag.starts_with("lt-"))
        .any(|e| {
            let end = at + e.tag.encode_utf16().count();
            starts_at_ci(source, at, &e.tag) && source.get(end).is_none_or(|&c| !is_name_char(c))
        })
}

fn find_class<'a>(vocabulary: &'a Vocabulary, name: &[u16]) -> Option<&'a Class> {
    vocabulary.classes.iter().find(|k| equals(name, &k.name))
}

fn check_classes(
    vocabulary: &Vocabulary,
    tag: &[u16],
    attributes: &[ReadAttribute],
    conditional: bool,
    cache: &mut Cache,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    let Some(class_attribute) = attributes.iter().find(|a| equals(&a.name, "class")) else {
        return findings;
    };
    let Some(value) = class_attribute.non_empty_value() else {
        return findings;
    };
    if is_templated_value(value) {
        return findings;
    }
    let name: Vec<&str> = vocabulary.classes.iter().map(|k| k.name.as_str()).collect();
    let mut present: Vec<&Class> = Vec::new();
    for (offset, token) in words(value) {
        let start = class_attribute.value_start + offset;
        if !checked_class(vocabulary, token)
            || token.iter().any(|&c| c == b'{' as u16 || c == b'}' as u16)
        {
            continue;
        }
        if let Some(info) = find_class(vocabulary, token) {
            present.push(info);
            if let Some(message) = wrong_tag(vocabulary, info, tag, attributes) {
                findings.push(Finding {
                    start,
                    end: start + token.len(),
                    severity: Severity::Error,
                    link: info.link.clone(),
                    message,
                    fix: None,
                    rule: "class-on-wrong-tag",
                });
            }
            continue;
        }
        let meant = closest(token, &name, Some(cache));
        let t = lossy(token);
        findings.push(Finding {
            start,
            end: start + token.len(),
            severity: Severity::Warning,
            link: meant.as_ref().map_or(DOCS.to_string(), |(m, _)| {
                find_class(vocabulary, &utf16(m)).unwrap().link.clone()
            }),
            message: {
                // A taken-over component is no longer LO-TEK's.
                let place = if starts_at(token, 0, "lt-") {
                    "in LO-TEK"
                } else {
                    "in the manifest for the copy"
                };
                match &meant {
                    Some((m, _)) => {
                        format!("The class \"{t}\" does not exist {place}. Did you mean {m}?")
                    }
                    None => format!("The class \"{t}\" does not exist {place}."),
                }
            },
            fix: meant.map(|(m, sure)| {
                Fix::one(
                    format!("Change to {m}"),
                    start,
                    start + token.len(),
                    m,
                    sure,
                )
            }),
            rule: "unknown-class",
        });
    }
    for a in attributes {
        let Some(value) = a.non_empty_value() else {
            continue;
        };
        if is_templated_value(value) {
            if is_text_template(value) && !conditional {
                let flag = present.iter().find(|info| {
                    info.attributes
                        .iter()
                        .any(|(n, t)| equals(&a.name, n) && t.flag)
                });
                if let Some(info) = flag {
                    findings.push(Finding {
                        start: a.start,
                        end: a.value_end,
                        severity: Severity::Warning,
                        link: info.link.clone(),
                        message: format!(
                            "{} is a flag on {}, and the template writes the value as text: \"false\" and an empty value turn it on too. Write the whole attribute inside a condition in the template.",
                            lossy(&a.name),
                            lossy(&lowercase(&utf16(&info.title)))
                        ),
                        fix: None,
                        rule: "boolean-with-value",
                    });
                }
            }
            continue;
        }
        for info in &present {
            let Some((_, takes)) = info.attributes.iter().find(|(n, _)| equals(&a.name, n)) else {
                continue;
            };
            if takes.flag {
                // The style sheet only asks whether the flag is there, so
                // `="false"` turns it on. The same as for a boolean attribute
                // on an element.
                if lowercase(value) != a.name {
                    let name = lossy(&a.name);
                    let v = lossy(value);
                    findings.push(Finding {
                        start: a.start,
                        end: a.value_end,
                        severity: Severity::Warning,
                        link: info.link.clone(),
                        message: format!(
                            "{name} is a flag on {}: it is either there or not. {name}=\"{v}\" means the same as {name}. Remove it to turn it off.",
                            lossy(&lowercase(&utf16(&info.title)))
                        ),
                        fix: Some(Fix::one(
                            format!("Remove {name}"),
                            a.space_start,
                            a.value_end,
                            String::new(),
                            true,
                        )),
                        rule: "boolean-with-value",
                    });
                }
                break;
            }
            if takes.values.iter().any(|v| equals(value, v))
                || takes
                    .default_value
                    .as_deref()
                    .is_some_and(|d| equals(value, d))
            {
                continue;
            }
            let mut candidates: Vec<&str> = takes.values.iter().map(String::as_str).collect();
            candidates.extend(takes.default_value.as_deref());
            let meant = closest(value, &candidates, None);
            let shown = collapse_spaces(value);
            let name = lossy(&a.name);
            let end = match takes.default_value.as_deref() {
                Some(d) => format!(", and {d} without the attribute."),
                None => ".".into(),
            };
            findings.push(Finding {
                start: a.start,
                end: a.value_end,
                severity: Severity::Warning,
                link: info.link.clone(),
                message: format!(
                    "{name} cannot be \"{shown}\" on {}. Valid values: {}{end}",
                    lossy(&lowercase(&utf16(&info.title))),
                    list(takes.values.iter().map(String::as_str))
                ),
                fix: meant.map(|(m, sure)| {
                    Fix::one(
                        format!("Change to {m}"),
                        a.value_start,
                        a.value_start + value.len(),
                        m,
                        sure,
                    )
                }),
                rule: "invalid-class-value",
            });
            break;
        }
    }
    findings.extend(check_disabled_link(&present, attributes));
    findings
}

/// `class-on-wrong-tag`: what is wrong when the class is on a tag its
/// `tags` do not allow, or on one that lacks an attribute it requires. A
/// class without `tags`, from a manifest before the field, is not checked.
fn wrong_tag(
    vocabulary: &Vocabulary,
    info: &Class,
    tag: &[u16],
    attributes: &[ReadAttribute],
) -> Option<String> {
    // A component renders a tag of its own, which is not in the source.
    if info.tags.is_empty() || is_component_name(tag) {
        return None;
    }
    let tag = lowercase(tag);
    // A custom element that is not LO-TEK's can be one of its components
    // registered under another name, as defineLtToast("my-toast") does, or
    // a component in Blade or Vue. What it is, the core cannot tell.
    let own = starts_at(&tag, 0, "lt-") || vocabulary.elements.iter().any(|e| equals(&tag, &e.tag));
    if tag.contains(&(b'-' as u16)) && !own {
        return None;
    }
    // `<component :is="…">` in Vue becomes whatever tag `is` names.
    if equals(&tag, "component") && attribute(attributes, "is").is_some() {
        return None;
    }
    let same: Vec<&Tag> = info
        .tags
        .iter()
        .filter(|t| t.tag == "*" || equals(&tag, &t.tag))
        .collect();
    // How a tag is written in a message: `<input type="checkbox">`, `<a href>`.
    let written = |t: &Tag, class: bool| {
        let mut out = format!("<{}", t.tag);
        if class {
            out.push_str(&format!(" class=\"{}\"", info.name));
        }
        for (name, values) in &t.attributes {
            out.push_str(&format!(" {name}=\"{}\"", values[0]));
        }
        for name in &t.requires {
            if !class {
                out.push_str(&format!(" {name}"));
            }
        }
        out.push('>');
        out
    };
    let alternatives = || {
        let all: Vec<String> = info.tags.iter().map(|t| written(t, false)).collect();
        match all.split_last() {
            Some((last, [])) => last.clone(),
            Some((last, rest)) => format!("{} or {last}", rest.join(", ")),
            None => String::new(),
        }
    };
    let write = format!("Write {}.", written(&info.tags[0], true));
    let shown = lossy(&tag);
    if same.is_empty() {
        return Some(format!(
            "{} is on <{shown}>, and belongs on {}. {write}",
            info.name,
            alternatives()
        ));
    }
    // A value bound by a framework, or written by the template, is not known
    // here, and only the tag is judged.
    fn unlike<'a>(t: &'a Tag, attributes: &[ReadAttribute]) -> Option<&'a str> {
        t.attributes.iter().find_map(|(name, values)| {
            let has = attribute(attributes, name).is_some_and(|a| match a.value.as_deref() {
                _ if !equals(&a.name, name) => true,
                Some(v) if is_templated_value(v) => true,
                Some(v) => values.iter().any(|w| equals(&lowercase(v), w)),
                None => false,
            });
            (!has).then_some(name.as_str())
        })
    }
    fn missing<'a>(t: &'a Tag, attributes: &[ReadAttribute]) -> Option<&'a String> {
        t.requires
            .iter()
            .find(|name| attribute(attributes, name).is_none())
    }
    // A spread can give any attribute, so only the tag is judged: `{...props}`
    // in JSX and Svelte, `v-bind` in Vue, `x-bind` in Alpine, `@attributes`
    // in Razor.
    let spread = attributes.iter().any(|a| {
        a.name.first() == Some(&(b'{' as u16))
            || ["v-bind", "x-bind", "@attributes"]
                .iter()
                .any(|n| equals(&a.name, n))
    });
    if spread
        || same
            .iter()
            .any(|t| unlike(t, attributes).is_none() && missing(t, attributes).is_none())
    {
        return None;
    }
    if let Some(name) = unlike(same[0], attributes) {
        let actual = attributes
            .iter()
            .find(|a| equals(&a.name, name))
            .and_then(|a| a.value.as_deref())
            .map(|v| format!(" {name}=\"{}\"", lossy(v)))
            .unwrap_or_default();
        return Some(format!(
            "{} is on <{shown}{actual}>, and belongs on {}. {write}",
            info.name,
            alternatives()
        ));
    }
    let name = missing(same[0], attributes)?;
    Some(format!(
        "{} is on <{shown}> without {name}. Give it {name}.",
        info.name
    ))
}

/// A disabled link that still has `href`.
///
/// `aria-disabled` tells the screen reader, and the style turns off the mouse
/// with `pointer-events: none`, but Enter still follows `href`. The link must
/// be written without it, with `role="link"` and `tabindex="0"` so it is
/// still a link in the tab order. That is what `lt.link({ disabled: true })`
/// gives.
fn check_disabled_link(present: &[&Class], attributes: &[ReadAttribute]) -> Option<Finding> {
    let info = present
        .iter()
        .find(|info| info.name == "lt-link" || info.name == "lt-button")?;
    attributes.iter().find(|a| {
        equals(&a.name, "aria-disabled")
            && a.value.as_deref().is_some_and(|v| {
                let v: Utf16 = v.iter().copied().filter(|&c| !is_space(c)).collect();
                equals(&lowercase(&v), "true")
            })
    })?;
    let href = attributes.iter().find(|a| equals(&a.name, "href"))?;
    Some(Finding {
        start: href.start,
        end: href.value_end,
        severity: Severity::Warning,
        link: info.link.clone(),
        message: format!(
            "{} is disabled with aria-disabled but has href, and Enter still follows it. Remove href, and write role=\"link\" and tabindex=\"0\" so it is still a link in the tab order.",
            info.name
        ),
        fix: None,
        rule: "disabled-with-href",
    })
}

/// `value.replace(/\s+/g, " ")`
fn collapse_spaces(t: &[u16]) -> String {
    let mut out = Vec::with_capacity(t.len());
    let mut i = 0;
    while i < t.len() {
        if is_space(t[i]) {
            while i < t.len() && is_space(t[i]) {
                i += 1;
            }
            out.push(b' ' as u16);
        } else {
            out.push(t[i]);
            i += 1;
        }
    }
    lossy(&out)
}

/// An attribute by name, also when bound by a framework. `:aria-label`,
/// `x-bind:aria-label`, `data-attr:aria-label`, `[attr.aria-label]` and
/// `th:title` become the same attribute on the page, and case is ignored.
pub(crate) fn attribute<'a>(
    attributes: &'a [ReadAttribute],
    name: &str,
) -> Option<&'a ReadAttribute> {
    attributes.iter().find(|a| {
        let full = lossy(&lowercase(&a.name));
        let n = full.strip_suffix(']').unwrap_or(&full);
        n == name
            || n.strip_suffix(name)
                .is_some_and(|p| p.ends_with([':', '.', '[']))
    })
}

/// `/<([a-z][a-z0-9-]*)(?=[\s/>])/gi` at `i`: where the name ends.
pub fn tag_name_end(t: &[u16], i: usize) -> Option<usize> {
    if t.get(i) != Some(&LT) || !t.get(i + 1).is_some_and(|&c| is_ascii_letter(c)) {
        return None;
    }
    let mut j = i + 2;
    while j < t.len() && is_name_char(t[j]) {
        j += 1;
    }
    followed_by_end(t, j).then_some(j)
}

/// The body of a tag, without one trailing `/`.
fn tag_body(t: &[u16], from: usize, to: usize) -> &[u16] {
    let b = &t[from..to];
    b.strip_suffix(&[SLASH]).unwrap_or(b)
}

/// `/\bclass\s*=/i`
fn has_class_attribute(b: &[u16]) -> bool {
    (0..b.len()).any(|i| {
        starts_at_ci(b, i, "class") && (i == 0 || !is_word(b[i - 1])) && {
            let mut j = i + 5;
            while j < b.len() && is_space(b[j]) {
                j += 1;
            }
            b.get(j) == Some(&EQUALS)
        }
    })
}

/// `/<\/name\b/gi` from `from`.
fn closing_tag(t: &[u16], from: usize, name: &str) -> Option<usize> {
    (from..t.len()).find(|&i| {
        t[i] == LT
            && starts_at(t, i + 1, "/")
            && starts_at_ci(t, i + 2, name)
            && t.get(i + 2 + name.len()).is_none_or(|&c| !is_word(c))
    })
}

/// All findings in the text, in the order they appear.
pub fn diagnose(text: &[u16], vocabulary: &Vocabulary, page: bool) -> Vec<Finding> {
    diagnose_visible(without_hidden(text), vocabulary, page)
}

/// Like [`diagnose`], on text already read with [`without_hidden`].
/// `page` is true for a whole page, where the ids the components create
/// themselves are correct, and false for a template, where they have been
/// copied in from DevTools.
pub fn diagnose_visible(source: Utf16, vocabulary: &Vocabulary, page: bool) -> Vec<Finding> {
    let mut findings = Vec::new();
    let mut cache = Cache::new();

    // The classes, on every tag.
    let mut i = 0;
    while i < source.len() {
        let Some(name_end) = tag_name_end(&source, i) else {
            i += 1;
            continue;
        };
        let tag = &source[i + 1..name_end];
        i = name_end;
        let Some(end) = tag_end(&source, name_end) else {
            continue;
        };
        let b = tag_body(&source, name_end, end);
        if !has_class_attribute(b) {
            continue;
        }
        let attributes = read_attributes(b, name_end);
        findings.extend(check_classes(
            vocabulary,
            tag,
            &attributes,
            has_condition(b, name_end, &attributes),
            &mut cache,
        ));
    }

    let mut i = 0;
    while i < source.len() {
        let is_lt = source[i] == LT
            && (starts_at_ci(&source, i + 1, "lt-") || own_element_at(vocabulary, &source, i + 1));
        if !is_lt {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < source.len() && is_name_char(source[j]) {
            j += 1;
        }
        if !followed_by_end(&source, j) {
            i += 1;
            continue;
        }
        let name_start = i + 1;
        let name_end = j;
        i = j;
        let tag = lossy(&lowercase(&source[name_start..name_end]));
        let Some(element) = vocabulary.elements.iter().find(|e| e.tag == tag) else {
            findings.push(Finding {
                start: name_start,
                end: name_end,
                severity: Severity::Error,
                link: DOCS.into(),
                message: format!(
                    "<{tag}> does not exist in LO-TEK. The elements are {}.",
                    list(vocabulary.elements.iter().map(|e| e.tag.as_str()))
                ),
                fix: None,
                rule: "unknown-element",
            });
            continue;
        };
        let Some(end) = tag_end(&source, name_end) else {
            continue;
        };
        let b = tag_body(&source, name_end, end);
        let templated_tag = is_templated(b);
        let attributes = read_attributes(b, name_end);
        let conditional = has_condition(b, name_end, &attributes);
        for a in &attributes {
            // An attribute that has been removed, with a note on what to use
            // instead, from `removed` in the manifest. Before
            // `unknown-attribute`, which would otherwise suggest the closest
            // name. Also when bound, like `data-attr:invalid` in Datastar or
            // `:invalid` in Vue: that is how the old recipe wrote it.
            let removed = element
                .removed
                .iter()
                .find(|(n, _)| attribute(std::slice::from_ref(a), n).is_some());
            if let Some((name, note)) = removed {
                let written = lossy(&a.name);
                findings.push(Finding {
                    start: a.start,
                    end: a.end,
                    severity: Severity::Warning,
                    link: element.link.clone(),
                    message: format!(
                        "{name} has been removed from <{tag}>. {}",
                        note.replace('`', "")
                    ),
                    fix: Some(Fix::one(
                        format!("Remove {written}"),
                        a.space_start,
                        a.value_end,
                        String::new(),
                        true,
                    )),
                    rule: "removed-attribute",
                });
                continue;
            }
            findings.extend(check_attribute(
                &tag,
                element,
                a,
                templated_tag,
                conditional,
            ));
        }

        if tag == "lt-session-timeout" {
            if let Some(close) = closing_tag(&source, end, "lt-session-timeout") {
                findings.extend(check_session_timeout(
                    &tag,
                    name_start,
                    name_end,
                    &source[end + 1..close.max(end + 1)],
                    &element.link,
                ));
            }
        }

        if tag == "lt-field" {
            let close = closing_tag(&source, end, "lt-field").unwrap_or(source.len());
            let content = &source[(end + 1).min(close.max(end + 1))..close.max(end + 1)];
            findings.extend(check_field(
                &tag,
                name_start,
                name_end,
                content,
                &element.link,
            ));
        }
    }
    // The tree is built once and shared by the rules that need it. Only when
    // there is something from LO-TEK in the text, or a button or a link,
    // which need a name with or without LO-TEK: on a page with thousands of
    // tags and none of them, the tree cost more than the rest of the check.
    let ours = contains_str(&source, "lt-")
        || vocabulary
            .elements
            .iter()
            .any(|e| contains_str(&source, &e.tag));
    // `has_tag` and `contains_ci` ignore case: `<LT-FIELD>` is the element too.
    if ours || contains_ci(&source, "lt-") || has_tag(&source, "button") || has_tag(&source, "a") {
        let nodes = crate::references::tree(&source);
        if ours {
            findings.extend(crate::parts::check_parts(&source, vocabulary, &nodes));
            findings.extend(crate::wiring::check_wiring(
                &source, vocabulary, &nodes, page,
            ));
            findings.extend(crate::texts::check_texts(&nodes, vocabulary));
        }
        findings.extend(crate::names::check_names(&source, vocabulary, &nodes, page));
    }
    findings.sort_by_key(|f| f.start);
    findings
}

/// What the style sheets do not style: a class none of them mentions, and a
/// value no selector has a rule for.
///
/// The first is a style sheet that is not loaded, or loaded after a rewrite.
/// The second is usually a variant added to the manifest for a taken-over
/// component without the CSS getting it: the markup is valid, but looks like
/// the default.
pub fn check_styles(text: &[u16], vocabulary: &Vocabulary, styles: &Styles) -> Vec<Finding> {
    check_styles_visible(&without_hidden(text), vocabulary, styles)
}

/// Like [`check_styles`], on text already read with [`without_hidden`].
pub fn check_styles_visible(
    source: &[u16],
    vocabulary: &Vocabulary,
    styles: &Styles,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    let mut i = 0;
    while i < source.len() {
        let Some(name_end) = tag_name_end(source, i) else {
            i += 1;
            continue;
        };
        i = name_end;
        let Some(end) = tag_end(source, name_end) else {
            continue;
        };
        let b = tag_body(source, name_end, end);
        if !has_class_attribute(b) {
            continue;
        }
        let attributes = read_attributes(b, name_end);
        let Some(class_attribute) = attributes.iter().find(|a| equals(&a.name, "class")) else {
            continue;
        };
        let Some(value) = class_attribute.non_empty_value() else {
            continue;
        };
        if is_templated_value(value) {
            continue;
        }
        let tokens: Vec<String> = words(value).into_iter().map(|(_, t)| lossy(t)).collect();
        let mut styled: Vec<&Class> = Vec::new();
        for (offset, token) in words(value) {
            if !checked_class(vocabulary, token) {
                continue;
            }
            let Some(info) = find_class(vocabulary, token) else {
                continue;
            };
            let name = lossy(token);
            if styles.classes.contains(&name) {
                styled.push(info);
                continue;
            }
            let start = class_attribute.value_start + offset;
            findings.push(Finding {
                start,
                end: start + token.len(),
                severity: Severity::Warning,
                link: info.link.clone(),
                message: format!(
                    "The class \"{name}\" is in the markup, but none of the style sheets styles it. Is lotek.css, or the style sheet for {}, loaded?",
                    lossy(&lowercase(&utf16(&info.title)))
                ),
                fix: None,
                rule: "unstyled-class",
            });
        }
        for a in &attributes {
            let value = a.non_empty_value();
            if value.is_some_and(|v| is_templated_value(v)) {
                continue;
            }
            for info in &styled {
                let Some((attribute, takes)) =
                    info.attributes.iter().find(|(n, _)| equals(&a.name, n))
                else {
                    continue;
                };
                let wanted = if takes.flag {
                    None
                } else {
                    let Some(value) = value else { break };
                    let known = takes.values.iter().any(|v| equals(value, v));
                    let default = takes
                        .default_value
                        .as_deref()
                        .is_some_and(|d| equals(value, d));
                    // An unknown value is reported by the vocabulary check,
                    // and the default value needs no rule.
                    if !known || default {
                        break;
                    }
                    Some(lossy(value))
                };
                // The value can be styled on another class on the same
                // element, like the state on lt-search, which is styled on
                // lt-input.
                if tokens
                    .iter()
                    .any(|t| styles.styles_value(t, attribute, wanted.as_deref()))
                {
                    break;
                }
                let shown = match &wanted {
                    Some(v) => format!("{attribute}=\"{v}\""),
                    None => attribute.clone(),
                };
                findings.push(Finding {
                    start: a.start,
                    end: a.value_end,
                    severity: Severity::Warning,
                    link: info.link.clone(),
                    message: format!(
                        "{shown} on {} has no rule in the style sheets, so it does nothing visible. Style the value, or remove it.",
                        lossy(&lowercase(&utf16(&info.title)))
                    ),
                    fix: None,
                    rule: "unstyled-value",
                });
                break;
            }
        }
    }
    if contains_str(source, "lt-") {
        let nodes = crate::references::tree(source);
        findings.extend(crate::texts::check_css_texts(&nodes, vocabulary, styles));
    }
    findings
}
