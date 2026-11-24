//! `lotek takeover <component>`: copies the source of one component into the
//! project, when customising through CSS is not enough.
//!
//! The layer and the `--lt-*` variables cover the appearance, and since no
//! component has shadow DOM, your CSS reaches everywhere. What they do not
//! cover is "I want this component to behave differently". The alternative is
//! then either to live with it or to write the component again from scratch,
//! and this command is the way in between: a component is a style sheet and a
//! file of between one and three hundred lines, without dependencies.
//!
//! Three things are done to the copy:
//!
//! - The references out of the folder are rewritten. `../shared.js` does not
//!   exist where the copy ends up, and becomes `@lo-tek/interfaces/shared`,
//!   which still works and shows what the copy takes from the package.
//! - The copy gets a new name: `lt-button` becomes `app-button` in classes,
//!   tags, `define` and selectors. What you take over is yours, and it can
//!   sit next to the original without the order deciding which one wins.
//!   The `--lt-*` variables are kept, so the theme works as before.
//! - A fragment of the manifest is written next to it, with the new names, so
//!   `lotek check --manifest=…` checks the markup for the copy too.
//!
//! What the copy is called is the core's (`lotek_core::takeover`), since the
//! check must recognise the same names. The files, the references and the
//! plan are here.
//!
//! The source is read from the package the project has installed (see
//! `package.rs`), so the copy is of the version the project uses.

use crate::output::{error, fail, shown};
use crate::{refuse_unknown_flags, refuse_without_value, Arguments};
use lotek_core::json::{parse, Json};
use lotek_core::takeover::{fragment, own_names, rename, renamed};

pub struct Component {
    pub category: String,
    pub name: String,
    folder: std::path::PathBuf,
    names: Vec<String>,
}

impl Component {
    /// The file name and the content, without the tests, sorted by name. Read
    /// only once the component is chosen.
    pub fn files(&self) -> Vec<(String, String)> {
        self.names
            .iter()
            .map(|file| (file.clone(), self.folder.join(file)))
            .map(|(file, path)| {
                let text = std::fs::read_to_string(&path).unwrap_or_else(|e| {
                    fail(&format!(
                        "Could not read {}: {e}\n",
                        shown(&path.to_string_lossy())
                    ))
                });
                (file, text)
            })
            .collect()
    }
}

/// The components in the package, sorted by name.
pub fn components() -> Vec<Component> {
    let root = crate::package::require().join("src/components");
    let text = |c: &Json, key: &str| {
        c.get(key)
            .and_then(Json::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let mut out: Vec<Component> = crate::package::files()
        .get("components")
        .and_then(Json::as_array)
        .unwrap_or_default()
        .iter()
        .map(|c| Component {
            category: text(c, "category"),
            name: text(c, "name"),
            folder: root.join(text(c, "category")).join(text(c, "name")),
            names: c
                .get("files")
                .and_then(Json::as_array)
                .unwrap_or_default()
                .iter()
                .filter_map(|f| f.as_str().map(str::to_string))
                .collect(),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// The file with the fragment of the manifest, in the copy's folder.
pub const FRAGMENT: &str = "lotek-manifest.json";

/// A file in the package.
pub struct SourceFile {
    /// The path in the package, like "src/components/css/button/button.ts".
    pub path: String,
    pub content: String,
}

#[derive(Debug, PartialEq)]
pub struct Rewrite {
    pub from: String,
    pub to: String,
}

pub struct PlannedFile {
    /// The file name alone, like "button.ts".
    pub name: String,
    pub content: String,
    /// References that were rewritten, to print afterwards.
    pub rewrites: Vec<Rewrite>,
}

pub struct Plan {
    pub files: Vec<PlannedFile>,
    /// Packages the copy needs in the project. Empty today: the package has no
    /// dependencies, but a consumer should be told at once if a component one
    /// day takes something from outside.
    pub dependencies: Vec<String>,
    /// Style sheets and modules the copy still takes from the package. The
    /// output shows the rewrites instead, so only the tests read the list.
    #[cfg_attr(not(test), allow(dead_code))]
    pub kept_imports: Vec<String>,
    /// The entry points in the package that load the original.
    pub replaced_entries: Vec<String>,
}

/// The lookup from a file in the package to the entry point that points to it.
///
/// `exports` points to `dist` for JavaScript and to `src` for the components'
/// CSS. Both are led back to the source, since the source is what is copied.
pub fn entry_points(name: &str, exports: &Json) -> Vec<(String, String)> {
    let mut entries: Vec<(String, String)> = Vec::new();
    for (subpath, target) in exports.as_object().unwrap_or(&[]) {
        let file = match target {
            Json::String(s) => s.as_str(),
            other => match other.get("import").and_then(Json::as_str) {
                Some(s) if !s.is_empty() => s,
                _ => continue,
            },
        };
        let file = file.strip_prefix("./").unwrap_or(file);
        let file = match file.strip_prefix("dist/") {
            Some(rest) => format!("src/{rest}"),
            None => file.to_string(),
        };
        let source = match file.strip_suffix(".js") {
            Some(stem) => format!("{stem}.ts"),
            None => file,
        };
        let entry = format!("{name}{}", subpath.strip_prefix('.').unwrap_or(subpath));
        match entries.iter_mut().find(|(s, _)| *s == source) {
            Some(existing) => existing.1 = entry,
            None => entries.push((source, entry)),
        }
    }
    entries
}

fn lookup<'a>(entries: &'a [(String, String)], source: &str) -> Option<&'a str> {
    entries
        .iter()
        .find(|(s, _)| s == source)
        .map(|(_, e)| e.as_str())
}

/// Joins a relative path with the folder it is in.
pub fn resolve_path(from_directory: &str, relative: &str) -> String {
    let mut parts: Vec<&str> = from_directory
        .split('/')
        .filter(|p| !p.is_empty())
        .collect();
    for part in relative.split('/') {
        match part {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

/// A reference in a file: `from "…"` or `@import "…"`.
struct Reference {
    /// From the start of `from` or `@import` up to and including the last quote.
    start: usize,
    end: usize,
    /// Everything before the path: `from ` and the quote.
    lead: String,
    quote: char,
    specifier: String,
}

/// `/(from\s+|@import\s+)(["'])([^"']+)\2/g`, without regular expressions.
fn references(text: &str) -> Vec<Reference> {
    let mut found = Vec::new();
    let mut at = 0;
    while at < text.len() {
        match reference_at(text, at) {
            Some(reference) => {
                at = reference.end;
                found.push(reference);
            }
            None => at += text[at..].chars().next().map_or(1, char::len_utf8),
        }
    }
    found
}

fn reference_at(text: &str, start: usize) -> Option<Reference> {
    let rest = &text[start..];
    let keyword = ["from", "@import"]
        .into_iter()
        .find(|k| rest.starts_with(k))?;
    let after = &rest[keyword.len()..];
    let spaces: usize = after
        .chars()
        .take_while(|c| c.is_whitespace() || *c == '\u{feff}')
        .map(char::len_utf8)
        .sum();
    if spaces == 0 {
        return None;
    }
    let quoted = &after[spaces..];
    let quote = quoted.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let inner = &quoted[1..];
    let length = inner.find(['"', '\'']).filter(|&n| n > 0)?;
    if !inner[length..].starts_with(quote) {
        return None;
    }
    let lead_length = keyword.len() + spaces;
    Some(Reference {
        start,
        end: start + lead_length + 1 + length + 1,
        lead: rest[..lead_length].to_string(),
        quote,
        specifier: inner[..length].to_string(),
    })
}

/// Rewrites the references out of the folder in one file.
///
/// A neighbour in the same folder comes along in the copy, and must still be
/// found there.
pub fn rewrite_references(
    file: &SourceFile,
    entries: &[(String, String)],
    own_files: &[String],
) -> PlannedFile {
    let directory = &file.path[..file.path.rfind('/').unwrap_or(0)];
    let mut rewrites = Vec::new();
    let mut content = String::with_capacity(file.content.len());
    let mut copied = 0;
    for reference in references(&file.content) {
        if !reference.specifier.starts_with('.') {
            continue;
        }
        let target = resolve_path(directory, &reference.specifier);
        // A file that comes along in the copy is left alone. The comparison is
        // on the whole path: the file name alone would have left
        // `../shared.js` as it was as soon as the folder itself had a
        // `shared.ts`. The import also points to ".js", the file after the
        // build, while the source is called ".ts".
        let as_source = match target.strip_suffix(".js") {
            Some(stem) => format!("{stem}.ts"),
            None => target.clone(),
        };
        if own_files.contains(&target) || own_files.contains(&as_source) {
            continue;
        }
        let Some(entry) = lookup(entries, &target).or_else(|| lookup(entries, &as_source)) else {
            continue;
        };
        content.push_str(&file.content[copied..reference.start]);
        content.push_str(&reference.lead);
        content.push(reference.quote);
        content.push_str(entry);
        content.push(reference.quote);
        copied = reference.end;
        rewrites.push(Rewrite {
            from: reference.specifier,
            to: entry.to_string(),
        });
    }
    content.push_str(&file.content[copied..]);
    PlannedFile {
        name: file
            .path
            .rsplit('/')
            .next()
            .unwrap_or(&file.path)
            .to_string(),
        content,
        rewrites,
    }
}

/// Puts together the whole plan for one component.
pub fn plan_takeover(files: &[SourceFile], entries: &[(String, String)]) -> Plan {
    let own: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
    let planned: Vec<PlannedFile> = files
        .iter()
        .map(|f| rewrite_references(f, entries, &own))
        .collect();

    let mut dependencies: Vec<String> = Vec::new();
    let mut kept: Vec<String> = Vec::new();
    for file in &planned {
        for reference in references(&file.content) {
            let specifier = reference.specifier;
            if specifier.starts_with('.') {
                continue;
            }
            if specifier.starts_with("@lo-tek/") {
                kept.push(specifier);
                continue;
            }
            let parts: Vec<&str> = specifier.split('/').collect();
            dependencies.push(if specifier.starts_with('@') {
                parts[..parts.len().min(2)].join("/")
            } else {
                parts[0].to_string()
            });
        }
    }
    let mut replaced: Vec<String> = files
        .iter()
        .filter_map(|f| lookup(entries, &f.path).map(str::to_string))
        .collect();
    for list in [&mut dependencies, &mut kept, &mut replaced] {
        list.sort();
        list.dedup();
    }
    Plan {
        files: planned,
        dependencies,
        kept_imports: kept,
        replaced_entries: replaced,
    }
}

pub fn run(arguments: &[String]) {
    let parsed = Arguments::read(arguments);
    // As in `agent`: `--out src/ui` without an equals sign was read as two
    // file names, and the copy quietly ended up in the default folder.
    refuse_without_value(&parsed);
    refuse_unknown_flags(&parsed, &["out", "overwrite"]);

    let name = parsed.files.first().map(String::as_str);
    let all_components = components();
    let Some(component) = name.and_then(|n| all_components.iter().find(|c| c.name == n)) else {
        let all: Vec<&str> = all_components.iter().map(|c| c.name.as_str()).collect();
        fail(&format!(
            "{}Usage: lotek takeover <component> [--out=<folder>] [--overwrite=yes]\nFull overview: lotek --help\n\nComponents:\n  {}\n",
            name.map_or(String::new(), |n| format!("No component is called \"{n}\".\n\n")),
            all.join(", ")
        ));
    };

    let base = parsed.flag("out").unwrap_or("src/lotek");
    let target = std::path::Path::new(base).join(&component.name);
    let shown = shown(&target.display().to_string());
    if target.exists() && parsed.flag("overwrite") != Some("yes") {
        fail(&format!(
            "{shown} already exists.\n\nIf you have changed the copy, the changes will be lost. Run with --overwrite=yes if it should be replaced.\n"
        ));
    }

    let package = parse(&crate::package::read("package.json")).unwrap_or_else(|e| {
        fail(&format!(
            "package.json in the package cannot be read: {e}\n"
        ))
    });
    let package_name = package
        .get("name")
        .and_then(Json::as_str)
        .unwrap_or("@lo-tek/interfaces");
    let entries = entry_points(package_name, package.get("exports").unwrap_or(&Json::Null));
    let manifest = parse(&crate::package::manifest()).unwrap_or_else(|e| {
        fail(&format!(
            "The manifest in the package cannot be read: {e}\n"
        ))
    });

    let folder = format!("src/components/{}/{}", component.category, component.name);
    let files: Vec<SourceFile> = component
        .files()
        .into_iter()
        .map(|(file, content)| SourceFile {
            path: format!("{folder}/{file}"),
            content,
        })
        .collect();
    let plan = plan_takeover(&files, &entries);
    let names = own_names(&manifest, &component.name);

    if let Err(e) = std::fs::create_dir_all(&target) {
        fail(&format!("Could not create {shown}: {e}"));
    }
    let write = |file: &str, content: &str| {
        let path = target.join(file);
        if let Err(e) = std::fs::write(&path, content) {
            fail(&format!(
                "Could not write {}: {e}",
                crate::output::shown(&path.display().to_string())
            ));
        }
    };
    for file in &plan.files {
        write(&file.name, &rename(&file.content, &names));
    }
    write(
        FRAGMENT,
        &format!(
            "{}\n",
            fragment(&manifest, &component.name, &names).to_pretty()
        ),
    );

    let new_names: Vec<String> = names.iter().map(|n| renamed(n)).collect();
    let mut lines = vec![format!("Copied {} to {shown}/", component.name)];
    lines.extend(plan.files.iter().map(|f| format!("  {}", f.name)));
    lines.push(format!("  {FRAGMENT}"));
    lines.push(String::new());
    lines.push(format!(
        "The component is now yours. Updates of {package_name} do not touch it."
    ));
    lines.push(String::new());
    lines.push(format!(
        "The copy is called {}, and can sit next to the original.",
        new_names.join(" and ")
    ));
    lines.push("Switch to the new name in the markup where the copy is used. The".into());
    lines.push("variables from the theme (--lt-*) are the same.".into());

    let rewrites: Vec<&Rewrite> = plan.files.iter().flat_map(|f| &f.rewrites).collect();
    if !rewrites.is_empty() {
        lines.push(String::new());
        lines.push("References out of the folder now point to the package:".into());
        lines.extend(rewrites.iter().map(|r| format!("  {} → {}", r.from, r.to)));
    }

    if !plan.replaced_entries.is_empty() {
        lines.push(String::new());
        lines.push(
            "These imports load the original, and can be removed when nothing uses it:".into(),
        );
        lines.extend(plan.replaced_entries.iter().map(|e| format!("  {e}")));
    }

    if !plan.dependencies.is_empty() {
        lines.push(String::new());
        lines.push(format!(
            "The copy needs {} in your project.",
            plan.dependencies.join(", ")
        ));
    }

    lines.push(String::new());
    lines.push("Check the markup for the copy with:".into());
    lines.push(format!(
        "  lotek check --manifest={} <files…>",
        crate::output::shown(&target.join(FRAGMENT).display().to_string())
    ));

    error(&format!("{}\n", lines.join("\n")));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exports() -> Json {
        parse(
            r#"{
                ".": {"import": "./dist/index.js"},
                "./shared": {"import": "./dist/components/css/shared.js"},
                "./input": {"import": "./dist/components/css/input/input.js"},
                "./suggestion": {"import": "./dist/components/frame/suggestion/lt-suggestion.js"},
                "./field-core": {"import": "./dist/components/frame/field/field-core.js"},
                "./button.css": "./src/components/css/button/button.css",
                "./input.css": "./src/components/css/input/input.css"
            }"#,
        )
        .unwrap()
    }

    fn entries() -> Vec<(String, String)> {
        entry_points("@lo-tek/interfaces", &exports())
    }

    fn file(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.into(),
            content: content.into(),
        }
    }

    fn own(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn leads_an_entry_point_back_to_its_source() {
        let e = entries();
        assert_eq!(
            lookup(&e, "src/components/css/shared.ts"),
            Some("@lo-tek/interfaces/shared")
        );
        assert_eq!(
            lookup(&e, "src/components/css/button/button.css"),
            Some("@lo-tek/interfaces/button.css")
        );
    }

    #[test]
    fn joins_a_relative_path_with_its_folder() {
        assert_eq!(
            resolve_path("src/components/css/button", "../shared.js"),
            "src/components/css/shared.js"
        );
        assert_eq!(
            resolve_path(
                "src/components/frame/suggestion",
                "../../css/input/input.css"
            ),
            "src/components/css/input/input.css"
        );
    }

    #[test]
    fn rewrites_references_out_of_the_folder() {
        let path = "src/components/css/button/button.ts";
        let planned = rewrite_references(
            &file(path, "import { attributes } from \"../shared.js\"\n"),
            &entries(),
            &own(&[path]),
        );
        assert!(planned
            .content
            .contains("from \"@lo-tek/interfaces/shared\""));
        assert_eq!(
            planned.rewrites,
            [Rewrite {
                from: "../shared.js".into(),
                to: "@lo-tek/interfaces/shared".into()
            }]
        );
    }

    #[test]
    fn leaves_a_neighbour_in_the_same_folder() {
        // The import points to ".js", the source is called ".ts". Without that
        // comparison the neighbour was rewritten to the package.
        let planned = rewrite_references(
            &file(
                "src/components/frame/field/lt-field.ts",
                "import { computeFieldAttributes } from \"./field-core.js\"\n",
            ),
            &entries(),
            &own(&[
                "src/components/frame/field/lt-field.ts",
                "src/components/frame/field/field-core.ts",
            ]),
        );
        assert!(planned.content.contains("from \"./field-core.js\""));
        assert!(planned.rewrites.is_empty());
    }

    #[test]
    fn rewrites_out_of_the_folder_even_when_the_file_name_is_there() {
        let planned = rewrite_references(
            &file(
                "src/components/css/accordion/accordion.ts",
                "import { attributes } from \"../shared.js\"\n",
            ),
            &entries(),
            &own(&[
                "src/components/css/accordion/accordion.ts",
                "src/components/css/accordion/shared.ts",
            ]),
        );
        assert!(planned
            .content
            .contains("from \"@lo-tek/interfaces/shared\""));
    }

    #[test]
    fn rewrites_imports_in_style_sheets() {
        let path = "src/components/css/search/search.css";
        let planned = rewrite_references(
            &file(path, "@import \"../input/input.css\";\n\n@layer lotek {}\n"),
            &entries(),
            &own(&[path]),
        );
        assert!(planned
            .content
            .contains("@import \"@lo-tek/interfaces/input.css\";"));
    }

    #[test]
    fn names_dependencies_and_what_it_replaces() {
        // LO-TEK has no dependencies, so this is a made-up component.
        let plan = plan_takeover(
            &[file(
                "src/components/frame/suggestion/lt-suggestion.ts",
                "import { thing } from \"a-library\"\nimport { attributes } from \"../../css/shared.js\"\n",
            )],
            &entries(),
        );
        assert_eq!(plan.dependencies, ["a-library"]);
        assert_eq!(plan.kept_imports, ["@lo-tek/interfaces/shared"]);
        assert_eq!(plan.replaced_entries, ["@lo-tek/interfaces/suggestion"]);
    }

    #[test]
    fn every_component_is_read_and_owns_a_name() {
        // The names are the core's, which holds what they are
        // (`core/tests/takeover.rs`). Here it is the files: every component
        // has some, and they say the names the core gives it.
        use lotek_core::takeover::{own_names, rename, renamed};
        let manifest = parse(&crate::package::manifest()).unwrap();
        let components = components();
        assert!(components.len() > 40);
        for component in &components {
            let files = component.files();
            assert!(!files.is_empty(), "{} has no files", component.name);
            assert!(files.iter().all(|(f, _)| !f.contains(".test.")));
            let names = own_names(&manifest, &component.name);
            let copy: String = files.iter().map(|(_, c)| rename(c, &names)).collect();
            let original: String = files.iter().map(|(_, c)| c.as_str()).collect();
            assert!(
                names.iter().any(|n| original.contains(n.as_str())),
                "{} does not mention {names:?}",
                component.name
            );
            for name in &names {
                assert!(
                    copy.contains(&renamed(name)),
                    "{} did not get a new name",
                    component.name
                );
            }
        }
    }
}
