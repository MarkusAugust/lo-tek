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
const SURFACES: [&str; 11] = [
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

/// Whether parentheses and quotes are balanced.
///
/// An unbalanced `(` is enough on its own: `1px (` opens a block that
/// swallows the semicolon, both braces and everything after it in the file.
/// Tested in Chromium, where both the theme and the consumer's own style
/// sheet disappeared.
fn balanced(value: &str) -> bool {
    let mut depth = 0i32;
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
            depth += 1;
        } else if c == ')' {
            depth -= 1;
            if depth < 0 {
                return false;
            }
        }
    }
    depth == 0 && quote.is_none()
}

/// Refuses a value that can break out of the rule it is written into.
///
/// The recipe can come from another repository or a build step. Four ways
/// out were checked in a browser: `4px; } html { display: none } :root { --x: 1`
/// closed the block, `1px (` swallowed the rest of the file, `Arial\` let the
/// backslash eat the semicolon, and `Arial</style><script>…` ran the script
/// where the CSS is inline in a `<style>`. Hence both a list of dangerous
/// characters and a requirement that parentheses and quotes are balanced.
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
            "The value of {} has an unbalanced parenthesis or quote. A parenthesis that is not closed swallows the rest of the style sheet. Got: {value}",
            recipe_name(name)
        ));
    }
    Ok(value.to_string())
}

/// The value as text, as `String(value)` gives it, or nothing when it is not
/// given. `0` counts as given.
fn given(value: Option<&Json>) -> Option<String> {
    match value? {
        Json::String(s) if s.is_empty() => None,
        Json::String(s) => Some(s.clone()),
        Json::Number(n) => Some(js_number(*n)),
        Json::Bool(b) => Some(b.to_string()),
        Json::Null => Some("null".into()),
        _ => None,
    }
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
        let rows: Vec<String> = brands
            .iter()
            .map(|b| {
                format!(
                    " * {}: {} gives the fill {} in the light theme and {} in the dark theme.",
                    b.family, b.given, b.light.fill, b.dark.fill
                )
            })
            .collect();
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

/// Builds the theme, and checks every promise while it is built.
///
/// `input` is the recipe: the brand colours per family, and `typography` and
/// `shape`. A family that is left out inherits LO-TEK's own hue.
pub fn build_theme(input: &Json) -> Result<Theme, String> {
    if !contract::loaded() {
        return Err(contract::NOT_LOADED.into());
    }
    let contract = contract();
    let given_families: Vec<(&str, String)> = contract
        .families
        .iter()
        .filter_map(|name| match input.get(name) {
            Some(Json::String(s)) if !s.is_empty() => Some((name.as_str(), s.clone())),
            Some(Json::Number(n)) if *n != 0.0 && !n.is_nan() => {
                Some((name.as_str(), js_number(*n)))
            }
            Some(Json::Bool(true)) => Some((name.as_str(), "true".into())),
            Some(Json::Array(_)) | Some(Json::Object(_)) => Some((name.as_str(), String::new())),
            _ => None,
        })
        .collect();
    let typography = input.get("typography").filter(|v| truthy(v));
    let shape = input.get("shape").filter(|v| truthy(v));

    if given_families.is_empty() && typography.is_none() && shape.is_none() {
        return Err(
            "The theme is empty. Give either brand colours, or typography and shape.".into(),
        );
    }
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
            Ok(Brand {
                family: name.to_string(),
                light: brand_fill(&light, Appearance::Light, name, &given)?,
                dark: brand_fill(&dark, Appearance::Dark, name, &given)?,
                given,
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

fn truthy(v: &Json) -> bool {
    match v {
        Json::Null => false,
        Json::Bool(b) => *b,
        Json::Number(n) => *n != 0.0 && !n.is_nan(),
        Json::String(s) => !s.is_empty(),
        _ => true,
    }
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
