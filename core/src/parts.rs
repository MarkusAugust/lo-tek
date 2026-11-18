//! `part-repeated`: a part with `unique` that appears more than once.
//!
//! The rule is driven by `parts` in the manifest, both for the elements and
//! for the classes, so a new part in the metadata is checked without a line
//! here. It only reports the parts with `unique`: where a second part of the
//! same kind is an error, like an `<lt-field>` with two controls, where only
//! the first is wired. A part without `unique` can appear several times and
//! be ordinary content. `<lt-popover>` finds the button by `aria-controls`
//! pointing at the panel, otherwise the first one outside the panel, and the
//! buttons in the panel belong to the menu. Each component's own rule for
//! which one is the right one lives in the component, not here.
//!
//! A match belongs to the nearest host: a field inside a field belongs to
//! the inner field, like `part.closest(host.localName) === host` in the
//! components. What is inside a `<template>` is not in the document and does
//! not count. When there is template syntax in the host, the rule says
//! nothing: a loop, an `if`/`else`, a `v-if` or an expression in `{…}` can
//! give two parts in the source and one on the page.
//!
//! The selectors are read by a small selector reader with exactly what the
//! manifest uses: tag, class, attribute with `=`, `^=` and the `i` flag,
//! `:not()` with a compound selector, `:scope`, child (`>`), descendant and
//! comma. A selector it does not understand is skipped rather than giving a
//! finding it cannot stand behind.

use crate::diagnose::{is_templated_content, tag_end};
use crate::references::{value, Node};
use crate::text::*;
use crate::types::*;

#[derive(Debug, PartialEq)]
enum Test {
    Tag(String),
    Class(String),
    /// The name, and the value with the operator and whether it is compared ignoring case.
    Attribute(String, Option<(Operator, String, bool)>),
    Not(Vec<Test>),
    Scope,
}

#[derive(Debug, PartialEq, Clone, Copy)]
enum Operator {
    Equals,
    Prefix,
}

#[derive(Debug, PartialEq, Clone, Copy)]
enum Combinator {
    Descendant,
    Child,
}

/// A selector without commas: the compound selectors from the left, and the
/// combinator before each of them after the first.
#[derive(Debug, PartialEq)]
pub(crate) struct Complex {
    compounds: Vec<Vec<Test>>,
    combinators: Vec<Combinator>,
}

fn is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

struct Reader {
    chars: Vec<char>,
    i: usize,
}

impl Reader {
    fn new(text: &str) -> Self {
        Reader {
            chars: text.chars().collect(),
            i: 0,
        }
    }
    fn peek(&self) -> Option<char> {
        self.chars.get(self.i).copied()
    }
    fn eat(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn spaces(&mut self) -> bool {
        let from = self.i;
        while self.peek().is_some_and(char::is_whitespace) {
            self.i += 1;
        }
        self.i > from
    }
    fn ident(&mut self) -> Option<String> {
        let from = self.i;
        while self.peek().is_some_and(is_ident) {
            self.i += 1;
        }
        (self.i > from).then(|| self.chars[from..self.i].iter().collect())
    }
    fn starts(&self, word: &str) -> bool {
        word.chars()
            .enumerate()
            .all(|(k, c)| self.chars.get(self.i + k) == Some(&c))
    }
    fn quoted(&mut self) -> Option<String> {
        let quote = self.peek().filter(|&c| c == '"' || c == '\'')?;
        self.i += 1;
        let from = self.i;
        while self.peek().is_some_and(|c| c != quote) {
            self.i += 1;
        }
        let value: String = self.chars[from..self.i].iter().collect();
        self.eat(quote).then_some(value)
    }

    /// `[name]`, `[name='v']`, `[name^='v']` and `[name="v" i]`.
    fn attribute(&mut self) -> Option<Test> {
        self.spaces();
        let name = self.ident()?.to_ascii_lowercase();
        self.spaces();
        if self.eat(']') {
            return Some(Test::Attribute(name, None));
        }
        let operator = if self.eat('=') {
            Operator::Equals
        } else if self.eat('^') && self.eat('=') {
            Operator::Prefix
        } else {
            return None;
        };
        self.spaces();
        let wanted = match self.quoted() {
            Some(v) => v,
            None => self.ident()?,
        };
        self.spaces();
        let insensitive = self.eat('i') || self.eat('I');
        self.spaces();
        self.eat(']')
            .then_some(Test::Attribute(name, Some((operator, wanted, insensitive))))
    }

    /// A compound selector: everything up to a space, `>`, `,` or `)`.
    fn compound(&mut self) -> Option<Vec<Test>> {
        let mut tests = Vec::new();
        loop {
            match self.peek() {
                Some('.') => {
                    self.i += 1;
                    tests.push(Test::Class(self.ident()?));
                }
                Some('[') => {
                    self.i += 1;
                    tests.push(self.attribute()?);
                }
                Some(':') if self.starts(":scope") => {
                    self.i += ":scope".len();
                    tests.push(Test::Scope);
                }
                Some(':') if self.starts(":not(") => {
                    self.i += ":not(".len();
                    self.spaces();
                    let inner = self.compound()?;
                    self.spaces();
                    if !self.eat(')') || inner.is_empty() {
                        return None;
                    }
                    tests.push(Test::Not(inner));
                }
                Some(c) if is_ident(c) && tests.is_empty() => {
                    tests.push(Test::Tag(self.ident()?.to_ascii_lowercase()));
                }
                _ => break,
            }
        }
        Some(tests)
    }

    fn complex(&mut self) -> Option<Complex> {
        let mut compounds = Vec::new();
        let mut combinators = Vec::new();
        self.spaces();
        // `> li` is relative to the host, like `:scope > li`.
        if self.eat('>') {
            compounds.push(vec![Test::Scope]);
            combinators.push(Combinator::Child);
            self.spaces();
        }
        loop {
            let compound = self.compound()?;
            if compound.is_empty() {
                return None;
            }
            compounds.push(compound);
            let spaced = self.spaces();
            match self.peek() {
                None | Some(',') => break,
                Some('>') => {
                    self.i += 1;
                    self.spaces();
                    combinators.push(Combinator::Child);
                }
                Some(_) if spaced => combinators.push(Combinator::Descendant),
                Some(_) => return None,
            }
        }
        Some(Complex {
            compounds,
            combinators,
        })
    }
}

/// The selector list, or `None` when it has something the matcher does not know.
pub(crate) fn parse(selector: &str) -> Option<Vec<Complex>> {
    let mut reader = Reader::new(selector);
    let mut out = Vec::new();
    loop {
        out.push(reader.complex()?);
        reader.spaces();
        if reader.peek().is_none() {
            return Some(out);
        }
        if !reader.eat(',') {
            return None;
        }
    }
}

fn has_word(node: &Node, attribute: &str, word: &str) -> bool {
    value(node, attribute)
        .and_then(|a| a.value.as_deref())
        .is_some_and(|v| words(v).iter().any(|(_, w)| equals_exact(w, word)))
}

fn equals_exact(t: &[u16], s: &str) -> bool {
    t.iter().copied().eq(s.encode_utf16())
}

fn test(nodes: &[Node], n: usize, host: usize, t: &Test) -> bool {
    let node = &nodes[n];
    match t {
        Test::Tag(name) => node.name == *name,
        Test::Class(name) => has_word(node, "class", name),
        Test::Scope => n == host,
        Test::Not(inner) => !inner.iter().all(|t| test(nodes, n, host, t)),
        Test::Attribute(name, wanted) => {
            let Some(a) = value(node, name) else {
                return false;
            };
            let Some((operator, wanted, insensitive)) = wanted else {
                return true;
            };
            let have = a.value.clone().unwrap_or_default();
            // HTML compares some values ignoring case, so `type="HIDDEN"` is
            // hidden for the browser too.
            let insensitive = *insensitive || name == "type" || name == "method";
            let (have, wanted) = if insensitive {
                (lowercase(&have), utf16(&wanted.to_ascii_lowercase()))
            } else {
                (have, utf16(wanted))
            };
            match operator {
                Operator::Equals => have == wanted,
                Operator::Prefix => have.starts_with(&wanted),
            }
        }
    }
}

fn compound_matches(nodes: &[Node], n: usize, host: usize, tests: &[Test]) -> bool {
    tests.iter().all(|t| test(nodes, n, host, t))
}

/// Whether node `n` matches the first `k` compound selectors, with the last one on `n`.
fn matches_at(nodes: &[Node], n: usize, host: usize, c: &Complex, k: usize) -> bool {
    if !compound_matches(nodes, n, host, &c.compounds[k]) {
        return false;
    }
    if k == 0 {
        return true;
    }
    match c.combinators[k - 1] {
        Combinator::Child => nodes[n]
            .parent
            .is_some_and(|p| matches_at(nodes, p, host, c, k - 1)),
        Combinator::Descendant => {
            let mut a = nodes[n].parent;
            while let Some(p) = a {
                if matches_at(nodes, p, host, c, k - 1) {
                    return true;
                }
                a = nodes[p].parent;
            }
            false
        }
    }
}

pub(crate) fn matches(nodes: &[Node], n: usize, host: usize, list: &[Complex]) -> bool {
    list.iter()
        .any(|c| matches_at(nodes, n, host, c, c.compounds.len() - 1))
}

/// Whether `a` is an ancestor of `n`.
fn is_ancestor(nodes: &[Node], a: usize, n: usize) -> bool {
    let mut p = nodes[n].parent;
    while let Some(i) = p {
        if i == a {
            return true;
        }
        p = nodes[i].parent;
    }
    false
}

/// Template syntax in the content that can give different markup on the page
/// than in the source: what `is_templated_content` knows, and an expression
/// in `{…}` in the text outside the tags, as in Astro and JSX. A `{` in an
/// attribute value, like `count-one="{n} match"` or `data-signals="{…}"`, is
/// not an expression.
fn decides_markup(content: &[u16]) -> bool {
    if is_templated_content(content) {
        return true;
    }
    let mut in_tag = false;
    let mut quote: Option<u16> = None;
    for &c in content {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if in_tag && (c == DOUBLE_QUOTE || c == SINGLE_QUOTE) => quote = Some(c),
            None if c == LT => in_tag = true,
            None if c == GT => in_tag = false,
            None if !in_tag && c == b'{' as u16 => return true,
            None => {}
        }
    }
    false
}

/// The attributes that remove or repeat an element in Vue and Angular.
/// Alpine's `x-if` and `x-for` go on a `<template>`, which does not count.
const DIRECTIVES: &[&str] = &["v-if", "v-else", "v-else-if", "v-for", "*ngif", "*ngfor"];

fn has_directive(node: &Node) -> bool {
    node.attributes
        .iter()
        .any(|a| DIRECTIVES.iter().any(|d| equals(&a.name, d)))
}

/// Whether the node is inside a `<template>`.
fn in_template(nodes: &[Node], n: usize) -> bool {
    let mut p = nodes[n].parent;
    while let Some(i) = p {
        if nodes[i].name == "template" {
            return true;
        }
        p = nodes[i].parent;
    }
    false
}

/// A host: an element or a class with parts.
struct Host<'a> {
    name: String,
    /// Whether the host is a web component, which uses the first part, or a class.
    element: bool,
    link: &'a str,
    parts: &'a [Part],
    /// Whether a node is a host of the same kind.
    is: Box<dyn Fn(&Node) -> bool + 'a>,
}

/// The first sentence of the description, without the code marks.
fn first_sentence(description: &str) -> String {
    let plain = description.replace('`', "");
    match plain.find(". ") {
        Some(end) => plain[..=end].to_string(),
        None => plain,
    }
}

/// The nodes that belong to the host `h`, and its content in the text.
///
/// The nodes are the descendants whose nearest host of the same kind is `h`,
/// apart from what is inside a `<template>`: a field inside a field belongs
/// to the inner field, like `part.closest(host.localName) === host` in the
/// components. The content runs from the end of the opening tag to the
/// closing tag, not the host's own attributes and not the text after it.
/// `None` when the host is empty.
pub(crate) fn host_content(
    source: &[u16],
    nodes: &[Node],
    h: usize,
    is_host: &dyn Fn(&Node) -> bool,
) -> Option<(Vec<usize>, (usize, usize))> {
    let mut own = Vec::new();
    let mut last = h;
    for n in h + 1..nodes.len() {
        if !is_ancestor(nodes, h, n) {
            break;
        }
        last = n;
        let mut p = nodes[n].parent;
        let mut nearest = None;
        while let Some(i) = p {
            if is_host(&nodes[i]) {
                nearest = Some(i);
                break;
            }
            p = nodes[i].parent;
        }
        if nearest == Some(h) && !in_template(nodes, n) {
            own.push(n);
        }
    }
    if own.is_empty() {
        return None;
    }
    let from = tag_end(source, nodes[h].name_end).map_or(nodes[h].name_end, |e| e + 1);
    let next = nodes
        .get(last + 1)
        .map_or(source.len(), |n| n.name_start.saturating_sub(1));
    let close = format!("</{}", nodes[h].name);
    let to = (from..next.max(from))
        .rev()
        .find(|&i| starts_at_ci(source, i, &close))
        .unwrap_or(next.max(from));
    Some((own, (from, to)))
}

/// Whether the template decides the markup in the host: template syntax in
/// the content, or a `v-if` on one of the parts. Then the rules say nothing.
pub(crate) fn templated_host(
    source: &[u16],
    nodes: &[Node],
    own: &[usize],
    (from, to): (usize, usize),
) -> bool {
    decides_markup(&source[from..to]) || own.iter().any(|&n| has_directive(&nodes[n]))
}

pub(crate) fn check_parts(source: &[u16], vocabulary: &Vocabulary, nodes: &[Node]) -> Vec<Finding> {
    // Only the hosts that have a part with `unique` can give a finding, and
    // only those that appear in the text.
    let unique = |parts: &[Part]| parts.iter().any(|p| p.unique);
    let present = |name: &str| contains_str(source, name);
    let elements: Vec<&Element> = vocabulary
        .elements
        .iter()
        .filter(|e| unique(&e.parts) && present(&e.tag))
        .collect();
    let classes: Vec<&Class> = vocabulary
        .classes
        .iter()
        .filter(|c| unique(&c.parts) && present(&c.name))
        .collect();
    if elements.is_empty() && classes.is_empty() {
        return Vec::new();
    }
    let mut hosts: Vec<Host> = Vec::new();
    for e in elements {
        let tag = e.tag.clone();
        hosts.push(Host {
            name: format!("<{}>", e.tag),
            element: true,
            link: &e.link,
            parts: &e.parts,
            is: Box::new(move |n: &Node| n.name == tag),
        });
    }
    for c in classes {
        let name = c.name.clone();
        hosts.push(Host {
            name: c.name.clone(),
            element: false,
            link: &c.link,
            parts: &c.parts,
            is: Box::new(move |n: &Node| has_word(n, "class", &name)),
        });
    }

    let mut out = Vec::new();
    let mut reported = std::collections::HashSet::new();
    for host in &hosts {
        let parsed: Vec<Option<Vec<Complex>>> =
            host.parts.iter().map(|p| parse(&p.selector)).collect();
        for h in (0..nodes.len()).filter(|&h| (host.is)(&nodes[h])) {
            let Some((own, range)) = host_content(source, nodes, h, &*host.is) else {
                continue;
            };
            if templated_host(source, nodes, &own, range) {
                continue;
            }
            for (k, part) in host.parts.iter().enumerate() {
                if !part.unique {
                    continue;
                }
                let Some(list) = &parsed[k] else {
                    continue;
                };
                let hits: Vec<usize> = own
                    .iter()
                    .copied()
                    .filter(|&n| matches(nodes, n, h, list))
                    .collect();
                for &n in hits.iter().skip(1) {
                    let node = &nodes[n];
                    // Nested hosts with the same part, like the class and the
                    // element in `<lt-session-timeout>`, report the same node
                    // only once.
                    if !reported.insert(node.name_start) {
                        continue;
                    }
                    out.push(Finding {
                        start: node.name_start,
                        end: node.name_end,
                        severity: Severity::Warning,
                        link: host.link.to_string(),
                        message: format!(
                            "{} has the part \"{}\" more than once. {} {}",
                            host.name,
                            part.name,
                            if host.element {
                                "The web component only uses the first one, and this one is left out."
                            } else {
                                "It must appear once."
                            },
                            first_sentence(&part.description)
                        )
                        .trim_end()
                        .to_string(),
                        fix: None,
                        rule: "part-repeated",
                    });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_selector_in_the_manifest() {
        let v = crate::manifest::for_tests();
        let selectors: Vec<&str> = v
            .elements
            .iter()
            .flat_map(|e| e.parts.iter())
            .chain(v.classes.iter().flat_map(|c| c.parts.iter()))
            .map(|p| p.selector.as_str())
            .collect();
        assert!(
            selectors.len() > 50,
            "found only {} selectors",
            selectors.len()
        );
        for s in selectors {
            assert!(parse(s).is_some(), "does not understand \"{s}\"");
        }
    }

    #[test]
    fn refuses_what_it_does_not_know() {
        for s in ["a ~ b", "a + b", "a:hover", "[a$='x']", ":is(a)", "a >", ""] {
            assert!(parse(s).is_none(), "should have refused \"{s}\"");
        }
    }

    fn rules(html: &str) -> Vec<String> {
        let v = crate::manifest::for_tests();
        check_parts(&utf16(html), &v, &crate::references::tree(&utf16(html)))
            .into_iter()
            .map(|f| f.message)
            .collect()
    }

    #[test]
    fn two_controls_in_a_field() {
        let found = rules(r#"<lt-field><label>Navn</label><input><input></lt-field>"#);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].starts_with("<lt-field> has the part \"control\""));
    }

    #[test]
    fn a_field_inside_a_field_is_its_own() {
        assert!(rules(r#"<lt-field><label>A</label><input><lt-field><label>B</label><input></lt-field></lt-field>"#).is_empty());
    }

    #[test]
    fn only_unique_parts_are_reported() {
        // The buttons in the panel belong to the menu, and a split button is correct.
        assert!(rules(r#"<lt-popover><button>Lagre</button><button aria-controls="m">v</button><ul class="lt-popover" id="m"><li><button>A</button></li></ul></lt-popover>"#).is_empty());
        // Several headings in a dialog are content.
        assert!(rules(r#"<lt-dialog><dialog aria-label="Innstillinger"><h2>Lyd</h2><h2>Bilde</h2></dialog></lt-dialog>"#).is_empty());
        // Each help text in its own field in a fieldset.
        assert!(rules(r#"<fieldset class="lt-fieldset"><legend class="lt-legend">Adresse</legend><label>Gate</label><input><p class="lt-help-text">A</p><label>Postnummer</label><input><p class="lt-help-text">B</p></fieldset>"#).is_empty());
        assert_eq!(
            rules(r#"<lt-dialog><dialog></dialog><dialog></dialog></lt-dialog>"#).len(),
            1
        );
    }

    #[test]
    fn a_nested_host_reports_a_node_once() {
        // In the manifest no two nested hosts have the same part with
        // `unique`. Here the class in the dialog gets it too, so the two overlap.
        let mut v = (*crate::manifest::for_tests()).clone();
        for c in v
            .classes
            .iter_mut()
            .filter(|c| c.name == "lt-session-timeout__dialog")
        {
            for p in c.parts.iter_mut().filter(|p| p.name == "text") {
                p.unique = true;
            }
        }
        let html = r#"<lt-session-timeout class="lt-session-timeout"><dialog class="lt-session-timeout__dialog"><p class="lt-session-timeout__text">A</p><p class="lt-session-timeout__text">B</p></dialog></lt-session-timeout>"#;
        let found = check_parts(&utf16(html), &v, &crate::references::tree(&utf16(html)));
        assert_eq!(found.len(), 1, "{found:?}");
    }

    #[test]
    fn what_a_template_hides_or_decides_does_not_count() {
        assert!(rules(
            r#"<lt-field><label>A</label><input><template><input></template></lt-field>"#
        )
        .is_empty());
        assert!(
            rules(r#"<lt-field><label>A</label>{lang ? <textarea /> : <input />}</lt-field>"#)
                .is_empty()
        );
        assert!(rules(r#"<lt-field><label>A</label><input v-if="kort"><textarea v-else></textarea></lt-field>"#).is_empty());
    }

    #[test]
    fn braces_and_words_that_are_not_templates_do_not_silence_it() {
        // `{n}` in an attribute value on the host, `nav-form` which looks like
        // `v-for`, an email address that looks like `@if`, and an expression
        // after the closing tag.
        let html = r#"<lt-suggestion count-one="{n} hits"><input class="nav-form" data-on:input="$n > 0 && go({a: 1})"><input><p>kontakt@ifi.uio.no</p></lt-suggestion>
<lt-field><label>A</label><input><input></lt-field>
{error && <p>Error</p>}"#;
        assert_eq!(rules(html).len(), 2, "{:?}", rules(html));
    }

    #[test]
    fn a_spinner_is_not_a_second_status() {
        assert!(rules(r#"<lt-suggestion><label>A</label><input><ul class="lt-suggestion__list"></ul><span role="status"></span><span class="lt-spinner" role="status" aria-label="Henter"></span></lt-suggestion>"#).is_empty());
    }

    #[test]
    fn type_is_compared_without_case() {
        assert!(rules(r#"<lt-field><input type="HIDDEN" name="x"><input type="checkbox" name="y"><label>A</label></lt-field>"#).is_empty());
    }

    #[test]
    fn says_nothing_when_a_template_decides() {
        assert!(rules("<lt-field><label>A</label>{{if .Lang}}<textarea></textarea>{{else}}<input>{{end}}</lt-field>").is_empty());
    }

    #[test]
    fn classes_have_parts_too() {
        assert_eq!(rules(r#"<table class="lt-table"><caption>A</caption><caption>B</caption><thead></thead><tbody></tbody></table>"#).len(), 1);
        assert!(rules(r#"<div class="lt-card"><h3 class="lt-card__title">A</h3><div class="lt-card"><h3 class="lt-card__title">B</h3></div></div>"#).is_empty());
    }
}
