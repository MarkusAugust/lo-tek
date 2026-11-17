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
//! The manifest says the same to a design tool, as `forbids` on a hole in
//! an anatomy, from the same standard (`generate-manifest.ts`), and
//! `check-design-tool.ts` holds the two to each other.

use crate::references::{value, Node};
use crate::text::{equals, lowercase};
use crate::types::*;

const LINK: &str = "https://lo-tek.sobernetics.no/markup-and-behaviour/";

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

/// The ancestors of a node, nearest first.
fn ancestors(nodes: &[Node], n: usize) -> impl Iterator<Item = &Node> {
    std::iter::successors(nodes[n].parent, |&p| nodes[p].parent).map(move |p| &nodes[p])
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

pub(crate) fn check_nesting(nodes: &[Node]) -> Vec<Finding> {
    let mut findings = Vec::new();
    for (n, node) in nodes.iter().enumerate() {
        // What is inside a <template> is not in the document.
        if ancestors(nodes, n).any(|a| a.name == "template") {
            continue;
        }
        let tag = &node.name;
        if tag == "form" && ancestors(nodes, n).any(|a| a.name == "form") {
            findings.push(finding(
                node,
                "<form> is inside another <form>, which HTML does not allow: the browser drops the inner <form>, and its fields send with the outer one.".into(),
            ));
            continue;
        }
        let focusable = interactive(node) || value(node, "tabindex").is_some();
        // A link takes no other link either, with href or without.
        let around = ancestors(nodes, n).find(|a| {
            (a.name == "button" && focusable) || (a.name == "a" && (focusable || tag == "a"))
        });
        if let Some(around) = around {
            let outer = &around.name;
            findings.push(finding(
                node,
                format!("<{tag}> is inside <{outer}>, and nothing interactive may be inside a link or a button: the browser cannot tell which one is clicked, and a screen reader announces only the outer. Put it next to the <{outer}>."),
            ));
        }
    }
    findings
}
