//! The theme: a whole colour theme from a few brand colours, and the check of
//! a theme a consumer has written themselves.
//!
//! The theme is the contract applied to the consumer's hues. The hue comes
//! from them, the lightness from the role, and the promises hold by
//! construction. That is why there is no adjustment pass here: there is
//! nothing to adjust afterwards. The brand colour itself is moved to the
//! lightness of the role, and `Theme::brands` says how far.

pub mod check;
mod color;
pub mod contract;
mod palettes;
#[cfg(test)]
mod tests;

pub use palettes::{suggest_palettes, Palette, PaletteColor, Palettes};

use crate::json::Json;
use color::{parse_hex, to_hex};
use contract::{
    breaks_as_fill, build_matrix, contract, fill_chroma_kept, token_name, Appearance, Matrix,
    Violation,
};

/// `String.prototype.trim` in JavaScript: whitespace as JavaScript sees it.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// A number written the way `String(number)` does it in JavaScript: `600`,
/// not `600.0`, `1e-7` and `1e+21` with an exponent, and `Infinity` and `NaN`.
///
/// The rules are Number::toString in ECMA-262: the shortest digits that read
/// back to the same number, which Rust also finds, with an exponent when the
/// number is below 1e-6 or at least 1e21.
pub(crate) fn js_number(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    // `-0` is written `0` in JavaScript.
    if n == 0.0 {
        return "0".into();
    }
    // `{:e}` gives the shortest digits, like `1.2345e-7`.
    let scientific = format!("{:e}", n.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits = mantissa.replace('.', "");
    let k = digits.len() as i32;
    // The number is 0.`digits` times 10 to the power of `point`.
    let point = exponent.parse::<i32>().unwrap_or(0) + 1;
    let text = if (k..=21).contains(&point) {
        format!("{digits}{}", "0".repeat((point - k) as usize))
    } else if (1..=21).contains(&point) {
        let (whole, fraction) = digits.split_at(point as usize);
        format!("{whole}.{fraction}")
    } else if (-5..=0).contains(&point) {
        format!("0.{}{digits}", "0".repeat(-point as usize))
    } else {
        let exponent = point - 1;
        let sign = if exponent >= 0 { '+' } else { '-' };
        let mantissa = if k == 1 {
            digits
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        format!("{mantissa}e{sign}{}", exponent.abs())
    };
    if n < 0.0 {
        format!("-{text}")
    } else {
        text
    }
}

/// `number.toFixed(2)` in JavaScript: a tie rounds up, not to even.
pub(crate) fn to_fixed2(n: f64) -> String {
    let scaled = n * 100.0;
    let floor = scaled.floor();
    if scaled - floor == 0.5 {
        let up = (floor + 1.0) / 100.0;
        return format!("{up:.2}");
    }
    format!("{n:.2}")
}

/// The buttons, fields and surfaces that share a corner radius in the theme.
const BUTTONS: [&str; 3] = ["button", "pagination", "skip-link"];
const FIELDS: [&str; 3] = ["input", "select", "textarea"];
const SURFACES: [&str; 12] = [
    "card",
    "dialog",
    "popover",
    "alert",
    "accordion",
    "error-summary",
    "file-upload",
    "session-timeout",
    "suggestion",
    "toast",
    "tooltip",
    "term",
];

/// The name the user wrote, for the error message.
///
/// The value ends up in `--lt-button-radius`, but what was written was
/// `buttonRadius`. An error message that names our own variable sends the
/// reader to the wrong place in their own file.
fn recipe_name(variable: &str) -> String {
    let named = match variable {
        "--lt-font-family-base" => "fontFamily",
        "--lt-font-weight-regular" => "weights.regular",
        "--lt-font-weight-medium" => "weights.medium",
        "--lt-font-weight-semibold" => "weights.semibold",
        "--lt-font-weight-bold" => "weights.bold",
        "--lt-line-height-default" => "lineHeights.default",
        "--lt-line-height-heading" => "lineHeights.heading",
        "--lt-line-height-article" => "lineHeights.article",
        "--lt-line-height-compact" => "lineHeights.compact",
        "--lt-button-border-width" => "buttonBorderWidth",
        "--lt-button-font-weight" => "buttonFontWeight",
        _ => "",
    };
    if !named.is_empty() {
        return named.into();
    }
    if let Some(name) = variable
        .strip_prefix("--lt-")
        .and_then(|v| v.strip_suffix("-radius"))
    {
        return if BUTTONS.contains(&name) {
            "buttonRadius"
        } else if FIELDS.contains(&name) {
            "fieldRadius"
        } else {
            "surfaceRadius"
        }
        .into();
    }
    variable.into()
}

/// Whether parentheses, square brackets and quotes are balanced.
///
/// An unbalanced `(` is enough on its own: `1px (` opens a block that
/// swallows the semicolon, both braces and everything after it in the file.
/// Tested in Chromium, where both the theme and the consumer's own style
/// sheet disappeared. A `[` opens a block in the same way: after `Inter [`
/// the declaration that followed was gone.
fn balanced(value: &str) -> bool {
    let mut open: Vec<char> = Vec::new();
    let mut quote: Option<char> = None;
    for c in value.chars() {
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
            continue;
        }
        if c == '"' || c == '\'' {
            quote = Some(c);
        } else if c == '(' {
            open.push(')');
        } else if c == '[' {
            open.push(']');
        } else if (c == ')' || c == ']') && open.pop() != Some(c) {
            // Blocks nest: each one is closed by its own kind, innermost first.
            return false;
        }
    }
    open.is_empty() && quote.is_none()
}

/// Refuses a value that can break out of the rule it is written into.
///
/// The recipe can come from another repository or a build step. Four ways
/// out were checked in a browser: `4px; } html { display: none } :root { --x: 1`
/// closed the block, `1px (` swallowed the rest of the file, `Arial\` let the
/// backslash eat the semicolon, and `Arial</style><script>…` ran the script
/// where the CSS is inline in a `<style>`. Hence both a list of dangerous
/// characters and a requirement that parentheses, brackets and quotes are balanced.
/// `calc(1rem + 2px)` and `"Segoe UI", Arial` are still valid.
fn checked(name: &str, value: &str) -> Result<String, String> {
    let dangerous = value.contains([';', '{', '}', '<', '>', '\\'])
        || value.contains("/*")
        || value.contains("*/")
        || value.chars().any(|c| (c as u32) < 0x20);
    if dangerous {
        return Err(format!(
            "The value of {} cannot contain \";\", \"{{\", \"}}\", \"<\", \">\", \"\\\", \"/*\" or control characters. It is written straight into a CSS rule. Got: {value}",
            recipe_name(name)
        ));
    }
    if !balanced(value) {
        return Err(format!(
            "The value of {} has an unbalanced parenthesis, bracket or quote. A parenthesis that is not closed swallows the rest of the style sheet. Got: {value}",
            recipe_name(name)
        ));
    }
    Ok(value.to_string())
}

/// What a recipe has at a key that takes one value: the value as text, as
/// `String(value)` gives it, nothing when it is not given, or an error when
/// it is something a value cannot be.
///
/// Not given is a key that is absent, `null`, an empty text or `false`. A
/// family is also not given by `0`, where a key of typography or shape takes
/// `0` as a value: `fieldRadius: 0` is a corner, and no colour is `0`. `true`,
/// a list and an object are not values. Every reading of a leaf goes through
/// here, so the theme and the check of a recipe cannot disagree on it.
fn leaf(value: Option<&Json>, zero_is_a_value: bool) -> Result<Option<String>, ()> {
    match value {
        None | Some(Json::Null) | Some(Json::Bool(false)) => Ok(None),
        Some(Json::String(s)) if s.is_empty() => Ok(None),
        Some(Json::String(s)) => Ok(Some(s.clone())),
        Some(Json::Number(n)) if !zero_is_a_value && (*n == 0.0 || n.is_nan()) => Ok(None),
        Some(Json::Number(n)) => Ok(Some(js_number(*n))),
        Some(Json::Bool(true)) | Some(Json::Array(_)) | Some(Json::Object(_)) => Err(()),
    }
}

/// The value of a key of typography or shape, as text, when it is given.
/// What cannot be a value has been refused before a theme is built.
fn given(value: Option<&Json>) -> Option<String> {
    leaf(value, true).ok().flatten()
}

type Declarations = Vec<(String, String)>;

fn maybe(out: &mut Declarations, name: &str, value: Option<&Json>) -> Result<(), String> {
    if let Some(v) = given(value) {
        let v = checked(name, &v)?;
        match out.iter_mut().find(|(n, _)| n == name) {
            Some(existing) => existing.1 = v,
            None => out.push((name.to_string(), v)),
        }
    }
    Ok(())
}

fn path<'a>(value: Option<&'a Json>, key: &str) -> Option<&'a Json> {
    value?.get(key)
}

fn typography_declarations(t: &Json) -> Result<Declarations, String> {
    let mut out = Vec::new();
    let t = Some(t);
    maybe(&mut out, "--lt-font-family-base", path(t, "fontFamily"))?;
    let weights = path(t, "weights");
    maybe(
        &mut out,
        "--lt-font-weight-regular",
        path(weights, "regular"),
    )?;
    maybe(&mut out, "--lt-font-weight-medium", path(weights, "medium"))?;
    maybe(
        &mut out,
        "--lt-font-weight-semibold",
        path(weights, "semibold"),
    )?;
    maybe(&mut out, "--lt-font-weight-bold", path(weights, "bold"))?;
    let heights = path(t, "lineHeights");
    maybe(
        &mut out,
        "--lt-line-height-default",
        path(heights, "default"),
    )?;
    maybe(
        &mut out,
        "--lt-line-height-heading",
        path(heights, "heading"),
    )?;
    maybe(
        &mut out,
        "--lt-line-height-article",
        path(heights, "article"),
    )?;
    maybe(
        &mut out,
        "--lt-line-height-compact",
        path(heights, "compact"),
    )?;
    Ok(out)
}

fn shape_declarations(f: &Json) -> Result<Declarations, String> {
    let mut out = Vec::new();
    for (key, names) in [
        ("buttonRadius", &BUTTONS[..]),
        ("fieldRadius", &FIELDS[..]),
        ("surfaceRadius", &SURFACES[..]),
    ] {
        for name in names {
            maybe(&mut out, &format!("--lt-{name}-radius"), f.get(key))?;
        }
    }
    maybe(
        &mut out,
        "--lt-button-border-width",
        f.get("buttonBorderWidth"),
    )?;
    maybe(
        &mut out,
        "--lt-button-font-weight",
        f.get("buttonFontWeight"),
    )?;
    Ok(out)
}

fn lines(declarations: &Declarations, indent: &str) -> String {
    declarations
        .iter()
        .map(|(n, v)| format!("{indent}{n}: {v};"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The theme control must be in the consumer's theme too, otherwise
/// `.lt-theme-control` switched to LO-TEK's own colours inside a theme.
fn control(name: &str) -> String {
    format!(":root:has(.lt-theme-control[value=\"{name}\"]:checked)")
}

/// Puts the theme together, in its own layer, `lotek-theme`, declared after
/// `lotek`. The declaration decides the order regardless of when the style
/// sheets load: both Astro and TanStack Start insert bundled CSS right before
/// `</head>`, after a `<link>` the app has written itself.
fn to_css(
    light: &Declarations,
    dark: &Declarations,
    typography: Option<&Json>,
    shape: Option<&Json>,
    brands: &[Brand],
) -> Result<String, String> {
    let typographic = typography
        .map(typography_declarations)
        .transpose()?
        .unwrap_or_default();
    let formal = shape
        .map(shape_declarations)
        .transpose()?
        .unwrap_or_default();
    let mut root: Declarations = light.clone();
    for (n, v) in typographic.into_iter().chain(formal) {
        match root.iter_mut().find(|(k, _)| *k == n) {
            Some(existing) => existing.1 = v,
            None => root.push((n, v)),
        }
    }

    let mut parts: Vec<String> = Vec::new();
    if !root.is_empty() {
        parts.push(format!("  :root {{\n{}\n  }}", lines(&root, "    ")));
    }
    // The font is set as a real rule: LO-TEK inherits the font on purpose, so
    // a token alone would not change a single letter.
    if given(path(typography, "fontFamily")).is_some() {
        parts.push("  :root {\n    font-family: var(--lt-font-family-base);\n  }".into());
    }
    // Both attributes are written, not only the dark one: `data-theme` is a
    // theme boundary and works on any element.
    if !dark.is_empty() {
        parts.push(format!(
            "  @media (prefers-color-scheme: dark) {{\n    :root:not([data-theme=\"light\"]) {{\n{}\n    }}\n  }}",
            lines(dark, "      ")
        ));
        parts.push(format!(
            "  [data-theme=\"light\"],\n  {} {{\n{}\n  }}",
            control("light"),
            lines(light, "    ")
        ));
        parts.push(format!(
            "  [data-theme=\"dark\"],\n  {} {{\n{}\n  }}",
            control("dark"),
            lines(dark, "    ")
        ));
    }

    // What became of each brand colour is written into the file, so it
    // still says so after the output of the run is gone. Only `given` and
    // the fills are written, and all three are colours the core has made.
    let became = if brands.is_empty() {
        String::new()
    } else {
        let rows: Vec<String> = brands.iter().map(|b| format!(" * {}", b.summary)).collect();
        format!("/*\n{}\n */\n\n", rows.join("\n"))
    };

    Ok([
        "/* Generated by @lo-tek/interfaces. Edit the recipe, not this file. */",
        "",
        &format!("{became}@layer lotek, lotek-theme;"),
        "",
        "@layer lotek-theme {",
        &parts.join("\n\n"),
        "}",
        "",
    ]
    .join("\n"))
}

pub struct Theme {
    pub light: Declarations,
    pub dark: Declarations,
    pub violations: Vec<Violation>,
    /// What became of each brand colour the recipe gave, in the order of the
    /// families.
    pub brands: Vec<Brand>,
    pub css: String,
}

/// What became of one brand colour.
///
/// The lightness is the role's, so a light brand colour comes out much
/// darker as a fill. The theme says so rather than leaving it to be found.
pub struct Brand {
    pub family: String,
    /// The colour the recipe gave, as `#rrggbb`. Never the text as written:
    /// it ends up in a CSS comment.
    pub given: String,
    pub light: BrandFill,
    pub dark: BrandFill,
    /// What became of the colour, in one sentence: the line the run writes
    /// first, and the row of the comment in the generated file.
    pub summary: String,
    /// Why, in sentences: for each appearance where the colour could not be
    /// the fill as it is, which promises it would break, and then for each
    /// where the fill has less chroma, how much it kept. The numbers are
    /// those of `light` and `dark`. A host shows these, and writes none.
    pub reasons: Vec<String>,
}

/// A promise about the fill, as what it is measured against. The contract
/// names its promises for the matrix, `fill on raised`, and a reader of the
/// theme has not read the contract. A promise that is not known here is said
/// by its name.
fn plainly(promise: &str) -> &str {
    match promise {
        "fill on canvas" => "against the page it",
        "fill on raised" => "against a raised surface it",
        "content on top of fill" => "text on it",
        other => other,
    }
}

/// What the theme says about one brand colour: the summary and the reasons.
///
/// The lightness is the role's, so the colour is moved, and a light one is
/// moved far. The theme says so, with the reason in plain words, rather than
/// answering only that every promise holds.
fn says(family: &str, given: &str, light: &BrandFill, dark: &BrandFill) -> (String, Vec<String>) {
    let summary = format!(
        "{family}: {given} gives the fill {} in the light theme and {} in the dark theme.",
        light.fill, dark.fill
    );
    let appearances = [("light", light), ("dark", dark)];
    let mut reasons = Vec::new();
    for (appearance, fill) in appearances {
        if fill.breaks.is_empty() {
            continue;
        }
        let breaks: Vec<String> = fill
            .breaks
            .iter()
            .map(|v| {
                format!(
                    "{} would have a contrast of {}:1, and {}:1 is required",
                    plainly(&v.promise),
                    to_fixed2(v.ratio),
                    js_number(v.required)
                )
            })
            .collect();
        reasons.push(format!(
            "In the {appearance} theme {given} cannot be the fill as it is: {}.",
            breaks.join("; ")
        ));
    }
    for (appearance, fill) in appearances {
        let percent = (fill.chroma_kept * 100.0).round();
        if percent < 100.0 {
            reasons.push(format!(
                "In the {appearance} theme the fill is less saturated than {given}, with {percent}% of its chroma: a screen cannot show more at that lightness."
            ));
        }
    }
    (summary, reasons)
}

/// The fill a brand colour got in one appearance.
pub struct BrandFill {
    pub fill: String,
    /// The promises about `fill` the given colour would break if it were
    /// the fill itself. Empty when it could have been.
    pub breaks: Vec<Violation>,
    /// The share of the brand colour's chroma the fill has. Below 1 when
    /// sRGB cannot show that much chroma at the lightness of the role.
    pub chroma_kept: f64,
}

fn brand_fill(
    matrix: &Matrix,
    appearance: Appearance,
    family: &str,
    given: &str,
) -> Result<BrandFill, String> {
    let name = token_name(family, "fill");
    Ok(BrandFill {
        chroma_kept: fill_chroma_kept(given, appearance)?,
        fill: matrix
            .tokens
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v.clone())
            .unwrap_or_default(),
        breaks: breaks_as_fill(matrix, family, given)?,
    })
}

/// The keys a recipe has besides the families: the two blocks, and `$schema`,
/// which editors write in by themselves and which says nothing about the theme.
const BLOCKS: [&str; 3] = ["typography", "shape", "$schema"];

const TYPOGRAPHY_KEYS: [&str; 3] = ["fontFamily", "weights", "lineHeights"];
const WEIGHT_KEYS: [&str; 4] = ["regular", "medium", "semibold", "bold"];
const LINE_KEYS: [&str; 4] = ["default", "heading", "article", "compact"];
const SHAPE_KEYS: [&str; 5] = [
    "buttonRadius",
    "fieldRadius",
    "surfaceRadius",
    "buttonBorderWidth",
    "buttonFontWeight",
];

/// The keys in the recipe the theme does not have, each as the segments of
/// its path: those at the top in the order they stand, then those in each
/// block. A block that is not an object has no keys, and is refused as a
/// value instead.
///
/// Every host builds its theme here, so this is where a key is known or not.
fn unknown_paths(input: &Json, families: &[String]) -> Vec<Vec<String>> {
    let keys = |value: Option<&Json>| -> Vec<String> {
        match value {
            Some(Json::Object(entries)) => entries.iter().map(|(key, _)| key.clone()).collect(),
            _ => Vec::new(),
        }
    };
    let mut unknown: Vec<Vec<String>> = keys(Some(input))
        .into_iter()
        .filter(|key| !families.contains(key) && !BLOCKS.contains(&key.as_str()))
        .map(|key| vec![key])
        .collect();
    let typography = input.get("typography");
    for (at, value, allowed) in [
        (&["typography"][..], typography, &TYPOGRAPHY_KEYS[..]),
        (
            &["typography", "weights"][..],
            path(typography, "weights"),
            &WEIGHT_KEYS[..],
        ),
        (
            &["typography", "lineHeights"][..],
            path(typography, "lineHeights"),
            &LINE_KEYS[..],
        ),
        (&["shape"][..], input.get("shape"), &SHAPE_KEYS[..]),
    ] {
        unknown.extend(
            keys(value)
                .into_iter()
                .filter(|key| !allowed.contains(&key.as_str()))
                .map(|key| at.iter().map(|s| s.to_string()).chain([key]).collect()),
        );
    }
    unknown
}

/// What kind of problem a recipe has. A host that treats them differently
/// reads this, and never the message.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RecipeKind {
    /// A key the recipe does not have.
    Unknown,
    /// A value the core does not take.
    Refused,
    /// The recipe gives nothing. About the recipe as a whole.
    Empty,
    /// The input is not an object. About the recipe as a whole.
    NotARecipe,
}

impl RecipeKind {
    /// The kind as the hosts are given it.
    pub fn as_str(&self) -> &'static str {
        match self {
            RecipeKind::Unknown => "unknown",
            RecipeKind::Refused => "refused",
            RecipeKind::Empty => "empty",
            RecipeKind::NotARecipe => "notARecipe",
        }
    }
}

/// One thing that is wrong with a recipe.
#[derive(Clone, Debug, PartialEq)]
pub struct RecipeProblem {
    /// The key it is about, as the segments of its path: `shape`,
    /// `buttonRadius`. Empty when it is about the recipe as a whole. A key
    /// may have a dot in its name, so the path is never one text.
    pub path: Vec<String>,
    pub kind: RecipeKind,
    /// The sentence for a person.
    pub message: String,
}

const EMPTY: &str = "The theme is empty. Give either brand colours, or typography and shape.";
/// What a colour is, said after a colour that is not one. A value of
/// typography or shape that is refused says what is wrong with it itself.
const COLOUR_HINT: &str = "Colours are written as hexadecimal values, for example #7c3aed.";
const NOT_A_RECIPE: &str = "The recipe is not an object. Write it as an object with the colours in it, for example {\"accent\": \"#7c3aed\"}.";

/// The variable a key of typography or shape is written to, the first of
/// them where it is written to several. `checked` names the key from it.
fn variable(block: &str, key: &str) -> String {
    match (block, key) {
        ("typography", "fontFamily") => "--lt-font-family-base".into(),
        ("weights", key) => format!("--lt-font-weight-{key}"),
        ("lineHeights", key) => format!("--lt-line-height-{key}"),
        ("shape", "buttonRadius") => format!("--lt-{}-radius", BUTTONS[0]),
        ("shape", "fieldRadius") => format!("--lt-{}-radius", FIELDS[0]),
        ("shape", "surfaceRadius") => format!("--lt-{}-radius", SURFACES[0]),
        ("shape", "buttonBorderWidth") => "--lt-button-border-width".into(),
        (_, _) => "--lt-button-font-weight".into(),
    }
}

/// What is wrong with a recipe, all at once and in a fixed order: what is
/// wrong with the recipe as a whole, then the keys the theme does not have,
/// then the values it refuses, in the order of the keys. Empty exactly when
/// `build_theme` takes the recipe, which is no coincidence: `build_theme`
/// asks here first, and builds only what this has nothing to say about.
///
/// `build_theme` answers with one sentence, which is right for a run and
/// wrong for a form with a field per key. A host with such a form asks here,
/// and gets every reason with the key it belongs to.
pub fn check_recipe(input: &Json) -> Vec<RecipeProblem> {
    read(input).1
}

/// One value a recipe gives: the key, as the segments of its path, and the
/// value as the text the core makes of it.
#[derive(Clone, Debug, PartialEq)]
pub struct RecipeValue {
    pub path: Vec<String>,
    pub text: String,
}

/// What a recipe gives, as the core reads it: each key that has a value, in
/// the order of the keys, with the value as text. A number is its text, and
/// a key that is not given is not there.
///
/// A text the core then refuses is here, with a problem beside it in
/// `check_recipe`: it is a value, only not one the theme takes. What cannot
/// be a value, `true`, a list or an object, is not, and neither is a key the
/// theme does not have. A host that shows a recipe in a form fills the form
/// from this, and has no reading of its own to disagree with the core's.
pub fn recipe_values(input: &Json) -> Vec<RecipeValue> {
    read(input).0
}

/// The one reading of a recipe: what it gives, and what is wrong with it.
fn read(input: &Json) -> (Vec<RecipeValue>, Vec<RecipeProblem>) {
    let contract = contract();
    let mut values: Vec<RecipeValue> = Vec::new();
    let gives = |path: &[&str], text: &str| RecipeValue {
        path: path.iter().map(|s| s.to_string()).collect(),
        text: text.to_string(),
    };
    let whole = |kind, message: &str| {
        vec![RecipeProblem {
            path: Vec::new(),
            kind,
            message: message.into(),
        }]
    };
    if !matches!(input, Json::Object(_)) {
        return (values, whole(RecipeKind::NotARecipe, NOT_A_RECIPE));
    }
    let mut problems: Vec<RecipeProblem> = unknown_paths(input, &contract.families)
        .into_iter()
        .map(|path| RecipeProblem {
            message: format!("Unknown key in the recipe: {}", path.join(".")),
            kind: RecipeKind::Unknown,
            path,
        })
        .collect();
    let refused = |path: &[&str], message: String| RecipeProblem {
        path: path.iter().map(|s| s.to_string()).collect(),
        kind: RecipeKind::Refused,
        message,
    };
    // The key is named as in every other sentence about a value: a family
    // by its name, a key of typography or shape as `checked` names it.
    let not_a_value = |name: &str, value: Option<&Json>| {
        format!(
            "The value of {name} must be text or a number. Got: {}",
            value.map(Json::to_compact).unwrap_or_default()
        )
    };

    for name in &contract.families {
        let at = [name.as_str()];
        let value = input.get(name);
        match leaf(value, false) {
            Err(()) => problems.push(refused(&at, not_a_value(name, value))),
            Ok(None) => {}
            Ok(Some(text)) => {
                values.push(gives(&at, &text));
                if let Err(message) = parse_hex(&text) {
                    problems.push(refused(&at, format!("{message}. {COLOUR_HINT}")));
                }
            }
        }
    }

    // A block is an object with its keys in it, or it is not given. Its
    // keys are looked at only when it is an object.
    let mut blocks: Vec<(Vec<&str>, Option<&Json>, &[&str])> = Vec::new();
    let typography = input.get("typography");
    blocks.push((vec!["typography"], typography, &["fontFamily"][..]));
    blocks.push((
        vec!["typography", "weights"],
        path(
            typography.filter(|t| matches!(t, Json::Object(_))),
            "weights",
        ),
        &WEIGHT_KEYS[..],
    ));
    blocks.push((
        vec!["typography", "lineHeights"],
        path(
            typography.filter(|t| matches!(t, Json::Object(_))),
            "lineHeights",
        ),
        &LINE_KEYS[..],
    ));
    blocks.push((vec!["shape"], input.get("shape"), &SHAPE_KEYS[..]));
    for (at, block, keys) in blocks {
        match block {
            // Not given, as for a value: absent, `null`, `false` or an
            // empty text.
            None | Some(Json::Null) | Some(Json::Bool(false)) => continue,
            Some(Json::String(text)) if text.is_empty() => continue,
            Some(Json::Object(_)) => {}
            Some(other) => {
                problems.push(refused(
                    &at,
                    format!(
                        "{} is not an object with its keys in it. Got: {}",
                        at.join("."),
                        other.to_compact()
                    ),
                ));
                continue;
            }
        }
        for key in keys {
            let mut here = at.clone();
            here.push(key);
            let value = path(block, key);
            let variable = variable(at[at.len() - 1], key);
            match leaf(value, true) {
                Err(()) => {
                    problems.push(refused(&here, not_a_value(&recipe_name(&variable), value)))
                }
                Ok(None) => {}
                Ok(Some(text)) => {
                    values.push(gives(&here, &text));
                    if let Err(message) = checked(&variable, &text) {
                        problems.push(refused(&here, message));
                    }
                }
            }
        }
    }

    if problems.is_empty() && values.is_empty() {
        return (values, whole(RecipeKind::Empty, EMPTY));
    }
    (values, problems)
}

/// The one sentence `build_theme` refuses a recipe with: every key it does
/// not have, when there are any, since a typo is the most likely reason for
/// whatever else is wrong, and otherwise the first problem.
fn refusal(problems: &[RecipeProblem]) -> String {
    let unknown: Vec<String> = problems
        .iter()
        .filter(|p| p.kind == RecipeKind::Unknown)
        .map(|p| p.path.join("."))
        .collect();
    if unknown.is_empty() {
        problems[0].message.clone()
    } else {
        format!("Unknown key in the recipe: {}", unknown.join(", "))
    }
}

/// Builds the theme, and checks every promise while it is built.
///
/// `input` is the recipe: the brand colours per family, and `typography` and
/// `shape`. A family that is left out inherits LO-TEK's own hue.
pub fn build_theme(input: &Json) -> Result<Theme, String> {
    if !contract::loaded() {
        return Err(contract::NOT_LOADED.into());
    }
    let contract = contract();
    // Before anything else: what is wrong with the recipe, if anything is.
    // What follows builds a recipe that has nothing wrong with it.
    let problems = check_recipe(input);
    if !problems.is_empty() {
        return Err(refusal(&problems));
    }
    let given_families: Vec<(&str, String)> = contract
        .families
        .iter()
        .filter_map(|name| Some((name.as_str(), leaf(input.get(name), false).ok()??)))
        .collect();
    let typography = given_block(input.get("typography"));
    let shape = given_block(input.get("shape"));

    // A theme without colours is not a curiosity: when the organisation
    // already uses LO-TEK's colours, the font and the corners are what set it apart.
    if given_families.is_empty() {
        return Ok(Theme {
            light: vec![],
            dark: vec![],
            violations: vec![],
            brands: vec![],
            css: to_css(&vec![], &vec![], typography, shape, &[])?,
        });
    }

    let (light, dark, given) = brands_of(&given_families)?;
    let css = to_css(&light.tokens, &dark.tokens, typography, shape, &given)?;
    Ok(Theme {
        brands: given,
        violations: light
            .violations
            .into_iter()
            .chain(dark.violations)
            .collect(),
        light: light.tokens,
        dark: dark.tokens,
        css,
    })
}

/// The two matrices of a theme with these colours, and what became of each
/// colour. A family that is not given has LO-TEK's own.
///
/// What a colour becomes is not its own business alone: the neutral family
/// sets the page and the raised surface every fill is measured against.
fn brands_of(given_families: &[(&str, String)]) -> Result<(Matrix, Matrix, Vec<Brand>), String> {
    let mut brands = contract().brands.clone();
    for (name, value) in given_families {
        if let Some(entry) = brands.iter_mut().find(|(n, _)| n == name) {
            entry.1 = value.clone();
        }
    }
    let light = build_matrix(&brands, Appearance::Light)?;
    let dark = build_matrix(&brands, Appearance::Dark)?;
    let given = given_families
        .iter()
        .map(|(name, value)| {
            let given = to_hex(parse_hex(value)?);
            let in_light = brand_fill(&light, Appearance::Light, name, &given)?;
            let in_dark = brand_fill(&dark, Appearance::Dark, name, &given)?;
            let (summary, reasons) = says(name, &given, &in_light, &in_dark);
            Ok(Brand {
                family: name.to_string(),
                light: in_light,
                dark: in_dark,
                given,
                summary,
                reasons,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok((light, dark, given))
}

/// What became of each colour the core takes, whatever else in the recipe is
/// wrong: the rows `build_theme` gives as `brands`, for every family whose
/// own value is a colour. A family whose value is refused has no row, and
/// the others are as they would be without it.
///
/// `build_theme` answers nothing for a recipe with one thing wrong. A form
/// that shows what each colour becomes wants the rows of the colours that
/// are right while another field is still being written, and would
/// otherwise have to take the recipe apart and ask again.
pub fn recipe_brands(input: &Json) -> Vec<Brand> {
    let (values, problems) = read(input);
    let families = &contract().families;
    let taken: Vec<(&str, String)> = values
        .iter()
        .filter(|value| value.path.len() == 1 && families.contains(&value.path[0]))
        .filter(|value| !problems.iter().any(|problem| problem.path == value.path))
        .map(|value| (value.path[0].as_str(), value.text.clone()))
        .collect();
    // No colour, no rows, and no matrices built to find that out: a form
    // asks at every change.
    if taken.is_empty() {
        return Vec::new();
    }
    brands_of(&taken)
        .map(|(_, _, rows)| rows)
        .unwrap_or_default()
}

/// A block of the recipe, when it has at least one key. An empty object and
/// a block that is not given have none. What is neither an object nor "not
/// given" has been refused before this is asked.
fn given_block(value: Option<&Json>) -> Option<&Json> {
    value.filter(|v| matches!(v, Json::Object(entries) if !entries.is_empty()))
}

#[cfg(test)]
mod recipe_tests {
    use super::*;
    use crate::json::parse;

    fn theme(recipe: &str) -> Result<Theme, String> {
        build_theme(&parse(recipe).unwrap())
    }

    #[test]
    fn loteks_own_colors_keep_every_promise() {
        let t = theme(r##"{"accent": "#1362ae"}"##).unwrap();
        assert!(t.violations.is_empty(), "{:?}", t.violations);
        assert!(t
            .light
            .iter()
            .any(|(n, _)| n == "--lt-color-neutral-canvas"));
        assert_eq!(t.light.len(), t.dark.len());
    }

    #[test]
    fn says_which_value_is_dangerous_by_the_name_in_the_recipe() {
        let error = theme(r#"{"shape": {"buttonRadius": "4px; } html { display: none }"}}"#)
            .err()
            .unwrap();
        assert!(error.starts_with("The value of buttonRadius"), "{error}");
        let error = theme(r#"{"typography": {"fontFamily": "Arial ("}}"#)
            .err()
            .unwrap();
        assert!(error.contains("parenthesis"), "{error}");
    }

    #[test]
    fn a_square_bracket_that_is_not_closed_is_refused_like_a_parenthesis() {
        // In a browser `Inter [` as the font opens a block that swallows
        // what follows it in the rule, as an unclosed `(` does.
        for value in ["Inter [", "Inter ]", "Inter [a", "a]b[", "calc(1px [) ]"] {
            let recipe = format!(r#"{{"typography": {{"fontFamily": "{value}"}}}}"#);
            assert_eq!(
                theme(&recipe).err(),
                Some(format!(
                    "The value of fontFamily has an unbalanced parenthesis, bracket or quote. A parenthesis that is not closed swallows the rest of the style sheet. Got: {value}"
                )),
                "{value}"
            );
        }
        // A pair is a pair, and a bracket in a quoted name is text.
        for value in ["a[b]", "Inter, [system]", "'Segoe [' , Arial"] {
            let recipe = format!(r#"{{"typography": {{"fontFamily": "{value}"}}}}"#);
            let css = theme(&recipe)
                .unwrap_or_else(|error| panic!("{value}: {error}"))
                .css;
            assert!(
                css.contains(&format!("--lt-font-family-base: {value};")),
                "{css}"
            );
        }
    }

    #[test]
    fn writes_numbers_like_javascript() {
        let t =
            theme(r#"{"typography": {"weights": {"bold": 700}, "lineHeights": {"default": 1.5}}}"#)
                .unwrap();
        assert!(t.css.contains("--lt-font-weight-bold: 700;"), "{}", t.css);
        assert!(
            t.css.contains("--lt-line-height-default: 1.5;"),
            "{}",
            t.css
        );
    }

    #[test]
    fn the_theme_control_stands_in_a_consumer_theme_too() {
        // The same asymmetry that hit `[data-theme="light"]` in 0.23.0:
        // without these the control switched to LO-TEK's own colours inside
        // a consumer theme, since only the attribute blocks had the theme's
        // values.
        let css = theme(r##"{"accent": "#7c3aed"}"##).unwrap().css;
        assert!(css.contains(r#":root:has(.lt-theme-control[value="light"]:checked)"#));
        assert!(css.contains(r#":root:has(.lt-theme-control[value="dark"]:checked)"#));
    }

    #[test]
    fn an_empty_recipe_is_an_error() {
        assert!(theme("{}").err().unwrap().starts_with("The theme is empty"));
        assert!(theme(r##"{"accent": "#zzz"}"##)
            .err()
            .unwrap()
            .contains("valid hexadecimal"));
    }

    #[test]
    fn an_unknown_key_in_the_recipe_is_an_error() {
        // A typo must not look like a recipe that worked: the colour was
        // dropped without a word, and the theme came out with LO-TEK's own.
        let error = theme(r##"{"accent": "#7c3aed", "dangr": "#b3261e"}"##)
            .err()
            .unwrap();
        assert_eq!(error, "Unknown key in the recipe: dangr");
    }

    #[test]
    fn the_unknown_keys_come_in_the_order_of_the_recipe() {
        // A key is known as it is written in the contract, not in another
        // case or another language.
        let error = theme(
            r##"{"radius": "4px", "accent": "#7c3aed", "aksent": "#000", "Accent": "#fff"}"##,
        )
        .err()
        .unwrap();
        assert_eq!(error, "Unknown key in the recipe: radius, aksent, Accent");
    }

    #[test]
    fn an_unknown_key_is_reported_before_anything_else() {
        // Before the colour is read, and before the recipe is found empty:
        // "The theme is empty" to someone who wrote `acent` sends them to
        // the wrong place.
        let error = theme(r##"{"accent": "#zzz", "acent": "#7c3aed"}"##)
            .err()
            .unwrap();
        assert_eq!(error, "Unknown key in the recipe: acent");
        let error = theme(r##"{"acent": "#7c3aed"}"##).err().unwrap();
        assert_eq!(error, "Unknown key in the recipe: acent");
    }

    #[test]
    fn the_schema_is_a_known_key_that_says_nothing_about_the_theme() {
        let t = theme(r##"{"$schema": "https://example.com/recipe.json", "accent": "#7c3aed"}"##)
            .unwrap();
        assert_eq!(t.brands.len(), 1);
        assert!(!t.css.contains("example.com"), "{}", t.css);
        let error = theme(r#"{"$schema": "https://example.com/recipe.json"}"#)
            .err()
            .unwrap();
        assert!(error.starts_with("The theme is empty"), "{error}");
    }

    #[test]
    fn a_recipe_with_every_known_key_builds() {
        // The families are read from the contract, so a family that is added
        // there and forgotten in the list of known keys turns this red.
        let colors: Vec<String> = contract()
            .families
            .iter()
            .map(|family| format!(r##""{family}": "#7c3aed""##))
            .collect();
        let recipe = format!(
            r#"{{"$schema": "https://example.com/recipe.json", {}, "typography": {{"fontFamily": "Georgia, serif"}}, "shape": {{"buttonRadius": "1rem"}}}}"#,
            colors.join(", ")
        );
        let t = theme(&recipe).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(t.brands.len(), contract().families.len());
        assert!(t.css.contains("--lt-button-radius: 1rem;"), "{}", t.css);
    }

    #[test]
    fn an_unknown_nested_key_is_named_with_its_path() {
        // `radius` alone would send the reader looking at the top of the file.
        for (recipe, key) in [
            (
                r#"{"typography": {"fontFamly": "Georgia"}}"#,
                "typography.fontFamly",
            ),
            (
                r#"{"typography": {"weights": {"blod": 700}}}"#,
                "typography.weights.blod",
            ),
            (
                r#"{"typography": {"lineHeights": {"body": 1.5}}}"#,
                "typography.lineHeights.body",
            ),
            (r#"{"shape": {"radius": "0"}}"#, "shape.radius"),
        ] {
            let error = theme(recipe).err().unwrap();
            assert_eq!(error, format!("Unknown key in the recipe: {key}"));
        }
    }

    #[test]
    fn the_unknown_keys_at_the_top_come_before_the_nested_ones() {
        let error = theme(r##"{"accent": "#7c3aed", "acent": "#000", "shape": {"radius": "0"}}"##)
            .err()
            .unwrap();
        assert_eq!(error, "Unknown key in the recipe: acent, shape.radius");
        // Then typography, its weights, its line heights and the shape,
        // wherever they stand in the recipe, each in the order of its keys.
        let error = theme(
            r##"{"shape": {"radius": "0", "corner": "0"}, "acent": "#000", "typography": {"lineHeights": {"body": 1.5}, "weights": {"blod": 700}, "font": "Inter"}, "form": {}}"##,
        )
        .err()
        .unwrap();
        assert_eq!(
            error,
            "Unknown key in the recipe: acent, form, typography.font, typography.weights.blod, typography.lineHeights.body, shape.radius, shape.corner"
        );
    }

    #[test]
    fn what_counts_as_not_given() {
        // Absent, `null`, an empty text and `false`, for every value. `0` is
        // not a colour, and so not given for a family; for a corner or a
        // line height it is a value, and is written.
        let alone = theme(r##"{"accent": "#7c3aed"}"##).unwrap().css;
        let t = theme(
            r##"{"accent": "#7c3aed", "danger": null, "success": "", "warning": false, "visited": 0, "typography": {"fontFamily": "", "weights": {"bold": null}, "lineHeights": {"article": false}}, "shape": {"buttonRadius": null, "fieldRadius": false, "surfaceRadius": ""}}"##,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(t.css, alone);
        let css = theme(
            r#"{"shape": {"fieldRadius": 0}, "typography": {"lineHeights": {"default": 0}}}"#,
        )
        .unwrap()
        .css;
        assert!(css.contains("--lt-input-radius: 0;"), "{css}");
        assert!(css.contains("--lt-line-height-default: 0;"), "{css}");
    }

    #[test]
    fn a_recipe_with_every_known_nested_key_builds() {
        let t = theme(
            r#"{
                "typography": {
                    "fontFamily": "Georgia, serif",
                    "weights": {"regular": 400, "medium": 500, "semibold": 600, "bold": 700},
                    "lineHeights": {"default": 1.5, "heading": 1.2, "article": 1.7, "compact": 1.3}
                },
                "shape": {
                    "buttonRadius": "1rem",
                    "fieldRadius": "2px",
                    "surfaceRadius": "4px",
                    "buttonBorderWidth": "2px",
                    "buttonFontWeight": 600
                }
            }"#,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        for declaration in [
            "--lt-font-weight-medium: 500;",
            "--lt-line-height-compact: 1.3;",
            "--lt-button-border-width: 2px;",
            "--lt-button-font-weight: 600;",
        ] {
            assert!(t.css.contains(declaration), "{declaration}\n{}", t.css);
        }
    }

    #[test]
    fn the_schema_of_the_recipe_has_the_keys_the_core_knows() {
        // The schema is what an editor completes and checks the recipe file
        // with. It is written by `interfaces/scripts/generate-theme-schema.ts`
        // from `interfaces/src/tokens/theme-keys.ts`, which is where a key
        // the core gains is added. A key the core knows and the schema lacks
        // is underlined in a recipe that works, and one the schema has and
        // the core lacks is suggested and then refused. Both ways, in every
        // place the core reads keys.
        let schema = parse(&crate::package_file("src/tokens/theme.schema.json")).unwrap();
        let families = contract().families.clone();
        let top: Vec<&str> = families.iter().map(String::as_str).chain(BLOCKS).collect();
        for (place, mut known) in [
            (vec![], top),
            (vec!["typography"], TYPOGRAPHY_KEYS.to_vec()),
            (vec!["typography", "weights"], WEIGHT_KEYS.to_vec()),
            (vec!["typography", "lineHeights"], LINE_KEYS.to_vec()),
            (vec!["shape"], SHAPE_KEYS.to_vec()),
        ] {
            let mut object = &schema;
            for key in &place {
                object = object
                    .get("properties")
                    .and_then(|properties| properties.get(key))
                    .unwrap_or_else(|| panic!("the schema has no {place:?}"));
            }
            let mut described: Vec<&str> = object
                .get("properties")
                .and_then(Json::as_object)
                .unwrap_or_else(|| panic!("{place:?} has no properties in the schema"))
                .iter()
                .map(|(key, _)| key.as_str())
                .collect();
            described.sort_unstable();
            known.sort_unstable();
            assert_eq!(
                described, known,
                "{place:?}: the schema and the core do not have the same keys. The schema's are written from interfaces/src/tokens/theme-keys.ts; run bun run generate in interfaces/ after changing it"
            );
            // Without this the schema lets through the key the core refuses.
            assert!(
                matches!(object.get("additionalProperties"), Some(Json::Bool(false))),
                "{place:?} is open to other keys in the schema"
            );
        }
    }

    #[test]
    fn the_radius_of_the_surfaces_reaches_the_panel_of_a_term() {
        // The panel is a surface like the popover.
        let css = theme(r#"{"shape": {"surfaceRadius": "4px"}}"#).unwrap().css;
        assert!(
            css.contains("    --lt-tooltip-radius: 4px;\n    --lt-term-radius: 4px;\n"),
            "{css}"
        );
        assert_eq!(css.matches("-radius: 4px;").count(), 12, "{css}");
        // And only that key: the button and the field have their own.
        let css = theme(r#"{"shape": {"buttonRadius": "1rem", "fieldRadius": "2px"}}"#)
            .unwrap()
            .css;
        assert!(!css.contains("--lt-term-radius"), "{css}");
    }

    /// The corners the recipe leaves alone on purpose. There the corner is
    /// not a style choice but the shape itself: a checkbox that turns round
    /// looks like a radio button, and a badge that turns square looks like a
    /// button. The page about your own theme says the same in prose.
    const LEFT_OUT: [&str; 7] = [
        "checkbox",
        "badge",
        "tag",
        "toggle-group",
        "avatar",
        "skeleton",
        "progress",
    ];

    /// Every `<name>` in a `var(--lt-<name>-radius` in the stylesheets of
    /// the components, sorted, each once.
    fn radius_hooks() -> Vec<String> {
        fn sheets(folder: &std::path::Path, out: &mut Vec<String>) {
            for entry in std::fs::read_dir(folder).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    sheets(&path, out);
                } else if path.extension().is_some_and(|e| e == "css") {
                    out.push(std::fs::read_to_string(&path).unwrap());
                }
            }
        }
        let mut css = Vec::new();
        sheets(
            std::path::Path::new(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../interfaces/src/components"
            )),
            &mut css,
        );
        let mut hooks: Vec<String> = css
            .iter()
            .flat_map(|sheet| sheet.split("var(").skip(1))
            .filter_map(|after| {
                let name: String = after
                    .trim_start()
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                    .collect();
                Some(
                    name.strip_prefix("--lt-")?
                        .strip_suffix("-radius")?
                        .to_string(),
                )
            })
            .collect();
        hooks.sort_unstable();
        hooks.dedup();
        hooks
    }

    #[test]
    fn every_corner_in_the_stylesheets_is_set_by_the_recipe_or_left_out_on_purpose() {
        // A component with a corner of its own is either reached by one of
        // the three keys or named among those left out, and someone has to
        // decide which. Both ways, so a list cannot keep a name the
        // stylesheets no longer read, and no name is in two lists.
        let hooks = radius_hooks();
        assert!(hooks.len() > 20, "found only {hooks:?}");
        let mut decided: Vec<String> = BUTTONS
            .iter()
            .chain(&FIELDS)
            .chain(&SURFACES)
            .chain(&LEFT_OUT)
            .map(|name| name.to_string())
            .collect();
        decided.sort_unstable();
        let twice: Vec<&String> = decided
            .windows(2)
            .filter(|pair| pair[0] == pair[1])
            .map(|pair| &pair[0])
            .collect();
        assert!(twice.is_empty(), "in two lists: {twice:?}");
        let undecided: Vec<&String> = hooks.iter().filter(|h| !decided.contains(h)).collect();
        assert!(
            undecided.is_empty(),
            "a stylesheet reads the corner of {undecided:?}, which no key of the recipe sets and which is not left out on purpose"
        );
        let gone: Vec<&String> = decided.iter().filter(|d| !hooks.contains(d)).collect();
        assert!(
            gone.is_empty(),
            "no stylesheet reads the corner of {gone:?}"
        );
    }

    /// A problem as the expected results write one: the path, the kind and
    /// the message.
    fn written(problem: &RecipeProblem) -> (Vec<String>, String, String) {
        (
            problem.path.clone(),
            problem.kind.as_str().to_string(),
            problem.message.clone(),
        )
    }

    /// A file of expected results in `core/theme/`, as its cases by name.
    fn expected(file: &str) -> Vec<(String, Json)> {
        let path = format!("{}/theme/{file}", env!("CARGO_MANIFEST_DIR"));
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        parse(&text).unwrap().as_object().unwrap().to_vec()
    }

    /// What `build_theme` must say of a recipe with these problems: every
    /// unknown key in one sentence, or else the first problem, or nothing.
    fn refusal(problems: &[RecipeProblem]) -> Option<String> {
        let unknown: Vec<String> = problems
            .iter()
            .filter(|p| p.kind.as_str() == "unknown")
            .map(|p| p.path.join("."))
            .collect();
        if !unknown.is_empty() {
            return Some(format!("Unknown key in the recipe: {}", unknown.join(", ")));
        }
        problems.first().map(|p| p.message.clone())
    }

    #[test]
    fn check_recipe_and_build_theme_answer_as_the_expected_results_say() {
        // The same file the package and Kotlin are held to: the problems, in
        // their order, and the one sentence `build_theme` makes of them.
        let cases = expected("recipe-checks.json");
        assert!(cases.len() > 18, "only {} cases", cases.len());
        for (name, case) in &cases {
            let wanted: Vec<(Vec<String>, String, String)> = case
                .get("problems")
                .and_then(Json::as_array)
                .unwrap()
                .iter()
                .map(|problem| {
                    let text = |key: &str| problem.get(key).unwrap().as_str().unwrap().to_string();
                    let path = problem.get("path").and_then(Json::as_array).unwrap();
                    (
                        path.iter()
                            .map(|part| part.as_str().unwrap().to_string())
                            .collect(),
                        text("kind"),
                        text("message"),
                    )
                })
                .collect();
            let recipe = case.get("recipe").unwrap();
            let found: Vec<_> = check_recipe(recipe).iter().map(written).collect();
            assert_eq!(found, wanted, "{name}");
            assert_eq!(
                build_theme(recipe).err(),
                case.get("refusal")
                    .and_then(Json::as_str)
                    .map(str::to_string),
                "{name}"
            );
            // And what the recipe gives: the path and the text of each value.
            let values: Vec<(Vec<String>, String)> = case
                .get("values")
                .and_then(Json::as_array)
                .unwrap()
                .iter()
                .map(|value| {
                    let path = value.get("path").and_then(Json::as_array).unwrap();
                    (
                        path.iter()
                            .map(|part| part.as_str().unwrap().to_string())
                            .collect(),
                        value.get("text").unwrap().as_str().unwrap().to_string(),
                    )
                })
                .collect();
            let given: Vec<(Vec<String>, String)> = recipe_values(recipe)
                .into_iter()
                .map(|value| (value.path, value.text))
                .collect();
            assert_eq!(given, values, "{name}");
        }
    }

    /// A row of `brands`, written out so that two answers can be compared.
    fn row(brand: &Brand) -> String {
        let fill = |fill: &BrandFill| {
            let breaks: Vec<String> = fill
                .breaks
                .iter()
                .map(|v| format!("{} {} {} {}", v.family, v.promise, v.ratio, v.required))
                .collect();
            format!("{} {} {:?}", fill.fill, fill.chroma_kept, breaks)
        };
        format!(
            "{} {} | {} | {:?} | {} | {}",
            brand.family,
            brand.given,
            brand.summary,
            brand.reasons,
            fill(&brand.light),
            fill(&brand.dark)
        )
    }

    #[test]
    fn recipe_brands_has_a_row_for_the_families_the_expected_results_say() {
        // The same file the package and Kotlin are held to. `brands` there is
        // the families with a row, worked out by hand from each case: the
        // families the recipe gives a value the core does not refuse.
        let cases = expected("recipe-checks.json");
        let mut rows = 0;
        for (name, case) in &cases {
            let wanted: Vec<String> = case
                .get("brands")
                .and_then(Json::as_array)
                .unwrap_or_else(|| panic!("{name} does not say which families have a row"))
                .iter()
                .map(|family| family.as_str().unwrap().to_string())
                .collect();
            let found: Vec<String> = recipe_brands(case.get("recipe").unwrap())
                .into_iter()
                .map(|brand| brand.family)
                .collect();
            assert_eq!(found, wanted, "{name}");
            rows += found.len();
        }
        assert!(rows > 0, "no case has a row");
    }

    #[test]
    fn recipe_brands_is_what_became_of_each_colour_the_core_takes() {
        // Over the expected results and six thousand recipes with something
        // odd at every place:
        // - a family has a row exactly when the recipe gives it a value and
        //   `check_recipe` does not refuse that value, and the rows are in
        //   the order of the families;
        // - a row is the row the theme of that colour and the neutral one
        //   alone has: nothing else in the recipe, right or wrong, changes
        //   it;
        // - for a recipe `build_theme` takes, the rows are its `brands`.
        let families = &contract().families;
        let mut recipes: Vec<Json> = ["recipes.json", "recipe-checks.json"]
            .iter()
            .flat_map(|file| expected(file))
            .map(|(_, case)| case.get("recipe").unwrap().clone())
            .collect();
        let mut seed = 20261124;
        for _ in 0..6000 {
            recipes.push(odd_recipe(&mut seed));
        }
        let (mut built, mut beside_something_wrong, mut without_a_row, mut beside_neutral) =
            (0, 0, 0, 0);
        for recipe in &recipes {
            let rows = recipe_brands(recipe);
            let problems = check_recipe(recipe);
            let wanted: Vec<RecipeValue> = recipe_values(recipe)
                .into_iter()
                .filter(|value| value.path.len() == 1 && families.contains(&value.path[0]))
                .filter(|value| {
                    !problems
                        .iter()
                        .any(|p| p.kind.as_str() == "refused" && p.path == value.path)
                })
                .collect();
            assert_eq!(
                rows.iter().map(|brand| &brand.family).collect::<Vec<_>>(),
                wanted
                    .iter()
                    .map(|value| &value.path[0])
                    .collect::<Vec<_>>(),
                "{}",
                recipe.to_compact()
            );
            // The page and the raised surface a fill is measured against
            // are the neutral family's, so a row is told by its own colour
            // and the neutral one, when the core takes that.
            let neutral = wanted.iter().find(|value| value.path[0] == "neutral");
            for (brand, value) in rows.iter().zip(&wanted) {
                let alone = Json::Object(
                    [Some(value), neutral.filter(|n| n.path != value.path)]
                        .into_iter()
                        .flatten()
                        .map(|value| (value.path[0].clone(), Json::String(value.text.clone())))
                        .collect(),
                );
                let theme = build_theme(&alone)
                    .unwrap_or_else(|e| panic!("{} alone: {e}", alone.to_compact()));
                let same = theme
                    .brands
                    .iter()
                    .find(|other| other.family == brand.family)
                    .unwrap_or_else(|| panic!("{} has no {}", alone.to_compact(), brand.family));
                assert_eq!(
                    row(brand),
                    row(same),
                    "{} of {}",
                    value.path[0],
                    recipe.to_compact()
                );
                if neutral.is_some() && value.path[0] != "neutral" {
                    beside_neutral += 1;
                }
            }
            match build_theme(recipe) {
                Ok(theme) => {
                    assert_eq!(
                        rows.iter().map(row).collect::<Vec<_>>(),
                        theme.brands.iter().map(row).collect::<Vec<_>>(),
                        "{}",
                        recipe.to_compact()
                    );
                    built += 1;
                }
                Err(_) if !rows.is_empty() => beside_something_wrong += 1,
                Err(_) => without_a_row += 1,
            }
        }
        assert!(
            built > 0 && beside_something_wrong > 0 && without_a_row > 0 && beside_neutral > 0,
            "{built} recipes built, {beside_something_wrong} refused with a row, {without_a_row} refused without one, {beside_neutral} rows beside a neutral colour"
        );
    }

    #[test]
    fn what_is_no_recipe_has_no_rows() {
        for text in [
            "{}",
            "[]",
            "[\"#7c3aed\"]",
            "\"#7c3aed\"",
            "null",
            "7",
            "true",
        ] {
            assert!(recipe_brands(&parse(text).unwrap()).is_empty(), "{text}");
        }
    }

    /// The families a palette has a colour for, in the order of its rows.
    const SUGGESTED: [&str; 5] = ["visited", "brand1", "brand2", "brand3", "neutral"];
    const PALETTES: [&str; 4] = ["Near", "Opposite", "Three ways", "One hue"];

    /// The recipe with these keys, each a text.
    fn recipe_of(entries: &[(&str, &str)]) -> Json {
        Json::Object(
            entries
                .iter()
                .map(|(key, value)| (key.to_string(), Json::String(value.to_string())))
                .collect(),
        )
    }

    fn lch(hex: &str) -> color::Oklch {
        color::rgb_to_oklch(parse_hex(hex).unwrap_or_else(|e| panic!("{hex}: {e}")))
    }

    /// How far apart two hues are, in degrees.
    fn apart(a: f64, b: f64) -> f64 {
        let d = (a - b).rem_euclid(360.0);
        d.min(360.0 - d)
    }

    /// LO-TEK's own colour for a family, from the contract.
    fn own(family: &str) -> String {
        let brands = &contract().brands;
        brands.iter().find(|(f, _)| f == family).unwrap().1.clone()
    }

    /// Accents all the way round, with a red, a yellow and a green one
    /// beside LO-TEK's danger, warning and success, and those three
    /// themselves.
    fn accents() -> Vec<String> {
        let mut accents: Vec<String> = [
            "#d32f2f", "#a82e39", "#f7df1e", "#896508", "#2e7d32", "#316f2a", "#7c3aed", "#1362ae",
            "#0000ff", "#00ffff", "#ff00aa",
        ]
        .iter()
        .map(|a| a.to_string())
        .collect();
        for step in 0..24 {
            accents.push(to_hex(color::oklch_to_rgb(color::Oklch {
                l: 0.6,
                c: 0.11,
                h: f64::from(step) * 15.0 + 7.0,
            })));
        }
        accents
    }

    /// An answer as the port writes it, for comparing with the expected results.
    fn palettes_json(found: Option<&Palettes>) -> Json {
        let text = |text: &str| Json::String(text.to_string());
        let Some(found) = found else {
            return Json::Null;
        };
        let palettes = found.palettes.iter().map(|palette| {
            let colors = palette.colors.iter().map(|color| {
                Json::Object(vec![
                    ("family".to_string(), text(&color.family)),
                    ("color".to_string(), text(&color.color)),
                    ("kept".to_string(), Json::Bool(color.kept)),
                ])
            });
            Json::Object(vec![
                ("name".to_string(), text(&palette.name)),
                ("description".to_string(), text(&palette.description)),
                ("colors".to_string(), Json::Array(colors.collect())),
            ])
        });
        Json::Object(vec![
            ("from".to_string(), text(&found.from)),
            ("palettes".to_string(), Json::Array(palettes.collect())),
        ])
    }

    #[test]
    fn suggest_palettes_answers_as_the_expected_results_say() {
        // The same file the package and Kotlin are held to, to the letter:
        // what the palettes are built on, their names and what they say
        // they are, and every row with its colour. The suggested colours in
        // the file are the core's own, recorded once the properties below
        // held them; what they must be is said there, and here that they
        // stay as they are and are the same in every host.
        let cases = expected("palettes.json");
        assert!(cases.len() > 20, "only {} cases", cases.len());
        let (mut answered, mut nothing) = (0, 0);
        for (name, case) in &cases {
            let found = suggest_palettes(case.get("recipe").unwrap());
            let wanted = case.get("expect").unwrap();
            assert_eq!(
                palettes_json(found.as_ref()).to_compact(),
                wanted.to_compact(),
                "{name}"
            );
            if found.is_some() {
                answered += 1;
            } else {
                nothing += 1;
            }
        }
        assert!(
            answered > 10 && nothing > 5,
            "{answered} answers and {nothing} without one"
        );
    }

    #[test]
    fn a_palette_is_the_same_whatever_the_recipe_keeps_or_gets_refused() {
        // The hues are placed before the rows are made: a brand the recipe
        // has set, or one the core refuses, takes its row and moves nothing
        // else. So the suggested rows of a recipe are those of the same
        // recipe without that brand.
        for accent in ["#d32f2f", "#f7df1e", "#2e7d32", "#7c3aed", "#1362ae"] {
            let alone = suggest_palettes(&recipe_of(&[("accent", accent)])).expect("an answer");
            for brand in ["brand1", "brand2", "brand3", "visited", "neutral"] {
                for value in ["#0d7a5f", "purple"] {
                    let beside =
                        suggest_palettes(&recipe_of(&[("accent", accent), (brand, value)]))
                            .expect("an answer");
                    for (with, without) in beside.palettes.iter().zip(&alone.palettes) {
                        let suggested = |palette: &Palette| {
                            palette
                                .colors
                                .iter()
                                .filter(|color| color.family != brand)
                                .map(|color| {
                                    (color.family.clone(), color.color.clone(), color.kept)
                                })
                                .collect::<Vec<_>>()
                        };
                        assert_eq!(
                            suggested(with),
                            suggested(without),
                            "{} of {accent} beside {brand} {value}",
                            with.name
                        );
                        assert_eq!(with.description, without.description);
                    }
                }
            }
        }
    }

    #[test]
    fn suggest_palettes_has_four_palettes_of_the_same_rows_whatever_else_the_recipe_has() {
        // Over the expected results and six thousand recipes with something
        // odd at every place:
        // - there is an answer exactly when the recipe is an object and
        //   the core does not refuse its accent;
        // - it is built on the accent the recipe gives, or LO-TEK's own;
        // - the four palettes are named, in order, and say what they are;
        // - each has a row for the five families, in order, less those the
        //   core refuses, and never one for danger, warning or success;
        // - a family the recipe gives is kept, as the colour `recipe_brands`
        //   says was given, and one it does not give is suggested;
        // - visited and neutral are the same in all four;
        // - every colour is written as `#rrggbb`.
        let mut recipes: Vec<Json> = ["recipes.json", "recipe-checks.json", "palettes.json"]
            .iter()
            .flat_map(|file| expected(file))
            .map(|(_, case)| case.get("recipe").unwrap().clone())
            .collect();
        let mut seed = 20261123;
        for _ in 0..6000 {
            recipes.push(odd_recipe(&mut seed));
        }
        let (mut answered, mut nothing, mut kept_rows, mut suggested_rows, mut without_a_row) =
            (0, 0, 0, 0, 0);
        for recipe in &recipes {
            let at = recipe.to_compact();
            let problems = check_recipe(recipe);
            let refused = |family: &str| problems.iter().any(|p| p.path == [family.to_string()]);
            let found = suggest_palettes(recipe);
            let answers = matches!(recipe, Json::Object(_)) && !refused("accent");
            assert_eq!(found.is_some(), answers, "{at}");
            let Some(found) = found else {
                nothing += 1;
                continue;
            };
            answered += 1;
            let given = recipe_brands(recipe);
            let given = |family: &str| {
                given
                    .iter()
                    .find(|b| b.family == family)
                    .map(|b| b.given.clone())
            };
            assert_eq!(
                found.from,
                given("accent").unwrap_or_else(|| own("accent")),
                "{at}"
            );
            assert_eq!(
                found
                    .palettes
                    .iter()
                    .map(|p| p.name.as_str())
                    .collect::<Vec<_>>(),
                PALETTES,
                "{at}"
            );
            let rows: Vec<&str> = SUGGESTED
                .into_iter()
                .filter(|family| !refused(family))
                .collect();
            without_a_row += SUGGESTED.len() - rows.len();
            for palette in &found.palettes {
                assert!(
                    !palette.description.trim().is_empty(),
                    "{}: {at}",
                    palette.name
                );
                assert_eq!(
                    palette
                        .colors
                        .iter()
                        .map(|c| c.family.as_str())
                        .collect::<Vec<_>>(),
                    rows,
                    "{}: {at}",
                    palette.name
                );
                for color in &palette.colors {
                    assert_eq!(
                        color.kept,
                        given(&color.family).is_some(),
                        "{} {}: {at}",
                        palette.name,
                        color.family
                    );
                    if color.kept {
                        assert_eq!(
                            Some(color.color.clone()),
                            given(&color.family),
                            "{} {}: {at}",
                            palette.name,
                            color.family
                        );
                        kept_rows += 1;
                    } else {
                        suggested_rows += 1;
                    }
                    let digits = color.color.strip_prefix('#').unwrap_or("");
                    assert!(
                        digits.len() == 6
                            && digits
                                .bytes()
                                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                        "{} {} is {:?}: {at}",
                        palette.name,
                        color.family,
                        color.color
                    );
                }
                for family in ["visited", "neutral"] {
                    let of = |p: &Palette| {
                        p.colors
                            .iter()
                            .find(|c| c.family == family)
                            .map(|c| c.color.clone())
                    };
                    assert_eq!(
                        of(palette),
                        of(&found.palettes[0]),
                        "{family} in {}: {at}",
                        palette.name
                    );
                }
            }
        }
        assert!(
            answered > 0 && nothing > 0 && kept_rows > 0 && suggested_rows > 0 && without_a_row > 0,
            "{answered} answers, {nothing} without, {kept_rows} kept rows, {suggested_rows} suggested, {without_a_row} families without a row"
        );
    }

    #[test]
    fn only_the_colours_of_the_recipe_decide_the_palettes() {
        // Typography, shape, a key the core does not know and `$schema` say
        // nothing of colours: the answer is the one the colours give alone.
        let colours = [
            ("accent", "#7c3aed"),
            ("brand2", "#0d7a5f"),
            ("danger", "#c2185b"),
        ];
        let alone = suggest_palettes(&recipe_of(&colours)).expect("an answer");
        let Json::Object(mut entries) = recipe_of(&colours) else {
            unreachable!()
        };
        entries.insert(
            0,
            (
                "$schema".to_string(),
                Json::String("./theme.schema.json".to_string()),
            ),
        );
        entries.push((
            "typography".to_string(),
            parse(r#"{"fontFamily": "Arial (", "weights": {"bold": 700}}"#).unwrap(),
        ));
        entries.push((
            "shape".to_string(),
            parse(r#"{"buttonRadius": true}"#).unwrap(),
        ));
        entries.push(("acent".to_string(), Json::String("#000".to_string())));
        entries.reverse();
        let beside =
            suggest_palettes(&Json::Object(entries)).expect("an answer beside what is wrong");
        let written = |palettes: &Palettes| {
            palettes
                .palettes
                .iter()
                .map(|p| {
                    format!(
                        "{} {} {:?}",
                        p.name,
                        p.description,
                        p.colors
                            .iter()
                            .map(|c| (&c.family, &c.color, c.kept))
                            .collect::<Vec<_>>()
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(beside.from, alone.from);
        assert_eq!(written(&beside), written(&alone));
        // A status the core refuses is as one that is not given.
        let refused = suggest_palettes(&recipe_of(&[("accent", "#7c3aed"), ("warning", "yellow")]))
            .expect("an answer");
        let not_given = suggest_palettes(&recipe_of(&[("accent", "#7c3aed")])).expect("an answer");
        assert_eq!(written(&refused), written(&not_given));
    }

    #[test]
    fn a_suggested_colour_is_the_fill_the_theme_gives_it() {
        // The colour shown is the colour got: a theme built from a
        // suggestion has it as the fill in the light theme, and has nothing
        // to say about why it could not be.
        let mut recipes: Vec<Json> = accents()
            .iter()
            .map(|accent| recipe_of(&[("accent", accent)]))
            .collect();
        recipes.push(recipe_of(&[]));
        recipes.push(recipe_of(&[("accent", "#808080")]));
        recipes.push(recipe_of(&[("accent", "#000000")]));
        recipes.push(recipe_of(&[("accent", "#ffffff")]));
        let mut held = 0;
        for recipe in &recipes {
            let found =
                suggest_palettes(recipe).unwrap_or_else(|| panic!("{}", recipe.to_compact()));
            let mut seen: Vec<(String, String)> = Vec::new();
            for palette in &found.palettes {
                for color in palette.colors.iter().filter(|c| !c.kept) {
                    let pair = (color.family.clone(), color.color.clone());
                    if seen.contains(&pair) {
                        continue;
                    }
                    let theme = build_theme(&recipe_of(&[(&color.family, &color.color)])).unwrap();
                    let brand = &theme.brands[0];
                    let at = format!(
                        "{} in {} of {}",
                        color.family,
                        palette.name,
                        recipe.to_compact()
                    );
                    assert_eq!(brand.light.fill, color.color, "{at}");
                    assert!(
                        brand
                            .reasons
                            .iter()
                            .all(|reason| !reason.starts_with("In the light theme")),
                        "{at}: {:?}",
                        brand.reasons
                    );
                    seen.push(pair);
                    held += 1;
                }
            }
        }
        assert!(held > 300, "only {held} suggestions were built");
    }

    /// The hues brand1, brand2 and brand3 were meant to have, and the hues
    /// they get once those too near a status are moved: the nearest hue at
    /// least 25 degrees from each status, a degree at a time and upwards
    /// first, and for a moved one also at least 15 degrees from an earlier
    /// brand that was meant for another hue.
    fn placed(intended: [f64; 3], statuses: &[f64]) -> [f64; 3] {
        let clear = |hue: f64| statuses.iter().all(|status| apart(hue, *status) >= 25.0);
        let mut out = intended;
        for i in 0..3 {
            if clear(intended[i]) {
                continue;
            }
            out[i] = (1..=180)
                .flat_map(|d| [intended[i] + f64::from(d), intended[i] - f64::from(d)])
                .find(|hue| {
                    clear(*hue)
                        && (0..i).all(|j| {
                            apart(intended[j], intended[i]) < 0.001 || apart(*hue, out[j]) >= 15.0
                        })
                })
                .expect("a hue clear of the three statuses");
        }
        out
    }

    #[test]
    fn the_palettes_are_the_hues_and_the_chroma_the_decision_gives_them() {
        // In OKLCH, with the lightness of the accent left out: brand1 to 3
        // at the accent's chroma and these hues from it, or at its hue with
        // less chroma, moved clear of danger, warning and success; visited
        // and neutral as LO-TEK's own stand to LO-TEK's accent. The colours
        // are fitted to what a screen shows and rounded to hex, so the hue
        // is held within a couple of degrees, more for a faint colour.
        // The chroma has more room: where a screen can only just show the
        // colour, the fill of a fill is not the fill, and the colour that is
        // its own fill lies a little off.
        const TURNS: [[f64; 3]; 4] = [
            [30.0, -30.0, 60.0],
            [180.0, 150.0, 210.0],
            [90.0, 180.0, 270.0],
            [0.0, 0.0, 0.0],
        ];
        const SHARES: [[f64; 3]; 4] = [[1.0; 3], [1.0; 3], [1.0; 3], [0.75, 0.5, 0.25]];
        let statuses = ["danger", "warning", "success"];
        let mut recipes: Vec<Vec<(String, String)>> = accents()
            .into_iter()
            .map(|accent| vec![("accent".to_string(), accent)])
            .collect();
        recipes.push(Vec::new());
        // Statuses of the recipe's own, elsewhere on the wheel.
        for accent in ["#7c3aed", "#d32f2f", "#00796b"] {
            recipes.push(
                [
                    ("accent", accent),
                    ("danger", "#c2185b"),
                    ("warning", "#a15c00"),
                    ("success", "#00796b"),
                ]
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            );
        }
        let (mut moved, mut unmoved, mut past_an_earlier) = (0, 0, 0);
        for entries in &recipes {
            let recipe = recipe_of(
                &entries
                    .iter()
                    .map(|(k, v)| (k.as_str(), v.as_str()))
                    .collect::<Vec<_>>(),
            );
            let at = recipe.to_compact();
            let found = suggest_palettes(&recipe).unwrap_or_else(|| panic!("{at}"));
            let given = |family: &str| {
                entries
                    .iter()
                    .find(|(f, _)| f == family)
                    .map_or_else(|| own(family), |(_, v)| v.clone())
            };
            let accent = lch(&found.from);
            assert_eq!(found.from, given("accent"), "{at}");
            let status_hues: Vec<f64> = statuses.iter().map(|s| lch(&given(s)).h).collect();
            // What a colour meant for this hue and chroma must be, once
            // fitted: the hue, and the chroma a screen can show there.
            let check = |color: &PaletteColor, hue: f64, chroma: f64, what: &str| {
                let got = lch(&color.color);
                let shown = chroma
                    * color::chroma_kept(color::Oklch {
                        l: got.l,
                        c: chroma,
                        h: hue.rem_euclid(360.0),
                    });
                assert!(
                    (got.c - shown).abs() < 0.012,
                    "{what}: chroma {:.4}, expected {shown:.4}: {at}",
                    got.c
                );
                if shown > 0.02 {
                    let within = 2.0 + (0.004 / shown).to_degrees();
                    assert!(
                        apart(got.h, hue) < within,
                        "{what}: hue {:.1}, expected {:.1} within {within:.1}: {at}",
                        got.h,
                        hue.rem_euclid(360.0)
                    );
                }
            };
            for (index, palette) in found.palettes.iter().enumerate() {
                let color =
                    |family: &str| palette.colors.iter().find(|c| c.family == family).unwrap();
                let intended = TURNS[index].map(|turn| accent.h + turn);
                // A grey has no hue to keep clear of anything.
                let hues = if accent.c < 0.02 {
                    intended
                } else {
                    placed(intended, &status_hues)
                };
                for (i, family) in ["brand1", "brand2", "brand3"].into_iter().enumerate() {
                    let what = format!("{family} in {}", palette.name);
                    check(color(family), hues[i], accent.c * SHARES[index][i], &what);
                    if accent.c < 0.02 {
                        continue;
                    }
                    if apart(hues[i], intended[i]) < 0.001 {
                        unmoved += 1;
                    } else {
                        moved += 1;
                        let nearest = (1..=180)
                            .flat_map(|d| [intended[i] + f64::from(d), intended[i] - f64::from(d)])
                            .find(|hue| status_hues.iter().all(|s| apart(*hue, *s) >= 25.0))
                            .unwrap();
                        if apart(nearest, hues[i]) > 0.001 {
                            past_an_earlier += 1;
                        }
                    }
                    // Whatever the search, a suggestion with colour in it
                    // is not beside a status.
                    let got = lch(&color(family).color);
                    if got.c > 0.04 {
                        for (status, hue) in statuses.iter().zip(&status_hues) {
                            assert!(
                                apart(got.h, *hue) > 21.0,
                                "{what} is {:.1} degrees from {status}: {at}",
                                apart(got.h, *hue)
                            );
                        }
                    }
                }
                for family in ["visited", "neutral"] {
                    let (ours, our_accent) = (lch(&own(family)), lch(&own("accent")));
                    check(
                        color(family),
                        accent.h + (ours.h - our_accent.h),
                        accent.c * ours.c / our_accent.c,
                        &format!("{family} in {}", palette.name),
                    );
                }
            }
        }
        assert!(
            moved > 20 && unmoved > 100 && past_an_earlier > 0,
            "{moved} suggestions moved clear of a status, {unmoved} not, {past_an_earlier} moved on past an earlier brand"
        );
    }

    #[test]
    fn a_grey_accent_gives_greys() {
        for accent in ["#808080", "#000000", "#ffffff", "#2b2b2b"] {
            let found = suggest_palettes(&recipe_of(&[("accent", accent)])).expect("an answer");
            for palette in &found.palettes {
                for color in &palette.colors {
                    assert!(
                        lch(&color.color).c < 0.02,
                        "{} in {} of {accent} is {}",
                        color.family,
                        palette.name,
                        color.color
                    );
                }
            }
        }
    }

    #[test]
    fn without_an_accent_visited_and_neutral_are_near_loteks_own() {
        // As the relation is between LO-TEK's own: built on LO-TEK's
        // accent, the two come out as the fills LO-TEK's own give.
        let found = suggest_palettes(&recipe_of(&[])).expect("an answer");
        assert_eq!(found.from, own("accent"));
        for family in ["visited", "neutral"] {
            let ours = build_theme(&recipe_of(&[(family, &own(family))]))
                .unwrap()
                .brands[0]
                .light
                .fill
                .clone();
            let suggested = &found.palettes[0]
                .colors
                .iter()
                .find(|c| c.family == family)
                .unwrap()
                .color;
            let (a, b) = (parse_hex(suggested).unwrap(), parse_hex(&ours).unwrap());
            let far = [(a.r - b.r).abs(), (a.g - b.g).abs(), (a.b - b.b).abs()]
                .into_iter()
                .fold(0.0, f64::max);
            assert!(
                far < 0.03,
                "{family}: suggested {suggested}, and LO-TEK's own gives {ours}"
            );
        }
    }

    /// Every key that takes a value, as the parts of its path, in the order
    /// of the schema: the families, then typography, then shape.
    fn leaves() -> Vec<Vec<String>> {
        let block = |names: &[&str], keys: &[&str]| -> Vec<Vec<String>> {
            keys.iter()
                .map(|key| {
                    names
                        .iter()
                        .chain([key])
                        .map(|part| part.to_string())
                        .collect()
                })
                .collect()
        };
        contract()
            .families
            .iter()
            .map(|family| vec![family.clone()])
            .chain(block(&["typography"], &["fontFamily"]))
            .chain(block(&["typography", "weights"], &WEIGHT_KEYS))
            .chain(block(&["typography", "lineHeights"], &LINE_KEYS))
            .chain(block(&["shape"], &SHAPE_KEYS))
            .collect()
    }

    #[test]
    fn recipe_values_and_check_recipe_read_the_recipe_alike() {
        // Over the expected results and six thousand recipes with something
        // odd at every place:
        // - what a recipe gives is at keys that take a value, each once, in
        //   the order of the schema, and never an empty text;
        // - a value that is refused is among them exactly when it is text or
        //   a number: `true`, a list and an object are refused and given by
        //   nothing;
        // - a recipe nothing is wrong with is the recipe made of what it
        //   gives: both build the same file.
        let leaves = leaves();
        let mut recipes: Vec<Json> = ["recipes.json", "recipe-checks.json"]
            .iter()
            .flat_map(|file| expected(file))
            .map(|(_, case)| case.get("recipe").unwrap().clone())
            .collect();
        let mut seed = 20261125;
        for _ in 0..6000 {
            recipes.push(odd_recipe(&mut seed));
        }
        let (mut rebuilt, mut in_values, mut not_in_values) = (0, 0, 0);
        for recipe in &recipes {
            let values = recipe_values(recipe);
            let positions: Vec<usize> = values
                .iter()
                .map(|value| {
                    leaves
                        .iter()
                        .position(|leaf| *leaf == value.path)
                        .unwrap_or_else(|| {
                            panic!("{:?} takes no value: {}", value.path, recipe.to_compact())
                        })
                })
                .collect();
            assert!(
                positions.windows(2).all(|pair| pair[0] < pair[1]),
                "{}",
                recipe.to_compact()
            );
            assert!(
                values.iter().all(|value| !value.text.is_empty()),
                "{}",
                recipe.to_compact()
            );

            let problems = check_recipe(recipe);
            for problem in problems.iter().filter(|p| p.kind.as_str() == "refused") {
                if !leaves.contains(&problem.path) {
                    continue;
                }
                let value = problem
                    .path
                    .iter()
                    .try_fold(recipe, |at, part| at.get(part))
                    .unwrap();
                let given = values.iter().any(|value| value.path == problem.path);
                assert_eq!(
                    given,
                    matches!(value, Json::String(_) | Json::Number(_)),
                    "{:?} of {}",
                    problem.path,
                    recipe.to_compact()
                );
                if given {
                    in_values += 1;
                } else {
                    not_in_values += 1;
                }
            }

            if problems.is_empty() {
                let mut made = Json::Object(vec![]);
                for value in &values {
                    let mut at = &mut made;
                    for part in &value.path[..value.path.len() - 1] {
                        let Json::Object(entries) = at else {
                            unreachable!()
                        };
                        if !entries.iter().any(|(key, _)| key == part) {
                            entries.push((part.clone(), Json::Object(vec![])));
                        }
                        at = &mut entries.iter_mut().find(|(key, _)| key == part).unwrap().1;
                    }
                    let Json::Object(entries) = at else {
                        unreachable!()
                    };
                    entries.push((
                        value.path.last().unwrap().clone(),
                        Json::String(value.text.clone()),
                    ));
                }
                assert_eq!(
                    build_theme(&made).map(|t| t.css).ok(),
                    build_theme(recipe).map(|t| t.css).ok(),
                    "{} and what it gives, {}",
                    recipe.to_compact(),
                    made.to_compact()
                );
                rebuilt += 1;
            }
        }
        assert!(
            rebuilt > 200 && in_values > 500 && not_in_values > 500,
            "{rebuilt} rebuilt, {in_values} refused texts, {not_in_values} refused values that are not text"
        );
    }

    /// A recipe with something odd at every place, from a seed. The values
    /// are the ones a file can hold where a value belongs: text the core
    /// takes and text it refuses, numbers, the booleans, `null`, lists and
    /// objects, and the keys are known ones, misspelt ones and ones with a
    /// dot in them.
    fn odd_recipe(seed: &mut u64) -> Json {
        /// The next number below `n`.
        fn roll(seed: &mut u64, n: u64) -> u64 {
            *seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (*seed >> 33) % n
        }
        /// Something that can stand where a value belongs. For a colour or
        /// a key of a block, half the time a text the core takes there, so
        /// that recipes which build are not a rarity; `None` is where a
        /// block belongs, and nothing there is right but an object.
        fn value(seed: &mut u64, good: Option<&str>) -> Json {
            let text = |s: &str| Json::String(s.to_string());
            match roll(seed, if good.is_some() { 24 } else { 12 }) {
                0 => Json::Null,
                1 => Json::Bool(true),
                2 => Json::Bool(false),
                3 => Json::Number(0.0),
                4 => Json::Number(12.0),
                5 => text(""),
                6 => Json::Array(vec![]),
                7 => Json::Array(vec![text("#fff")]),
                8 => Json::Object(vec![]),
                9 => Json::Object(vec![("a".to_string(), Json::Number(1.0))]),
                10 => text("4px; }"),
                11 => text("Arial ("),
                _ => text(good.unwrap_or("1rem")),
            }
        }
        /// Some of the keys, each with a value, and now and then one the
        /// block does not have.
        fn block(seed: &mut u64, keys: &[&str]) -> Vec<(String, Json)> {
            let mut entries = Vec::new();
            for key in keys {
                if roll(seed, 3) == 0 {
                    entries.push((key.to_string(), value(seed, Some("1rem"))));
                }
            }
            if roll(seed, 8) == 0 {
                entries.push(("radius".to_string(), value(seed, Some("1rem"))));
            }
            entries
        }

        if roll(seed, 40) == 0 {
            return value(seed, None);
        }
        let mut entries: Vec<(String, Json)> = Vec::new();
        for family in contract().families.iter() {
            if roll(seed, 5) == 0 {
                entries.push((family.clone(), value(seed, Some("#7c3aed"))));
            }
        }
        for name in ["acent", "shape.buttonRadius", "$schema"] {
            if roll(seed, 10) == 0 {
                entries.push((name.to_string(), value(seed, Some("#7c3aed"))));
            }
        }
        if roll(seed, 2) == 0 {
            let typography = if roll(seed, 6) == 0 {
                value(seed, None)
            } else {
                let mut inner = block(seed, &["fontFamily"]);
                for (name, keys) in [
                    ("weights", &WEIGHT_KEYS[..]),
                    ("lineHeights", &LINE_KEYS[..]),
                ] {
                    if roll(seed, 2) == 0 {
                        let nested = if roll(seed, 6) == 0 {
                            value(seed, None)
                        } else {
                            Json::Object(block(seed, keys))
                        };
                        inner.push((name.to_string(), nested));
                    }
                }
                Json::Object(inner)
            };
            entries.push(("typography".to_string(), typography));
        }
        if roll(seed, 2) == 0 {
            let shape = if roll(seed, 6) == 0 {
                value(seed, None)
            } else {
                Json::Object(block(seed, &SHAPE_KEYS))
            };
            entries.push(("shape".to_string(), shape));
        }
        Json::Object(entries)
    }

    #[test]
    fn check_recipe_finds_nothing_exactly_when_build_theme_takes_the_recipe() {
        // Both ways, for every recipe: the expected results, and six thousand
        // with something odd at every place. An empty answer for a recipe
        // that `build_theme` refuses is a form that looks in order and
        // builds nothing, and a problem with a recipe that builds is a field
        // marked for nothing. And when there is a problem, the one sentence
        // `build_theme` refuses with is made of the same problems.
        let mut recipes: Vec<Json> = ["recipes.json", "recipe-checks.json"]
            .iter()
            .flat_map(|file| expected(file))
            .map(|(_, case)| case.get("recipe").unwrap().clone())
            .collect();
        let mut seed = 20261124;
        for _ in 0..6000 {
            recipes.push(odd_recipe(&mut seed));
        }
        let (mut taken, mut refused, mut kinds) = (0, 0, std::collections::BTreeSet::new());
        for recipe in &recipes {
            let problems = check_recipe(recipe);
            let built = build_theme(recipe);
            assert_eq!(
                built.as_ref().err().cloned(),
                refusal(&problems),
                "{}",
                recipe.to_compact()
            );
            for problem in &problems {
                kinds.insert(problem.kind.as_str());
                // A problem with the whole recipe has no path, and it is
                // alone; the others say which key.
                let whole = matches!(problem.kind.as_str(), "empty" | "notARecipe");
                assert_eq!(problem.path.is_empty(), whole, "{}", recipe.to_compact());
                assert!(!whole || problems.len() == 1, "{}", recipe.to_compact());
            }
            if built.is_ok() {
                taken += 1;
            } else {
                refused += 1;
            }
        }
        // The recipes are of every sort, or the property was held to few.
        assert!(
            taken > 200 && refused > 2000,
            "{taken} taken, {refused} refused"
        );
        assert_eq!(
            kinds.into_iter().collect::<Vec<_>>(),
            ["empty", "notARecipe", "refused", "unknown"]
        );
    }

    #[test]
    fn what_check_recipe_says_of_a_value_is_what_build_theme_says_of_it_alone() {
        // For every value it refuses, in every recipe of the expected
        // results: the recipe with only that key gets that message.
        let mut held = 0;
        for file in ["recipes.json", "recipe-checks.json"] {
            for (name, case) in expected(file) {
                let recipe = case.get("recipe").unwrap();
                for problem in check_recipe(recipe) {
                    if problem.kind.as_str() != "refused" {
                        continue;
                    }
                    let value = problem
                        .path
                        .iter()
                        .try_fold(recipe, |at, part| at.get(part))
                        .unwrap_or_else(|| {
                            panic!("{file}, {name}: the recipe has no {:?}", problem.path)
                        });
                    let alone = problem
                        .path
                        .iter()
                        .rev()
                        .fold(value.clone(), |inner, part| {
                            Json::Object(vec![(part.to_string(), inner)])
                        });
                    assert_eq!(
                        build_theme(&alone).err(),
                        Some(problem.message.clone()),
                        "{file}, {name}: {:?}",
                        problem.path
                    );
                    held += 1;
                }
            }
        }
        assert!(held > 20, "only {held} refused values");
    }

    #[test]
    fn a_color_that_is_false_zero_or_null_is_not_given() {
        // Next to a real colour: the theme is the one that colour gives
        // alone, and the families keep LO-TEK's own.
        let alone = theme(r##"{"accent": "#7c3aed"}"##).unwrap();
        let t = theme(r##"{"accent": "#7c3aed", "danger": false, "success": 0, "warning": null}"##)
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(t.css, alone.css);
        assert_eq!(t.brands.len(), 1);
        assert_eq!(t.brands[0].family, "accent");
    }

    #[test]
    fn a_block_without_keys_is_not_given() {
        // A theme with nothing in it is not a theme: an empty object, `null`,
        // `false` and an empty text are a block that is not there, as they
        // are a value that is not there.
        for value in ["{}", "null", "false", r#""""#] {
            for recipe in [
                format!(r#"{{"typography": {value}}}"#),
                format!(r#"{{"shape": {value}}}"#),
                format!(r#"{{"typography": {value}, "shape": {value}}}"#),
                format!(r#"{{"typography": {{"weights": {value}, "lineHeights": {value}}}}}"#),
            ] {
                assert_eq!(
                    theme(&recipe).err().as_deref(),
                    Some("The theme is empty. Give either brand colours, or typography and shape."),
                    "{recipe}"
                );
            }
        }
    }

    #[test]
    fn a_block_without_keys_next_to_colors_changes_nothing() {
        let alone = theme(r##"{"accent": "#7c3aed"}"##).unwrap().css;
        for blocks in [
            r#""typography": {}, "shape": {}"#,
            r#""typography": null, "shape": false"#,
            r#""typography": "", "shape": null"#,
            r#""typography": {"weights": {}, "lineHeights": null}"#,
        ] {
            let css = theme(&format!(r##"{{"accent": "#7c3aed", {blocks}}}"##))
                .unwrap_or_else(|error| panic!("{blocks}: {error}"))
                .css;
            assert_eq!(css, alone, "{blocks}");
        }
    }

    #[test]
    fn one_block_with_one_key_is_a_theme() {
        for (recipe, declaration) in [
            (
                r#"{"typography": {"fontFamily": "Georgia, serif"}}"#,
                "--lt-font-family-base: Georgia, serif;",
            ),
            (
                r#"{"shape": {"buttonRadius": "1rem"}, "typography": {}}"#,
                "--lt-button-radius: 1rem;",
            ),
        ] {
            let css = theme(recipe)
                .unwrap_or_else(|error| panic!("{recipe}: {error}"))
                .css;
            assert!(css.contains(declaration), "{css}");
        }
    }

    #[test]
    fn a_theme_without_colors_passes_the_check() {
        // A theme made with `theme` meets the requirements, also one with only
        // typography and shape. It has no contrast to check, and that is not
        // a violation.
        let css = theme(
            r#"{"typography": {"fontFamily": "Georgia, serif"}, "shape": {"buttonRadius": "1rem"}}"#,
        )
        .unwrap()
        .css;
        let report = check::inspect_theme(&css);
        assert!(report.problems.is_empty(), "{}", css);
        assert_eq!(report.blocks, 0);
        assert!(report.others > 0);
    }

    #[test]
    fn the_check_finds_a_broken_promise() {
        let report = check::inspect_theme(":root { --lt-color-accent-text: #ffffff; }");
        assert_eq!(report.blocks, 1);
        assert!(
            report
                .problems
                .iter()
                .any(|p| p.message.starts_with("accent: text on canvas is 1.00:1")),
            "{:?}",
            report
                .problems
                .iter()
                .map(|p| &p.message)
                .collect::<Vec<_>>()
        );
    }

    /// The value of `--lt-color-<family>-fill` among the tokens of one appearance.
    fn fill_token<'a>(tokens: &'a Declarations, family: &str) -> &'a str {
        let name = format!("--lt-color-{family}-fill");
        &tokens.iter().find(|(n, _)| *n == name).unwrap().1
    }

    #[test]
    fn says_what_became_of_a_brand_color() {
        // The fills are worked out with the TypeScript functions in
        // `@lo-tek/interfaces/color`, from the hue and chroma of the brand
        // colour and the lightness of `fill` in the contract: 0.53 and 0.65.
        let t = theme(r##"{"accent": "#7c3aed"}"##).unwrap();
        assert_eq!(t.brands.len(), 1);
        let brand = &t.brands[0];
        assert_eq!(brand.family, "accent");
        assert_eq!(brand.given, "#7c3aed");
        assert_eq!(brand.light.fill, "#7935e9");
        assert_eq!(brand.dark.fill, "#986eff");
        // The row says what the theme holds, not a calculation of its own.
        assert_eq!(brand.light.fill, fill_token(&t.light, "accent"));
        assert_eq!(brand.dark.fill, fill_token(&t.dark, "accent"));
    }

    #[test]
    fn a_light_brand_color_gets_a_much_darker_fill() {
        // The case the rows are there for: the lightness comes from the
        // role, so a yellow at 0.90 comes out as an olive at 0.53.
        let t = theme(r##"{"brand1": "#f7df1e"}"##).unwrap();
        assert_eq!(t.brands.len(), 1);
        let brand = &t.brands[0];
        assert_eq!(brand.family, "brand1");
        assert_eq!(brand.given, "#f7df1e");
        assert_eq!(brand.light.fill, "#7a6d00");
        assert_eq!(brand.dark.fill, "#a19100");
    }

    #[test]
    fn the_brands_are_the_given_families_in_the_order_of_the_contract() {
        // Six families inherit LO-TEK's own colour here and get no row, and
        // the order is the contract's, not the recipe's.
        let t =
            theme(r##"{"danger": "#b91c1c", "brand1": "#0f766e", "accent": "#7c3aed"}"##).unwrap();
        let families: Vec<&str> = t.brands.iter().map(|b| b.family.as_str()).collect();
        assert_eq!(families, ["accent", "brand1", "danger"]);
        let given: Vec<&str> = t.brands.iter().map(|b| b.given.as_str()).collect();
        assert_eq!(given, ["#7c3aed", "#0f766e", "#b91c1c"]);
    }

    #[test]
    fn the_given_color_is_normalized_not_the_text_as_written() {
        // `given` is to be written into a CSS comment, so the text of the
        // recipe must never get through as it stands.
        let t = theme(r##"{"accent": "  #7C3AED\n", "neutral": "#FFF"}"##).unwrap();
        let given: Vec<&str> = t.brands.iter().map(|b| b.given.as_str()).collect();
        assert_eq!(given, ["#7c3aed", "#ffffff"]);
    }

    #[test]
    fn a_theme_without_colors_has_no_brands() {
        let t = theme(
            r#"{"typography": {"fontFamily": "Georgia, serif"}, "shape": {"buttonRadius": "1rem"}}"#,
        )
        .unwrap();
        assert!(t.brands.is_empty());
    }

    /// The breaks as text, one per promise, with the ratio to two decimals.
    fn breaks(fill: &BrandFill) -> Vec<String> {
        fill.breaks
            .iter()
            .map(|v| {
                format!(
                    "{}: {} is {}:1, not {}:1",
                    v.family,
                    v.promise,
                    to_fixed2(v.ratio),
                    js_number(v.required)
                )
            })
            .collect()
    }

    #[test]
    fn a_light_brand_color_could_not_be_the_fill_on_a_light_page() {
        // The ratios are worked out with the TypeScript functions in
        // `@lo-tek/interfaces/color`: the yellow against the canvas
        // `#ffffff`, the raised `#e4e4e5` and its own content `#fdfcf6`.
        // Against the dark page, `#111212`, `#323333` and `#0e0d0a`, the
        // lowest is 9.37:1, so there it could have been the fill as it is.
        let t = theme(r##"{"brand1": "#f7df1e"}"##).unwrap();
        let brand = &t.brands[0];
        assert_eq!(
            breaks(&brand.light),
            [
                "brand1: fill on canvas is 1.35:1, not 3.1:1",
                "brand1: fill on raised is 1.06:1, not 3.1:1",
                "brand1: content on top of fill is 1.32:1, not 4.6:1",
            ]
        );
        assert!(brand.dark.breaks.is_empty(), "{:?}", brand.dark.breaks);
    }

    #[test]
    fn a_brand_color_in_the_middle_breaks_only_on_a_dark_page() {
        // On the light page the lowest is 4.48:1 against the raised surface.
        // On the dark one it holds against the canvas, 3.29:1, and is
        // therefore not listed, but not against the raised `#323333` or
        // under its own content `#0d0d11`.
        let t = theme(r##"{"accent": "#7c3aed"}"##).unwrap();
        let brand = &t.brands[0];
        assert!(brand.light.breaks.is_empty(), "{:?}", brand.light.breaks);
        assert_eq!(
            breaks(&brand.dark),
            [
                "accent: fill on raised is 2.22:1, not 3.1:1",
                "accent: content on top of fill is 3.40:1, not 4.6:1",
            ]
        );
    }

    #[test]
    fn a_break_is_about_the_given_color_not_about_the_theme() {
        // The theme never uses the given colour as the fill, so its own
        // promises hold whatever the breaks say.
        let t = theme(r##"{"accent": "#7c3aed", "brand1": "#f7df1e"}"##).unwrap();
        assert!(t.brands.iter().any(|b| !b.light.breaks.is_empty()));
        assert!(t.brands.iter().any(|b| !b.dark.breaks.is_empty()));
        assert!(t.violations.is_empty(), "{:?}", t.violations);
    }

    /// Whether the share is the expected one. The expected shares are worked
    /// out with the TypeScript functions in `@lo-tek/interfaces/color`, as
    /// the chroma of the fitted colour over the chroma of the brand colour.
    fn close(share: f64, expected: f64) -> bool {
        (share - expected).abs() < 0.01
    }

    #[test]
    fn a_light_brand_color_loses_chroma_in_the_fill() {
        // sRGB has no yellow this strong at the lightness of `fill`: the
        // blue channel is at zero long before. Of the chroma 0.182, 0.111 is
        // left at 0.53 and 0.136 at 0.65.
        let t = theme(r##"{"brand1": "#f7df1e"}"##).unwrap();
        let brand = &t.brands[0];
        assert!(
            close(brand.light.chroma_kept, 0.608),
            "{}",
            brand.light.chroma_kept
        );
        assert!(
            close(brand.dark.chroma_kept, 0.745),
            "{}",
            brand.dark.chroma_kept
        );
    }

    #[test]
    fn the_chroma_kept_is_per_appearance() {
        // The purple fits whole at 0.53. At 0.65 the blue channel is full,
        // and 0.208 is left of 0.247.
        let t = theme(r##"{"accent": "#7c3aed"}"##).unwrap();
        let brand = &t.brands[0];
        assert_eq!(brand.light.chroma_kept, 1.0);
        assert!(
            close(brand.dark.chroma_kept, 0.842),
            "{}",
            brand.dark.chroma_kept
        );
    }

    #[test]
    fn a_grey_keeps_all_of_the_chroma_it_has() {
        // A grey intends no chroma, so there is nothing to lower. The share
        // is not the quotient of two rounding errors.
        let t = theme(r##"{"brand2": "#808080"}"##).unwrap();
        let brand = &t.brands[0];
        assert_eq!(brand.light.chroma_kept, 1.0);
        assert_eq!(brand.dark.chroma_kept, 1.0);
    }

    const FIRST_LINE: &str =
        "/* Generated by @lo-tek/interfaces. Edit the recipe, not this file. */\n\n";
    const LAYERS: &str = "@layer lotek, lotek-theme;\n\n@layer lotek-theme {\n";

    #[test]
    fn the_file_says_what_became_of_each_brand_color() {
        // The terminal output is gone the next day, and the file is what is
        // left. One line per brand, in the order of the rows.
        let css = theme(r##"{"brand1": "#f7df1e", "accent": "#7c3aed"}"##)
            .unwrap()
            .css;
        let comment = [
            "/*",
            " * accent: #7c3aed gives the fill #7935e9 in the light theme and #986eff in the dark theme.",
            " * brand1: #f7df1e gives the fill #7a6d00 in the light theme and #a19100 in the dark theme.",
            " */",
            "",
            "",
        ]
        .join("\n");
        assert!(
            css.starts_with(&format!("{FIRST_LINE}{comment}{LAYERS}")),
            "{css}"
        );
    }

    #[test]
    fn a_brand_says_in_words_what_became_of_it() {
        // The sentences are the core's, made once: the command writes them,
        // the theme builder shows them and the file has the first of them.
        let t = theme(r##"{"accent": "#f7df1e"}"##).unwrap();
        let brand = &t.brands[0];
        assert_eq!(
            brand.summary,
            "accent: #f7df1e gives the fill #7a6d00 in the light theme and #a19100 in the dark theme."
        );
        // All three promises about the fill break on a light page, and the
        // screen cannot show the chroma in either appearance.
        assert_eq!(
            brand.reasons,
            [
                "In the light theme #f7df1e cannot be the fill as it is: against the page it would have a contrast of 1.35:1, and 3.1:1 is required; against a raised surface it would have a contrast of 1.06:1, and 3.1:1 is required; text on it would have a contrast of 1.32:1, and 4.6:1 is required.",
                "In the light theme the fill is less saturated than #f7df1e, with 61% of its chroma: a screen cannot show more at that lightness.",
                "In the dark theme the fill is less saturated than #f7df1e, with 74% of its chroma: a screen cannot show more at that lightness.",
            ]
        );
    }

    #[test]
    fn a_brand_gives_no_reason_for_an_appearance_it_fits() {
        // A colour in the middle could be the fill on a light page, and
        // keeps all of its chroma there: both sentences are about the dark.
        let t = theme(r##"{"accent": "#7c3aed"}"##).unwrap();
        assert_eq!(
            t.brands[0].reasons,
            [
                "In the dark theme #7c3aed cannot be the fill as it is: against a raised surface it would have a contrast of 2.22:1, and 3.1:1 is required; text on it would have a contrast of 3.40:1, and 4.6:1 is required.",
                "In the dark theme the fill is less saturated than #7c3aed, with 84% of its chroma: a screen cannot show more at that lightness.",
            ]
        );
    }

    #[test]
    fn a_brand_never_has_more_than_four_reasons() {
        // The theme builder has four places for the reasons of a colour,
        // since a list in one of its signals cannot change length. Two
        // appearances and two kinds of sentence make four; a third kind of
        // sentence would be a reason the page has nowhere to show. Every
        // family, around the wheel, from nearly black to nearly white.
        let (mut rows, mut most) = (0, 0);
        for family in contract().families.iter() {
            for red in [0x00, 0x33, 0x80, 0xcc, 0xff] {
                for green in [0x00, 0x55, 0xaa, 0xff] {
                    for blue in [0x00, 0x44, 0x99, 0xee] {
                        let recipe =
                            format!(r##"{{"{family}": "#{red:02x}{green:02x}{blue:02x}"}}"##);
                        let t = theme(&recipe).unwrap_or_else(|error| panic!("{recipe}: {error}"));
                        let reasons = t.brands[0].reasons.len();
                        assert!(
                            reasons <= 4,
                            "{recipe} has {reasons} reasons, and the theme builder has four places for them: {:?}",
                            t.brands[0].reasons
                        );
                        most = most.max(reasons);
                        rows += 1;
                    }
                }
            }
        }
        assert_eq!(rows, 9 * 80);
        assert!(
            most >= 3,
            "the sweep has no colour with more than {most} reasons"
        );
        // And four are reached: a strong blue is too light for white text
        // and too dark against a raised surface in the dark, and loses
        // chroma in both. The page's four places are all in use.
        let blue = theme(r##"{"accent": "#0078ff"}"##).unwrap();
        assert_eq!(
            blue.brands[0].reasons.len(),
            4,
            "{:?}",
            blue.brands[0].reasons
        );
    }

    #[test]
    fn the_comment_in_the_file_is_the_summaries() {
        let t =
            theme(r##"{"danger": "#b91c1c", "brand1": "#f7df1e", "accent": "#7c3aed"}"##).unwrap();
        let lines: Vec<String> = t
            .brands
            .iter()
            .map(|brand| format!(" * {}", brand.summary))
            .collect();
        assert_eq!(lines.len(), 3);
        assert!(
            t.css.starts_with(&format!(
                "{FIRST_LINE}/*\n{}\n */\n\n{LAYERS}",
                lines.join("\n")
            )),
            "{}",
            t.css
        );
    }

    #[test]
    fn the_text_of_the_recipe_never_reaches_the_comment() {
        let css = theme(r##"{"accent": "  #7C3AED\n", "neutral": "#FFF"}"##)
            .unwrap()
            .css;
        assert!(
            css.contains("\n * accent: #7c3aed gives the fill "),
            "{css}"
        );
        assert!(
            css.contains("\n * neutral: #ffffff gives the fill "),
            "{css}"
        );
        assert!(!css.contains("#7C3AED") && !css.contains("#FFF"), "{css}");
    }

    #[test]
    fn a_theme_without_colors_has_no_comment_about_brands() {
        let css = theme(r#"{"shape": {"buttonRadius": "1rem"}}"#).unwrap().css;
        assert!(css.starts_with(&format!("{FIRST_LINE}{LAYERS}")), "{css}");
        assert_eq!(css.matches("/*").count(), 1, "{css}");
    }

    #[test]
    fn the_comment_does_not_disturb_the_check() {
        // The same file with the comment taken out is what the theme was
        // before, and the check is to read the two alike.
        let css = theme(r##"{"accent": "#7c3aed", "brand1": "#f7df1e"}"##)
            .unwrap()
            .css;
        let rest = css.strip_prefix(FIRST_LINE).unwrap();
        let (comment, rest) = rest.split_at(rest.find(LAYERS).unwrap());
        assert!(comment.starts_with("/*\n * accent: "), "{css}");
        let without = check::inspect_theme(&format!("{FIRST_LINE}{rest}"));
        let report = check::inspect_theme(&css);
        assert!(report.problems.is_empty(), "{css}");
        assert_eq!(report.blocks, without.blocks);
        assert_eq!(report.declarations, without.declarations);
        assert_eq!(report.promises, without.promises);
        assert_eq!(report.others, without.others);
        assert!(report.blocks > 0);
    }
}
