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
use lotek_core::theme::contract::contract;
use lotek_core::theme::{build_theme, check_recipe, Brand, RecipeKind};

/// The order the colour flags are listed in, as in `lotek --help`. Which
/// families exist is the contract's to say, not this list's.
const SHOWN: [&str; 9] = [
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

type Object = Vec<(String, Json)>;

fn set(object: &mut Object, key: &str, value: Json) {
    match object.iter_mut().find(|(k, _)| k == key) {
        Some(existing) => existing.1 = value,
        None => object.push((key.to_string(), value)),
    }
}

/// The keys a block of the recipe file has, to set the flags on top of. A
/// block that is not an object has none: the core says what it is.
fn keys_of(value: Option<&Json>) -> Object {
    match value {
        Some(Json::Object(entries)) => entries.clone(),
        _ => Vec::new(),
    }
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
        // `null`, a list and a text are all valid JSON, and none of them is
        // a recipe. The core says so, and the file is named before it.
        Ok(other) => {
            crate::package::load_contract();
            let said: Vec<String> = check_recipe(&other)
                .into_iter()
                .map(|p| p.message)
                .collect();
            fail(&format!("\"{path}\": {}\n", said.join(" ")))
        }
        Err(reason) => fail(&format!("\"{path}\" is not valid JSON: {reason}\n")),
    }
}

/// What became of each brand colour, as the lines the run writes: the
/// core's summary, and its reasons under it. The sentences are the core's.
fn brand_lines(brands: &[Brand]) -> Vec<String> {
    let mut lines = Vec::new();
    for brand in brands {
        lines.push(brand.summary.clone());
        lines.extend(brand.reasons.iter().map(|reason| format!("  {reason}")));
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

    // The keys in the recipe file, which can come from another repository,
    // where a typo is harder to spot than one on the command line. The core
    // knows the keys, and is asked before the flags are, so a mistake in the
    // recipe is reported before an unknown flag.
    crate::package::load_contract();
    let in_file = check_recipe(&from_file);
    let unknown = in_file
        .iter()
        .any(|problem| problem.kind == RecipeKind::Unknown);
    if unknown {
        // The core's own refusal of the file as it is: it names every key
        // the recipe does not have.
        let refusal = build_theme(&from_file).err().unwrap_or_default();
        fail(&format!("{refusal}\n\nFull overview: lotek --help\n"));
    }

    // The colour families. The flag, the recipe key and the family have the
    // same name, and the contract says which exist. `SHOWN` is only the
    // order they are listed in when a flag is unknown, the one in the help
    // text. A family the contract has and `SHOWN` lacks comes after them.
    let contract = contract();
    let families = || contract.families.iter().map(String::as_str);
    let known: Vec<&str> = SHOWN
        .into_iter()
        .filter(|shown| families().any(|family| family == *shown))
        .chain(families().filter(|family| !SHOWN.contains(family)))
        .chain(TYPOGRAPHY_FLAGS.iter().map(|(n, _)| *n))
        .chain(SHAPE_FLAGS.iter().map(|(n, _)| *n))
        .chain(["out"])
        .collect();
    refuse_unknown_flags(&arguments, &known);

    // The recipe goes to the core as it is written, and a flag wins over the
    // same key in the file.
    let mut input = recipe;
    for family in &contract.families {
        if let Some(v) = arguments.flag(family) {
            set(&mut input, family, Json::String(v.to_string()));
        }
    }
    for (block, flags) in [
        ("typography", &TYPOGRAPHY_FLAGS[..]),
        ("shape", &SHAPE_FLAGS[..]),
    ] {
        let mut keys = keys_of(from_file.get(block));
        let mut flagged = false;
        for (flag, key) in flags {
            if let Some(v) = arguments.flag(flag) {
                set(&mut keys, key, Json::String(v.to_string()));
                flagged = true;
            }
        }
        // A block of the file the core refuses is left as it is, for the
        // core to refuse: a flag does not paper over it. Whether it does is
        // the core's to say. Any other block is an object or not given, and
        // the flags are set on the keys it has.
        let broken = in_file.iter().any(|problem| {
            problem.kind == RecipeKind::Refused && problem.path == [block.to_string()]
        });
        if flagged && !broken {
            set(&mut input, block, Json::Object(keys));
        }
    }

    let theme = match build_theme(&Json::Object(input)) {
        Ok(theme) => theme,
        // The core says what is wrong, and what a colour is where that is
        // the mistake. Nothing is added here.
        Err(message) => fail(&format!("\n{message}\n")),
    };

    if !theme.violations.is_empty() {
        let lines: Vec<String> = theme
            .violations
            .iter()
            .map(|v| format!("  {}", v.summary()))
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
