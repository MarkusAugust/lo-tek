//! The shape of the vocabulary and of the findings.
//!
//! The vocabulary is read from the manifest (`interfaces/manifest/manifest.json`)
//! when the core runs. The order is the same as in the manifest, and it
//! matters: it decides which suggestion wins at equal distance, and the order
//! of the lists in the messages.

/// An attribute an `<lt-…>` element reads.
#[derive(Clone, Debug)]
pub enum Attribute {
    Flag,
    Text,
    Number,
    Values(Vec<String>),
}

/// A part of an element or a class, like the control in `<lt-field>`, with
/// the selector the component finds it by. Without `multiple` the first one
/// counts, and with `unique` a second part of the same kind is an error. With
/// `stable_id` the part must have an id from the server: the component never
/// writes one, since an update would otherwise replace the part.
#[derive(Clone, Debug)]
pub struct Part {
    pub name: String,
    pub selector: String,
    pub description: String,
    pub multiple: bool,
    pub unique: bool,
    pub stable_id: bool,
    /// LO-TEK's own demand for a name, beyond WAI-ARIA's.
    pub named: Option<Named>,
}

/// An element or part LO-TEK demands a name for, where WAI-ARIA does not, or
/// where the component gives the name itself. WAI-ARIA's own demands, by
/// role, are in the core.
#[derive(Clone, Debug, PartialEq)]
pub struct Named {
    /// The part the component names it after when the markup gives it no
    /// name: it points `aria-labelledby` at that part.
    pub after: Option<String>,
    /// The part must have an id from the template, since the component does
    /// not write one.
    pub id: bool,
    /// The component names it itself, from what the other rules check, and
    /// no rule judges its name in the markup.
    pub component: bool,
}

#[derive(Clone, Debug)]
pub struct Element {
    pub tag: String,
    pub link: String,
    pub attributes: Vec<(String, Attribute)>,
    pub parts: Vec<Part>,
    /// Attributes that have been removed, with what to use instead.
    pub removed: Vec<(String, String)>,
    /// LO-TEK's demand for a name on the element itself.
    pub named: Option<Named>,
    /// The texts the element writes itself.
    pub texts: Vec<DefaultText>,
}

/// A text a component writes itself when nobody has given it another, and
/// the attributes that replace it, any one of them.
#[derive(Clone, Debug, PartialEq)]
pub struct DefaultText {
    pub key: String,
    pub text: String,
    pub replaced_by: Vec<String>,
}

/// A text a stylesheet shows on an element with the class and the
/// attribute, and the CSS variable that replaces it.
#[derive(Clone, Debug, PartialEq)]
pub struct CssText {
    pub variable: String,
    pub text: String,
    pub attribute: String,
    pub value: Option<String>,
    /// Attributes that keep the text from showing.
    pub unless: Vec<String>,
    /// The attribute is on an element inside the one with the class, as
    /// `aria-current="step"` is on a step in `lt-steps`.
    pub within: bool,
}

/// An attribute a class takes, like `data-variant` on `lt-button`, or a
/// flag, like `data-optional` on `lt-label`, which is on when present.
#[derive(Clone, Debug)]
pub struct ClassAttribute {
    pub values: Vec<String>,
    pub default_value: Option<String>,
    pub flag: bool,
}

#[derive(Clone, Debug)]
pub struct Class {
    pub name: String,
    pub title: String,
    pub link: String,
    pub attributes: Vec<(String, ClassAttribute)>,
    pub parts: Vec<Part>,
    /// LO-TEK's demand for a name on the element with the class.
    pub named: Option<Named>,
    /// The texts the stylesheet shows on it.
    pub texts: Vec<CssText>,
}

/// Everything the spell check checks against, read from one manifest.
#[derive(Clone, Debug)]
pub struct Vocabulary {
    /// The version of `@lo-tek/interfaces` the manifest was written from.
    pub version: String,
    pub schema_version: u32,
    pub elements: Vec<Element>,
    pub classes: Vec<Class>,
    /// The language of the texts the components and stylesheets write
    /// themselves, when the manifest says.
    pub text_language: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Severity {
    Error,
    Warning,
}

/// One edit in a fix: replace the text from `start` to `end` with `text`.
#[derive(Clone, Debug)]
pub struct Edit {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// A fix the editor can offer: one or more edits that belong together, like
/// `id` on the field and `for` on the label. The edits are in text order and
/// do not overlap; whoever applies them applies them from the end, so the
/// positions hold.
#[derive(Clone, Debug)]
pub struct Fix {
    pub title: String,
    pub edits: Vec<Edit>,
    pub preferred: bool,
}

impl Fix {
    /// A fix with one edit.
    pub fn one(title: String, start: usize, end: usize, text: String, preferred: bool) -> Fix {
        Fix {
            title,
            edits: vec![Edit { start, end, text }],
            preferred,
        }
    }
}

/// One finding. The positions are UTF-16 indices into the original text.
#[derive(Clone, Debug)]
pub struct Finding {
    pub start: usize,
    pub end: usize,
    pub severity: Severity,
    pub link: String,
    pub message: String,
    pub fix: Option<Fix>,
    /// The name of the rule, like `unknown-class`. This is what a comment
    /// like `<!-- lotek-ignore-next unknown-class -->` refers to.
    pub rule: &'static str,
}

/// The names of the rules, in the order they appear in the documentation.
pub const RULES: &[&str] = &[
    "unknown-element",
    "unknown-attribute",
    "boolean-with-value",
    "invalid-value",
    "not-a-number",
    "unknown-class",
    "invalid-class-value",
    "disabled-with-href",
    "field-without-control",
    "part-repeated",
    "timeout-without-dialog",
    "duplicate-id",
    "id-not-found",
    "for-points-nowhere",
    "summary-points-nowhere",
    "text-not-wired",
    "unstyled-class",
    "unstyled-value",
    "control-without-wiring",
    "panel-without-id",
    "tab-link-without-panel",
    "tab-without-link",
    "term-without-entry",
    "text-in-label",
    "value-without-field",
    "error-text-contradicts",
    "removed-attribute",
    "id-from-component",
    "without-name",
    "untranslated-text",
];
