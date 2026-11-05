//! `untranslated-text`: a text LO-TEK writes itself, in the language of
//! `textLanguage` in the manifest, on a page in another language.
//!
//! LO-TEK has almost no text of its own: whoever renders writes it. What is
//! left are the defaults a component writes when nobody has given it another
//! (`texts` on an element in the manifest, from `DEFAULT_TEXTS`), and the
//! texts a stylesheet shows (`texts` on a class, read from the CSS). On a
//! Norwegian page a screen reader then says "Notifications" or "(required)"
//! in the middle of Norwegian.
//!
//! The language is the nearest `lang`, as the components read it. Without
//! one, or with one from the template, the rule cannot tell, and says
//! nothing; the same goes for an element with a binding or a spread, which
//! can give it the attribute. A text is replaced by any of the attributes in
//! `replacedBy`, unless its value is the default itself, as `lt.toast()`
//! writes it without `label`. A stylesheet text is replaced when a style
//! sheet sets its variable, and is only checked when the style sheets are
//! given.

use crate::diagnose::is_templated_value;
use crate::references::{has_class, value, Node};
use crate::styles::Styles;
use crate::text::*;
use crate::types::*;

const LINK: &str = "https://lo-tek.sobernetics.no/translation/";

/// The page's language at the node, when the markup says it.
fn language(nodes: &[Node], n: usize) -> Option<String> {
    let mut at = Some(n);
    while let Some(i) = at {
        if let Some(lang) = value(&nodes[i], "lang") {
            let v = lang.value.as_deref().unwrap_or(&[]);
            if is_templated_value(v) {
                return None;
            }
            let primary = lossy(&lowercase(trimmed(v)));
            let primary = primary.split('-').next().unwrap_or("").to_string();
            // `lang=""` is "unknown" in HTML.
            return (!primary.is_empty()).then_some(primary);
        }
        at = nodes[i].parent;
    }
    None
}

/// Whether every attribute on the node is plain: a binding or a spread can
/// give it the attribute that replaces the text.
fn plain(node: &Node) -> bool {
    node.attributes.iter().all(|a| {
        a.name
            .iter()
            .all(|&c| c < 128 && ((c as u8).is_ascii_alphanumeric() || c == b'-' as u16))
    })
}

/// The language other than the texts', when the page has one.
fn foreign(nodes: &[Node], n: usize, vocabulary: &Vocabulary) -> Option<String> {
    let texts = vocabulary.text_language.as_deref()?;
    language(nodes, n).filter(|l| l != texts)
}

pub(crate) fn check_texts(nodes: &[Node], vocabulary: &Vocabulary) -> Vec<Finding> {
    let mut out = Vec::new();
    for element in vocabulary.elements.iter().filter(|e| !e.texts.is_empty()) {
        for (n, node) in nodes.iter().enumerate() {
            if node.name != element.tag || !plain(node) {
                continue;
            }
            let Some(lang) = foreign(nodes, n, vocabulary) else {
                continue;
            };
            let untranslated: Vec<&DefaultText> = element
                .texts
                .iter()
                .filter(|t| {
                    !t.replaced_by.iter().any(|a| {
                        value(node, a).is_some_and(|a| {
                            let v = a.value.as_deref().unwrap_or(&[]);
                            is_templated_value(v) || lossy(trimmed(v)) != t.text
                        })
                    })
                })
                .collect();
            if untranslated.is_empty() {
                continue;
            }
            let texts = untranslated
                .iter()
                .map(|t| format!("\"{}\"", t.text))
                .collect::<Vec<_>>()
                .join(", ");
            let how = untranslated
                .iter()
                .map(|t| t.replaced_by[0].as_str())
                .collect::<Vec<_>>()
                .join(", ");
            out.push(Finding {
                start: node.name_start,
                end: node.name_end,
                severity: Severity::Warning,
                link: LINK.into(),
                message: format!(
                    "<{}> is on a page in \"{lang}\", and writes its own text in \"{}\": {texts}. A screen reader reads it out in the middle of the page's language. Write {how} in the page's language.",
                    element.tag,
                    vocabulary.text_language.as_deref().unwrap_or("")
                ),
                fix: None,
                rule: "untranslated-text",
            });
        }
    }
    out
}

/// The nodes inside node `n`. The nodes are in document order, so they
/// follow it, and each has a parent at `n` or after it, up to the first that
/// does not.
fn subtree(nodes: &[Node], n: usize) -> &[Node] {
    let mut end = n + 1;
    while nodes
        .get(end)
        .is_some_and(|m| m.parent.is_some_and(|p| p >= n && p < end))
    {
        end += 1;
    }
    &nodes[n + 1..end]
}

pub(crate) fn check_css_texts(
    nodes: &[Node],
    vocabulary: &Vocabulary,
    styles: &Styles,
) -> Vec<Finding> {
    let mut out = Vec::new();
    for class in vocabulary.classes.iter().filter(|c| !c.texts.is_empty()) {
        for (n, node) in nodes.iter().enumerate() {
            if !has_class(node, |c| equals(c, &class.name)) || !plain(node) {
                continue;
            }
            for text in &class.texts {
                if styles.variables.contains(&text.variable) {
                    continue;
                }
                let carries = |node: &Node| {
                    value(node, &text.attribute).is_some_and(|a| match &text.value {
                        None => true,
                        Some(wanted) => a
                            .value
                            .as_deref()
                            .is_some_and(|v| lossy(trimmed(v)) == *wanted),
                    })
                };
                let inside = subtree(nodes, n);
                // On the children before the one with the attribute: shown
                // when a child other than the first carries it.
                let shown = if text.siblings_before {
                    inside
                        .iter()
                        .filter(|m| m.parent == Some(n))
                        .skip(1)
                        .any(carries)
                } else {
                    carries(node)
                };
                let sets = |m: &Node| {
                    value(m, "style")
                        .and_then(|a| a.value.as_deref())
                        .is_some_and(|v| lossy(v).contains(&text.variable))
                };
                // On the element or above it, and for a text on the children
                // also inside it, where the children are.
                let set_inline = std::iter::successors(Some(n), |&i| nodes[i].parent)
                    .any(|i| sets(&nodes[i]))
                    || text.siblings_before && inside.iter().any(sets);
                if !shown || set_inline || text.unless.iter().any(|u| value(node, u).is_some()) {
                    continue;
                }
                let Some(lang) = foreign(nodes, n, vocabulary) else {
                    continue;
                };
                out.push(Finding {
                    start: node.name_start,
                    end: node.name_end,
                    severity: Severity::Warning,
                    link: LINK.into(),
                    message: format!(
                        "<{}> is on a page in \"{lang}\", and the stylesheet shows \"{}\" with it, in \"{}\", which a screen reader reads out. Set {} in the page's language in a stylesheet of your own.",
                        node.name,
                        text.text.trim(),
                        vocabulary.text_language.as_deref().unwrap_or(""),
                        text.variable
                    ),
                    fix: None,
                    rule: "untranslated-text",
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use crate::styles::read_styles;
    use crate::text::utf16;
    use crate::{diagnose_markup, diagnose_page, manifest};

    fn rules(found: Vec<crate::types::Finding>) -> Vec<String> {
        found
            .into_iter()
            .filter(|f| f.rule == "untranslated-text")
            .map(|f| f.message)
            .collect()
    }

    fn page(html: &str) -> Vec<String> {
        rules(diagnose_page(&utf16(html), &manifest::for_tests()))
    }

    #[test]
    fn warns_about_the_default_texts_on_a_page_in_another_language() {
        let found = page(r#"<html lang="nb"><body><lt-toast></lt-toast></body></html>"#);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].contains("\"Notifications\""), "{found:?}");
        assert!(found[0].contains("\"Close message\""), "{found:?}");
        assert!(found[0].contains("\"nb\""), "{found:?}");
        for quiet in [
            r#"<html lang="en"><lt-toast></lt-toast></html>"#,
            r#"<html lang="en-GB"><lt-toast></lt-toast></html>"#,
            "<lt-toast></lt-toast>",
            r#"<html lang="${locale}"><lt-toast></lt-toast></html>"#,
            r#"<html lang="nb"><lt-toast label="Varsler" close-label="Lukk"></lt-toast></html>"#,
            r#"<html lang="nb"><lt-toast aria-label="Varsler" close-label="${t('lukk')}"></lt-toast></html>"#,
            r#"<html lang="nb"><lt-toast {...props}></lt-toast></html>"#,
            r#"<div lang="en"><lt-toast></lt-toast></div>"#,
        ] {
            assert!(page(quiet).is_empty(), "{quiet}: {:?}", page(quiet));
        }
        // `lt.toast()` without `label` writes the default itself.
        let builder = page(
            r#"<html lang="nn"><lt-toast aria-label="Notifications" close-label="Lukk"></lt-toast></html>"#,
        );
        assert_eq!(builder.len(), 1, "{builder:?}");
        assert!(!builder[0].contains("Close message"), "{builder:?}");
        // The nearest lang counts.
        assert_eq!(
            page(r#"<html lang="en"><section lang="nb"><lt-connection-status></lt-connection-status></section></html>"#).len(),
            1
        );
    }

    #[test]
    fn a_count_is_replaced_by_its_form_or_the_other_form() {
        let suggestion = |attributes: &str| {
            page(&format!(
                r#"<html lang="nb"><lt-suggestion{attributes}><input></lt-suggestion></html>"#
            ))
        };
        assert!(suggestion(r#" count-none="Ingen treff" count-other="{n} treff""#).is_empty());
        let one = suggestion(r#" count-none="Ingen treff" count-one="Ett treff""#);
        assert_eq!(one.len(), 1, "{one:?}");
        assert!(
            one[0].contains("{n} matches") && !one[0].contains("One match"),
            "{one:?}"
        );
    }

    #[test]
    fn warns_about_the_stylesheets_texts_until_a_variable_replaces_them() {
        let vocabulary = manifest::for_tests();
        let html = utf16(
            r#"<html lang="nb"><label class="lt-label" for="a" data-required="text">Navn</label><label class="lt-label" for="b" data-required>Navn</label></html>"#,
        );
        let check = |css: &str| -> Vec<String> {
            rules(crate::diagnose::check_styles(
                &html,
                &vocabulary,
                &read_styles(css),
            ))
        };
        let found = check(".lt-label { color: red }");
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].contains("--lt-label-required-text"), "{found:?}");
        assert!(check(r#":root { --lt-label-required-text: " (påkrevd)"; }"#).is_empty());
        // What the stylesheet does not show, and a variable set on the page.
        let quiet = |html: &str| {
            rules(crate::diagnose::check_styles(
                &utf16(html),
                &vocabulary,
                &read_styles(".lt-label { color: red }"),
            ))
        };
        assert!(quiet(r#"<html lang="nb"><label class="lt-label" data-optional data-required>Navn</label></html>"#).is_empty());
        assert!(quiet(r#"<html lang="nb" style="--lt-label-required-text: ' (påkrevd)'"><label class="lt-label" data-required="text">Navn</label></html>"#).is_empty());
        assert_eq!(
            quiet(r#"<html lang="nb"><label class="lt-label" data-optional>Navn</label></html>"#)
                .len(),
            1
        );
        // Without the style sheets the rule cannot tell.
        assert!(rules(diagnose_markup(&html, &vocabulary)).is_empty());
    }

    #[test]
    fn warns_about_a_text_shown_on_the_children_before_the_one_with_the_attribute() {
        // The done steps say "Completed ", and they are the steps before the
        // one with `aria-current="step"`.
        let vocabulary = manifest::for_tests();
        let check = |html: &str, css: &str| -> Vec<String> {
            rules(crate::diagnose::check_styles(
                &utf16(html),
                &vocabulary,
                &read_styles(css),
            ))
        };
        let page = |steps: &str| {
            format!(
                r#"<html lang="nb"><ol class="lt-steps">{steps}</ol><p aria-current="step">Ute</p></html>"#
            )
        };
        let second = page(r#"<li><a href="/a">Sted</a></li><li aria-current="step">Vegger</li>"#);
        let found = check(&second, ".lt-steps { color: red }");
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].contains("--lt-steps-done-text"), "{found:?}");
        assert!(check(&second, r#":root { --lt-steps-done-text: "Fullført "; }"#).is_empty());
        for quiet in [
            // The first step is current, so no step is done.
            r#"<li aria-current="step">Sted</li><li>Vegger</li>"#,
            // No step is current, and the paragraph after the list is not a step.
            r#"<li>Sted</li><li>Vegger</li>"#,
            // On the link, not the step: the stylesheet does not read it there.
            r#"<li>Sted</li><li><a href="/b" aria-current="step">Vegger</a></li>"#,
        ] {
            let found = check(&page(quiet), ".lt-steps { color: red }");
            assert!(found.is_empty(), "{quiet}: {found:?}");
        }
        // The variable set on a step, where the text is shown.
        let on_step = page(
            r#"<li style="--lt-steps-done-text: 'Fullført '"><a href="/a">Sted</a></li><li aria-current="step">Vegger</li>"#,
        );
        assert!(check(&on_step, ".lt-steps { color: red }").is_empty());
        // But not on an element after the list.
        let after = format!(
            r#"{}<p style="--lt-steps-done-text: 'Fullført '">Ute</p>"#,
            second.trim_end_matches("</html>")
        );
        assert_eq!(
            check(&format!("{after}</html>"), ".lt-steps { color: red }").len(),
            1
        );
        let on_list =
            r#"<html lang="nb"><ol class="lt-steps" aria-current="step"><li>Sted</li></ol></html>"#;
        assert!(check(on_list, ".lt-steps { color: red }").is_empty());
    }
}
