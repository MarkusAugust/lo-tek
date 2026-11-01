//! `without-name`: an element a screen reader must be given a name for, and
//! is not.
//!
//! Which elements must have a name is not decided here. WAI-ARIA decides it
//! by role ("Accessible Name Required", in the role table in
//! `accessibility.rs`), and LO-TEK where its components demand more, or give
//! the name themselves (`name` on an element or a part in the manifest). The
//! name is computed by the same model `check-accessibility-tree.ts` compares
//! with the browsers, here on the markup as it is written
//! ([`Markup`](crate::accessibility::Markup)). The rule reports only a name
//! the markup certainly does not give: where a binding, a template or another
//! part of the page could give one, the model says it cannot tell, and the
//! rule says nothing.
//!
//! The rule looks at LO-TEK's own: an element or a class from the manifest,
//! and what is inside a component. It also looks at every `<button>` and
//! `<a href>`, with or without LO-TEK's classes: a button with only an icon is
//! the commonest way to lose a name.

use std::collections::HashSet;

use crate::accessibility::{name_required, Markup, MarkupNames, Name};
use crate::parts::{host_content, matches, parse, templated_host};
use crate::references::{has_class, value, Node};
use crate::text::*;
use crate::types::*;

const ICON_LINK: &str = "https://lo-tek.sobernetics.no/components/icon/";

const HOW: &str = "Write for on the label and id on the field in the template, or put the label around the field. If the markup is built with JavaScript, lt.field({ id }) does it.";

/// The roles of the fields: their name is a label.
const FIELDS: &[&str] = &[
    "checkbox",
    "combobox",
    "listbox",
    "radio",
    "searchbox",
    "slider",
    "spinbutton",
    "switch",
    "textbox",
];

pub(crate) fn check_names(
    source: &[u16],
    vocabulary: &Vocabulary,
    nodes: &[Node],
    page: bool,
) -> Vec<Finding> {
    let mut attributes: Vec<String> = vocabulary
        .elements
        .iter()
        .flat_map(|e| e.attributes.iter().map(|(n, _)| n.clone()))
        .chain(
            vocabulary
                .classes
                .iter()
                .flat_map(|c| c.attributes.iter().map(|(n, _)| n.clone())),
        )
        .collect();
    attributes.sort();
    attributes.dedup();
    let names = MarkupNames::new(
        source,
        Markup {
            page,
            elements: vocabulary.elements.iter().map(|e| e.tag.clone()).collect(),
            attributes,
        },
    );
    let index = |n: usize| names.at(nodes[n].name_start);
    let mut out = Vec::new();
    // The elements LO-TEK's own demands cover, so WAI-ARIA's do not report
    // them a second time.
    let mut done: HashSet<usize> = HashSet::new();

    let kinds = vocabulary
        .elements
        .iter()
        .map(|e| Kind {
            name: &e.tag,
            element: true,
            link: &e.link,
            parts: &e.parts,
            named: e.named.as_ref(),
        })
        .chain(vocabulary.classes.iter().map(|c| Kind {
            name: &c.name,
            element: false,
            link: &c.link,
            parts: &c.parts,
            named: c.named.as_ref(),
        }));
    for kind in kinds {
        let duties: Vec<(Option<usize>, &Named)> = kind
            .named
            .map(|n| (None, n))
            .into_iter()
            .chain(
                kind.parts
                    .iter()
                    .enumerate()
                    .filter_map(|(k, p)| p.named.as_ref().map(|n| (Some(k), n))),
            )
            .collect();
        if duties.is_empty() || !contains_ci(source, kind.name) {
            continue;
        }
        let is_host = |n: &Node| {
            if kind.element {
                n.name == kind.name
            } else {
                has_class(n, |c| equals(c, kind.name))
            }
        };
        let parsed: Vec<_> = kind.parts.iter().map(|p| parse(&p.selector)).collect();
        for h in (0..nodes.len()).filter(|&h| is_host(&nodes[h])) {
            let own = host_content(source, nodes, h, &is_host);
            if let Some((own, range)) = &own {
                // The template decides the markup in the host: no rule
                // judges it, WAI-ARIA's below neither.
                if templated_host(source, nodes, own, *range) {
                    done.insert(h);
                    done.extend(own.iter().copied());
                    continue;
                }
            }
            let own = own.map(|(own, _)| own).unwrap_or_default();
            let part = |k: usize| -> Vec<usize> {
                match &parsed[k] {
                    Some(list) => own
                        .iter()
                        .copied()
                        .filter(|&n| matches(nodes, n, h, list))
                        .collect(),
                    None => Vec::new(),
                }
            };
            for (k, named) in &duties {
                let targets = match k {
                    None => vec![h],
                    Some(k) => part(*k),
                };
                for n in targets {
                    let Some(i) = index(n) else { continue };
                    done.insert(n);
                    if named.component {
                        continue;
                    }
                    if names.aria_hidden(i) || names.name(i) != Name::Missing {
                        continue;
                    }
                    // Empty: the content comes later, like an error summary
                    // the server fills when the form fails.
                    if names.empty(i) {
                        continue;
                    }
                    let from = named
                        .after
                        .as_ref()
                        .and_then(|from| kind.parts.iter().position(|p| &p.name == from));
                    if let Some(f) = from {
                        // The part names it when it has a name, or is empty
                        // and filled later.
                        let gives = part(f).into_iter().next().is_some_and(|s| {
                            let id = value(&nodes[s], "id")
                                .and_then(|a| a.non_empty_value())
                                .is_some();
                            index(s).is_some_and(|j| names.referenced(j) != Name::Missing)
                                && (!named.id || id)
                        });
                        if gives {
                            continue;
                        }
                    }
                    let role = names.role(i).unwrap_or("generic");
                    out.push(finding(
                        source,
                        icon_inside(nodes, n),
                        &nodes[n],
                        role,
                        Some((&kind, *k, from)),
                        named,
                        kind.link,
                    ));
                }
            }
        }
    }

    let hosts: Vec<&str> = vocabulary.elements.iter().map(|e| e.tag.as_str()).collect();
    for (n, node) in nodes.iter().enumerate() {
        if done.contains(&n) {
            continue;
        }
        let class = own_class(vocabulary, node);
        let ours = has_class(node, |c| starts_at(c, 0, "lt-"))
            || hosts.contains(&node.name.as_str())
            || within(nodes, n, |m| hosts.contains(&m.name.as_str()))
            || node.name == "button"
            || (node.name == "a" && value(node, "href").is_some());
        if !ours {
            continue;
        }
        let Some(i) = index(n) else { continue };
        if names.aria_hidden(i) {
            continue;
        }
        let Ok(role) = names.role(i) else { continue };
        if !name_required(role) {
            continue;
        }
        // Empty: filled later, by the server or a script.
        if names.empty(i) {
            continue;
        }
        if names.name(i) != Name::Missing {
            continue;
        }
        let link = class
            .map(|c| c.link.clone())
            .or_else(|| {
                nearest_host(nodes, n, &hosts)
                    .and_then(|t| vocabulary.elements.iter().find(|e| e.tag == t))
                    .map(|e| e.link.clone())
            })
            .unwrap_or_else(|| ICON_LINK.to_string());
        out.push(finding(
            source,
            icon_inside(nodes, n),
            node,
            role,
            None,
            &Named {
                after: None,
                id: false,
                component: false,
            },
            &link,
        ));
    }
    out
}

/// An element or a class from the manifest, as a host of parts.
struct Kind<'a> {
    name: &'a str,
    element: bool,
    link: &'a str,
    parts: &'a [Part],
    named: Option<&'a Named>,
}

/// The node itself or an ancestor that meets the condition, not counting the node.
fn within(nodes: &[Node], n: usize, test: impl Fn(&Node) -> bool) -> bool {
    let mut p = nodes[n].parent;
    while let Some(i) = p {
        if test(&nodes[i]) {
            return true;
        }
        p = nodes[i].parent;
    }
    false
}

fn nearest_host<'a>(nodes: &'a [Node], n: usize, hosts: &[&str]) -> Option<&'a str> {
    let mut p = Some(n);
    while let Some(i) = p {
        if hosts.contains(&nodes[i].name.as_str()) {
            return Some(&nodes[i].name);
        }
        p = nodes[i].parent;
    }
    None
}

/// The first of LO-TEK's classes on the node.
fn own_class<'a>(vocabulary: &'a Vocabulary, node: &Node) -> Option<&'a Class> {
    let classes = value(node, "class").and_then(|a| a.value.as_deref())?;
    words(classes)
        .iter()
        .find_map(|(_, c)| vocabulary.classes.iter().find(|k| equals(c, &k.name)))
}

/// What goes after an inserted label: the line break and the space before
/// the tag, when the tag starts its line, and nothing when it does not.
fn indent_before(source: &[u16], at: usize) -> String {
    let line = (0..at)
        .rev()
        .find(|&k| source[k] == b'\n' as u16 || source[k] == b'\r' as u16);
    match line {
        Some(line) if source[line + 1..at].iter().all(|&c| is_space(c)) => lossy(&source[line..at]),
        _ => String::new(),
    }
}

/// Whether there is an icon in the node: an `<svg>`, an `<img>` or `lt-icon`.
fn icon_inside(nodes: &[Node], n: usize) -> bool {
    (n + 1..nodes.len())
        .take_while(|&m| {
            let mut p = nodes[m].parent;
            while let Some(i) = p {
                if i == n {
                    return true;
                }
                p = nodes[i].parent;
            }
            false
        })
        .any(|m| {
            matches!(nodes[m].name.as_str(), "svg" | "img")
                || has_class(&nodes[m], |c| equals(c, "lt-icon"))
        })
}

#[allow(clippy::too_many_arguments)]
fn finding(
    source: &[u16],
    has_icon: bool,
    node: &Node,
    role: &str,
    part: Option<(&Kind, Option<usize>, Option<usize>)>,
    named: &Named,
    link: &str,
) -> Finding {
    let tag = node.name.as_str();
    let aria_label = |text: &str| {
        Some(Fix::one(
            "Give it a name with aria-label".into(),
            node.name_end,
            node.name_end,
            format!(" aria-label=\"{text}\""),
            true,
        ))
    };
    let field = FIELDS.contains(&role) && matches!(tag, "input" | "select" | "textarea");
    let icon = has_icon;
    let (message, fix) = if let (Some((kind, k, from)), false) = (part, field) {
        let host = if kind.element {
            format!("<{}>", kind.name)
        } else {
            format!("<{tag}> with {}", kind.name)
        };
        let from = from.map(|f| kind.parts[f].name.as_str());
        match k {
            None if role == "group" => (
                format!(
                    "{host} is a group without a name: no <legend>, and no aria-label or aria-labelledby. A screen reader reads the options without saying what they choose between. Give it a <legend>; it can be hidden with lt-sr-only."
                ),
                None,
            ),
            Some(k) if kind.name == "lt-tabs" && kind.parts[k].name == "list" => (
                format!(
                    "{host} has a tab list without a name. Write aria-label on .lt-tabs__list, like aria-label=\"Case sections\", or aria-labelledby pointing at a heading. Without a name the screen reader only says \"tab list\"."
                ),
                Some(Fix::one(
                    "Give the tab list a name with aria-label".into(),
                    node.name_end,
                    node.name_end,
                    " aria-label=\"Case sections\"".into(),
                    true,
                )),
            ),
            None if named.id => (
                format!(
                    "{host} has no name: no aria-label or aria-labelledby, and no {} with an id for the component to point aria-labelledby at. It takes focus as an alert a screen reader cannot name. Give the heading an id and the box aria-labelledby pointing at it, as lt.errorSummary({{ id }}) does.",
                    from.unwrap_or("heading")
                ),
                None,
            ),
            _ => (
                format!(
                    "<{tag}> in {host} has no name: no aria-labelledby, no aria-label{}. A screen reader announces it as \"{role}\" without saying what it is about. {}",
                    from.map_or(String::new(), |f| format!(
                        ", and no {f} with text for the component to name it after"
                    )),
                    if let Some(f) = from {
                        format!("Give it a {f}, or aria-label.")
                    } else {
                        "Give it aria-label, or aria-labelledby pointing at a heading.".to_string()
                    }
                ),
                aria_label("Describe it"),
            ),
        }
    } else if field {
        let id = value(node, "id").and_then(|a| a.non_empty_value());
        let fix = id.map(|id| {
            let start = node.name_start - 1;
            let indent = indent_before(source, start);
            Fix::one(
                "Add a label".into(),
                start,
                start,
                format!("<label for=\"{}\">Label</label>{indent}", lossy(id)),
                true,
            )
        });
        (
            format!(
                "<{tag}> has no label: no <label for> pointing at it, no <label> around it, and no aria-label or aria-labelledby. A screen reader announces the field without a name. {HOW}"
            ),
            fix,
        )
    } else if matches!(role, "button" | "link") && icon {
        (
            format!(
                "<{tag}> has only an icon in it and no name: no text, and no aria-label, aria-labelledby or title. A screen reader announces it as \"{role}\" without saying what it does. Give it an aria-label, or a text in an element with the class lt-sr-only."
            ),
            aria_label("Describe the action"),
        )
    } else if matches!(role, "button" | "link") {
        (
            format!(
                "<{tag}> has no name: no text, and no aria-label, aria-labelledby or title. A screen reader announces it as \"{role}\" without saying what it does. Give it an aria-label, or a text in an element with the class lt-sr-only next to the icon."
            ),
            aria_label("Describe the action"),
        )
    } else if role == "table" {
        (
            format!(
                "<{tag}> has no name: no <caption>, aria-label or aria-labelledby. A screen reader announces it as \"table\" without saying what is in it. Give it a <caption>."
            ),
            None,
        )
    } else if role == "img" {
        (
            format!(
                "<{tag}> has no text alternative. A screen reader announces it as \"image\", or reads the file name. Give it alt, or alt=\"\" when it is only decoration."
            ),
            None,
        )
    } else {
        (
            format!(
                "<{tag}> is a {role} without a name: no aria-label or aria-labelledby{}. A screen reader announces it as \"{role}\" without saying what it is. Give it aria-label, or aria-labelledby pointing at a heading.",
                if MarkupNames::from_content(role) {
                    ", and no text"
                } else {
                    ""
                }
            ),
            aria_label("Describe it"),
        )
    };
    Finding {
        start: node.name_start,
        end: node.name_end,
        severity: Severity::Error,
        link: link.to_string(),
        message,
        fix,
        rule: "without-name",
    }
}

#[cfg(test)]
mod tests {
    use crate::text::utf16;
    use crate::{diagnose_markup, diagnose_page, manifest};

    fn rules(found: Vec<crate::types::Finding>) -> Vec<String> {
        found
            .into_iter()
            .filter(|f| f.rule == "without-name")
            .map(|f| f.message)
            .collect()
    }

    fn markup(html: &str) -> Vec<String> {
        rules(diagnose_markup(&utf16(html), &manifest::for_tests()))
    }

    fn page(html: &str) -> Vec<String> {
        rules(diagnose_page(&utf16(html), &manifest::for_tests()))
    }

    #[test]
    fn the_tab_list_needs_a_name_from_lo_tek() {
        let tabs = |list: &str| {
            markup(&format!(
                r##"<lt-tabs><ul class="lt-tabs__list"{list}><li><a href="#a">A</a></li></ul><section id="a" class="lt-tabs__panel">x</section></lt-tabs>"##
            ))
        };
        let found = tabs("");
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].contains("tab list without a name"), "{found:?}");
        assert!(tabs(r#" aria-label="Case sections""#).is_empty());
        assert!(tabs(r#" aria-label="${label}""#).is_empty());
        // A heading elsewhere on the page can be what it points at.
        assert!(tabs(r#" aria-labelledby="t""#).is_empty());
    }

    #[test]
    fn the_dialog_is_named_after_its_heading_by_the_component() {
        let host = |inner: &str| markup(&format!("<lt-dialog>{inner}</lt-dialog>"));
        assert!(host(r#"<dialog class="lt-dialog"><h2>Delete?</h2></dialog>"#).is_empty());
        let found = host(r#"<dialog class="lt-dialog"><p>Delete?</p></dialog>"#);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].contains("no title with text"), "{found:?}");
        // Without the host nothing names it, and WAI-ARIA demands a name.
        assert_eq!(
            markup(r#"<dialog class="lt-dialog"><h2>Delete?</h2></dialog>"#).len(),
            1
        );
        assert!(markup(
            r#"<dialog class="lt-dialog" aria-labelledby="t"><h2 id="t">Delete?</h2></dialog>"#
        )
        .is_empty());
    }

    #[test]
    fn the_error_summary_needs_a_heading_with_an_id() {
        let summary = |inner: &str| {
            markup(&format!(
                "<lt-error-summary hidden>{inner}<ul><li><a href=\"#e\">Enter an email</a></li></ul></lt-error-summary>"
            ))
        };
        assert!(markup("<lt-error-summary hidden></lt-error-summary>").is_empty());
        let found = summary("<h2>There is a problem</h2>");
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].contains("with an id"), "{found:?}");
        assert!(summary(r#"<h2 id="errors-title">There is a problem</h2>"#).is_empty());
    }

    #[test]
    fn a_field_needs_a_label() {
        let whole = page(r#"<input class="lt-input">"#);
        assert_eq!(whole.len(), 1, "{whole:?}");
        assert!(whole[0].contains("has no label"));
        // In a piece of a page the label can be in another piece, with `for`
        // or around the template that includes it.
        assert!(markup(r#"<input class="lt-input" id="email">"#).is_empty());
        assert!(markup(r#"<input class="lt-checkbox" type="checkbox">"#).is_empty());
        assert_eq!(page(r#"<input class="lt-input" id="email">"#).len(), 1);
        for named in [
            r#"<label for="email">Email</label><input class="lt-input" id="email">"#,
            r#"<label>Email <input class="lt-input"></label>"#,
            r#"<input class="lt-input" aria-label="Email">"#,
            r#"<input class="lt-input" placeholder="Email">"#,
            r#"<input class="lt-input" type="hidden">"#,
            r#"<input class="lt-input" id="${id}">"#,
            r#"<label for="email" x-text="label"></label><input class="lt-input" id="email">"#,
        ] {
            assert!(page(named).is_empty(), "{named}: {:?}", page(named));
        }
        // A field without LO-TEK's classes is not the rule's business.
        assert!(page(r#"<input id="email">"#).is_empty());
    }

    #[test]
    fn the_fix_puts_a_label_before_the_field() {
        let html = "<lt-field>\n  <input class=\"lt-input\" id=\"email\">\n</lt-field>";
        let found = diagnose_page(&utf16(html), &manifest::for_tests());
        let fix = found
            .iter()
            .find(|f| f.rule == "without-name")
            .and_then(|f| f.fix.as_ref())
            .expect("a fix");
        assert_eq!(fix.edits[0].text, "<label for=\"email\">Label</label>\n  ");
    }

    #[test]
    fn svg_is_named_by_its_title() {
        assert!(markup(
            r#"<button><svg class="lt-icon"><title>Delete</title><path d="M0 0"/></svg></button>"#
        )
        .is_empty());
        assert_eq!(
            markup(
                r#"<button><svg class="lt-icon"><desc>Delete</desc><path d="M0 0"/></svg></button>"#
            )
            .len(),
            1
        );
    }

    #[test]
    fn what_the_markup_does_not_show_is_not_reported() {
        for html in [
            // Hidden for good.
            r#"<button aria-hidden="true"><svg class="lt-icon"></svg></button>"#,
            // A table without LO-TEK's class.
            "<table><tr><td>x</td></tr></table>",
            // A link without href is no link.
            r#"<a class="lt-link"><svg></svg></a>"#,
            // Filled later.
            r#"<a class="lt-link" href="/x"></a>"#,
        ] {
            assert!(markup(html).is_empty(), "{html}: {:?}", markup(html));
        }
    }

    #[test]
    fn what_a_component_or_template_may_name_is_not_reported() {
        for html in [
            // The template decides the markup in the host.
            r#"<lt-dialog><dialog class="lt-dialog">{% include 'title.html' %}<p>x</p></dialog></lt-dialog>"#,
            r#"<lt-dialog><dialog class="lt-dialog">${title("Delete?")}<p>x</p></dialog></lt-dialog>"#,
            // Template text where the caption would be.
            r#"<table class="lt-table">${caption}<tr><td>x</td></tr></table>"#,
            r#"<table class="lt-table">{{ template "caption" . }}<tr><td>x</td></tr></table>"#,
            r#"<table class="lt-table">{caption}<tr><td>x</td></tr></table>"#,
            // A framework's component renders what it likes.
            r#"<button class="lt-button"><svg class="lt-icon" aria-hidden="true"></svg><Label /></button>"#,
            r#"<a href="/"><Picture src={logo} alt="Home" /></a>"#,
            // The components name these themselves.
            r#"<lt-suggestion><label for="t">Breaker</label><input id="t" role="combobox"><ul class="lt-suggestion__list" role="listbox"><li role="option">Crowbar</li></ul></lt-suggestion>"#,
            r##"<lt-tabs><ul class="lt-tabs__list" aria-label="Parts"><li><a href="#a">A</a></li></ul><section id="a" class="lt-tabs__panel" role="tabpanel">x</section></lt-tabs>"##,
            // <lt-field> writes `for` from the id.
            r#"<lt-field><label>Email</label><input class="lt-input" id="email"></lt-field>"#,
            // SVG-AAM: a title names any element in an svg.
            r#"<button><svg><g><title>Delete</title><path d="M0 0"/></g></svg></button>"#,
        ] {
            assert!(page(html).is_empty(), "{html}: {:?}", page(html));
        }
    }

    #[test]
    fn a_long_form_is_read_in_time() {
        let rows: String = (0..2000)
            .map(|i| format!(r#"<tr><td><label class="lt-label">Status {i}</label></td><td><button class="lt-button">Edit</button></td></tr>"#))
            .collect();
        let started = std::time::Instant::now();
        page(&format!("<table><caption>Cases</caption>{rows}</table>"));
        assert!(started.elapsed().as_secs() < 5, "{:?}", started.elapsed());
    }

    #[test]
    fn lo_tek_tables_and_images_need_names() {
        let table = markup(r#"<table class="lt-table"><tr><td>x</td></tr></table>"#);
        assert_eq!(table.len(), 1, "{table:?}");
        assert!(table[0].contains("<caption>"));
        assert!(markup(
            r#"<table class="lt-table"><caption>Cases</caption><tr><td>x</td></tr></table>"#
        )
        .is_empty());
        assert!(markup(r#"<button><img src="x.png"></button>"#)
            .iter()
            .any(|m| m.contains("<button>")));
    }
}
