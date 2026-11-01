//! LO-TEK's diagnostics, one implementation for every host language.
//!
//! The core compiles to a WebAssembly module without imports. The same file
//! runs in Node, Bun and the browser, on the JVM through Chicory, and in
//! every other language that has a WebAssembly runtime.
//!
//! The interface is the smallest one every runtime understands, without
//! binding tools:
//!
//! 1. `alloc(length)` gives a pointer to a region of the module's memory.
//! 2. The host writes the HTML there as UTF-8.
//! 3. `diagnose_markup_raw(ptr, length)` or `diagnose_page_raw(…)` runs the
//!    check, frees the input and puts the response in the module's memory.
//! 4. `result_ptr()` and `result_len()` say where the response is: the
//!    findings as JSON, in UTF-8, with the same fields as `Finding` in
//!    TypeScript, plus `rule`, `line` and `column`.
//!
//! The core carries no data. The host gives it the vocabulary with
//! `load_manifest_raw(ptr, length)` and the colour contract with
//! `load_contract_raw(ptr, length)`, from the package it has. Every call that
//! reads, checks or builds answers 0, or 1 with `{"error": …}`, also when the
//! data is missing. `version_raw()` gives the core's version, the manifest's
//! or `null`, and the manifest format the core understands.
//!
//! The positions in the findings are UTF-16 indices, as in JavaScript and
//! Kotlin. `line` and `column` start at 1, and the column is counted in
//! UTF-16 units.

pub mod accessibility;
pub mod diagnose;
pub mod json;
pub mod manifest;
pub mod names;
pub mod parts;
pub mod references;
pub mod styles;
pub mod suppress;
pub mod text;
pub mod texts;
pub mod theme;
pub mod types;
pub mod wiring;

/// A file in the package, for the tests: from `interfaces/` next to this
/// directory. The build never reads it.
#[cfg(test)]
pub(crate) fn package_file(path: &str) -> String {
    std::fs::read_to_string(
        concat!(env!("CARGO_MANIFEST_DIR"), "/../interfaces/").to_owned() + path,
    )
    .unwrap_or_else(|e| panic!("the tests need {path} in the package: {e}"))
}

use std::cell::RefCell;

use text::{utf16, Utf16};
use types::{Finding, Severity, Vocabulary};

/// What `diagnoseMarkup` finds: the vocabulary, for a template or a fragment.
pub fn diagnose_markup(html: &[u16], vocabulary: &Vocabulary) -> Vec<Finding> {
    suppress::apply(html, diagnose::diagnose(html, vocabulary, false))
}

/// What `diagnosePage` finds: the vocabulary and the wiring on a whole page.
pub fn diagnose_page(html: &[u16], vocabulary: &Vocabulary) -> Vec<Finding> {
    let page: Utf16 = references::page_source(html);
    let mut findings = diagnose::diagnose(&page, vocabulary, true);
    findings.extend(references::check_references(&page));
    findings.sort_by_key(|f| f.start);
    suppress::apply(&references::page_source_with_comments(html), findings)
}

/// The check with the style sheets as well: what `diagnose_markup`, or
/// `diagnose_page` when `page` is true, finds, plus what the style sheets do
/// not style.
///
/// A whole page is read the way `diagnose_page` reads it: what is inside a
/// `<template>`, a `<textarea>` or an attribute value is not shown, and is
/// not checked against the style sheets either. The page is read once for
/// both.
pub fn diagnose_styled(
    html: &[u16],
    vocabulary: &Vocabulary,
    styles: &styles::Styles,
    page: bool,
) -> Vec<Finding> {
    let source: Utf16 = if page {
        references::page_source(html)
    } else {
        html.to_vec()
    };
    let visible = diagnose::without_hidden(&source);
    let mut findings = diagnose::check_styles_visible(&visible, vocabulary, styles);
    findings.extend(diagnose::diagnose_visible(visible, vocabulary, page));
    if page {
        findings.extend(references::check_references(&source));
    }
    findings.sort_by_key(|f| f.start);
    if page {
        suppress::apply(&references::page_source_with_comments(html), findings)
    } else {
        suppress::apply(html, findings)
    }
}

/// Where each line starts, so the line and column of a finding are a lookup.
///
/// When every finding counted the line breaks from the start of the text,
/// the time grew with the square of the page length: 6000 findings on a
/// page with 3000 lines took a quarter of a second.
///
/// A line break is `\n`, `\r\n` or `\r` alone, as LSP requires. With only
/// `\n`, a document with `\r` line breaks became one long line, and a client
/// that sends the buffer as it is got the findings in the wrong place.
pub struct Lines {
    starts: Vec<usize>,
}

impl Lines {
    pub fn new(text: &[u16]) -> Self {
        const CR: u16 = b'\r' as u16;
        const LF: u16 = b'\n' as u16;
        let mut starts = vec![0];
        starts.extend(
            text.iter()
                .enumerate()
                // `\r` before `\n` is the same line break, and the line
                // starts after `\n`.
                .filter(|&(i, &c)| c == LF || (c == CR && text.get(i + 1) != Some(&LF)))
                .map(|(i, _)| i + 1),
        );
        Lines { starts }
    }

    /// Line and column for a UTF-16 position, both from 1.
    pub fn line_and_column(&self, at: usize) -> (usize, usize) {
        // The line is the last one that starts at or before `at`.
        let line = self.starts.partition_point(|&start| start <= at);
        (line, at - self.starts[line - 1] + 1)
    }
}

/// Line and column for one UTF-16 position, both from 1.
pub fn line_and_column(text: &[u16], at: usize) -> (usize, usize) {
    // The text is taken one character past `at`: a `\r` right before must
    // not count as a line break when it comes before `\n`.
    Lines::new(&text[..(at + 1).min(text.len())]).line_and_column(at)
}

/// The findings as JSON, in the same shape as `JSON.stringify` of
/// `Finding[]`, plus rule name, line and column.
pub fn to_json(findings: &[Finding], text: &[u16]) -> String {
    let lines = Lines::new(text);
    let mut out = String::from("[");
    for (i, f) in findings.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let (line, column) = lines.line_and_column(f.start);
        out.push_str(&format!(
            "{{\"start\":{},\"end\":{},\"line\":{line},\"column\":{column},\"severity\":{},\"rule\":{},\"link\":{},\"message\":{}",
            f.start,
            f.end,
            json_string(match f.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            }),
            json_string(f.rule),
            json_string(&f.link),
            json_string(&f.message),
        ));
        if let Some(r) = &f.fix {
            let edits: Vec<String> = r
                .edits
                .iter()
                .map(|e| {
                    format!(
                        "{{\"start\":{},\"end\":{},\"text\":{}}}",
                        e.start,
                        e.end,
                        json_string(&e.text)
                    )
                })
                .collect();
            out.push_str(&format!(
                ",\"fix\":{{\"title\":{},\"edits\":[{}],\"preferred\":{}}}",
                json_string(&r.title),
                edits.join(","),
                r.preferred
            ));
        }
        out.push('}');
    }
    out.push(']');
    out
}

pub(crate) fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

thread_local! {
    static RESPONSE: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn respond(json: String) {
    RESPONSE.with(|s| *s.borrow_mut() = json.into_bytes());
}

/// A region of `length` bytes in the module's memory, which the host writes the HTML to.
#[no_mangle]
pub extern "C" fn alloc(length: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(length.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Frees a region from `alloc`.
///
/// # Safety
/// `ptr` and `length` must come from one and the same call to `alloc`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, length: usize) {
    drop(Vec::from_raw_parts(ptr, 0, length.max(1)));
}

/// Reads the input, which `alloc` gave and the host filled, and frees it.
unsafe fn read_input(ptr: *mut u8, length: usize) -> String {
    let bytes = Vec::from_raw_parts(ptr, length, length.max(1));
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Responds with an error, and returns 1. Without data the core must say
/// why, not answer with an empty list that looks like a page without findings.
fn refuse(error: &str) -> u32 {
    respond(format!("{{\"error\":{}}}", json_string(error)));
    1
}

const NO_MANIFEST: &str =
    "The core has not been given a manifest. Give it manifest.json from the package with load_manifest_raw first.";
const NO_CONTRACT: &str = theme::contract::NOT_LOADED;

/// # Safety
/// `ptr` and `length` must come from `alloc(length)`, filled with UTF-8.
#[no_mangle]
pub unsafe extern "C" fn diagnose_markup_raw(ptr: *mut u8, length: usize) -> u32 {
    let html = utf16(&read_input(ptr, length));
    let Some(vocabulary) = manifest::current() else {
        return refuse(NO_MANIFEST);
    };
    respond(to_json(&diagnose_markup(&html, &vocabulary), &html));
    0
}

/// # Safety
/// `ptr` and `length` must come from `alloc(length)`, filled with UTF-8.
#[no_mangle]
pub unsafe extern "C" fn diagnose_page_raw(ptr: *mut u8, length: usize) -> u32 {
    let html = utf16(&read_input(ptr, length));
    let Some(vocabulary) = manifest::current() else {
        return refuse(NO_MANIFEST);
    };
    respond(to_json(&diagnose_page(&html, &vocabulary), &html));
    0
}

/// The accessibility tree of a page the host has rendered: see
/// [`accessibility::accessibility_tree`] for the facts the host must write
/// on each element. Refuses, with the reason, when they are missing.
///
/// # Safety
/// `ptr` and `length` must come from `alloc(length)`, filled with UTF-8.
#[no_mangle]
pub unsafe extern "C" fn accessibility_tree_raw(ptr: *mut u8, length: usize) -> u32 {
    let html = utf16(&read_input(ptr, length));
    match accessibility::accessibility_tree(&html) {
        Ok(nodes) => {
            respond(accessibility::to_json(&nodes));
            0
        }
        Err(error) => refuse(&error),
    }
}

/// The facts the host must write on each element before it asks for the
/// accessibility tree, as a JSON list.
#[no_mangle]
pub extern "C" fn accessibility_facts_raw() {
    respond(accessibility::names_json(accessibility::FACTS));
}

/// The states the accessibility tree can give, as a JSON list.
#[no_mangle]
pub extern "C" fn accessibility_states_raw() {
    respond(accessibility::names_json(accessibility::STATES));
}

/// The WAI-ARIA roles the accessibility tree knows, as a JSON list.
#[no_mangle]
pub extern "C" fn accessibility_roles_raw() {
    respond(accessibility::names_json(&accessibility::roles()));
}

/// Gives the core the vocabulary: the manifest the host has written in.
///
/// # Safety
/// `ptr` and `length` must come from `alloc(length)`, filled with UTF-8.
#[no_mangle]
pub unsafe extern "C" fn load_manifest_raw(ptr: *mut u8, length: usize) -> u32 {
    match manifest::from_json(&read_input(ptr, length)) {
        Ok(vocabulary) => {
            manifest::set_current(vocabulary);
            respond("{\"ok\":true}".into());
            0
        }
        Err(error) => refuse(&error),
    }
}

/// Gives the core the colour contract the host has written in.
///
/// # Safety
/// `ptr` and `length` must come from `alloc(length)`, filled with UTF-8.
#[no_mangle]
pub unsafe extern "C" fn load_contract_raw(ptr: *mut u8, length: usize) -> u32 {
    match theme::contract::load(&read_input(ptr, length)) {
        Ok(()) => {
            respond("{\"ok\":true}".into());
            0
        }
        Err(error) => refuse(&error),
    }
}

fn json_object(entries: &[(String, String)]) -> String {
    let fields: Vec<String> = entries
        .iter()
        .map(|(k, v)| format!("{}:{}", json_string(k), json_string(v)))
        .collect();
    format!("{{{}}}", fields.join(","))
}

/// Builds a theme from the recipe the host has written in, as JSON: the same
/// fields as `ThemeInput` in TypeScript. Answers 0 with the theme, or 1 with
/// `{"error": …}`, like `load_manifest_raw`.
///
/// # Safety
/// `ptr` and `length` must come from `alloc(length)`, filled with UTF-8.
#[no_mangle]
pub unsafe extern "C" fn build_theme_raw(ptr: *mut u8, length: usize) -> u32 {
    if !theme::contract::loaded() {
        return refuse(NO_CONTRACT);
    }
    let built = json::parse(&read_input(ptr, length)).and_then(|input| theme::build_theme(&input));
    match built {
        Ok(t) => {
            let violations: Vec<String> = t
                .violations
                .iter()
                .map(|v| {
                    format!(
                        "{{\"family\":{},\"promise\":{},\"ratio\":{},\"required\":{}}}",
                        json_string(&v.family),
                        json_string(&v.promise),
                        theme::js_number(v.ratio),
                        theme::js_number(v.required)
                    )
                })
                .collect();
            respond(format!(
                "{{\"light\":{},\"dark\":{},\"violations\":[{}],\"css\":{}}}",
                json_object(&t.light),
                json_object(&t.dark),
                violations.join(","),
                json_string(&t.css)
            ));
            0
        }
        Err(error) => refuse(&error),
    }
}

/// Checks a theme the host has written in, as CSS text. Returns 0 with the
/// report, or 1 when the core has not been given a colour contract.
///
/// # Safety
/// `ptr` and `length` must come from `alloc(length)`, filled with UTF-8.
#[no_mangle]
pub unsafe extern "C" fn inspect_theme_raw(ptr: *mut u8, length: usize) -> u32 {
    if !theme::contract::loaded() {
        return refuse(NO_CONTRACT);
    }
    let report = theme::check::inspect_theme(&read_input(ptr, length));
    let problems: Vec<String> = report
        .problems
        .iter()
        .map(|p| {
            format!(
                "{{\"selector\":{},\"message\":{}}}",
                json_string(&p.selector),
                json_string(&p.message)
            )
        })
        .collect();
    respond(format!(
        "{{\"problems\":[{}],\"blocks\":{},\"declarations\":{},\"promises\":{}}}",
        problems.join(","),
        report.blocks,
        report.declarations,
        report.promises
    ));
    0
}

/// What a style sheet styles: the classes, the attribute values and the
/// `@import` addresses.
///
/// # Safety
/// `ptr` and `length` must come from `alloc(length)`, filled with UTF-8.
#[no_mangle]
pub unsafe extern "C" fn inspect_styles_raw(ptr: *mut u8, length: usize) {
    respond(styles_json(&styles::read_styles(&read_input(ptr, length))));
}

/// The check with the style sheets: `{"html": "…", "css": ["…"], "page": true}`
/// in, the findings out, like `diagnose_page_raw`. Returns 0, or 1 with
/// `{"error": "…"}` when the input does not have that shape. An empty answer
/// must mean no findings, not that nothing was checked.
///
/// # Safety
/// `ptr` and `length` must come from `alloc(length)`, filled with UTF-8.
#[no_mangle]
pub unsafe extern "C" fn diagnose_styled_raw(ptr: *mut u8, length: usize) -> u32 {
    match styled_input(&read_input(ptr, length)) {
        Ok((html, styles, page)) => {
            let Some(vocabulary) = manifest::current() else {
                return refuse(NO_MANIFEST);
            };
            respond(to_json(
                &diagnose_styled(&html, &vocabulary, &styles, page),
                &html,
            ));
            0
        }
        Err(error) => refuse(&error),
    }
}

/// Reads the input to `diagnose_styled_raw`.
fn styled_input(text: &str) -> Result<(Utf16, styles::Styles, bool), String> {
    let input = json::parse(text)?;
    let html = input
        .get("html")
        .and_then(json::Json::as_str)
        .ok_or("The input is missing \"html\" as text.")?;
    let sheets = input
        .get("css")
        .and_then(json::Json::as_array)
        .ok_or("The input is missing \"css\" as an array of style sheets.")?;
    let mut styles = styles::Styles::default();
    for (i, css) in sheets.iter().enumerate() {
        let css = css
            .as_str()
            .ok_or_else(|| format!("css[{i}] must be the text of a style sheet."))?;
        styles.extend(styles::read_styles(css));
    }
    let page = match input.get("page") {
        None | Some(json::Json::Bool(false)) => false,
        Some(json::Json::Bool(true)) => true,
        Some(_) => return Err("\"page\" must be true or false.".into()),
    };
    Ok((utf16(html), styles, page))
}

/// What the style sheets style, as JSON.
pub fn styles_json(styles: &styles::Styles) -> String {
    let classes: Vec<String> = styles.classes.iter().map(|c| json_string(c)).collect();
    let attributes: Vec<String> = styles
        .attributes
        .iter()
        .map(|(class, attribute, value)| match value {
            Some(v) => format!(
                "{{\"class\":{},\"attribute\":{},\"value\":{}}}",
                json_string(class),
                json_string(attribute),
                json_string(v)
            ),
            None => format!(
                "{{\"class\":{},\"attribute\":{}}}",
                json_string(class),
                json_string(attribute)
            ),
        })
        .collect();
    let imports: Vec<String> = styles.imports.iter().map(|i| json_string(i)).collect();
    format!(
        "{{\"classes\":[{}],\"attributes\":[{}],\"imports\":[{}]}}",
        classes.join(","),
        attributes.join(","),
        imports.join(",")
    )
}

/// Puts the versions in the response, as JSON. The manifest's is `null` when
/// the host has not given a manifest.
#[no_mangle]
pub extern "C" fn version_raw() {
    let manifest_version = manifest::current()
        .map(|v| json_string(&v.version))
        .unwrap_or_else(|| "null".into());
    respond(format!(
        "{{\"core\":{},\"manifest\":{manifest_version},\"schemaVersion\":{}}}",
        json_string(env!("CARGO_PKG_VERSION")),
        manifest::SCHEMA_VERSION
    ));
}

/// Where the response from the last call is.
#[no_mangle]
pub extern "C" fn result_ptr() -> *const u8 {
    RESPONSE.with(|s| s.borrow().as_ptr())
}

/// How long the response from the last call is, in bytes.
#[no_mangle]
pub extern "C" fn result_len() -> usize {
    RESPONSE.with(|s| s.borrow().len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(html: &str) -> Vec<Finding> {
        diagnose_page(&utf16(html), &manifest::for_tests())
    }

    #[test]
    fn gives_line_and_column_from_one() {
        let text = utf16("ab\nø🧾x");
        assert_eq!(line_and_column(&text, 0), (1, 1));
        assert_eq!(line_and_column(&text, 3), (2, 1));
        // "🧾" is two UTF-16 units.
        assert_eq!(line_and_column(&text, 6), (2, 4));
    }

    #[test]
    fn a_flag_on_a_class_takes_no_value() {
        let markup = |html: &str| diagnose_markup(&utf16(html), &manifest::for_tests());
        assert!(markup(r#"<label class="lt-label" data-optional>Navn</label>"#).is_empty());
        assert!(markup(r#"<label class="lt-label" data-optional="">Navn</label>"#).is_empty());
        let found = markup(r#"<label class="lt-label" data-optional="false">Navn</label>"#);
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].rule, "boolean-with-value");
        assert!(
            found[0].message.contains("flag on label"),
            "{}",
            found[0].message
        );
        let fix = found[0].fix.as_ref().unwrap();
        assert_eq!(fix.edits[0].text, "");
    }

    #[test]
    fn skips_comments_in_template_languages() {
        let markup = |html: &str| diagnose_markup(&utf16(html), &manifest::for_tests());
        for comment in [
            "{{-- <lt-feil> --}}",
            "{{/* <lt-feil> */}}",
            "{# <lt-feil> #}",
            "{#- <lt-feil> -#}",
            "@* <lt-feil> *@",
            "<%-- <lt-feil> --%>",
        ] {
            assert!(markup(comment).is_empty(), "{comment}");
        }
        // `{#if}` in Svelte is a block, not a comment, and an unclosed
        // comment does not blank the rest.
        assert_eq!(markup("{#if x}<lt-feil></lt-feil>{/if}").len(), 1);
        assert_eq!(markup("{{-- <lt-feil>").len(), 1);
    }

    #[test]
    fn checks_the_color_of_a_dialog() {
        let markup = |html: &str| diagnose_markup(&utf16(html), &manifest::for_tests());
        assert!(markup(
            r#"<dialog class="lt-dialog" data-color="danger" aria-label="Delete"></dialog>"#
        )
        .is_empty());
        let found =
            markup(r#"<dialog class="lt-dialog" data-color="red" aria-label="Delete"></dialog>"#);
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].rule, "invalid-class-value");
    }

    #[test]
    fn looks_up_lines_like_counting_them() {
        let text = utf16("\n\nab\n\ncd\n");
        let lines = Lines::new(&text);
        for at in 0..=text.len() {
            let before = &text[..at];
            let line = 1 + before.iter().filter(|&&c| c == b'\n' as u16).count();
            let column = match before.iter().rposition(|&c| c == b'\n' as u16) {
                Some(newline) => at - newline,
                None => at + 1,
            };
            assert_eq!(lines.line_and_column(at), (line, column), "at {at}");
        }
    }

    #[test]
    fn counts_every_line_break_lsp_knows() {
        // `\r\n` is one line break, and `\r` alone is one.
        let text = utf16("a\r\nb\rc\nd\r\re");
        let lines = Lines::new(&text);
        let expected = [
            (1, 1),
            (1, 2),
            (1, 3),
            (2, 1),
            (2, 2),
            (3, 1),
            (3, 2),
            (4, 1),
            (4, 2),
            (5, 1),
            (6, 1),
        ];
        for (at, want) in expected.iter().enumerate() {
            assert_eq!(lines.line_and_column(at), *want, "at {at}");
            assert_eq!(line_and_column(&text, at), *want, "at {at}, alone");
        }
        let found = check("<div>\r<div>\r<span class=\"lt-buton\">x</span></div></div>");
        let (line, column) = line_and_column(
            &utf16("<div>\r<div>\r<span class=\"lt-buton\">x</span></div></div>"),
            found[0].start,
        );
        assert_eq!((line, column), (3, 14));
    }

    #[test]
    fn a_missing_id_gives_a_message_without_trailing_space() {
        for (attribute, ends) in [
            ("for", "lt.field({ id }) does it."),
            ("aria-describedby", "lt.field({ id }) does it."),
            ("aria-labelledby", "lt.field({ id }) does it."),
            ("aria-controls", "the wiring to what the element controls."),
        ] {
            let html = format!(r#"<label class="lt-label" {attribute}="borte">x</label>"#);
            let findings = check(&html);
            let found = findings
                .iter()
                .find(|f| f.rule == "id-not-found")
                .unwrap_or_else(|| panic!("{attribute}: {findings:?}"));
            assert!(
                found.message.ends_with(ends),
                "{attribute}: \"{}\"",
                found.message
            );
        }
    }

    #[test]
    fn names_the_rule() {
        let findings = check(r#"<button class="lt-buton">Send</button>"#);
        assert_eq!(findings[0].rule, "unknown-class");
        assert!(findings.iter().all(|f| types::RULES.contains(&f.rule)));
    }

    #[test]
    fn a_comment_that_is_text_suppresses_nothing_on_a_page() {
        let found = |html: &str| diagnose_page(&utf16(html), &manifest::for_tests());
        // The comment is inside a textarea and is text, so the finding on
        // the field after it stays.
        let in_textarea =
            found(r#"<textarea><!-- lotek-ignore-next --></textarea><input class="lt-inptu">"#);
        let rules: Vec<&str> = in_textarea.iter().map(|f| f.rule).collect();
        assert_eq!(rules, ["without-name", "unknown-class"], "{rules:?}");
        // A real comment suppresses as before.
        assert!(found(r#"<!-- lotek-ignore-next --><input class="lt-inptu">"#).is_empty());
    }

    #[test]
    fn checks_against_another_manifest() {
        let html = utf16("<lt-kart sone=\"oslo\"></lt-kart>");
        assert_eq!(
            diagnose_markup(&html, &manifest::for_tests())[0].rule,
            "unknown-element"
        );
        let mut vocabulary = (*manifest::for_tests()).clone();
        vocabulary.elements.push(types::Element {
            tag: "lt-kart".into(),
            link: String::new(),
            attributes: vec![("sone".into(), types::Attribute::Text)],
            parts: Vec::new(),
            removed: Vec::new(),
            named: None,
            texts: Vec::new(),
        });
        assert!(diagnose_markup(&html, &vocabulary).is_empty());
    }

    #[test]
    fn checks_a_taken_over_component_and_nothing_else() {
        let vocabulary = manifest::with_fragments(&manifest::test_text(), &[r#"{
            "schemaVersion": 1, "version": "0",
            "elements": {"app-dialog": {"link": "", "attributes": {"open": {"type": "flag"}}}},
            "classes": {
                "app-button": {"title": "Button", "link": "", "attributes": {"data-variant": {"values": ["primary"]}}},
                "app-button__icon": {"title": "Button", "link": "", "attributes": {}}
            }
        }"#])
        .unwrap();
        let found = |html: &str| diagnose_markup(&utf16(html), &vocabulary);
        assert!(
            found(r#"<button class="app-button app-button__icon app-header">x</button>"#)
                .is_empty()
        );
        let wrong = found(r#"<button class="app-button__ikon">x</button>"#);
        assert_eq!(wrong[0].rule, "unknown-class");
        assert_eq!(
            wrong[0].fix.as_ref().unwrap().edits[0].text,
            "app-button__icon"
        );
        assert_eq!(
            found(r#"<button class="app-button" data-variant="secondary">x</button>"#).len(),
            1
        );
        assert_eq!(found(r#"<app-dialog lukket></app-dialog>"#).len(), 1);
        assert!(found(r#"<app-dialog open></app-dialog><app-dialogs></app-dialogs>"#).is_empty());
    }

    #[test]
    fn says_what_the_style_sheets_do_not_style() {
        let styles = styles::read_styles(
            r#".lt-button { } .lt-button[data-variant="ghost"] { }
            .lt-input[data-state="invalid"] { } .lt-search { }
            .lt-label[data-optional] { }"#,
        );
        let found =
            |html: &str| diagnose_styled(&utf16(html), &manifest::for_tests(), &styles, false);
        assert!(found(r#"<button class="lt-button" data-variant="ghost">x</button>"#).is_empty());
        // The default value needs no rule.
        assert!(found(r#"<button class="lt-button" data-variant="primary">x</button>"#).is_empty());

        let unstyled = found(r#"<button class="lt-button" data-variant="danger">x</button>"#);
        assert_eq!(unstyled.len(), 1);
        assert_eq!(unstyled[0].rule, "unstyled-value");

        let missing = found(r#"<div class="lt-card">x</div>"#);
        assert_eq!(missing[0].rule, "unstyled-class");
        assert!(missing[0].message.contains("lt-card"));

        // The state on lt-search is styled on lt-input, on the same element.
        assert!(found(
            r#"<input class="lt-search lt-input" data-state="invalid" aria-label="Search">"#
        )
        .is_empty());
        // A flag is styled by a selector that asks whether it is present.
        assert!(found(r#"<label class="lt-label" data-optional>x</label>"#).is_empty());
        // Classes outside LO-TEK are not the check's business.
        assert!(found(r#"<div class="kort">x</div>"#).is_empty());
        // Markup that is not shown on a whole page is not checked against the style sheets.
        let page =
            |html: &str| diagnose_styled(&utf16(html), &manifest::for_tests(), &styles, true);
        assert!(page(r#"<template><div class="lt-card"></div></template><textarea><div class="lt-card"></div></textarea><button data-x='<div class="lt-card">'>x</button>"#)
            .iter()
            .all(|f| !f.rule.starts_with("unstyled")));
        assert_eq!(
            page(r#"<div class="lt-card"></div>"#)[0].rule,
            "unstyled-class"
        );
        // And a comment suppresses, as for the other rules.
        assert!(
            found("<!-- lotek-ignore-next unstyled-class -->\n<div class=\"lt-card\">x</div>")
                .is_empty()
        );
    }

    #[test]
    fn styled_input_says_what_is_wrong() {
        assert!(styled_input(r#"{"html": "<b></b>", "css": [".lt-x {}"], "page": true}"#).is_ok());
        assert!(styled_input(r#"{"html": "<b></b>", "css": []}"#).is_ok());
        for wrong in [
            "not json",
            r#"{"css": []}"#,
            r#"{"html": "x"}"#,
            r#"{"html": "x", "css": [42]}"#,
            r#"{"html": "x", "css": [], "page": "ja"}"#,
        ] {
            assert!(styled_input(wrong).is_err(), "{wrong}");
        }
    }

    #[test]
    fn a_text_template_in_a_flag_is_always_on() {
        let markup = |html: &str| diagnose_markup(&utf16(html), &manifest::for_tests());
        for value in [
            "{{ .Optional }}",
            "{% if optional %}data-optional{% endif %}",
            "<?= $optional ?>",
            "<%= optional %>",
        ] {
            let found = markup(&format!(
                r#"<label class="lt-label" data-optional="{value}">Navn</label>"#
            ));
            assert_eq!(found.len(), 1, "{value}: {found:?}");
            assert_eq!(found[0].rule, "boolean-with-value");
            assert!(
                found[0].message.contains("flag on label"),
                "{}",
                found[0].message
            );

            let found = markup(&format!(r#"<lt-popover open="{value}"></lt-popover>"#));
            assert_eq!(found.len(), 1, "{value}: {found:?}");
            assert_eq!(found[0].rule, "boolean-with-value");
        }
    }

    #[test]
    fn a_template_that_drops_a_false_flag_is_left_alone() {
        // Astro, Svelte, JSX, Razor and JTE remove the attribute themselves.
        let markup = |html: &str| diagnose_markup(&utf16(html), &manifest::for_tests());
        for value in [
            "{optional}",
            "@optional",
            "${optional}",
            "@(Model.Optional)",
        ] {
            let html = format!(
                r#"<label class="lt-label" data-optional="{value}">Navn</label><lt-popover open="{value}"></lt-popover>"#
            );
            assert!(markup(&html).is_empty(), "{value}: {:?}", markup(&html));
        }
        // When the attribute is already inside a condition, the template in the value is harmless.
        for html in [
            r#"<lt-popover {{ if .Open }} open="{{ .Open }}" {{ end }}></lt-popover>"#,
            r#"<label class="lt-label" {% if optional %} data-optional="{{ optional }}" {% endif %}>Navn</label>"#,
        ] {
            assert!(markup(html).is_empty(), "{html}: {:?}", markup(html));
        }
        // A template in a value that is not a flag is no error.
        assert!(
            markup(r#"<label class="lt-label" data-required="{{ .Required }}">Navn</label>"#)
                .is_empty()
        );
    }

    #[test]
    fn bootstrap_font_sizes_are_not_ours() {
        for n in 1..=6 {
            let found = check(&format!(r#"<p class="lt-{n}">Tekst</p>"#));
            assert!(found.is_empty(), "lt-{n}: {found:?}");
        }
        // A number with something after it is still a typo for us.
        assert_eq!(check(r#"<p class="lt-1x">Tekst</p>"#).len(), 1);
    }

    #[test]
    fn knows_the_newer_global_attributes() {
        let found = check(
            r#"<lt-popover writingsuggestions="false" autocorrect="off" headingoffset="1"></lt-popover>"#,
        );
        assert!(found.is_empty(), "{found:?}");
    }

    #[test]
    fn a_disabled_link_with_href_can_still_be_followed() {
        for html in [
            r#"<a class="lt-link" aria-disabled="true" href="/small-print">Read the small print</a>"#,
            r#"<a class="lt-button" href="/next" aria-disabled=" TRUE ">Next</a>"#,
        ] {
            let found = check(html);
            assert_eq!(found.len(), 1, "{html}: {found:?}");
            assert_eq!(found[0].rule, "disabled-with-href");
        }
        for html in [
            r#"<a class="lt-link" role="link" tabindex="0" aria-disabled="true">Read the small print</a>"#,
            r#"<a class="lt-link" aria-disabled="false" href="/small-print">Read the small print</a>"#,
            r#"<a class="app-link" aria-disabled="true" href="/small-print">Read the small print</a>"#,
        ] {
            assert!(check(html).is_empty(), "{html}: {:?}", check(html));
        }
    }

    #[test]
    fn an_icon_alone_needs_a_name() {
        let rules = |html: &str| -> Vec<&str> {
            diagnose_markup(&utf16(html), &manifest::for_tests())
                .iter()
                .map(|f| f.rule)
                .filter(|r| *r == "without-name")
                .collect()
        };
        let svg = r#"<svg class="lt-icon" aria-hidden="true"><path d="M0 0"/></svg>"#;
        for html in [
            format!("<button>{svg}</button>"),
            format!(r#"<a href="/hjem"> {svg} </a>"#),
            format!("<button>{svg}<span aria-hidden=\"true\">x</span></button>"),
            r#"<button><img src="x.svg" alt=""></button>"#.to_string(),
            r#"<button><svg><path d="M0 0"></path></svg></button>"#.to_string(),
            format!("<button aria-label=\"  \">{svg}</button>"),
            format!("<button>&nbsp;{svg}&#160;</button>"),
            format!(
                r#"<button type="button" class="lt-button" data-variant="ghost" onclick="slett()">{svg}</button>"#
            ),
            format!(r#"<button data-testid="slett">{svg}</button>"#),
            // Hidden now, and without a name once it is shown.
            format!("<button hidden>{svg}</button>"),
        ] {
            assert_eq!(rules(&html), ["without-name"], "{html}");
        }
        for html in [
            format!("<button>{svg} Slett</button>"),
            format!("<button aria-label=\"Slett\">{svg}</button>"),
            format!("<button aria-labelledby=\"t\">{svg}</button>"),
            format!("<button title=\"Slett\">{svg}</button>"),
            format!("<button>{svg}<span class=\"lt-sr-only\">Slett</span></button>"),
            r#"<button><svg role="img" aria-label="Slett"></svg></button>"#.to_string(),
            r#"<button><svg><title>Slett</title></svg></button>"#.to_string(),
            r#"<button><img src="x.svg" alt="Slett"></button>"#.to_string(),
            format!("<a>{svg}</a>"),
            "<button></button>".to_string(),
            format!("<button>{{{{ .Navn }}}}{svg}</button>"),
            format!("<button aria-label=\"{{{{ .Navn }}}}\">{svg}</button>"),
            format!(r#"<button :aria-label="t('slett')">{svg}</button>"#),
            format!(r#"<button v-bind:title="t('slett')">{svg}</button>"#),
            format!(r#"<button x-bind:aria-label="name">{svg}</button>"#),
            format!(r#"<button data-attr:aria-label="$navn">{svg}</button>"#),
            format!(r#"<button [attr.aria-label]="name">{svg}</button>"#),
            format!(r##"<button th:title="#{{slett}}">{svg}</button>"##),
            format!("<BUTTON ARIA-LABEL=\"Slett\">{svg}</BUTTON>"),
            r#"<button><IMG SRC="x.svg" ALT="Slett"></button>"#.to_string(),
            format!("<button {{...props}}>{svg}</button>"),
            format!("<button class=\"lt-button\">{svg}<slot /></button>"),
            format!("<button>{svg}<span x-text=\"navn\"></span></button>"),
            format!("<button>{svg}<span data-text=\"$navn\"></span></button>"),
            format!("<button>{svg}<Trans id=\"slett\" /></button>"),
            format!("<button>{svg}<app-tekst></app-tekst></button>"),
            r#"<button><svg {...lt.icon({ label })}></svg></button>"#.to_string(),
            format!("<label for=\"b\">Slett</label><button id=\"b\">{svg}</button>"),
            format!(r#"<a :href="url">{svg}</a>"#),
            format!("<button><span :hidden=\"x\"></span>{svg}</button>"),
            format!(r#"<button v-bind="$attrs">{svg}</button>"#),
            format!(r#"<button x-bind="trigger">{svg}</button>"#),
            format!(r#"<button data-attr="{{'aria-label': $name}}">{svg}</button>"#),
            format!(r#"<button th:attr="aria-label=${{label}}">{svg}</button>"#),
            format!(r#"<button @attributes="Extra">{svg}</button>"#),
            format!("<button {{title}}>{svg}</button>"),
            format!(r#"<button title="" :title="t('slett')">{svg}</button>"#),
            format!(r#"<button>{svg}<span v-t="'slett'"></span></button>"#),
            format!(r#"<button>{svg}<span data-i18n="slett"></span></button>"#),
            format!(r#"<button>{svg}<span translate="slett"></span></button>"#),
            format!("<label>Slett <button>{svg}</button></label>"),
            format!(r#"<button data-i18n="[aria-label]slett">{svg}</button>"#),
            r#"<button><svg v-bind="ikon"></svg></button>"#.to_string(),
            r#"<button><svg x-bind="ikon"></svg></button>"#.to_string(),
            r#"<button><svg><clipPath id="c"><rect /></clipPath><title>Slett</title></svg></button>"#.to_string(),
        ] {
            assert!(rules(&html).is_empty(), "{html}: {:?}", rules(&html));
        }
    }
}
