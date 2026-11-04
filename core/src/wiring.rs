//! The wiring the template must write itself, for the components to work
//! without JavaScript and survive an update from the server.
//!
//! The components never write an id on what the user interacts with: the
//! field, the tabs and the panels. Datastar and idiomorph recognise an
//! element by its id, and an element with an id the server did not send is
//! replaced at the next update, together with focus and what the user typed.
//! What the field needs to have a name without JavaScript, `for` and `id` or
//! the label around the field, is therefore the template's job. The rules
//! here report when it is missing, in markup mode as in page mode, with the
//! same words the components use in the console.
//!
//! Which parts must have an id from the server is in the manifest as
//! `stableId` on the part, so a new part in `metadata.ts` is checked without
//! a line here. Each component's own rules, like the tabs and the suggestion
//! list, are under its element name.
//!
//! The rules stay silent where the template decides the markup: a loop, an
//! `if` or an expression in the host, a `v-if` on a part, a bound id (`:id`,
//! `v-bind:id`, `x-bind:id`, `data-attr:id`, `[id]`, `th:id`, `asp-for`) or
//! an id with template syntax in it. Then only the server knows what ends up
//! on the page.

use std::collections::{HashMap, HashSet};

use crate::diagnose::{attribute, is_templated, is_templated_value};
use crate::parts::{host_content, matches, parse, templated_host};
use crate::references::{decode, fragment, has_class, non_empty, value, within, Node};
use crate::text::*;
use crate::types::*;

const CONTROLS: &[&str] = &["input", "textarea", "select"];

/// The ids the components create themselves, `uniqueId` in `host-element.ts`,
/// plus `createFieldId`: `lt-field-<number>-<six characters>`.
const GENERATED_PREFIXES: &[&str] = &[
    "lt-field-help-",
    "lt-field-error-",
    "lt-popover-",
    "lt-dialog-title-",
    "lt-session-timeout-title-",
    "lt-tabs-heading-",
    "lt-suggestion-list-",
    "lt-suggestion-option-",
    "lt-suggestion-label-",
];

/// What the node says about its id.
enum Id {
    /// No id, and no binding that gives one.
    Missing,
    /// A binding or template syntax gives the id on the page, and only the server knows what.
    Unknown,
    /// An id written out directly.
    Given(Utf16),
}

/// Whether the attribute is bound by a framework, like `:for`, `v-bind:id`,
/// `data-attr:id`, `[id]`, `[attr.for]` or `th:id`. Then the binding gives the
/// value on the page, and only the server knows what it will be.
fn bound(node: &Node, name: &str) -> bool {
    node.attributes.iter().any(|a| {
        let full = lossy(&lowercase(&a.name));
        let n = full.trim_end_matches(']');
        n != name
            && n.strip_suffix(name)
                .is_some_and(|p| p.ends_with([':', '.', '[']))
    })
}

fn id_of(node: &Node) -> Id {
    // `asp-for` in Razor gives both `id` and `name`, without the name saying so.
    if bound(node, "id") || value(node, "asp-for").is_some() {
        return Id::Unknown;
    }
    match value(node, "id").and_then(|a| a.value.clone()) {
        Some(v) if is_templated_value(&v) => Id::Unknown,
        Some(v) if !trimmed(&v).is_empty() => Id::Given(v),
        _ => Id::Missing,
    }
}

/// Whether the node itself has template syntax in an attribute or a value.
fn templated_node(node: &Node) -> bool {
    node.attributes
        .iter()
        .any(|a| is_templated(&a.name) || a.value.as_deref().is_some_and(is_templated))
}

/// Whether the attribute is there in some form, bound or written out.
fn has_attribute(node: &Node, name: &str) -> bool {
    attribute(&node.attributes, name).is_some()
}

/// The value as written, only when the attribute is written out directly.
fn plain_value<'a>(node: &'a Node, name: &str) -> Option<&'a Utf16> {
    value(node, name).and_then(|a| a.value.as_ref())
}

fn finding(
    rule: &'static str,
    node: &Node,
    link: &str,
    message: String,
    fix: Option<Fix>,
) -> Finding {
    Finding {
        start: node.name_start,
        end: node.name_end,
        severity: Severity::Warning,
        link: link.to_string(),
        message,
        fix,
        rule,
    }
}

/// A valid id made from `name`: letters, digits, hyphen and underscore, with
/// a letter first. `items[0].email` and `country[]` are not.
fn id_from_name(name: &[u16]) -> Option<String> {
    let text = lossy(name);
    let mut chars = text.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return None;
    }
    Some(text)
}

/// What is in the text, read once per page.
struct Page<'a> {
    nodes: &'a [Node],
    /// Every id on the page, decoded, and the node that has it.
    ids: HashMap<Utf16, usize>,
    /// The values of every `<label for>` on the page, decoded.
    label_for: HashSet<Utf16>,
}

impl Page<'_> {
    fn has_id(&self, id: &[u16]) -> bool {
        self.ids.contains_key(&decode(id))
    }
}

pub(crate) fn check_wiring(
    source: &[u16],
    vocabulary: &Vocabulary,
    nodes: &[Node],
    page_mode: bool,
) -> Vec<Finding> {
    let mut ids = HashMap::new();
    let mut label_for = HashSet::new();
    for (n, node) in nodes.iter().enumerate() {
        if let Some(id) = non_empty(node, "id") {
            ids.entry(decode(id)).or_insert(n);
        }
        if node.name == "label" {
            if let Some(target) = non_empty(node, "for") {
                label_for.insert(decode(target));
            }
        }
    }
    let page = Page {
        nodes,
        ids,
        label_for,
    };

    let mut out = Vec::new();
    for element in &vocabulary.elements {
        if !contains_str(source, &element.tag) {
            continue;
        }
        let tag = element.tag.as_str();
        let is_host = |n: &Node| n.name == tag;
        let parsed: Vec<Option<Vec<_>>> =
            element.parts.iter().map(|p| parse(&p.selector)).collect();
        for h in (0..nodes.len()).filter(|&h| is_host(&nodes[h])) {
            let Some((own, range)) = host_content(source, nodes, h, &is_host) else {
                continue;
            };
            if templated_node(&nodes[h]) || templated_host(source, nodes, &own, range) {
                continue;
            }
            let host = Host {
                page: &page,
                element,
                h,
                own: &own,
                parsed: &parsed,
                page_mode,
            };
            out.extend(host.stable_ids());
            match tag {
                "lt-tabs" => out.extend(host.tabs()),
                "lt-suggestion" => out.extend(host.suggestion()),
                "lt-field" => out.extend(host.field()),
                "lt-term" => out.extend(host.term()),
                _ => {}
            }
        }
    }
    out.extend(text_in_label(&page, vocabulary));
    if !page_mode {
        out.extend(generated_ids(&page, vocabulary));
    }
    out
}

/// One host with its parts, as they are in the manifest.
struct Host<'a> {
    page: &'a Page<'a>,
    element: &'a Element,
    h: usize,
    own: &'a [usize],
    parsed: &'a [Option<Vec<crate::parts::Complex>>],
    page_mode: bool,
}

impl Host<'_> {
    fn nodes(&self) -> &[Node] {
        self.page.nodes
    }

    fn tag(&self) -> &str {
        &self.element.tag
    }

    fn link(&self) -> &str {
        &self.element.link
    }

    /// The nodes in the host that are the part with the name, in order.
    fn part(&self, name: &str) -> Vec<usize> {
        let Some(k) = self.element.parts.iter().position(|p| p.name == name) else {
            return Vec::new();
        };
        let Some(list) = &self.parsed[k] else {
            return Vec::new();
        };
        self.own
            .iter()
            .copied()
            .filter(|&n| matches(self.nodes(), n, self.h, list))
            .collect()
    }

    fn first(&self, name: &str) -> Option<usize> {
        self.part(name).into_iter().next()
    }

    fn own_named(&self, name: &str) -> Vec<usize> {
        self.own
            .iter()
            .copied()
            .filter(|&n| self.nodes()[n].name == name)
            .collect()
    }

    /// The parts with `stableId`: a control without wiring, and a panel without an id.
    fn stable_ids(&self) -> Vec<Finding> {
        let mut out = Vec::new();
        for (k, part) in self.element.parts.iter().enumerate() {
            if !part.stable_id {
                continue;
            }
            let Some(list) = &self.parsed[k] else {
                continue;
            };
            let Some(n) = self
                .own
                .iter()
                .copied()
                .find(|&n| matches(self.nodes(), n, self.h, list))
            else {
                continue;
            };
            let node = &self.nodes()[n];
            if templated_node(node) {
                continue;
            }
            if CONTROLS.contains(&node.name.as_str()) {
                out.extend(self.control(n));
            } else if matches!(id_of(node), Id::Missing) {
                out.push(finding(
                    "panel-without-id",
                    node,
                    self.link(),
                    format!(
                        "<{}> has the part \"{}\" without an id. {}",
                        self.tag(),
                        part.name,
                        // The message is plain text; the code font is for the hover box.
                        part.description.replace('`', "")
                    ),
                    None,
                ));
            }
        }
        out
    }

    /// `control-without-wiring`: the label neither points at the field with
    /// `for` nor is around it.
    fn control(&self, n: usize) -> Option<Finding> {
        let nodes = self.nodes();
        let control = &nodes[n];
        if has_attribute(control, "aria-label") || has_attribute(control, "aria-labelledby") {
            return None;
        }
        if within(nodes, n, |m| m.name == "label") {
            return None;
        }
        let labels = self.own_named("label");
        // A label with a bound `for`, like `:for` or `asp-for`, points at
        // something only the server knows.
        if labels
            .iter()
            .any(|&l| bound(&nodes[l], "for") || value(&nodes[l], "asp-for").is_some())
        {
            return None;
        }
        // Without any label at all, `without-name` reports the control in
        // <lt-field>, and on a whole page in <lt-suggestion>. In a piece of a
        // page `without-name` cannot tell, and the suggestion field is
        // reported here.
        if labels.is_empty() && (self.tag() == "lt-field" || self.page_mode) {
            return None;
        }
        let id = match id_of(control) {
            Id::Unknown => return None,
            Id::Given(id) => Some(id),
            Id::Missing => None,
        };
        if let Some(id) = &id {
            if self.page.label_for.contains(&decode(id)) {
                return None;
            }
        }
        let what = format!("<{}>", control.name);
        let message = if labels.is_empty() {
            format!(
                "The field has no label wired to it: no <label for> points at {what}, and no <label> is around it. Without the wiring the field has no name without JavaScript. Give the field a fixed id based on what the field is for, for example id=\"country\", and write the same in for on a <label>, or put the label around the field."
            )
        } else {
            format!(
                "The label is not wired to {what}. Without the wiring the field has no name without JavaScript, and a click on the label does not move focus to it. Give the field a fixed id based on what the field is for, for example id=\"country\", and write the same in for on the label, or put the label around the field."
            )
        };
        let fix = self.link_fix(n, &labels, id.is_none());
        Some(finding(
            "control-without-wiring",
            control,
            self.link(),
            message,
            fix,
        ))
    }

    /// "Give the field the id "name"": `id` on the control and `for` on the
    /// label, only when `name` can be an id, nothing else has it, the control
    /// has no id already, and the label in the host has no `for`.
    fn link_fix(&self, n: usize, labels: &[usize], without_id: bool) -> Option<Fix> {
        if !without_id {
            return None;
        }
        let nodes = self.nodes();
        let control = &nodes[n];
        let name = plain_value(control, "name")?;
        if is_templated_value(name) {
            return None;
        }
        let id = id_from_name(name)?;
        if self.page.has_id(&utf16(&id)) {
            return None;
        }
        let &l = labels.first()?;
        let label = &nodes[l];
        if value(label, "for").is_some() || templated_node(label) {
            return None;
        }
        let mut edits = vec![
            Edit {
                start: control.name_end,
                end: control.name_end,
                text: format!(" id=\"{id}\""),
            },
            Edit {
                start: label.name_end,
                end: label.name_end,
                text: format!(" for=\"{id}\""),
            },
        ];
        edits.sort_by_key(|e| e.start);
        Some(Fix {
            title: format!("Give the field the id \"{id}\""),
            edits,
            preferred: true,
        })
    }

    /// The tabs: every link has a panel, and a tab is a link. The name of the
    /// tab list is `without-name`'s.
    fn tabs(&self) -> Vec<Finding> {
        let nodes = self.nodes();
        let mut out = Vec::new();
        for n in self.part("tab") {
            let tab = &nodes[n];
            if templated_node(tab) {
                continue;
            }
            let Some(href) = plain_value(tab, "href") else {
                continue;
            };
            if is_templated_value(href) {
                continue;
            }
            // Like the browser: the fragment as written, and otherwise
            // decoded, so `#s%C3%B8knaden` finds `id="søknaden"`.
            let target = &href[1..];
            if target.is_empty()
                || self.page.has_id(target)
                || self.page.ids.contains_key(&fragment(target))
            {
                continue;
            }
            out.push(finding(
                "tab-link-without-panel",
                tab,
                self.link(),
                format!(
                    "<{}> has a tab without a panel: the link points at #{}, and no element has that id. Write an id on every .lt-tabs__panel, the same one the link points at. The tab can be selected without anything being shown.",
                    self.tag(),
                    lossy(target)
                ),
                None,
            ));
        }

        if let Some(l) = self.first("list") {
            let list = &nodes[l];
            // What the server has called a tab in the tab list, but is not a
            // link to a panel.
            for &n in self.own {
                let node = &nodes[n];
                if !within(nodes, n, |m| std::ptr::eq(m, list)) || n == l {
                    continue;
                }
                let is_tab = plain_value(node, "role")
                    .is_some_and(|v| equals(&lowercase(trimmed(v)), "tab"));
                if !is_tab || templated_node(node) {
                    continue;
                }
                let is_link = node.name == "a"
                    && plain_value(node, "href").is_some_and(|v| {
                        v.first() == Some(&(b'#' as u16)) || is_templated_value(v)
                    });
                if is_link {
                    continue;
                }
                out.push(finding(
                    "tab-without-link",
                    node,
                    self.link(),
                    format!(
                        "<{}> has a tab without href: role=\"tab\" is on <{}>, which is not a link to a panel. The tabs are links, like <a href=\"#attachments\">, so they work without JavaScript. The component does not touch what is not a link.",
                        self.tag(),
                        node.name
                    ),
                    None,
                ));
            }
        }
        out
    }

    /// The word in `<lt-term>` points at a glossary entry: a `<div>` in a
    /// `<dl>` with a `<dt>` and a `<dd>`. Only on a whole page: in a template
    /// the glossary can be in another file.
    fn term(&self) -> Vec<Finding> {
        if !self.page_mode {
            return Vec::new();
        }
        let nodes = self.nodes();
        let Some(w) = self.first("word") else {
            return Vec::new();
        };
        let word = &nodes[w];
        if templated_node(word) {
            return Vec::new();
        }
        let Some(href) = plain_value(word, "href") else {
            return Vec::new();
        };
        if href.len() < 2 || is_templated_value(href) {
            return Vec::new();
        }
        // Like the browser: the fragment as written, and otherwise decoded.
        let target = &href[1..];
        let found = self
            .page
            .ids
            .get(&decode(target))
            .or_else(|| self.page.ids.get(&fragment(target)));
        let message = match found {
            None => format!(
                "<{}> points at #{}, and no element has that id. Give the glossary entry the id; until then the word is a plain link, and no card opens.",
                self.tag(),
                lossy(target)
            ),
            Some(&e) if is_entry(nodes, e) => return Vec::new(),
            Some(&e) => format!(
                "<{}> points at #{}, which is <{}> and not a glossary entry. The entry is a <div> in a <dl> with a <dt> and a <dd>: put the id on the <div>. Until then the word is a plain link, and no card opens.",
                self.tag(),
                lossy(target),
                nodes[e].name
            ),
        };
        vec![finding("term-without-entry", word, self.link(), message, None)]
    }

    /// The suggestion list: `data-value` on the options and `.lt-suggestion__value` belong together.
    fn suggestion(&self) -> Vec<Finding> {
        let nodes = self.nodes();
        let options = self.part("option");
        if options.is_empty() {
            return Vec::new();
        }
        let with_value: Vec<usize> = options
            .iter()
            .copied()
            .filter(|&n| has_attribute(&nodes[n], "data-value"))
            .collect();
        let field = self.first("value");
        match (with_value.first(), field) {
            (Some(&n), None) => vec![finding(
                "value-without-field",
                &nodes[n],
                self.link(),
                format!(
                    "<{}> has options with data-value, but no .lt-suggestion__value. The code the user picks is then not sent with the form, only the text in the field. Write <input type=\"hidden\" class=\"lt-suggestion__value\" name=\"…\"> in the field, so the component fills it.",
                    self.tag()
                ),
                None,
            )],
            (None, Some(f)) => vec![finding(
                "value-without-field",
                &nodes[f],
                self.link(),
                format!(
                    "<{}> has an .lt-suggestion__value, but no options with data-value. The field stays empty. Give every option a data-value with the code it stands for.",
                    self.tag()
                ),
                None,
            )],
            _ => Vec::new(),
        }
    }

    /// The field: a hidden error text and `aria-invalid="true"` contradict each other.
    fn field(&self) -> Vec<Finding> {
        let nodes = self.nodes();
        let (Some(e), Some(c)) = (self.first("error"), self.first("control")) else {
            return Vec::new();
        };
        let error = &nodes[e];
        let control = &nodes[c];
        // A boolean attribute has no value; it is either there or not.
        let hidden = value(error, "hidden").is_some();
        let invalid = plain_value(control, "aria-invalid")
            .is_some_and(|v| equals(&lowercase(trimmed(v)), "true"));
        if !hidden || !invalid || templated_node(error) || templated_node(control) {
            return Vec::new();
        }
        vec![finding(
            "error-text-contradicts",
            error,
            self.link(),
            format!(
                "The error text has hidden, but <{}> has aria-invalid=\"true\". The component treats the field as invalid when the error text is visible or aria-invalid is there, so the two contradict each other: the screen reader says \"invalid\" without the user seeing why. Remove one of them.",
                control.name
            ),
            None,
        )]
    }
}

/// `text-in-label`: the help text or the error text is inside `<label>`.
fn text_in_label(page: &Page, vocabulary: &Vocabulary) -> Vec<Finding> {
    let link = vocabulary
        .elements
        .iter()
        .find(|e| e.tag == "lt-field")
        .map_or("", |e| e.link.as_str());
    let mut out = Vec::new();
    for (n, node) in page.nodes.iter().enumerate() {
        let help = has_class(node, |c| equals(c, "lt-help-text"));
        let error = !help && has_class(node, |c| equals(c, "lt-error-text"));
        if !help && !error {
            continue;
        }
        if !within(page.nodes, n, |m| m.name == "label") {
            continue;
        }
        let what = if help {
            "The help text"
        } else {
            "The error text"
        };
        out.push(finding(
            "text-in-label",
            node,
            link,
            format!(
                "{what} is inside <label>, and becomes part of the field's name. The screen reader reads it as the name of the field, and aria-describedby points at something inside the name. Move it out of the <label>, next to the field."
            ),
            None,
        ));
    }
    out
}

/// `id-from-component`: an id the component created itself in the browser,
/// copied into the template from DevTools. Only in markup mode: on a rendered
/// page it is correct.
fn generated_ids(page: &Page, vocabulary: &Vocabulary) -> Vec<Finding> {
    let link = vocabulary
        .elements
        .iter()
        .find(|e| e.tag == "lt-field")
        .map_or("", |e| e.link.as_str());
    let mut out = Vec::new();
    for node in page.nodes {
        let Some(id) = non_empty(node, "id") else {
            continue;
        };
        let text = lossy(id);
        if !looks_generated(&text) {
            continue;
        }
        let a = value(node, "id").unwrap();
        out.push(Finding {
            start: a.value_start,
            end: a.value_start + id.len(),
            severity: Severity::Warning,
            link: link.to_string(),
            message: format!(
                "id=\"{text}\" is an id the component created itself in the browser, and looks copied from DevTools. The component creates a new one on every page load, so nothing can point at this one. Write your own id, based on what the element is for, or leave it empty."
            ),
            fix: None,
            rule: "id-from-component",
        });
    }
    out
}

fn looks_generated(id: &str) -> bool {
    let base36 = |s: &str, len: usize| {
        s.len() == len
            && s.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    };
    if let Some(rest) = id.strip_prefix("lt-field-") {
        // `createFieldId`: `lt-field-<counter>-<six characters>`.
        if let Some((count, tail)) = rest.split_once('-') {
            if !count.is_empty() && count.chars().all(|c| c.is_ascii_digit()) && base36(tail, 6) {
                return true;
            }
        }
    }
    GENERATED_PREFIXES
        .iter()
        .any(|p| id.strip_prefix(p).is_some_and(|tail| base36(tail, 7)))
}

/// A glossary entry, as `<lt-term>` recognises one: a `<div>` in a `<dl>`,
/// with a `<dt>` and a `<dd>` of its own.
fn is_entry(nodes: &[Node], n: usize) -> bool {
    let node = &nodes[n];
    let child = |name: &str| {
        nodes
            .iter()
            .any(|m| m.parent == Some(n) && m.name == name)
    };
    node.name == "div"
        && node.parent.is_some_and(|p| nodes[p].name == "dl")
        && child("dt")
        && child("dd")
}
