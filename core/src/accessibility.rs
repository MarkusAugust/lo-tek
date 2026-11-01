//! The accessibility tree a browser builds from a page: for every element
//! that is exposed, its role, name, description and states.
//!
//! What a screen reader is given is a function of the page, and the parts of
//! it the specifications define are computed here: the roles from HTML-AAM,
//! the name and description from AccName 1.2, the states from Core-AAM. The
//! rest is the browser's, and the core does not guess it:
//!
//! - **What the browser computed.** The core has no style engine, and cannot
//!   see focus or a field's value. The host, which has a browser, writes
//!   those facts on each element before it asks, under the names in
//!   [`FACTS`], which the host reads from here. An element without them is
//!   refused, never read as visible.
//! - **What the platform calls it.** The roles here are WAI-ARIA roles. The
//!   names AT-SPI gives them are in `platform.ts`, with the browsers'
//!   deviations, and nowhere else.
//! - **Timing and events.** Which events a change gives, and in what order,
//!   is the browser's.
//!
//! Where AccName leaves a choice to the browser, the choice here is the one
//! the browsers were seen to make, and `check-accessibility-tree.ts` compares
//! this tree with what Chromium and Firefox give through AT-SPI on every
//! contract step, so a browser that chooses otherwise fails the run. The one
//! such choice is the space around block-level content (accname issue #225).
//!
//! The page is read by [`walk`], the same reading the checks use.

use crate::diagnose::ReadAttribute;
use crate::json_string;
use crate::references::{decode, page_source, walk, Item};
use crate::text::*;

/// The facts the host writes on every element, from what the browser
/// computed. The host reads this list from the core (`accessibility_facts_raw`).
pub const FACTS: &[&str] = &[
    // "1" when the element is rendered and not `visibility: hidden`.
    "data-lt-ax-visible",
    // The computed `display`.
    "data-lt-ax-display",
    // The computed `content` of `::before` and `::after`.
    "data-lt-ax-before",
    "data-lt-ax-after",
    // "1" on the focused element, a checked or indeterminate checkbox or
    // radio, a disabled control, and a modal dialog.
    "data-lt-ax-focused",
    "data-lt-ax-checked",
    "data-lt-ax-mixed",
    "data-lt-ax-disabled",
    "data-lt-ax-modal",
    // The value of a text field, or the text of the chosen option.
    "data-lt-ax-value",
    // "1" on a field that fails a constraint other than being empty, or
    // matches `:user-invalid`, and on a chosen `<option>`.
    "data-lt-ax-invalid",
    "data-lt-ax-selected",
];

/// The states the core can give, by WAI-ARIA name. `platform.ts` maps each
/// to AT-SPI or says why it cannot be compared; a guard requires one or the
/// other for every name here.
pub const STATES: &[&str] = &[
    "busy",
    "checked",
    "disabled",
    "expandable",
    "expanded",
    "focused",
    "invalid",
    "mixed",
    "modal",
    "pressed",
    "readonly",
    "required",
    "selected",
];

/// One exposed element.
#[derive(Clone, Debug, PartialEq)]
pub struct AxNode {
    pub role: String,
    pub name: String,
    pub description: String,
    /// Core-AAM states, by their WAI-ARIA names, sorted.
    pub states: Vec<&'static str>,
    pub id: Option<String>,
}

/// A WAI-ARIA role the core knows, whether its name may come from its
/// content (WAI-ARIA 1.2, "Roles Supporting Name from Content"), and whether
/// it must have a name.
struct Role {
    name: &'static str,
    from_content: bool,
    /// WAI-ARIA 1.2, "Accessible Name Required: True" in the role's table.
    /// Documented: www.w3.org/TR/wai-aria-1.2/, read 2026-10-30.
    required: bool,
}

const fn role(name: &'static str, from_content: bool, required: bool) -> Role {
    Role {
        name,
        from_content,
        required,
    }
}

/// The roles the core knows. An explicit `role` with none of them is
/// refused: WAI-ARIA would fall back to the element's own role, and a tree
/// built on a fallback the author did not mean is a guess.
const ROLES: &[Role] = &[
    role("alert", false, false),
    role("application", false, true),
    role("alertdialog", false, true),
    role("article", false, false),
    role("banner", false, false),
    role("button", true, true),
    role("cell", true, false),
    role("checkbox", true, true),
    role("columnheader", true, true),
    role("combobox", false, true),
    role("complementary", false, false),
    role("contentinfo", false, false),
    role("definition", false, false),
    role("dialog", false, true),
    role("document", false, false),
    role("feed", false, false),
    role("figure", false, false),
    role("form", false, true),
    role("generic", false, false),
    // SVG-AAM: the `<svg>` root.
    role("graphics-document", false, false),
    role("grid", false, true),
    role("gridcell", true, false),
    role("group", false, false),
    role("heading", true, true),
    role("img", false, true),
    role("link", true, true),
    role("list", false, false),
    role("listbox", false, true),
    role("listitem", false, false),
    role("log", false, false),
    role("main", false, false),
    role("meter", false, true),
    role("marquee", false, true),
    role("menu", false, false),
    role("menubar", false, false),
    role("menuitem", true, true),
    role("menuitemcheckbox", true, true),
    role("menuitemradio", true, true),
    role("navigation", false, false),
    role("none", false, false),
    role("note", false, false),
    role("option", true, true),
    role("paragraph", false, false),
    role("presentation", false, false),
    role("progressbar", false, true),
    role("radio", true, true),
    role("radiogroup", false, true),
    role("region", false, true),
    role("row", true, false),
    role("rowgroup", false, false),
    role("rowheader", true, true),
    role("search", false, false),
    role("searchbox", false, true),
    role("separator", false, false),
    role("slider", false, true),
    role("spinbutton", false, true),
    role("status", false, false),
    role("switch", true, true),
    role("tab", true, false),
    role("table", false, true),
    role("tablist", false, false),
    role("term", true, false),
    role("tabpanel", false, true),
    role("textbox", false, true),
    role("timer", false, false),
    role("toolbar", false, false),
    role("tooltip", true, true),
    role("tree", false, true),
    role("treegrid", false, true),
    role("treeitem", true, true),
];

/// The names of the roles the core knows, for the guard that every role in
/// `platform.ts` is one of them.
pub fn roles() -> Vec<&'static str> {
    ROLES.iter().map(|r| r.name).collect()
}

/// Whether WAI-ARIA requires a name for the role.
pub fn name_required(role: &str) -> bool {
    known(role).is_some_and(|r| r.required)
}

fn known(name: &str) -> Option<&'static Role> {
    ROLES.iter().find(|r| r.name == name)
}

#[derive(Debug)]
enum Kind {
    Element {
        name: String,
        attributes: Vec<(String, String)>,
    },
    Text(String),
}

#[derive(Debug)]
struct DomNode {
    kind: Kind,
    parent: Option<usize>,
    children: Vec<usize>,
}

/// The page as elements and text, with the attributes decoded, and where
/// the facts about it come from.
struct Dom {
    nodes: Vec<DomNode>,
    facts: Box<dyn Facts>,
    /// The first element with each id, as `getElementById` finds it.
    ids: std::collections::HashMap<String, usize>,
    /// Where each element's name starts in the source: element `i` from
    /// [`walk`] is node `i + 1`.
    starts: Vec<usize>,
    /// The labels of each labelable element, in tree order, found once:
    /// searching every label for every control was cubic on a long form.
    labels: std::collections::HashMap<usize, Vec<usize>>,
    /// The elements whose name is written with a capital letter, like
    /// `<Label />`: a component of a framework, which renders what it likes.
    cased: std::collections::HashSet<usize>,
}

impl Dom {
    /// The page as [`walk`] reads it from [`page_source`]: comments, raw
    /// text and template content are not part of it. Attribute values are
    /// read from the original text, which `page_source` blanks when they
    /// hold a `<`.
    fn parse(source: &[u16], facts: Box<dyn Facts>) -> Dom {
        let page = page_source(source);
        let (elements, items) = walk(&page);
        let value = |a: &ReadAttribute| {
            a.value.as_ref().map_or(String::new(), |v| {
                lossy(&decode(&source[a.value_start..a.value_start + v.len()]))
            })
        };
        // The document is node 0, element `i` is node `i + 1`.
        let mut nodes: Vec<DomNode> = Vec::with_capacity(elements.len() + 1);
        nodes.push(DomNode {
            kind: Kind::Element {
                name: "#document".into(),
                attributes: vec![],
            },
            parent: None,
            children: vec![],
        });
        for e in &elements {
            let mut attributes: Vec<(String, String)> = Vec::new();
            for a in &e.attributes {
                let name = lossy(&a.name);
                // HTML keeps the first of two attributes with the same name.
                if !attributes.iter().any(|(n, _)| *n == name) {
                    attributes.push((name, value(a)));
                }
            }
            nodes.push(DomNode {
                kind: Kind::Element {
                    name: e.name.clone(),
                    attributes,
                },
                parent: Some(e.parent.map_or(0, |p| p + 1)),
                children: vec![],
            });
        }
        for item in items {
            match item {
                Item::Element(i) => {
                    let parent = nodes[i + 1].parent.unwrap_or(0);
                    nodes[parent].children.push(i + 1);
                }
                Item::Text { parent, start, end } => {
                    let parent = parent.map_or(0, |p| p + 1);
                    // The original text without its comments: `page_source`
                    // blanks a comment to spaces, and `Sa<!-- -->ve`, which
                    // React writes between two text nodes, is "Save".
                    let raw = matches!(
                        nodes[parent].kind,
                        Kind::Element { ref name, .. }
                            if matches!(name.as_str(), "script" | "style" | "template" | "textarea" | "title")
                    );
                    // Raw text and template content stay blank, as the
                    // page reads them.
                    let text = if raw {
                        page[start..end].to_vec()
                    } else {
                        without_comments(&source[start..end])
                    };
                    nodes.push(DomNode {
                        kind: Kind::Text(lossy(&decode(&text))),
                        parent: Some(parent),
                        children: vec![],
                    });
                    let index = nodes.len() - 1;
                    nodes[parent].children.push(index);
                }
            }
        }
        let mut ids = std::collections::HashMap::new();
        for (n, node) in nodes.iter().enumerate() {
            if let Kind::Element { attributes, .. } = &node.kind {
                if let Some((_, id)) = attributes.iter().find(|(k, _)| k == "id") {
                    ids.entry(id.clone()).or_insert(n);
                }
            }
        }
        let starts = elements.iter().map(|e| e.name_start).collect();
        let cased = elements
            .iter()
            .enumerate()
            .filter(|(_, e)| {
                // `<Label>` is a component; `<INPUT>` is HTML in capitals.
                let written = &source[e.name_start..e.name_end];
                let upper = |c: &u16| (b'A' as u16..=b'Z' as u16).contains(c);
                written.first().is_some_and(upper)
                    && !written
                        .iter()
                        .all(|c| upper(c) || !(b'a' as u16..=b'z' as u16).contains(c))
            })
            .map(|(i, _)| i + 1)
            .collect();
        let mut dom = Dom {
            nodes,
            facts,
            ids,
            starts,
            labels: std::collections::HashMap::new(),
            cased,
        };
        // HTML: a label with `for` labels the first element with that id,
        // when it is labelable; one without labels its first labelable
        // descendant.
        let mut labels: std::collections::HashMap<usize, Vec<usize>> =
            std::collections::HashMap::new();
        for l in (0..dom.nodes.len()).filter(|&l| dom.name(l) == Some("label")) {
            let target = match dom.attribute(l, "for") {
                Some(id) => dom.by_id(id),
                None => first_labelable(&dom, l),
            };
            if let Some(t) = target {
                labels.entry(t).or_default().push(l);
            }
        }
        dom.labels = labels;
        dom
    }

    fn attribute(&self, n: usize, name: &str) -> Option<&str> {
        match &self.nodes[n].kind {
            Kind::Element { attributes, .. } => attributes
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.as_str()),
            Kind::Text(_) => None,
        }
    }

    fn has(&self, n: usize, name: &str) -> bool {
        self.attribute(n, name).is_some()
    }

    fn name(&self, n: usize) -> Option<&str> {
        match &self.nodes[n].kind {
            Kind::Element { name, .. } => Some(name),
            Kind::Text(_) => None,
        }
    }

    fn by_id(&self, id: &str) -> Option<usize> {
        self.ids.get(id).copied()
    }

    fn ancestors(&self, n: usize) -> impl Iterator<Item = usize> + '_ {
        std::iter::successors(self.nodes[n].parent, move |&p| self.nodes[p].parent)
    }

    fn is_true(&self, n: usize, name: &str) -> bool {
        self.attribute(n, name)
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("true"))
    }

    fn fact(&self, n: usize, name: &str) -> bool {
        self.facts.flag(self, n, name)
    }
}

/// Where the facts come from: the port between the model and whatever
/// computed them.
///
/// [`Browser`] reads what a browser computed, which the host wrote on each
/// element. [`Markup`] has no browser: it reads the markup as it is written,
/// for `lotek check`, and answers "cannot tell" wherever something the core
/// does not run could give an element text.
trait Facts {
    /// Whether the element is rendered and not `visibility: hidden`.
    fn visible(&self, dom: &Dom, n: usize) -> Result<bool, String>;
    /// Whether the element is laid out as a block, which puts spaces around
    /// its text in a name.
    fn block(&self, dom: &Dom, n: usize) -> Result<bool, String>;
    /// The text CSS generates in `::before` or `::after`.
    fn generated(&self, dom: &Dom, n: usize, fact: &str) -> Result<String, String>;
    /// One of the "1" facts in [`FACTS`].
    fn flag(&self, dom: &Dom, n: usize, fact: &str) -> bool;
    /// The value of a field, or the text of the chosen option.
    fn value(&self, dom: &Dom, n: usize) -> Result<String, String>;
    /// Whether everything the element can say is in what the core reads.
    fn readable(&self, _dom: &Dom, _n: usize) -> Result<(), String> {
        Ok(())
    }
    /// A reference that finds no element.
    fn nowhere(&self, _what: &str) -> Result<(), String> {
        Ok(())
    }
    /// A control no label points at.
    fn unlabelled(&self, _dom: &Dom, _n: usize) -> Result<(), String> {
        Ok(())
    }
    /// What `aria-labelledby` points at. An empty label, legend or caption
    /// is not asked about: it is a mistake, not a text on its way.
    fn source(&self, _dom: &Dom, _n: usize) -> Result<(), String> {
        Ok(())
    }
}

/// The facts a browser computed, as the host wrote them under the names in
/// [`FACTS`]. An element without one is refused, never read as visible.
struct Browser;

impl Facts for Browser {
    fn visible(&self, dom: &Dom, n: usize) -> Result<bool, String> {
        match dom.attribute(n, "data-lt-ax-visible") {
            Some("1") => Ok(true),
            Some("0") => Ok(false),
            _ => Err(missing(dom.name(n).unwrap_or("?"), "data-lt-ax-visible")),
        }
    }

    fn block(&self, dom: &Dom, n: usize) -> Result<bool, String> {
        match dom.attribute(n, "data-lt-ax-display") {
            Some(d) => Ok(!matches!(d, "inline" | "contents" | "none")),
            None => Err(missing(dom.name(n).unwrap_or("?"), "data-lt-ax-display")),
        }
    }

    fn generated(&self, dom: &Dom, n: usize, fact: &str) -> Result<String, String> {
        browser_generated(dom, n, fact)
    }

    fn flag(&self, dom: &Dom, n: usize, fact: &str) -> bool {
        dom.attribute(n, fact) == Some("1")
    }

    fn value(&self, dom: &Dom, n: usize) -> Result<String, String> {
        dom.attribute(n, "data-lt-ax-value")
            .map(str::to_string)
            .ok_or_else(|| missing(dom.name(n).unwrap_or("?"), "data-lt-ax-value"))
    }
}

/// The markup as it is written, without a browser, for `lotek check`.
///
/// What it assumes, and so what a finding from it can claim: the elements
/// are shown unless `hidden` is on them or above them, a closed `<dialog>` or
/// popover as if it were open; CSS generates no text; a field's value is its
/// `value`. The space around block-level content is left out, which changes
/// the text of a name but never whether there is one, and the rule reads
/// only that.
///
/// It cannot tell, and says so, when an element carries anything other than
/// HTML, WAI-ARIA and LO-TEK's own attributes, since a binding like `x-text`,
/// `:aria-label`, `th:text`, `data-i18n` or `{...props}` can give it text; on
/// a custom element that is not LO-TEK's; and on a reference that finds no
/// element, which `id-not-found` reports.
pub(crate) struct Markup {
    /// The whole page. A piece of one can be labelled from another piece.
    pub page: bool,
    /// LO-TEK's elements and attributes, from the manifest.
    pub elements: Vec<String>,
    pub attributes: Vec<String>,
}

/// HTML's attributes, from the HTML Living Standard, "Index: Attributes".
/// Documented: html.spec.whatwg.org/multipage/indices.html#attributes-3,
/// read 2026-10-30, without `is` and `slot`, which can bring in content the
/// markup does not show.
const HTML_ATTRIBUTES: &[&str] = &[
    "abbr",
    "accept",
    "accept-charset",
    "accesskey",
    "action",
    "allow",
    "allowfullscreen",
    "alpha",
    "alt",
    "as",
    "async",
    "autocapitalize",
    "autocomplete",
    "autocorrect",
    "autofocus",
    "autoplay",
    "blocking",
    "charset",
    "checked",
    "cite",
    "class",
    "closedby",
    "color",
    "colorspace",
    "cols",
    "colspan",
    "command",
    "commandfor",
    "content",
    "contenteditable",
    "controls",
    "coords",
    "crossorigin",
    "data",
    "datetime",
    "decoding",
    "default",
    "defer",
    "dir",
    "dirname",
    "disabled",
    "download",
    "draggable",
    "enctype",
    "enterkeyhint",
    "fetchpriority",
    "for",
    "form",
    "formaction",
    "formenctype",
    "formmethod",
    "formnovalidate",
    "formtarget",
    "headers",
    "headingoffset",
    "headingreset",
    "height",
    "hidden",
    "high",
    "href",
    "hreflang",
    "http-equiv",
    "id",
    "imagesizes",
    "imagesrcset",
    "inert",
    "inputmode",
    "integrity",
    "ismap",
    "itemid",
    "itemprop",
    "itemref",
    "itemscope",
    "itemtype",
    "kind",
    "label",
    "lang",
    "list",
    "loading",
    "loop",
    "low",
    "max",
    "maxlength",
    "media",
    "method",
    "min",
    "minlength",
    "multiple",
    "muted",
    "name",
    "nomodule",
    "nonce",
    "novalidate",
    "open",
    "optimum",
    "pattern",
    "ping",
    "placeholder",
    "playsinline",
    "popover",
    "popovertarget",
    "popovertargetaction",
    "poster",
    "preload",
    "readonly",
    "referrerpolicy",
    "rel",
    "required",
    "reversed",
    "rows",
    "rowspan",
    "sandbox",
    "scope",
    "selected",
    "shadowrootclonable",
    "shadowrootcustomelementregistry",
    "shadowrootdelegatesfocus",
    "shadowrootmode",
    "shadowrootserializable",
    "shadowrootslotassignment",
    "shape",
    "size",
    "sizes",
    "span",
    "spellcheck",
    "src",
    "srcdoc",
    "srclang",
    "srcset",
    "start",
    "step",
    "style",
    "tabindex",
    "target",
    "title",
    "translate",
    "type",
    "usemap",
    "value",
    "width",
    "wrap",
    "writingsuggestions",
];

/// The DOM events a framework binds with `@`, as in Vue and Alpine.
const DOM_EVENTS: &[&str] = &[
    "blur",
    "change",
    "click",
    "dblclick",
    "focus",
    "focusin",
    "focusout",
    "input",
    "keydown",
    "keypress",
    "keyup",
    "mousedown",
    "mouseenter",
    "mouseleave",
    "mouseout",
    "mouseover",
    "mouseup",
    "pointerdown",
    "pointerup",
    "scroll",
    "submit",
    "toggle",
];

/// The SVG elements that are never rendered.
const SVG_UNRENDERED: &[&str] = &[
    "clippath",
    "defs",
    "desc",
    "filter",
    "lineargradient",
    "marker",
    "mask",
    "metadata",
    "pattern",
    "radialgradient",
    "script",
    "style",
    "symbol",
    "title",
];

fn in_svg(dom: &Dom, n: usize) -> bool {
    std::iter::once(n)
        .chain(dom.ancestors(n))
        .any(|a| dom.name(a) == Some("svg"))
}

/// A value from a template, like `${id}` or `{id}`.
fn templated(value: &str) -> bool {
    crate::diagnose::is_templated_value(&utf16(value))
}

impl Facts for Markup {
    fn visible(&self, dom: &Dom, n: usize) -> Result<bool, String> {
        let tag = dom.name(n).unwrap_or("");
        let unrendered = dom.has(n, "hidden")
            || matches!(tag, "script" | "style" | "template")
            || (in_svg(dom, n) && tag != "svg" && SVG_UNRENDERED.contains(&tag));
        if unrendered {
            return Ok(false);
        }
        dom.nodes[n].parent.map_or(Ok(true), |p| visible(dom, p))
    }

    fn block(&self, _dom: &Dom, _n: usize) -> Result<bool, String> {
        Ok(true)
    }

    fn generated(&self, _dom: &Dom, _n: usize, _fact: &str) -> Result<String, String> {
        Ok(String::new())
    }

    fn flag(&self, dom: &Dom, n: usize, fact: &str) -> bool {
        match fact {
            "data-lt-ax-disabled" => dom.has(n, "disabled"),
            "data-lt-ax-selected" => dom.has(n, "selected"),
            _ => false,
        }
    }

    fn value(&self, dom: &Dom, n: usize) -> Result<String, String> {
        let text = |n: usize| -> String {
            dom.nodes[n]
                .children
                .iter()
                .filter_map(|&c| match &dom.nodes[c].kind {
                    Kind::Text(t) => Some(t.as_str()),
                    Kind::Element { .. } => None,
                })
                .collect()
        };
        match dom.name(n) {
            Some("input") => Ok(dom.attribute(n, "value").unwrap_or("").to_string()),
            Some("textarea") => Ok(text(n)),
            Some("select") => {
                let options: Vec<usize> = (n + 1..dom.nodes.len())
                    .filter(|&o| dom.name(o) == Some("option") && dom.ancestors(o).any(|a| a == n))
                    .collect();
                let chosen = options
                    .iter()
                    .copied()
                    .find(|&o| dom.has(o, "selected"))
                    .or(options.first().copied());
                Ok(chosen.map(text).unwrap_or_default())
            }
            other => Err(format!(
                "<{}> has a value only a browser knows",
                other.unwrap_or("?")
            )),
        }
    }

    fn readable(&self, dom: &Dom, n: usize) -> Result<(), String> {
        let Kind::Element {
            name: tag,
            attributes,
        } = &dom.nodes[n].kind
        else {
            return Ok(());
        };
        if tag == "slot"
            || (tag.contains('-') && !self.elements.contains(tag))
            || dom.cased.contains(&n)
        {
            return Err(format!(
                "<{tag}> is not an element the core knows, and can put text on the page"
            ));
        }
        // Template text where the child that names the element would be,
        // like `${caption}` in a table, can be that child.
        let named_by_child =
            matches!(tag.as_str(), "table" | "fieldset" | "figure") || in_svg(dom, n);
        if named_by_child {
            let templated_text = dom.nodes[n]
                .children
                .iter()
                .any(|&c| match &dom.nodes[c].kind {
                    Kind::Text(t) => t.contains('{') || t.contains("<%") || templated(t),
                    Kind::Element { .. } => false,
                });
            if templated_text {
                return Err(format!(
                    "<{tag}> has text from the template, which can be what names it"
                ));
            }
        }
        let svg = in_svg(dom, n);
        for (name, value) in attributes {
            let plain = !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            let aria = name == "role"
                || name.starts_with("aria-")
                || name == "data-testid"
                || self.attributes.contains(name);
            // An event handler bound by a framework runs code on an event,
            // and gives no text: `@input`, `x-on:click`, `v-on:click`,
            // `on:click`, `(click)`. Only a DOM event after `@`: Razor's
            // `@attributes` spreads attributes, a name among them.
            let after_at = name
                .strip_prefix('@')
                .map(|e| e.split('.').next().unwrap_or(""));
            let event = after_at.is_some_and(|e| DOM_EVENTS.contains(&e))
                || ["x-on:", "v-on:", "on:"]
                    .iter()
                    .any(|p| name.starts_with(p))
                || (name.starts_with('(') && name.ends_with(')'));
            if event {
                continue;
            }
            // The prefixes the frameworks bind with, which SVG has none of.
            let bound = ["v-", "x-", "ng-", "hx-", "data-"]
                .iter()
                .any(|p| name.starts_with(p));
            let known = if svg {
                aria || (!bound
                    && !name.is_empty()
                    && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
                    || name.starts_with("xlink:")
                    || name.starts_with("xml:")
            } else {
                plain
                    && (aria
                        || (name.starts_with("on") && name.len() > 2)
                        || (HTML_ATTRIBUTES.contains(&name.as_str())
                            // `translate` takes "yes" or "no"; anything else is
                            // a key for a translation library.
                            && (name != "translate"
                                || matches!(value.trim(), "" | "yes" | "no"))))
            };
            if !known {
                return Err(format!(
                    "<{tag}> has {name}, which can give it text the markup does not show"
                ));
            }
            let points = matches!(
                name.as_str(),
                "id" | "for" | "aria-labelledby" | "role" | "type" | "hidden"
            );
            if points && templated(value) {
                return Err(format!("<{tag}> has {name} from the template"));
            }
        }
        Ok(())
    }

    fn nowhere(&self, what: &str) -> Result<(), String> {
        Err(format!("{what}, which is not in the markup"))
    }

    /// An empty one is filled later, by the server or a script, like the
    /// heading of an error summary before the form has failed.
    fn source(&self, dom: &Dom, n: usize) -> Result<(), String> {
        // An empty label, legend or caption is a mistake, wherever it is
        // asked about from.
        let labelling = matches!(dom.name(n), Some("label" | "legend" | "caption"));
        if !labelling && dom.nodes[n].children.is_empty() {
            return Err(format!(
                "<{}> is empty, and is filled later",
                dom.name(n).unwrap_or("?")
            ));
        }
        Ok(())
    }

    /// In a piece of a page, a field's label can be in another piece: one
    /// with `for` pointing at its id, or one around the template that
    /// includes it. A button's name is its content, which is here.
    fn unlabelled(&self, dom: &Dom, n: usize) -> Result<(), String> {
        let field = matches!(dom.name(n), Some("input" | "select" | "textarea"));
        if !self.page && field {
            return Err(format!(
                "<{}> can have its label in another part of the page",
                dom.name(n).unwrap_or("?")
            ));
        }
        Ok(())
    }
}

/// The role an element has: its first known `role` token, otherwise the
/// element's own from HTML-AAM.
fn role_of(dom: &Dom, n: usize) -> Result<&'static str, String> {
    if let Some(explicit) = dom.attribute(n, "role") {
        if !explicit.trim().is_empty() {
            let chosen = explicit
                .split_ascii_whitespace()
                .find_map(|t| known(&t.to_ascii_lowercase()).map(|r| r.name))
                .ok_or_else(|| {
                    format!(
                        "role=\"{explicit}\" has no role the core knows: it does not guess the fallback"
                    )
                })?;
            // WAI-ARIA 1.2, presentational role conflict: an element that
            // can take focus, or has a global aria-* attribute, keeps its own
            // role.
            if !(matches!(chosen, "none" | "presentation") && keeps_own_role(dom, n)) {
                return Ok(chosen);
            }
        }
    }
    let Some(name) = dom.name(n) else {
        return Ok("generic");
    };
    let input_type = || {
        dom.attribute(n, "type")
            .unwrap_or("text")
            .to_ascii_lowercase()
    };
    // SVG-AAM: the root is a graphics document; the shapes and groups in it
    // give no role a name needs, and their text is read as content.
    if name == "svg" {
        return Ok("graphics-document");
    }
    if in_svg(dom, n) && name != "a" {
        return Ok("generic");
    }
    Ok(match name {
        "a" | "area" if dom.has(n, "href") => "link",
        "button" => "button",
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => "heading",
        "ul" | "ol" | "menu" => "list",
        "li" => "listitem",
        "nav" => "navigation",
        "main" => "main",
        "p" => "paragraph",
        "dialog" => "dialog",
        "textarea" => "textbox",
        "select"
            if dom.has(n, "multiple")
                || dom
                    .attribute(n, "size")
                    .and_then(|v| v.trim().parse::<u32>().ok())
                    .is_some_and(|v| v > 1) =>
        {
            "listbox"
        }
        "select" => "combobox",
        "option" => "option",
        "fieldset" => "group",
        "progress" => "progressbar",
        "hr" => "separator",
        "article" => "article",
        "aside" => "complementary",
        "figure" => "figure",
        "table" => "table",
        "tr" => "row",
        "td" => "cell",
        "img" if dom.attribute(n, "alt") == Some("") => "presentation",
        "img" => "img",
        "section" if has_name_attribute(dom, n) => "region",
        "form" if has_name_attribute(dom, n) => "form",
        "search" => "search",
        "output" => "status",
        "details" => "group",
        "thead" | "tbody" | "tfoot" => "rowgroup",
        "th" => match dom.attribute(n, "scope").map(|v| v.to_ascii_lowercase()) {
            Some(v) if v == "row" || v == "rowgroup" => "rowheader",
            Some(v) if v == "col" || v == "colgroup" => "columnheader",
            // Without `scope`, browsers decide from the table's shape.
            _ => {
                return Err(
                    "<th> without scope: the browser decides from the table whether it heads a row or a column, and the core does not".into(),
                )
            }
        },
        // A header or footer is a landmark only outside sectioning content.
        "header" | "footer" => {
            let sectioned = dom.ancestors(n).any(|a| {
                matches!(
                    dom.name(a),
                    Some("article" | "aside" | "main" | "nav" | "section")
                )
            });
            match (name, sectioned) {
                (_, true) => "generic",
                ("header", false) => "banner",
                _ => "contentinfo",
            }
        }
        "input" => match input_type().as_str() {
            "checkbox" => "checkbox",
            "radio" => "radio",
            "button" | "submit" | "reset" | "image" => "button",
            "range" => "slider",
            "number" => "spinbutton",
            "search" if !dom.has(n, "list") => "searchbox",
            "hidden" => "none",
            _ if dom.has(n, "list") => "combobox",
            _ => "textbox",
        },
        // An autonomous custom element has no role of its own.
        tag if tag.contains('-') => "generic",
        tag if GENERIC.contains(&tag) => "generic",
        tag => {
            return Err(format!(
                "<{tag}> has a role the core does not know: it does not guess"
            ))
        }
    })
}

/// Elements HTML-AAM maps to `generic` or to no role, and the document's
/// own elements, which are not in the tree.
const GENERIC: &[&str] = &[
    "#document",
    "abbr",
    "address",
    "b",
    "bdi",
    "bdo",
    "body",
    "br",
    "caption",
    "cite",
    "code",
    "col",
    "colgroup",
    "data",
    "dd",
    "del",
    "dfn",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "form",
    "head",
    "html",
    "i",
    "ins",
    "kbd",
    "label",
    "legend",
    "link",
    "mark",
    "meta",
    "noscript",
    "picture",
    "pre",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "script",
    "section",
    "slot",
    "small",
    "source",
    "span",
    "strong",
    "style",
    "sub",
    "sup",
    "template",
    "time",
    "title",
    "track",
    "u",
    "var",
    "wbr",
    "a",
    "area",
    "img",
    "input",
    "select",
];

/// Whether an element with `role="none"` or `role="presentation"` keeps its
/// own role: it can take focus, or it has a global aria-* attribute.
fn keeps_own_role(dom: &Dom, n: usize) -> bool {
    // WAI-ARIA 1.2, "Global States and Properties", the deprecated ones too.
    const GLOBAL: &[&str] = &[
        "aria-atomic",
        "aria-busy",
        "aria-controls",
        "aria-current",
        "aria-describedby",
        "aria-details",
        "aria-disabled",
        "aria-dropeffect",
        "aria-errormessage",
        "aria-flowto",
        "aria-grabbed",
        "aria-haspopup",
        "aria-invalid",
        "aria-keyshortcuts",
        "aria-label",
        "aria-labelledby",
        "aria-live",
        "aria-owns",
        "aria-relevant",
        "aria-roledescription",
    ];
    // A disabled control takes no focus, and stays presentational.
    let disabled = matches!(
        dom.name(n),
        Some("button" | "select" | "textarea" | "input")
    ) && dom.fact(n, "data-lt-ax-disabled");
    let focusable = !disabled
        && (dom.has(n, "tabindex")
            || matches!(
                dom.name(n),
                Some("button" | "select" | "textarea" | "iframe" | "summary")
            )
            || (dom.name(n) == Some("a") && dom.has(n, "href"))
            || (dom.name(n) == Some("input")
                && !dom
                    .attribute(n, "type")
                    .is_some_and(|t| t.eq_ignore_ascii_case("hidden"))));
    focusable || GLOBAL.iter().any(|a| dom.has(n, a))
}

fn has_name_attribute(dom: &Dom, n: usize) -> bool {
    ["aria-label", "aria-labelledby", "title"]
        .iter()
        .any(|a| dom.attribute(n, a).is_some_and(|v| !v.trim().is_empty()))
}

/// Whether the element is rendered. Text is rendered when its parent is.
fn visible(dom: &Dom, n: usize) -> Result<bool, String> {
    // With scripting on, `<noscript>` is raw text that `outerHTML` writes out
    // as markup: none of it is rendered, and none of it has facts.
    if dom.name(n) == Some("noscript") || dom.ancestors(n).any(|a| dom.name(a) == Some("noscript"))
    {
        return Ok(false);
    }
    match dom.name(n) {
        None => dom.nodes[n].parent.map_or(Ok(true), |p| visible(dom, p)),
        Some("#document") => Ok(true),
        Some(_) => dom.facts.visible(dom, n),
    }
}

fn missing(tag: &str, fact: &str) -> String {
    format!(
        "<{tag}> has no {fact}: the core does not compute what the browser computes, the host writes it"
    )
}

fn block(dom: &Dom, n: usize) -> Result<bool, String> {
    dom.facts.block(dom, n)
}

/// Hidden from the tree: not rendered, or `aria-hidden="true"` on it or above it.
fn excluded(dom: &Dom, n: usize) -> Result<bool, String> {
    let aria_hidden = std::iter::once(n)
        .chain(dom.ancestors(n))
        .any(|a| dom.is_true(a, "aria-hidden"));
    Ok(aria_hidden || !visible(dom, n)?)
}

/// The text CSS generates in `::before` or `::after`, from the computed
/// `content`. Only a plain string is read: anything else is refused.
fn generated(dom: &Dom, n: usize, fact: &str) -> Result<String, String> {
    if is_replaced(dom, n) {
        return Ok(String::new());
    }
    dom.facts.generated(dom, n, fact)
}

/// A replaced element has no `::before` or `::after`.
fn is_replaced(dom: &Dom, n: usize) -> bool {
    // A replaced element has no `::before` or `::after` (CSS Pseudo-Elements
    // 4), whatever the browser's own value for it says: Firefox gives
    // `-moz-alt-content` on an image.
    matches!(
        dom.name(n),
        Some(
            "img"
                | "input"
                | "textarea"
                | "select"
                | "video"
                | "audio"
                | "iframe"
                | "object"
                | "embed"
                | "canvas"
                | "br"
                | "hr"
        )
    )
}

/// The computed `content` the host wrote, when it is a plain string.
fn browser_generated(dom: &Dom, n: usize, fact: &str) -> Result<String, String> {
    let Some(content) = dom.attribute(n, fact) else {
        return Err(missing(dom.name(n).unwrap_or("?"), fact));
    };
    let content = content.trim();
    if matches!(content, "" | "none" | "normal") {
        return Ok(String::new());
    }
    let quoted = content.len() >= 2
        && (content.starts_with('"') && content.ends_with('"')
            || content.starts_with('\'') && content.ends_with('\''));
    let inner = if quoted {
        &content[1..content.len() - 1]
    } else {
        ""
    };
    if !quoted || inner.contains(['"', '\'', '\\']) {
        return Err(format!(
            "<{}> has {fact}=\"{content}\": the core reads only a plain string",
            dom.name(n).unwrap_or("?")
        ));
    }
    Ok(inner.to_string())
}

#[derive(Clone, Copy, Default)]
struct Traversal {
    /// Computing a name from content, recursively (AccName 2F), or the
    /// content of a referenced node or a label.
    recursive: bool,
    /// Inside an `aria-labelledby` or `aria-describedby` traversal (2B).
    referenced: bool,
    /// The node the traversal started from was itself hidden, and so its
    /// hidden content counts (2A).
    hidden_root: bool,
}

/// Which step gave a name: `title` describes only when it did not name.
#[derive(Clone, Copy, PartialEq)]
enum From {
    Title,
    Other,
}

/// AccName 1.2, section 4.3.2, for the markup the core knows.
fn text_alternative(
    dom: &Dom,
    n: usize,
    t: Traversal,
    visited: &mut Vec<usize>,
) -> Result<(String, From), String> {
    if let Kind::Text(text) = &dom.nodes[n].kind {
        return Ok((text.clone(), From::Other));
    }
    // The cycle guard: a node is not part of its own content.
    if visited.contains(&n) {
        return Ok((String::new(), From::Other));
    }
    visited.push(n);
    let result = alternative(dom, n, t, visited);
    visited.pop();
    result
}

fn alternative(
    dom: &Dom,
    n: usize,
    t: Traversal,
    visited: &mut Vec<usize>,
) -> Result<(String, From), String> {
    // 2A: hidden, unless the traversal started at a hidden node.
    if !t.hidden_root && excluded(dom, n)? {
        return Ok((String::new(), From::Other));
    }
    dom.facts.readable(dom, n)?;
    let r = role_of(dom, n)?;
    let embedded = matches!(
        r,
        "textbox" | "searchbox" | "combobox" | "listbox" | "slider" | "spinbutton"
    );
    // 2B: aria-labelledby, unless already in such a traversal. A node may
    // name itself in the list, and is then computed from 2C on.
    if !t.referenced {
        if let Some(ids) = dom.attribute(n, "aria-labelledby") {
            let mut parts = Vec::new();
            for id in ids.split_ascii_whitespace() {
                let Some(target) = dom.by_id(id) else {
                    dom.facts
                        .nowhere(&format!("aria-labelledby points at \"{id}\""))?;
                    continue;
                };
                if target != n {
                    dom.facts.source(dom, target)?;
                }
                let traversal = Traversal {
                    recursive: target != n,
                    referenced: true,
                    hidden_root: excluded(dom, target)?,
                };
                let part = if target == n {
                    alternative(dom, n, traversal, visited)?.0
                } else {
                    text_alternative(dom, target, traversal, visited)?.0
                };
                parts.push(part);
            }
            let joined = flat(&parts.join(" "));
            if !joined.is_empty() {
                return Ok((joined, From::Other));
            }
        }
    }
    // 2C: aria-label, except on an embedded control inside a label, which
    // gives its value instead (2E).
    let in_label = t.recursive;
    if !(in_label && embedded) {
        if let Some(label) = dom.attribute(n, "aria-label") {
            if !ascii_trim(label).is_empty() {
                return Ok((ascii_trim(label).to_string(), From::Other));
            }
        }
    }
    // 2D: the host language's own label, unless the role is none or
    // presentation, also inside content (an image's `alt` in a link). An
    // embedded control inside a label goes to 2E instead: its own label is
    // the one being computed.
    if !(in_label && embedded) && !matches!(r, "presentation" | "none") {
        if let Some((native, from)) = native_label(dom, n, visited)? {
            if !native.is_empty() {
                return Ok((native, from));
            }
        }
    }
    // 2E: an embedded control inside a label gives its value.
    if in_label && embedded {
        return Ok((dom.facts.value(dom, n)?.trim().to_string(), From::Other));
    }
    // 2F: name from content.
    let from_content = known(r).is_some_and(|k| k.from_content);
    if t.recursive || t.referenced || from_content {
        let mut out = generated(dom, n, "data-lt-ax-before")?;
        for &c in &dom.nodes[n].children {
            let inner = Traversal {
                recursive: true,
                ..t
            };
            let (part, _) = text_alternative(dom, c, inner, visited)?;
            if dom.name(c) == Some("br") {
                out.push(' ');
            } else if dom.name(c).is_some() && block(dom, c)? {
                out.push(' ');
                out.push_str(&part);
                out.push(' ');
            } else {
                out.push_str(&part);
            }
        }
        out.push_str(&generated(dom, n, "data-lt-ax-after")?);
        let out = flat(&out);
        if !out.is_empty() {
            return Ok((out, From::Other));
        }
    }
    // 2I: the tooltip attribute.
    Ok(dom
        .attribute(n, "title")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map_or((String::new(), From::Other), |v| (v, From::Title)))
}

/// HTML-AAM's own labels: `<label>` for a form control, then `title`, then
/// `placeholder` for a text field; the value of a button input; `alt` on an
/// image; `<legend>`, `<caption>` and `<figcaption>`.
fn native_label(
    dom: &Dom,
    n: usize,
    visited: &mut Vec<usize>,
) -> Result<Option<(String, From)>, String> {
    let content = |c: usize, visited: &mut Vec<usize>| -> Result<String, String> {
        let traversal = Traversal {
            recursive: true,
            referenced: false,
            hidden_root: excluded(dom, c)?,
        };
        Ok(text_alternative(dom, c, traversal, visited)?.0)
    };
    let tag = dom.name(n).unwrap_or("");
    // SVG-AAM, "Name and description": the first `<title>` child names an
    // element in an svg, the svg itself too. Documented:
    // www.w3.org/TR/svg-aam-1.0/#mapping_additional_nd, read 2026-10-30.
    if in_svg(dom, n) {
        return dom.nodes[n]
            .children
            .iter()
            .copied()
            .find(|&c| dom.name(c) == Some("title"))
            .map(|c| content(c, visited).map(|s| (s, From::Other)))
            .transpose();
    }
    let input_type = dom
        .attribute(n, "type")
        .unwrap_or("text")
        .to_ascii_lowercase();
    if tag == "input" && input_type == "image" {
        for attribute in ["alt", "value", "title"] {
            if let Some(v) = dom
                .attribute(n, attribute)
                .filter(|v| !ascii_trim(v).is_empty())
            {
                let from = if attribute == "title" {
                    From::Title
                } else {
                    From::Other
                };
                return Ok(Some((ascii_trim(v).to_string(), from)));
            }
        }
        return Err(
            "<input type=\"image\"> without alt, value or title has the browser's own label, which the core does not know".into(),
        );
    }
    if tag == "input" && matches!(input_type.as_str(), "submit" | "reset" | "button") {
        return match dom.attribute(n, "value") {
            Some(v) => Ok(Some((v.trim().to_string(), From::Other))),
            // The browser's own word, in the browser's language: HTML-AAM
            // leaves it to the implementation.
            None if input_type != "button" => Err(format!(
                "<input type=\"{input_type}\"> without a value has the browser's own label, which the core does not know"
            )),
            None => Ok(None),
        };
    }
    match tag {
        "input" | "textarea" | "select" | "button" | "progress" | "meter" | "output" => {
            // HTML: a label with `for` labels the first element with that
            // id, when it is labelable; one without labels its first
            // labelable descendant. In tree order.
            let labels = dom.labels.get(&n).cloned().unwrap_or_default();
            // The control itself is not part of its own label's text.
            visited.push(n);
            let parts: Result<Vec<String>, String> =
                labels.iter().map(|&l| content(l, visited)).collect();
            visited.pop();
            let label = flat(&parts?.join(" "));
            if !label.is_empty() {
                return Ok(Some((label, From::Other)));
            }
            if labels.is_empty() {
                dom.facts.unlabelled(dom, n)?;
            }
            // For a field, HTML-AAM puts `title` and `placeholder` here; for
            // a button, after the content (2F, then 2I).
            if !matches!(tag, "input" | "textarea" | "select") {
                return Ok(None);
            }
            if let Some(title) = dom.attribute(n, "title").filter(|v| !v.trim().is_empty()) {
                return Ok(Some((title.trim().to_string(), From::Title)));
            }
            if matches!(tag, "input" | "textarea") {
                if let Some(p) = dom.attribute(n, "placeholder") {
                    return Ok(Some((p.trim().to_string(), From::Other)));
                }
            }
            Ok(None)
        }
        "img" => Ok(dom
            .attribute(n, "alt")
            .map(|a| (a.trim().to_string(), From::Other))),
        "fieldset" | "table" | "figure" => {
            let child = match tag {
                "fieldset" => "legend",
                "table" => "caption",
                _ => "figcaption",
            };
            let found = dom.nodes[n]
                .children
                .iter()
                .copied()
                .find(|&c| dom.name(c) == Some(child));
            found
                .map(|c| content(c, visited).map(|s| (s, From::Other)))
                .transpose()
        }
        _ => Ok(None),
    }
}

/// The first labelable element inside a label, in tree order.
fn first_labelable(dom: &Dom, label: usize) -> Option<usize> {
    // The elements come in tree order, before the text nodes, so the label's
    // descendants are the elements right after it.
    (label + 1..dom.nodes.len())
        .take_while(|&c| dom.name(c).is_some() && dom.ancestors(c).any(|a| a == label))
        .find(|&c| match dom.name(c) {
            Some("button" | "meter" | "output" | "progress" | "select" | "textarea") => true,
            Some("input") => !dom
                .attribute(c, "type")
                .is_some_and(|t| t.eq_ignore_ascii_case("hidden")),
            _ => false,
        })
}

/// ASCII whitespace, which HTML and AccName collapse; a no-break space is
/// text, and the browsers keep it.
fn ascii_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0c')
}

fn ascii_trim(s: &str) -> &str {
    s.trim_matches(ascii_space)
}

/// Whitespace collapsed and trimmed, as AccName's "flat string".
fn flat(s: &str) -> String {
    s.split(ascii_space)
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// A piece of the page without its comments.
fn without_comments(t: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(t.len());
    let mut i = 0;
    while i < t.len() {
        if starts_at(t, i, "<!--") {
            i = find_at(t, i + 4, "-->").map_or(t.len(), |e| e + 3);
            continue;
        }
        out.push(t[i]);
        i += 1;
    }
    out
}

/// AccName 1.2, section 4.2: the first applicable source, `aria-describedby`,
/// then `aria-description`, then `title` when it did not give the name.
fn description(dom: &Dom, n: usize, named_by: From) -> Result<String, String> {
    if let Some(ids) = dom.attribute(n, "aria-describedby") {
        let mut parts = Vec::new();
        for id in ids.split_ascii_whitespace() {
            let Some(target) = dom.by_id(id) else {
                continue;
            };
            let traversal = Traversal {
                recursive: true,
                referenced: true,
                hidden_root: excluded(dom, target)?,
            };
            parts.push(text_alternative(dom, target, traversal, &mut vec![n])?.0);
        }
        let joined = flat(&parts.join(" "));
        if !joined.is_empty() {
            return Ok(joined);
        }
    }
    if let Some(d) = dom.attribute(n, "aria-description") {
        return Ok(d.trim().to_string());
    }
    if named_by == From::Title {
        return Ok(String::new());
    }
    Ok(dom
        .attribute(n, "title")
        .map(|t| t.trim().to_string())
        .unwrap_or_default())
}

/// The element focus is on for a screen reader: the focused element, or the
/// element its `aria-activedescendant` points at, when that exists and is
/// shown. Core-AAM 1.2 gives the active descendant the focus state and the
/// focus events.
fn focused_node(dom: &Dom) -> Result<Option<usize>, String> {
    let Some(focused) = (0..dom.nodes.len()).find(|&n| dom.fact(n, "data-lt-ax-focused")) else {
        return Ok(None);
    };
    if let Some(id) = dom.attribute(focused, "aria-activedescendant") {
        if let Some(active) = dom.by_id(id.trim()) {
            if !excluded(dom, active)? {
                return Ok(Some(active));
            }
        }
    }
    Ok(Some(focused))
}

/// Core-AAM 1.2 states, by WAI-ARIA name. A native state, which only the
/// browser knows, wins over the same `aria-*` attribute.
fn states(dom: &Dom, n: usize, role: &str, focus: Option<usize>) -> Vec<&'static str> {
    let mut out = Vec::new();
    let native_check = dom.name(n) == Some("input")
        && dom
            .attribute(n, "type")
            .is_some_and(|t| t.eq_ignore_ascii_case("checkbox") || t.eq_ignore_ascii_case("radio"));
    if focus == Some(n) {
        out.push("focused");
    }
    // An empty or "undefined" aria-expanded is not set (WAI-ARIA 1.2).
    let expanded = dom
        .attribute(n, "aria-expanded")
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty() && v != "undefined");
    if let Some(v) = expanded {
        out.push("expandable");
        if v == "true" {
            out.push("expanded");
        }
    } else if role == "combobox" && dom.name(n) == Some("select") {
        // HTML-AAM: a `<select>` shown as a combo box has a popup, and so
        // can be expanded. Whether it is open now is the browser's, and not
        // in the facts; the contracts never open one.
        out.push("expandable");
    }
    if (dom.name(n) == Some("option") && dom.fact(n, "data-lt-ax-selected"))
        || dom.is_true(n, "aria-selected")
    {
        out.push("selected");
    }
    let checkable = matches!(
        role,
        "checkbox"
            | "radio"
            | "switch"
            | "menuitemcheckbox"
            | "menuitemradio"
            | "option"
            | "treeitem"
    );
    if native_check {
        if dom.fact(n, "data-lt-ax-checked") {
            out.push("checked");
        }
        if dom.fact(n, "data-lt-ax-mixed") {
            out.push("mixed");
        }
    } else if checkable {
        match dom
            .attribute(n, "aria-checked")
            .map(|v| v.trim().to_ascii_lowercase())
        {
            Some(v) if v == "true" => out.push("checked"),
            Some(v) if v == "mixed" => out.push("mixed"),
            _ => {}
        }
    }
    if dom.is_true(n, "aria-pressed") {
        out.push("pressed");
    }
    // aria-invalid when the page wrote it; otherwise the field's own
    // validity, which HTML-AAM exposes except an empty required field the
    // user has not touched yet.
    let invalid = match dom.attribute(n, "aria-invalid") {
        Some(v) => {
            let v = v.trim().to_ascii_lowercase();
            !v.is_empty() && v != "false"
        }
        None => dom.fact(n, "data-lt-ax-invalid"),
    };
    if invalid {
        out.push("invalid");
    }
    let form_control = matches!(dom.name(n), Some("input" | "select" | "textarea"));
    if (form_control && dom.has(n, "required")) || dom.is_true(n, "aria-required") {
        out.push("required");
    }
    if dom.is_true(n, "aria-busy") {
        out.push("busy");
    }
    if dom.is_true(n, "aria-modal") || dom.fact(n, "data-lt-ax-modal") {
        out.push("modal");
    }
    if dom.fact(n, "data-lt-ax-disabled") || dom.is_true(n, "aria-disabled") {
        out.push("disabled");
    }
    // `readonly` applies to a textarea and the inputs that take text.
    let takes_text = dom.name(n) == Some("textarea")
        || (dom.name(n) == Some("input")
            && !dom.attribute(n, "type").is_some_and(|t| {
                matches!(
                    t.to_ascii_lowercase().as_str(),
                    "checkbox"
                        | "radio"
                        | "file"
                        | "hidden"
                        | "range"
                        | "color"
                        | "button"
                        | "submit"
                        | "reset"
                        | "image"
                )
            }));
    if (takes_text && dom.has(n, "readonly")) || dom.is_true(n, "aria-readonly") {
        out.push("readonly");
    }
    out.sort_unstable();
    out
}

/// The exposed elements on the page, in document order.
///
/// Refuses, with the reason, when an element lacks the facts the browser
/// must give, or holds what the core does not compute: an answer computed
/// from a guess would look like a real one.
pub fn accessibility_tree(source: &[u16]) -> Result<Vec<AxNode>, String> {
    let dom = Dom::parse(source, Box::new(Browser));
    let focus = focused_node(&dom)?;
    let mut out = Vec::new();
    for n in 1..dom.nodes.len() {
        let Some(tag) = dom.name(n) else { continue };
        if matches!(tag, "html" | "head" | "body")
            || dom.ancestors(n).any(|a| dom.name(a) == Some("head"))
        {
            continue;
        }
        if excluded(&dom, n)? {
            continue;
        }
        let r = role_of(&dom, n)?;
        if matches!(r, "generic" | "none" | "presentation") {
            continue;
        }
        let (name, from) = text_alternative(&dom, n, Traversal::default(), &mut vec![])?;
        out.push(AxNode {
            role: r.to_string(),
            states: states(&dom, n, r, focus),
            description: description(&dom, n, from)?,
            name,
            id: dom.attribute(n, "id").map(str::to_string),
        });
    }
    Ok(out)
}

/// Whether an element has a name, read from the markup as it is written.
#[derive(Clone, Debug, PartialEq)]
pub enum Name {
    Given,
    Missing,
    /// The markup does not say, and why.
    Unknown(String),
}

/// The markup as `lotek check` reads it, to ask about names. Element `i` is
/// element `i` from [`walk`] on [`page_source`], as the checks number them.
pub(crate) struct MarkupNames {
    dom: Dom,
}

impl MarkupNames {
    pub fn new(source: &[u16], markup: Markup) -> MarkupNames {
        MarkupNames {
            dom: Dom::parse(source, Box::new(markup)),
        }
    }

    /// The element whose name starts at `start` in the source.
    pub fn at(&self, start: usize) -> Option<usize> {
        self.dom.starts.binary_search(&start).ok()
    }

    /// Whether the element has no content at all: no element, and no text
    /// but space. A button or link like that is usually filled later, by the
    /// server or a script.
    pub fn empty(&self, i: usize) -> bool {
        // A void element never has content, and is not waiting for any.
        let void = matches!(
            self.dom.name(i + 1),
            Some(
                "area"
                    | "base"
                    | "br"
                    | "col"
                    | "embed"
                    | "hr"
                    | "img"
                    | "input"
                    | "link"
                    | "meta"
                    | "source"
                    | "track"
                    | "wbr"
            )
        );
        !void
            && self.dom.nodes[i + 1]
                .children
                .iter()
                .all(|&c| match &self.dom.nodes[c].kind {
                    Kind::Text(t) => t.chars().all(ascii_space),
                    Kind::Element { .. } => false,
                })
    }

    /// Whether the role may take its name from the content.
    pub fn from_content(role: &str) -> bool {
        known(role).is_some_and(|r| r.from_content)
    }

    /// The element's role, or why the core does not know it.
    pub fn role(&self, i: usize) -> Result<&'static str, String> {
        role_of(&self.dom, i + 1)
    }

    /// Whether the element is left out of the tree for good, with
    /// `aria-hidden="true"` on it or above it. A `hidden` element is not: it
    /// can be shown, and then needs its name.
    pub fn aria_hidden(&self, i: usize) -> bool {
        let n = i + 1;
        std::iter::once(n)
            .chain(self.dom.ancestors(n))
            .any(|a| self.dom.is_true(a, "aria-hidden"))
    }

    /// The text the element gives what `aria-labelledby` points at it: its
    /// content, also when its own role takes no name from it, like a label.
    pub fn referenced(&self, i: usize) -> Name {
        let n = i + 1;
        let computed = self.dom.facts.source(&self.dom, n).and_then(|_| {
            let traversal = Traversal {
                recursive: true,
                referenced: true,
                hidden_root: !visible(&self.dom, n)?,
            };
            text_alternative(&self.dom, n, traversal, &mut vec![])
        });
        match computed {
            Ok((name, _)) if name.trim().is_empty() => Name::Missing,
            Ok(_) => Name::Given,
            Err(why) => Name::Unknown(why),
        }
    }

    /// The element's name, as it would be once it is shown.
    pub fn name(&self, i: usize) -> Name {
        let n = i + 1;
        let computed = visible(&self.dom, n).and_then(|shown| {
            let traversal = Traversal {
                hidden_root: !shown,
                ..Traversal::default()
            };
            text_alternative(&self.dom, n, traversal, &mut vec![])
        });
        match computed {
            // A name of only no-break spaces is text to the browser, and
            // nothing to say for the screen reader.
            Ok((name, _)) if name.trim().is_empty() => Name::Missing,
            Ok(_) => Name::Given,
            Err(why) => Name::Unknown(why),
        }
    }
}

/// The tree as JSON: `[{"role","name","description","states","id"}]`.
pub fn to_json(nodes: &[AxNode]) -> String {
    let items: Vec<String> = nodes
        .iter()
        .map(|n| {
            format!(
                "{{\"role\":{},\"name\":{},\"description\":{},\"states\":[{}],\"id\":{}}}",
                json_string(&n.role),
                json_string(&n.name),
                json_string(&n.description),
                n.states
                    .iter()
                    .map(|s| json_string(s))
                    .collect::<Vec<_>>()
                    .join(","),
                n.id.as_deref().map_or("null".into(), json_string),
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

/// A list of names as a JSON array.
pub fn names_json(names: &[&str]) -> String {
    format!(
        "[{}]",
        names
            .iter()
            .map(|s| json_string(s))
            .collect::<Vec<_>>()
            .join(",")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Markup as the host gives it: every element with the facts a browser
    /// would compute for this small set of elements.
    fn rendered(html: &str) -> Vec<u16> {
        let mut out = String::new();
        let mut rest = html;
        while let Some(at) = rest.find('<') {
            out.push_str(&rest[..at]);
            rest = &rest[at..];
            let starts_tag = rest[1..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic());
            let end = rest.find('>').unwrap();
            if starts_tag {
                let tag = &rest[..end];
                let (tag, closing) = tag.strip_suffix('/').map_or((tag, ""), |t| (t, "/"));
                let hidden = tag.contains(" hidden");
                let block = [
                    "<div", "<p", "<h2", "<ul", "<li", "<section", "<dialog", "<lt-",
                ]
                .iter()
                .any(|b| tag.starts_with(b));
                out.push_str(&format!(
                    "{tag} data-lt-ax-visible=\"{}\" data-lt-ax-display=\"{}\" data-lt-ax-before=\"none\" data-lt-ax-after=\"none\"{closing}>",
                    if hidden { 0 } else { 1 },
                    if hidden {
                        "none"
                    } else if block {
                        "block"
                    } else {
                        "inline"
                    }
                ));
            } else {
                out.push_str(&rest[..=end]);
            }
            rest = &rest[end + 1..];
        }
        out.push_str(rest);
        utf16(&out)
    }

    fn tree(html: &str) -> Vec<AxNode> {
        accessibility_tree(&rendered(html)).unwrap()
    }

    fn node<'a>(tree: &'a [AxNode], role: &str) -> &'a AxNode {
        tree.iter()
            .find(|n| n.role == role)
            .unwrap_or_else(|| panic!("no {role} in {tree:#?}"))
    }

    #[test]
    fn names_the_error_summary_from_its_heading() {
        let tree = tree(
            r##"<lt-error-summary role="alert" tabindex="-1" aria-labelledby="t" data-lt-ax-focused="1"><h2 id="t">There is a problem</h2><ul><li><a href="#email">Enter an email</a></li></ul></lt-error-summary>"##,
        );
        let alert = node(&tree, "alert");
        assert_eq!(alert.name, "There is a problem");
        assert_eq!(alert.states, vec!["focused"]);
        assert_eq!(node(&tree, "link").name, "Enter an email");
    }

    #[test]
    fn an_alert_is_not_named_from_its_content() {
        // WAI-ARIA 1.2: alert is "Name From: author". The component's
        // aria-labelledby is what names it.
        let tree = tree(
            r##"<lt-error-summary role="alert"><h2>There is a problem</h2></lt-error-summary>"##,
        );
        assert_eq!(node(&tree, "alert").name, "");
    }

    #[test]
    fn a_reference_counts_hidden_text_and_follows_no_second_reference() {
        let tree = tree(
            r##"<a href="#a" aria-labelledby="x"></a><span id="x" hidden aria-labelledby="y">Enclosures</span><span id="y">Wrong</span>"##,
        );
        assert_eq!(node(&tree, "link").name, "Enclosures");
    }

    #[test]
    fn hidden_content_of_a_visible_reference_does_not_count() {
        // AccName 2A: only a node referenced directly while hidden brings
        // its hidden content.
        let tree = tree(
            r##"<a href="#a" aria-labelledby="x"></a><p id="x">Shown <span hidden>secret</span></p>"##,
        );
        assert_eq!(node(&tree, "link").name, "Shown");
    }

    #[test]
    fn a_node_may_name_itself_in_its_own_list() {
        let tree = tree(
            r##"<button id="b" aria-labelledby="b x" aria-label="Delete">x</button><span id="x">the file</span>"##,
        );
        assert_eq!(node(&tree, "button").name, "Delete the file");
    }

    #[test]
    fn a_control_inside_a_label_gives_its_value() {
        let tree = tree(
            r##"<label for="n">Flush every <input id="m" aria-label="ignored" data-lt-ax-value="5"> minutes</label><input id="n">"##,
        );
        let fields: Vec<&AxNode> = tree.iter().filter(|n| n.role == "textbox").collect();
        assert_eq!(fields[1].name, "Flush every 5 minutes");
    }

    #[test]
    fn labels_a_control_by_for_and_by_wrapping() {
        let tree = tree(
            r##"<label for="e">Email</label><input id="e" type="email" required aria-describedby="h"><p id="h">We never send spam</p><label>Name <input></label>"##,
        );
        let fields: Vec<&AxNode> = tree.iter().filter(|n| n.role == "textbox").collect();
        assert_eq!(fields[0].name, "Email");
        assert_eq!(fields[0].description, "We never send spam");
        assert_eq!(fields[0].states, vec!["required"]);
        assert_eq!(fields[1].name, "Name");
    }

    #[test]
    fn title_names_or_describes_but_not_both() {
        let tree = tree(
            r##"<button title="Close"></button><button title="Closes the dialog">Close</button>"##,
        );
        let buttons: Vec<&AxNode> = tree.iter().filter(|n| n.role == "button").collect();
        assert_eq!(
            (buttons[0].name.as_str(), buttons[0].description.as_str()),
            ("Close", "")
        );
        assert_eq!(
            (buttons[1].name.as_str(), buttons[1].description.as_str()),
            ("Close", "Closes the dialog")
        );
    }

    #[test]
    fn generated_content_is_part_of_the_name() {
        let html = String::from_utf16(&rendered(r##"<label for="e">Email</label><input id="e">"##))
            .unwrap()
            .replacen(
                "data-lt-ax-after=\"none\">Email",
                "data-lt-ax-after='\" (required)\"'>Email",
                1,
            );
        let tree = accessibility_tree(&utf16(&html)).unwrap();
        assert_eq!(node(&tree, "textbox").name, "Email (required)");
    }

    #[test]
    fn hidden_elements_are_not_in_the_tree() {
        let tree = tree(
            r##"<button hidden>Gone</button><button aria-hidden="true">Gone too</button><button>Here</button>"##,
        );
        assert_eq!(
            tree.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(),
            vec!["Here"]
        );
    }

    #[test]
    fn comments_and_templates_are_not_text() {
        let tree = tree(r##"<button>Save<!-- not this --><template>nor this</template></button>"##);
        assert_eq!(node(&tree, "button").name, "Save");
    }

    #[test]
    fn refuses_what_it_would_have_to_guess() {
        let no_facts = accessibility_tree(&utf16("<button>Save</button>")).unwrap_err();
        assert!(no_facts.contains("data-lt-ax-visible"), "{no_facts}");
        let unknown_role =
            accessibility_tree(&rendered(r##"<div role="made-up">x</div>"##)).unwrap_err();
        assert!(unknown_role.contains("role=\"made-up\""), "{unknown_role}");
        let default_label =
            accessibility_tree(&rendered(r##"<input type="submit">"##)).unwrap_err();
        assert!(
            default_label.contains("browser's own label"),
            "{default_label}"
        );
    }

    #[test]
    fn native_checked_wins_over_aria_checked() {
        let tree = tree(
            r##"<input type="checkbox" aria-checked="true"><div role="checkbox" aria-checked="mixed">x</div>"##,
        );
        let boxes: Vec<&AxNode> = tree.iter().filter(|n| n.role == "checkbox").collect();
        assert!(boxes[0].states.is_empty(), "{:?}", boxes[0].states);
        assert_eq!(boxes[1].states, vec!["mixed"]);
    }

    #[test]
    fn an_image_in_a_link_gives_its_alt() {
        // Found by comparing the core with Chromium and Firefox through AT-SPI.
        let tree = tree(r##"<a href="#a"><img alt="Attachments"></a>"##);
        assert_eq!(node(&tree, "link").name, "Attachments");
    }

    #[test]
    fn focus_follows_the_active_descendant() {
        // Found by comparing the core with Chromium and Firefox through AT-SPI.
        let tree = tree(
            r##"<input role="combobox" aria-expanded="true" aria-activedescendant="o2" data-lt-ax-focused="1"><ul role="listbox"><li role="option" id="o1">Crowbar</li><li role="option" id="o2" aria-selected="true">Needle</li></ul>"##,
        );
        let focused: Vec<&str> = tree
            .iter()
            .filter(|n| n.states.contains(&"focused"))
            .map(|n| n.name.as_str())
            .collect();
        assert_eq!(focused, vec!["Needle"]);
    }

    #[test]
    fn a_native_select_can_be_expanded() {
        let tree = tree(r##"<select><option>Crowbar</option></select>"##);
        assert_eq!(node(&tree, "combobox").states, vec!["expandable"]);
    }

    #[test]
    fn hidden_markup_the_core_does_not_know_does_not_stop_the_page() {
        let tree = tree(
            r##"<button><svg aria-hidden="true"><path d="M0 0"></path></svg> Delete</button>"##,
        );
        assert_eq!(node(&tree, "button").name, "Delete");
    }

    #[test]
    fn comments_and_line_breaks_in_a_name() {
        let tree = tree(r##"<button>Sa<!-- -->ve</button><a href="#x">Cancel<br>the job</a>"##);
        assert_eq!(node(&tree, "button").name, "Save");
        assert_eq!(node(&tree, "link").name, "Cancel the job");
    }

    #[test]
    fn a_no_break_space_is_text() {
        let tree = tree("<button>10\u{a0}kr</button>");
        assert_eq!(node(&tree, "button").name, "10\u{a0}kr");
    }

    #[test]
    fn labels_follow_html_association() {
        let tree = tree(
            r##"<label>Name <input id="a" data-lt-ax-value="x"> <input id="b" data-lt-ax-value=""></label><label>Outer <input id="c"></label><label for="c">Second</label><div id="d"></div><label for="d">Wrong</label><input id="d">"##,
        );
        let fields: Vec<&AxNode> = tree.iter().filter(|n| n.role == "textbox").collect();
        assert_eq!(fields[1].name, "");
        assert_eq!(fields[2].name, "Outer Second");
        assert_eq!(fields[3].name, "");
    }

    #[test]
    fn roles_html_and_aria_give() {
        let tree = tree(
            r##"<select size="4"><option>Crowbar</option></select><div role="feed article">x</div><button role="presentation">Save</button><input type="image" alt="Search">"##,
        );
        assert!(tree.iter().any(|n| n.role == "listbox"));
        assert!(tree.iter().any(|n| n.role == "feed"));
        let buttons: Vec<&str> = tree
            .iter()
            .filter(|n| n.role == "button")
            .map(|n| n.name.as_str())
            .collect();
        assert_eq!(buttons, vec!["Save", "Search"]);
    }

    #[test]
    fn states_where_html_applies_them() {
        let tree = tree(
            r##"<input type="checkbox" readonly><div role="checkbox" required aria-checked="false">x</div><div role="button" aria-expanded="">y</div><input data-lt-ax-invalid="1">"##,
        );
        let boxes: Vec<&AxNode> = tree.iter().filter(|n| n.role == "checkbox").collect();
        assert!(boxes[0].states.is_empty(), "{:?}", boxes[0].states);
        assert!(boxes[1].states.is_empty(), "{:?}", boxes[1].states);
        assert!(node(&tree, "button").states.is_empty());
        assert_eq!(node(&tree, "textbox").states, vec!["invalid"]);
    }

    #[test]
    fn nothing_inside_noscript_is_read() {
        let html = String::from_utf16(&rendered("<button>Save</button>"))
            .unwrap()
            .replace(
                "</button>",
                r#"</button><noscript><a href="/x">Without script</a></noscript>"#,
            );
        let tree = accessibility_tree(&utf16(&html)).unwrap();
        assert_eq!(tree.len(), 1);
    }

    #[test]
    fn the_presentational_conflict_counts_every_global_attribute() {
        let tree = tree(
            r##"<ul><li role="none" aria-current="page">Home</li></ul><button role="presentation" data-lt-ax-disabled="1">Off</button>"##,
        );
        // aria-current is global, so the item keeps its role; a disabled
        // button takes no focus, so it is presentational.
        assert!(tree.iter().any(|n| n.role == "listitem"));
        assert!(!tree.iter().any(|n| n.role == "button"));
    }

    #[test]
    fn block_content_is_separated_by_spaces() {
        let tree = tree(r##"<a href="#x"><div>One</div><div>Two</div></a>"##);
        assert_eq!(node(&tree, "link").name, "One Two");
    }
}
