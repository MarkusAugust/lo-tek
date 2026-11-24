//! `lotek agent`: the rulebook for this project, to standard output.
//!
//! To standard output, not to a file. `AGENTS.md`, `CLAUDE.md` and
//! `.github/copilot-instructions.md` are the consumer's own files. Anyone who
//! wants the rulebook on disk is one pipe away, and then it is their decision.
//!
//! The rulebooks are read from the package (see `package.rs`), so they follow
//! the version the project has installed. The choice of environment is
//! written to standard error, so standard output can be piped cleanly.

use crate::output::{error, fail, write};
use crate::{refuse_unknown_flags, refuse_without_value, Arguments};
use lotek_core::json::{parse, Json};

/// The names of the rulebooks in the package, sorted. Only the chosen one's
/// text is read.
fn rulebooks() -> Vec<String> {
    let books: Vec<String> = crate::package::files()
        .get("agent")
        .and_then(Json::as_array)
        .unwrap_or_default()
        .iter()
        .filter_map(|name| name.as_str().map(str::to_string))
        .collect();
    if books.is_empty() {
        fail("Found no rulebooks in agent/ in the package.\n");
    }
    books
}

/// Which rulebook a project gets, as the manifest of the package says it.
///
/// The command line has no list of its own: a rulebook that is added or
/// renamed is pointed to from the manifest it comes with. A manifest of
/// schema version 1 has no `rulebooks`, and then no dependency and no other
/// name points anywhere.
struct Choice {
    /// The dependency that decides the environment, in the order it is read.
    dependencies: Vec<(String, String)>,
    /// Other names `--framework` takes, each with the rulebook it gives.
    aliases: Vec<(String, String)>,
}

fn choice() -> Choice {
    let manifest = parse(&crate::package::manifest()).unwrap_or(Json::Null);
    let rulebooks = manifest.get("rulebooks");
    let text = |row: &Json, key: &str| row.get(key).and_then(Json::as_str).map(str::to_string);
    let dependencies = rulebooks
        .and_then(|r| r.get("dependencies"))
        .and_then(Json::as_array)
        .unwrap_or_default()
        .iter()
        .filter_map(|row| Some((text(row, "dependency")?, text(row, "rulebook")?)))
        .collect();
    let aliases = match rulebooks.and_then(|r| r.get("aliases")) {
        Some(Json::Object(entries)) => entries
            .iter()
            .filter_map(|(name, book)| Some((name.clone(), book.as_str()?.to_string())))
            .collect(),
        _ => Vec::new(),
    };
    Choice {
        dependencies,
        aliases,
    }
}

/// The names in an object, as `{ ...value }` sees them.
fn keys(value: Option<&Json>) -> Vec<String> {
    match value {
        Some(Json::Object(entries)) => entries.iter().map(|(k, _)| k.clone()).collect(),
        Some(Json::Array(items)) => (0..items.len()).map(|i| i.to_string()).collect(),
        Some(Json::String(s)) => (0..s.encode_utf16().count())
            .map(|i| i.to_string())
            .collect(),
        _ => Vec::new(),
    }
}

/// The build files of a project on the JVM. Its markup comes from Kotlin or
/// Java, where the builder functions are `Lt`, and the rulebook says how. A
/// Gradle build with several modules may have only the settings file at its
/// root, where the agent's instruction file is.
const JVM_BUILD_FILES: [&str; 5] = [
    "build.gradle.kts",
    "build.gradle",
    "settings.gradle.kts",
    "settings.gradle",
    "pom.xml",
];

/// The first JVM build file in the working directory, if there is one.
fn jvm_build_file() -> Option<&'static str> {
    JVM_BUILD_FILES
        .into_iter()
        .find(|name| std::path::Path::new(name).is_file())
}

/// The environment the project in the working directory uses, and why we
/// think so.
///
/// A framework in package.json decides first, since it renders the markup.
/// Then a JVM build file: a Kotlin server often has a package.json for its
/// assets, with `vite` or nothing known in it, and its markup still comes
/// from Kotlin.
fn detect_framework(choice: &Choice) -> (String, String) {
    let jvm = jvm_build_file();
    let without_package = |reason: &str| match jvm {
        Some(file) => ("kotlin".into(), format!("{file} is in this folder")),
        None => ("templates".into(), reason.into()),
    };
    let Ok(text) = std::fs::read_to_string("package.json") else {
        // Go, PHP and Razor have no package.json. Then the markup comes from
        // the server, and the templates rulebook is the one that explains
        // how the check reads template syntax.
        return without_package("no package.json in this folder");
    };
    let manifest = match parse(&text) {
        Ok(Json::Null | Json::Bool(_) | Json::Number(_) | Json::String(_)) => {
            return without_package("package.json is not an object")
        }
        Ok(value) => value,
        Err(_) => return without_package("package.json could not be read"),
    };
    let mut dependencies = keys(manifest.get("dependencies"));
    dependencies.extend(keys(manifest.get("devDependencies")));
    for (dependency, framework) in &choice.dependencies {
        // `vite` builds the assets, and says nothing about who writes the
        // markup when there is a JVM build file next to it.
        if dependency == "vite" && jvm.is_some() {
            continue;
        }
        if dependencies.iter().any(|d| d == dependency) {
            return (
                framework.clone(),
                format!("{dependency} is in package.json"),
            );
        }
    }
    if let Some(file) = jvm {
        return (
            "kotlin".into(),
            format!("{file} is in this folder, and package.json names no framework"),
        );
    }
    // There is a package.json, so there is a build step. Then the style
    // sheets are imported, and the `<link>` rulebook would send the agent the
    // wrong way.
    (
        "bundles".into(),
        "package.json names no known framework".into(),
    )
}

pub fn run(arguments: &[String]) {
    let arguments = Arguments::read(arguments);
    refuse_without_value(&arguments);
    refuse_unknown_flags(&arguments, &["framework"]);

    let choice = choice();
    let (chosen, reason) = match arguments.flag("framework") {
        Some(requested) => (requested.to_string(), "given with --framework".to_string()),
        None => detect_framework(&choice),
    };
    let books = rulebooks();
    let name = if books.contains(&chosen) {
        Some(chosen.as_str())
    } else {
        choice
            .aliases
            .iter()
            .find(|(alias, _)| *alias == chosen)
            .map(|(_, book)| book.as_str())
    };
    let Some(name) = name.and_then(|n| books.iter().find(|r| *r == n)) else {
        let names: Vec<&str> = books.iter().map(String::as_str).collect();
        // The other names, by the rulebook each gives, in the manifest's order.
        let mut shared: Vec<(&str, Vec<&str>)> = Vec::new();
        for (alias, book) in &choice.aliases {
            match shared.iter_mut().find(|(b, _)| *b == book.as_str()) {
                Some((_, aliases)) => aliases.push(alias),
                None => shared.push((book, vec![alias])),
            }
        }
        let also: String = shared
            .iter()
            .map(|(book, aliases)| format!("\nOr {} for \"{book}\".\n", aliases.join(", ")))
            .collect();
        fail(&format!(
            "Unknown framework \"{chosen}\".\n\nChoose from: {}\n{also}",
            names.join(", ")
        ));
    };
    // The alias must be visible: whoever asked for "svelte" should see that
    // the answer is the bundles rulebook.
    let via = if *name == chosen {
        String::new()
    } else {
        format!(" via {chosen}")
    };
    error(&format!("The rulebook for {name}{via} ({reason})."));
    write(&crate::package::read(&format!("agent/{name}.md")));
}
