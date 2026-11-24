//! The LO-TEK command line.
//!
//! Written once, and run wherever you are: as an executable from
//! `cargo install`, as a WASI module in Node (`npx @lo-tek/interfaces`), on
//! the JVM with Chicory (`java -jar`) and in wasmtime. The answers, texts and
//! exit codes are the same everywhere, and they were the same as in `cli.ts`
//! when it was written in TypeScript.
//!
//! A finding is printed as `file:line:column: error: message`, like a
//! compiler, and one finding is enough to exit with an error.

mod agent;
mod check;
mod check_theme;
mod fetch;
mod lookup;
mod lsp;
mod manifest;
mod output;
mod package;
mod takeover;
mod theme;

use output::{fail, log};

/// What the command can do, on one screen.
pub const HELP: &str = r#"lotek <command>

  check <file|address…> Checks the markup against LO-TEK, as the editor does.
                       Without files, standard input is read. One finding
                       gives an error code. An address is fetched and
                       checked as a whole page: every id referred to must
                       exist, and every field must be wired
    --rendered         Check files and standard input as whole pages too
    --manifest=<file>  Also check a taken-over component, with the fragment
                       lotek takeover wrote next to the copy
    --css=<file>       Also check that the style sheets style the markup: a
                       class without a style sheet, and a value without a rule
                       Each file is checked against the manifest nearest to
                       it, in build/lotek/ or in node_modules, as lsp finds
                       it, with the package's own as a fallback

  check-theme <file…>  Checks that a colour theme keeps the contrast promises.
                       Reads the --lt-color-* values in each block and says
                       which cell fails. One violation gives an error code

  agent                Writes the rulebook for coding agents to standard
    --framework=<name> output. No file is written anywhere. Without the flag,
                       the environment is read from package.json. Names:
                       astro, bundles, datastar, html, kotlin, react,
                       templates.
                       Vue, Svelte, Solid and Lit share "bundles"

  takeover <component> Copies the source of one component into the project,
                       with a new name (app-…), so it is yours to change
    --out=<folder>     Where the copy goes. Default: src/lotek
    --overwrite=yes    Overwrite a copy that already exists

  lsp                  The language server for editors, over standard input
                       and output. Reads the manifest in build/lotek/ or in
                       node_modules, with the package's own as a fallback

  manifest             Writes the manifest the check uses, with the fragments
    --manifest=<file>  from lotek takeover added
    --out=<file>       Write to a file instead of standard output

  theme                Builds a theme from your brand colours, font and shape
    --accent=<colour>        Links, buttons and focus
    --danger=<colour>        Errors and deletion
    --success=<colour>       Confirmations
    --warning=<colour>       Warnings
    --neutral=<colour>       Text and surfaces
    --visited=<colour>       Visited links
    --brand1=<colour>        Brand colour for surfaces and categories
    --brand2=<colour>        Second brand colour
    --brand3=<colour>        Third brand colour
    --font=<stack>           The font stack the theme uses
    --button-radius=<size>   Corners on button, pagination and skip link
    --field-radius=<size>    Corners on input, text area and select
    --surface-radius=<size>  Corners on card, dialog, popover, alert,
                             accordion, error summary, file upload,
                             session timeout, suggestion list, toast,
                             tooltip and term
    --button-border=<size>   Border width of the button
    --button-weight=<weight> Font weight of the button text
    --out=<file>             Write to a file instead of standard output

Colours are written in hexadecimal, for example #7c3aed. The theme can also
be read from a JSON file: lotek theme lotek.theme.json

The manifest, the colour contract, the rulebooks and the components are read
from @lo-tek/interfaces in node_modules, or from the folder LOTEK_PACKAGE
points to.

Examples:
  npx @lo-tek/interfaces check templates/*.html
  npx @lo-tek/interfaces check http://localhost:8080/form
  curl -s http://localhost:8080/form | npx @lo-tek/interfaces check --rendered
  npx @lo-tek/interfaces agent
  npx @lo-tek/interfaces takeover button --out=src/ui
  npx @lo-tek/interfaces theme --accent=#7c3aed --danger=#b3261e \
    --success=#2b6940 --warning=#8a5a00 --out=theme.css
"#;

const HELP_FLAGS: [&str; 3] = ["--help", "-h", "help"];
const COMMANDS: [&str; 7] = [
    "agent",
    "check",
    "check-theme",
    "takeover",
    "theme",
    "manifest",
    "lsp",
];

/// The flags with an equals sign, `--name=value`, and the rest as files.
///
/// A hyphen is part of the name: flags like `--button-radius` are otherwise
/// read as a file. Digits too: `--brand1` was read as a file name.
pub struct Arguments {
    pub flags: Vec<(String, String)>,
    pub files: Vec<String>,
}

impl Arguments {
    pub fn read(arguments: &[String]) -> Self {
        let mut flags: Vec<(String, String)> = Vec::new();
        let mut files = Vec::new();
        for part in arguments {
            match flag(part) {
                Some((name, value)) => match flags.iter_mut().find(|(n, _)| *n == name) {
                    Some(existing) => existing.1 = value,
                    None => flags.push((name, value)),
                },
                None => files.push(part.clone()),
            }
        }
        Arguments { flags, files }
    }

    pub fn flag(&self, name: &str) -> Option<&str> {
        self.flags
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    /// The first "flag" without a value, like `--out src/ui`, which would
    /// otherwise be read as two file names.
    pub fn without_value(&self) -> Option<&str> {
        self.files
            .iter()
            .find(|f| f.starts_with("--"))
            .map(String::as_str)
    }
}

/// `/^--([a-z0-9-]+)=(.+)$/`
fn flag(part: &str) -> Option<(String, String)> {
    let rest = part.strip_prefix("--")?;
    let (name, value) = rest.split_once('=')?;
    let name_ok = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    // `.` in a regular expression does not match a line break.
    let value_ok = !value.is_empty() && !value.contains(['\n', '\r', '\u{2028}', '\u{2029}']);
    (name_ok && value_ok).then(|| (name.to_string(), value.to_string()))
}

/// Reports a flag without a value and exits.
pub fn refuse_without_value(arguments: &Arguments) {
    if let Some(flag) = arguments.without_value() {
        fail(&format!(
            "\"{flag}\" has no value.\n\nWrite {flag}=<value>, with an equals sign and no spaces.\n"
        ));
    }
}

/// Reports flags the command does not know, and exits. A typo like
/// `--outt=src/ui` must not look as if the command did what you asked.
pub fn refuse_unknown_flags(arguments: &Arguments, known: &[&str]) {
    let unknown: Vec<String> = arguments
        .flags
        .iter()
        .map(|(n, _)| n.as_str())
        .filter(|n| !known.contains(n))
        .map(|n| format!("--{n}"))
        .collect();
    if !unknown.is_empty() {
        let all: Vec<String> = known.iter().map(|n| format!("--{n}")).collect();
        fail(&format!(
            "Unknown flag: {}\n\nKnown flags: {}\n\nFull overview: lotek --help\n",
            unknown.join(", "),
            all.join(", ")
        ));
    }
}

fn main() {
    // A WASI module starts in the folder `/`, so a relative path like
    // `package.json` would have been read from the root. The host says where
    // the working directory is, and the module goes there before anything
    // else.
    if let Ok(directory) = std::env::var("LOTEK_WORKDIR") {
        // A network folder on Windows (`\\\\server\\…`) is not open to the
        // module. It should be told so, not get "File not found" afterwards.
        if let Err(reason) = std::env::set_current_dir(&directory) {
            output::error(&format!(
                "Warning: the command line cannot go to the working directory \"{directory}\" ({reason}). Relative paths are read from the root. Use absolute paths, or run from a folder on a drive."
            ));
        }
    }
    let arguments: Vec<String> = std::env::args().skip(1).collect();

    // Without arguments, or when someone asks for help, the command says what
    // it can do.
    if arguments.is_empty() || HELP_FLAGS.contains(&arguments[0].as_str()) {
        log(HELP);
        std::process::exit(0);
    }
    let first = arguments[0].as_str();
    if !COMMANDS.contains(&first) && !first.starts_with("--") {
        fail(&format!("Unknown command \"{first}\".\n\n{HELP}"));
    }

    let rest = &arguments[1..];
    match first {
        "agent" => agent::run(rest),
        "check" => check::run(rest),
        "check-theme" => check_theme::run(rest),
        "takeover" => takeover::run(rest),
        "manifest" => manifest::run(rest),
        "lsp" => lsp::run(rest),
        // `theme` can come first, since the command is run as
        // `npx @lo-tek/interfaces theme`.
        "theme" => theme::run(rest),
        _ => theme::run(&arguments),
    }
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_flags_like_the_regular_expression() {
        assert_eq!(
            flag("--button-radius=4px"),
            Some(("button-radius".into(), "4px".into()))
        );
        assert_eq!(
            flag("--brand1=#fff"),
            Some(("brand1".into(), "#fff".into()))
        );
        assert_eq!(
            flag("--neutral=a=b"),
            Some(("neutral".into(), "a=b".into()))
        );
        assert_eq!(flag("--Accent=#fff"), None);
        assert_eq!(flag("--out="), None);
        assert_eq!(flag("--out"), None);
        assert_eq!(flag("theme.json"), None);
    }
}
