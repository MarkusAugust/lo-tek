//! `lotek theme`: a colour theme from your brand colours, font and shape.
//!
//! ```bash
//! lotek theme --accent=#7c3aed --danger=#b3261e --out=theme.css
//! lotek theme lotek.theme.json --out=theme.css
//! ```
//!
//! The core builds the theme, and the promises hold by construction. If a
//! pair still fails, the run exits with an error rather than delivering a
//! theme that looks right. A flag or a key that does not exist stops the run:
//! a typo must not look as if the command did what you asked.

use crate::output::{error, fail, log, shown};
use crate::{refuse_unknown_flags, refuse_without_value, Arguments};
use lotek_core::json::{parse, Json};
use lotek_core::theme::{build_theme, js_number, to_fixed2, Brand, BrandFill};

/// The colour families. The flag, the recipe key and the family have the
/// same name.
const COLORS: [&str; 9] = [
    "accent", "danger", "success", "warning", "neutral", "visited", "brand1", "brand2", "brand3",
];

const TYPOGRAPHY_FLAGS: [(&str, &str); 1] = [("font", "fontFamily")];

const SHAPE_FLAGS: [(&str, &str); 5] = [
    ("button-radius", "buttonRadius"),
    ("field-radius", "fieldRadius"),
    ("surface-radius", "surfaceRadius"),
    ("button-border", "buttonBorderWidth"),
    ("button-weight", "buttonFontWeight"),
];

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

type Object = Vec<(String, Json)>;

fn set(object: &mut Object, key: &str, value: Json) {
    match object.iter_mut().find(|(k, _)| k == key) {
        Some(existing) => existing.1 = value,
        None => object.push((key.to_string(), value)),
    }
}

/// `{ ...value }`: the names and values as JavaScript spreads them.
fn spread(value: Option<&Json>) -> Object {
    match value {
        Some(Json::Object(entries)) => entries.clone(),
        Some(Json::Array(items)) => items
            .iter()
            .enumerate()
            .map(|(i, v)| (i.to_string(), v.clone()))
            .collect(),
        Some(Json::String(s)) => s
            .encode_utf16()
            .enumerate()
            .map(|(i, u)| (i.to_string(), Json::String(String::from_utf16_lossy(&[u]))))
            .collect(),
        _ => Vec::new(),
    }
}

/// The keys in an object that are not in the list, with the path in front.
fn unknown_keys(value: Option<&Json>, allowed: &[&str], path: &str) -> Vec<String> {
    let keys: Vec<String> = match value {
        Some(Json::Object(entries)) => entries.iter().map(|(k, _)| k.clone()).collect(),
        Some(Json::Array(items)) => (0..items.len()).map(|i| i.to_string()).collect(),
        _ => Vec::new(),
    };
    keys.into_iter()
        .filter(|k| !allowed.contains(&k.as_str()))
        .map(|k| format!("{path}.{k}"))
        .collect()
}

/// The recipe in a JSON file, or an explanation and an error code.
fn read_recipe(file: &str) -> Object {
    let path = shown(file);
    let Ok(bytes) = std::fs::read(file) else {
        fail(&format!(
            "File not found: \"{path}\".\n\nGive a JSON file with the colours, or set them as flags. See `lotek --help`.\n"
        ));
    };
    match parse(&String::from_utf8_lossy(&bytes)) {
        Ok(Json::Object(entries)) => entries,
        // `null`, a list and a string are all valid JSON, and none of them is
        // a recipe.
        Ok(_) => fail(&format!(
            "\"{path}\" is valid JSON, but not a recipe.\n\nThe file must be an object with the colours in it, for example:\n  {{\"accent\": \"#7c3aed\", \"danger\": \"#b3261e\"}}\n"
        )),
        Err(reason) => fail(&format!("\"{path}\" is not valid JSON: {reason}\n")),
    }
}

/// What became of each brand colour, as the lines the run writes.
///
/// The lightness is the role's, so the colour is moved, and a light one is
/// moved far. The run says so, with the reason in the contract's own terms,
/// rather than answering only that every promise holds.
fn brand_lines(brands: &[Brand]) -> Vec<String> {
    let mut lines = Vec::new();
    for brand in brands {
        let appearances: [(&str, &BrandFill); 2] = [("light", &brand.light), ("dark", &brand.dark)];
        lines.push(format!(
            "{}: {} gives the fill {} in the light theme and {} in the dark theme.",
            brand.family, brand.given, brand.light.fill, brand.dark.fill
        ));
        for (appearance, fill) in appearances {
            if fill.breaks.is_empty() {
                continue;
            }
            let breaks: Vec<String> = fill
                .breaks
                .iter()
                .map(|v| {
                    format!(
                        "{} would be {}:1, the requirement is {}:1",
                        v.promise,
                        to_fixed2(v.ratio),
                        js_number(v.required)
                    )
                })
                .collect();
            lines.push(format!(
                "  In the {appearance} theme {} could not be the fill itself: {}.",
                brand.given,
                breaks.join("; ")
            ));
        }
        for (appearance, fill) in appearances {
            let percent = (fill.chroma_kept * 100.0).round();
            if percent < 100.0 {
                lines.push(format!(
                    "  In the {appearance} theme the fill has {percent}% of the chroma of {}: sRGB cannot show more at that lightness and hue.",
                    brand.given
                ));
            }
        }
    }
    lines
}

pub fn run(arguments: &[String]) {
    let arguments = Arguments::read(arguments);
    // `--out theme.css` without an equals sign was read as two file names
    // after the recipe. The theme then went to standard output, and no file
    // was written.
    refuse_without_value(&arguments);
    if arguments.files.len() > 1 {
        let files: Vec<String> = arguments
            .files
            .iter()
            .map(|f| format!("\"{}\"", shown(f)))
            .collect();
        fail(&format!(
            "A theme is built from one recipe, but got {} files: {}.\n\nMerge them into one JSON file, or set the rest as flags. See `lotek --help`.\n",
            files.len(),
            files.join(", ")
        ));
    }
    let recipe: Object = match arguments.files.first() {
        Some(path) => read_recipe(path),
        None => Vec::new(),
    };
    let from_file = Json::Object(recipe.clone());

    let mut input: Object = Vec::new();
    for family in COLORS {
        let value = match arguments.flag(family) {
            Some(v) => Some(Json::String(v.to_string())),
            None => from_file.get(family).cloned(),
        };
        if let Some(Json::String(s)) = value {
            if !s.is_empty() {
                set(&mut input, family, Json::String(s));
            }
        }
    }

    // Font and shape can come from the file or from flags, and the flag wins.
    let mut typography = spread(from_file.get("typography"));
    for (flag, key) in TYPOGRAPHY_FLAGS {
        if let Some(v) = arguments.flag(flag) {
            set(&mut typography, key, Json::String(v.to_string()));
        }
    }
    let mut shape = spread(from_file.get("shape"));
    for (flag, key) in SHAPE_FLAGS {
        if let Some(v) = arguments.flag(flag) {
            set(&mut shape, key, Json::String(v.to_string()));
        }
    }
    let typography = Json::Object(typography);
    let shape = Json::Object(shape);
    if typography.as_object().is_some_and(|o| !o.is_empty()) {
        set(&mut input, "typography", typography.clone());
    }
    if shape.as_object().is_some_and(|o| !o.is_empty()) {
        set(&mut input, "shape", shape.clone());
    }

    let known: Vec<&str> = COLORS
        .iter()
        .copied()
        .chain(TYPOGRAPHY_FLAGS.iter().map(|(n, _)| *n))
        .chain(SHAPE_FLAGS.iter().map(|(n, _)| *n))
        .chain(["out"])
        .collect();

    // The keys in the recipe file, which can come from another repository,
    // where a typo is harder to spot than one on the command line.
    let top_level: Vec<&str> = COLORS
        .iter()
        .copied()
        .chain(["typography", "shape", "$schema"])
        .collect();
    let mut unknown: Vec<String> = recipe
        .iter()
        .map(|(k, _)| k.clone())
        .filter(|k| !top_level.contains(&k.as_str()))
        .collect();
    unknown.extend(unknown_keys(
        Some(&typography),
        &TYPOGRAPHY_KEYS,
        "typography",
    ));
    unknown.extend(unknown_keys(
        typography.get("weights"),
        &WEIGHT_KEYS,
        "typography.weights",
    ));
    unknown.extend(unknown_keys(
        typography.get("lineHeights"),
        &LINE_KEYS,
        "typography.lineHeights",
    ));
    unknown.extend(unknown_keys(Some(&shape), &SHAPE_KEYS, "shape"));

    if !unknown.is_empty() {
        fail(&format!(
            "Unknown key in the recipe: {}\n\nFull overview: lotek --help\n",
            unknown.join(", ")
        ));
    }
    // After the keys, so a mistake in the recipe is reported before an
    // unknown flag.
    refuse_unknown_flags(&arguments, &known);

    crate::package::load_contract();
    let theme = match build_theme(&Json::Object(input)) {
        Ok(theme) => theme,
        Err(message) => {
            // The hint about hexadecimal colours is shown only when the error
            // is about a colour, not about a font or shape value that could
            // break out of its CSS rule. Those errors name the recipe key.
            let about_colors = !TYPOGRAPHY_KEYS
                .iter()
                .chain(SHAPE_KEYS.iter())
                .any(|key| message.contains(key));
            fail(&format!(
                "\n{message}\n{}",
                if about_colors {
                    "\nColours are written as hexadecimal values, for example #7c3aed.\n"
                } else {
                    ""
                }
            ));
        }
    };

    if !theme.violations.is_empty() {
        let lines: Vec<String> = theme
            .violations
            .iter()
            .map(|v| {
                format!(
                    "  {}: {} is {}:1, the requirement is {}:1",
                    v.family,
                    v.promise,
                    to_fixed2(v.ratio),
                    js_number(v.required)
                )
            })
            .collect();
        fail(&format!(
            "\nThe theme does not meet the contrast requirement:\n\n{}\n",
            lines.join("\n")
        ));
    }

    let became = brand_lines(&theme.brands);
    for line in &became {
        error(line);
    }

    match arguments.flag("out") {
        Some(path) => {
            if let Err(e) = std::fs::write(path, &theme.css) {
                fail(&format!("Could not write {}: {e}", shown(path)));
            }
            // The blank line sets the message apart when it stands alone.
            // After the lines about the brand colours it belongs with them.
            error(&format!(
                "{}Wrote {}. {} colours in each theme, every promise holds.",
                if became.is_empty() { "\n" } else { "" },
                shown(path),
                theme.light.len()
            ));
        }
        None => log(&theme.css),
    }
}
