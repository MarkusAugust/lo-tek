//! `invalid-nesting`: an element where HTML does not allow it.
//!
//! Only what the HTML standard forbids, never a choice of LO-TEK's: a
//! developer may write any valid HTML. The content models (documented):
//! a form has "no form element descendants" (4.10.3); a link has "no
//! interactive content descendant, a element descendant, or descendant
//! with the tabindex attribute specified" (4.5.1), and a button the same
//! without the `a` (4.10.6). The interactive elements are those of
//! 3.2.5.2.7.
//!
//! The source is read as written, not as a template renders it. Where a
//! template condition stands between the two elements, as an `<a>` in each
//! branch of an if and an else, only one may be written, and the rule says
//! nothing.
//!
//! The manifest says the same about a form to a design tool, as `forbids`
//! on a hole in an anatomy (`generate-manifest.ts`), and
//! `check-design-tool.ts` holds the two to each other.

use crate::diagnose::{is_templated_content, tag_end};
use crate::references::{value, Node};
use crate::text::{contains_str, equals, lowercase};
use crate::types::*;

const LINK: &str = "https://lo-tek.sobernetics.no/markup-and-behaviour/";

/// The attributes and blocks that leave an element out in a template
/// language: Thymeleaf, Vue, Angular, Alpine and Svelte. Not one that only
/// hides it, as `v-show` or `data-show`: the element is still there.
const CONDITIONS: &[&str] = &[
    "th:if",
    "th:unless",
    "th:switch",
    "v-if",
    "v-else",
    "*ngif",
    "x-if",
    "{#if",
    "{:else",
];

/// Interactive content, 3.2.5.2.7 in the HTML standard.
fn interactive(node: &Node) -> bool {
    match node.name.as_str() {
        "a" => value(node, "href").is_some(),
        "audio" | "video" => value(node, "controls").is_some(),
        "img" => value(node, "usemap").is_some(),
        "input" => value(node, "type")
            .and_then(|a| a.value.as_deref())
            .is_none_or(|t| !equals(&lowercase(t), "hidden")),
        "button" | "details" | "embed" | "iframe" | "label" | "select" | "textarea" => true,
        _ => false,
    }
}

/// What is around a node, carried down from its parent: whether it is in a
/// `<template>`, and the nearest form, link and button.
#[derive(Clone, Copy, Default)]
struct Around {
    template: bool,
    form: Option<usize>,
    link: Option<usize>,
    button: Option<usize>,
}

fn finding(node: &Node, message: String) -> Finding {
    Finding {
        start: node.name_start,
        end: node.name_end,
        severity: Severity::Error,
        link: LINK.into(),
        message,
        fix: None,
        rule: "invalid-nesting",
    }
}

pub(crate) fn check_nesting(source: &[u16], nodes: &[Node]) -> Vec<Finding> {
    // Whether a template condition stands between the outer and the inner.
    let conditional = |outer: usize, inner: usize| {
        let (o, i) = (&nodes[outer], &nodes[inner]);
        // A condition on either tag, or anywhere between them.
        let to = tag_end(source, i.name_end).map_or(i.name_end, |e| e + 1);
        let tags = lowercase(&source[o.name_start..to]);
        // Template syntax only after the outer tag, so a value it binds, as
        // href="{{url}}", is not taken for a condition.
        let from = tag_end(source, o.name_end).map_or(o.name_end, |e| e + 1);
        let between = &source[from.min(i.name_start)..i.name_start];
        CONDITIONS.iter().any(|c| contains_str(&tags, c)) || is_templated_content(between)
    };
    let mut findings = Vec::new();
    // The nodes come in document order, a parent before its children, so
    // one pass carries what is around each.
    let mut around: Vec<Around> = Vec::with_capacity(nodes.len());
    for (n, node) in nodes.iter().enumerate() {
        let outer = node.parent.map(|p| around[p]).unwrap_or_default();
        let tag = node.name.as_str();
        let mut here = Around {
            template: outer.template || tag == "template",
            ..outer
        };
        match tag {
            "form" => here.form = Some(n),
            "a" => here.link = Some(n),
            "button" => here.button = Some(n),
            _ => {}
        }
        around.push(here);
        // What is inside a <template> is not in the document.
        if outer.template {
            continue;
        }
        if tag == "form" {
            if outer.form.is_some_and(|f| !conditional(f, n)) {
                findings.push(finding(
                    node,
                    "<form> is inside another <form>, which HTML does not allow: the browser drops the inner <form>, and its fields send with the outer one.".into(),
                ));
            }
            continue;
        }
        let focusable = interactive(node) || value(node, "tabindex").is_some();
        // A link takes no other link either, with href or without.
        let link = outer.link.filter(|_| focusable || tag == "a");
        let button = outer.button.filter(|_| focusable);
        // The nearest of the two: the later in document order.
        let Some(container) = link.max(button) else {
            continue;
        };
        if conditional(container, n) {
            continue;
        }
        let outer = &nodes[container].name;
        findings.push(finding(
            node,
            format!("<{tag}> is inside <{outer}>, and nothing interactive may be inside a link or a button: the browser cannot tell which one is clicked, and a screen reader announces only the outer. Put it next to the <{outer}>."),
        ));
    }
    findings
}
