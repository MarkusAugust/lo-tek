//! The theme: a whole colour theme from a few brand colours, and the check of
//! a theme a consumer has written themselves.
//!
//! The theme is the contract applied to the consumer's hues. The hue comes
//! from them, the lightness from the role, and the promises hold by
//! construction. That is why there is no adjustment pass here: there is
//! nothing to adjust afterwards. The brand colour itself is moved to the
//! lightness of the role, and `Theme::brands` says how far.

pub mod check;
pub mod color;
pub mod contract;
#[cfg(test)]
mod tests;

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
pub fn js_number(n: f64) -> String {
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
pub fn to_fixed2(n: f64) -> String {
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

/// The keys in a recipe the theme does not have, for a host that has more
/// to refuse before it builds: the command line reports a mistake in the
/// recipe file before an unknown flag. `build_theme` refuses the same keys.
pub fn unknown_recipe_keys(input: &Json) -> Vec<String> {
    unknown_paths(input, &contract().families)
        .iter()
        .map(|path| path.join("."))
        .collect()
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
    let contract = contract();
    let whole = |kind, message: &str| {
        vec![RecipeProblem {
            path: Vec::new(),
            kind,
            message: message.into(),
        }]
    };
    if !matches!(input, Json::Object(_)) {
        return whole(RecipeKind::NotARecipe, NOT_A_RECIPE);
    }
    let mut problems: Vec<RecipeProblem> = unknown_paths(input, &contract.families)
        .into_iter()
        .map(|path| RecipeProblem {
            message: format!("Unknown key in the recipe: {}", path.join(".")),
            kind: RecipeKind::Unknown,
            path,
        })
        .collect();
    let mut anything = false;
    let refused = |path: &[&str], message: String| RecipeProblem {
        path: path.iter().map(|s| s.to_string()).collect(),
        kind: RecipeKind::Refused,
        message,
    };
    let not_a_value = |path: &[&str], value: Option<&Json>| {
        format!(
            "The value of {} must be text or a number. Got: {}",
            path.join("."),
            value.map(Json::to_compact).unwrap_or_default()
        )
    };

    for name in &contract.families {
        let at = [name.as_str()];
        let value = input.get(name);
        match leaf(value, false) {
            Err(()) => problems.push(refused(&at, not_a_value(&at, value))),
            Ok(None) => {}
            Ok(Some(text)) => {
                anything = true;
                if let Err(message) = parse_hex(&text) {
                    problems.push(refused(&at, message));
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
            match leaf(value, true) {
                Err(()) => problems.push(refused(&here, not_a_value(&here, value))),
                Ok(None) => {}
                Ok(Some(text)) => {
                    anything = true;
                    if let Err(message) = checked(&variable(at[at.len() - 1], key), &text) {
                        problems.push(refused(&here, message));
                    }
                }
            }
        }
    }

    if problems.is_empty() && !anything {
        return whole(RecipeKind::Empty, EMPTY);
    }
    problems
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

    let mut brands = contract.brands.clone();
    for (name, value) in &given_families {
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

/// A block of the recipe, when it has at least one key. An empty object, a
/// number, a boolean and `null` have none, and are as if the block were not
/// in the recipe: the hosts left them out before the core checked the keys.
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
        // Seen in a browser: `Inter [` as the font opens a block that
        // swallows what follows it in the rule, as an unclosed `(` does, and
        // the radius declared after it came out empty. The theme built, and
        // looked right in the file.
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
    fn a_block_that_is_not_an_object_is_refused_where_it_stands() {
        // A text was read as its characters, "Unknown key: typography.0,
        // typography.1", and a number was passed over without a word. Both
        // are the same mistake, and it is about the block.
        for (recipe, message) in [
            (
                r##"{"accent": "#7c3aed", "typography": "Inter"}"##,
                r#"typography is not an object with its keys in it. Got: "Inter""#,
            ),
            (
                r#"{"typography": {"weights": [400]}}"#,
                "typography.weights is not an object with its keys in it. Got: [400]",
            ),
            (
                r#"{"typography": {"lineHeights": true}}"#,
                "typography.lineHeights is not an object with its keys in it. Got: true",
            ),
            (
                r##"{"accent": "#7c3aed", "shape": 5}"##,
                "shape is not an object with its keys in it. Got: 5",
            ),
        ] {
            assert_eq!(theme(recipe).err().as_deref(), Some(message), "{recipe}");
        }
    }

    #[test]
    fn a_value_that_is_true_a_list_or_an_object_is_refused() {
        // `true` was written into the file as `true`, and a list for a
        // colour was read as an empty text, "\"\" is not a valid colour".
        for (recipe, message) in [
            (
                r#"{"accent": true}"#,
                "The value of accent must be text or a number. Got: true",
            ),
            (
                r##"{"danger": ["#fff"]}"##,
                r##"The value of danger must be text or a number. Got: ["#fff"]"##,
            ),
            (
                r#"{"shape": {"buttonRadius": {"a": 1}}}"#,
                r#"The value of shape.buttonRadius must be text or a number. Got: {"a":1}"#,
            ),
            (
                r#"{"typography": {"weights": {"bold": true}}}"#,
                "The value of typography.weights.bold must be text or a number. Got: true",
            ),
        ] {
            assert_eq!(theme(recipe).err().as_deref(), Some(message), "{recipe}");
        }
    }

    #[test]
    fn what_is_not_a_recipe_is_refused_as_that() {
        // A text was "Unknown key in the recipe: 0, 1, 2, 3", and `null` was
        // an empty theme. Neither says what is wrong.
        for recipe in [r#""text""#, "[1]", "[]", "null", "12", "true", "false"] {
            assert_eq!(
                theme(recipe).err().as_deref(),
                Some(
                    r##"The recipe is not an object. Write it as an object with the colours in it, for example {"accent": "#7c3aed"}."##
                ),
                "{recipe}"
            );
        }
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
        // with, and it is written by hand. A key the core knows and the
        // schema lacks is underlined in a recipe that works, and one the
        // schema has and the core lacks is suggested and then refused. Both
        // ways, in every place the core reads keys.
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
            assert_eq!(described, known, "{place:?}");
            // Without this the schema lets through the key the core refuses.
            assert!(
                matches!(object.get("additionalProperties"), Some(Json::Bool(false))),
                "{place:?} is open to other keys in the schema"
            );
        }
    }

    #[test]
    fn the_radius_of_the_surfaces_reaches_the_panel_of_a_term() {
        // The panel is a surface like the popover, and was left behind when
        // the component came: a theme with square surfaces had one round one.
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
        // decide which: the panel of a term was neither for nine versions,
        // and nothing said so. Both ways, so a list cannot keep a name the
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
    fn check_recipe_says_everything_that_is_wrong_at_once() {
        // `build_theme` stops at the first thing it refuses, which is right
        // for one answer and useless for a form: with two fields wrong, the
        // second is told nothing until the first is put right. Here every
        // problem is there, each with the key it is about, as the parts of
        // its path, and with its kind, so nobody has to read the sentence
        // to know what sort of problem it is.
        //
        // The order is part of the answer: the unknown keys as `build_theme`
        // lists them, then the refused values in the order of the schema.
        let recipe = parse(
            r##"{"shape": {"buttonRadius": "4px; } html { display: none"}, "danger": "#b91c1c", "acent": "#000", "accent": "purple"}"##,
        )
        .unwrap();
        let alone = |recipe: &str| theme(recipe).err().unwrap();
        let found: Vec<_> = check_recipe(&recipe).iter().map(written).collect();
        assert_eq!(
            found,
            [
                (
                    vec!["acent".to_string()],
                    "unknown".to_string(),
                    "Unknown key in the recipe: acent".to_string()
                ),
                (
                    vec!["accent".to_string()],
                    "refused".to_string(),
                    alone(r#"{"accent": "purple"}"#)
                ),
                (
                    vec!["shape".to_string(), "buttonRadius".to_string()],
                    "refused".to_string(),
                    alone(r#"{"shape": {"buttonRadius": "4px; } html { display: none"}}"#)
                ),
            ]
        );
    }

    #[test]
    fn a_key_with_a_dot_in_its_name_is_not_the_key_it_looks_like() {
        // `"shape.buttonRadius"` at the top is one key, which the recipe
        // does not have. Written as a path with dots it was the same as the
        // corner of the button, and one of the two answers was lost.
        let recipe =
            parse(r##"{"shape.buttonRadius": "4px", "shape": {"buttonRadius": "4px;"}}"##).unwrap();
        let problems = check_recipe(&recipe);
        let paths: Vec<(&[String], &str)> = problems
            .iter()
            .map(|p| (p.path.as_slice(), p.kind.as_str()))
            .collect();
        assert_eq!(
            paths,
            [
                (&["shape.buttonRadius".to_string()][..], "unknown"),
                (
                    &["shape".to_string(), "buttonRadius".to_string()][..],
                    "refused"
                ),
            ]
        );
    }

    #[test]
    fn a_problem_with_the_whole_recipe_has_no_path() {
        for (recipe, kind) in [
            ("{}", "empty"),
            (r#"{"accent": ""}"#, "empty"),
            ("[1]", "notARecipe"),
            ("null", "notARecipe"),
        ] {
            let problems = check_recipe(&parse(recipe).unwrap());
            assert_eq!(problems.len(), 1, "{recipe}");
            assert_eq!(problems[0].kind.as_str(), kind, "{recipe}");
            assert!(problems[0].path.is_empty(), "{recipe}");
            // The sentence is the one `build_theme` refuses with.
            assert_eq!(
                theme(recipe).err(),
                Some(problems[0].message.clone()),
                "{recipe}"
            );
        }
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
        }
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
        // the theme builder shows them and the file has the first of them,
        // and none of the three puts them together itself. The wording is
        // the one `lotek theme` had when the core took it over.
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

    /// The reasons of a row, put together here from the row's own numbers:
    /// first what the colour would break as the fill, light then dark, then
    /// the chroma the fill lost, light then dark.
    fn reasons_from_the_numbers(brand: &Brand) -> Vec<String> {
        let sides = [("light", &brand.light), ("dark", &brand.dark)];
        let plainly = |promise: &str| match promise {
            "fill on canvas" => "against the page it",
            "fill on raised" => "against a raised surface it",
            "content on top of fill" => "text on it",
            other => panic!("a promise about the fill without plain words: {other}"),
        };
        let mut reasons = Vec::new();
        for (appearance, side) in sides {
            if side.breaks.is_empty() {
                continue;
            }
            let clauses: Vec<String> = side
                .breaks
                .iter()
                .map(|b| {
                    format!(
                        "{} would have a contrast of {}:1, and {}:1 is required",
                        plainly(&b.promise),
                        to_fixed2(b.ratio),
                        js_number(b.required)
                    )
                })
                .collect();
            reasons.push(format!(
                "In the {appearance} theme {} cannot be the fill as it is: {}.",
                brand.given,
                clauses.join("; ")
            ));
        }
        for (appearance, side) in sides {
            let percent = (side.chroma_kept * 100.0).round();
            if percent < 100.0 {
                reasons.push(format!(
                    "In the {appearance} theme the fill is less saturated than {}, with {percent}% of its chroma: a screen cannot show more at that lightness.",
                    brand.given
                ));
            }
        }
        reasons
    }

    #[test]
    fn what_a_brand_says_agrees_with_its_own_numbers() {
        // A sentence with one number and a row with another is two answers.
        // Nine colours around the wheel, a grey and LO-TEK's own among them.
        let t = theme(
            r##"{"accent": "#ff0000", "visited": "#ff8800", "brand1": "#ffd600", "brand2": "#39ff14", "brand3": "#00bcd4", "neutral": "#2b2b2b", "danger": "#ff00ff", "warning": "#8a5a00", "success": "#1362ae"}"##,
        )
        .unwrap();
        assert_eq!(t.brands.len(), 9);
        let mut said = 0;
        for brand in &t.brands {
            assert_eq!(
                brand.summary,
                format!(
                    "{}: {} gives the fill {} in the light theme and {} in the dark theme.",
                    brand.family, brand.given, brand.light.fill, brand.dark.fill
                )
            );
            assert_eq!(
                brand.reasons,
                reasons_from_the_numbers(brand),
                "{}",
                brand.family
            );
            said += brand.reasons.len();
        }
        // Every kind of sentence is among them, and a row without one of a
        // kind: a comparison of nothing with nothing would pass too.
        assert!(said > 15, "only {said} reasons");
        assert!(t.brands.iter().any(|b| b.light.breaks.is_empty()));
        assert!(t
            .brands
            .iter()
            .any(|b| (b.light.chroma_kept * 100.0).round() == 100.0));
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
