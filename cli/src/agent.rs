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

/// Frameworks that share a rulebook: Vue, Svelte, Solid and Lit do the same
/// with the style sheets, the attribute names and the registration.
const ALIASES: [(&str, &str); 6] = [
    ("vue", "bundles"),
    ("svelte", "bundles"),
    ("solid", "bundles"),
    ("solid-js", "bundles"),
    ("lit", "bundles"),
    ("vite", "bundles"),
];

/// The dependency that decides the environment, in the order it is read.
/// Astro comes first, since an Astro app with React islands has both, and
/// `vite` last.
const DEPENDENCY_HINTS: [(&str, &str); 8] = [
    ("astro", "astro"),
    ("react", "react"),
    ("vue", "bundles"),
    ("svelte", "bundles"),
    ("solid-js", "bundles"),
    ("lit", "bundles"),
    ("@starfederation/datastar-sdk", "datastar"),
    ("vite", "bundles"),
];

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
/// Java, where the builder functions are `Lt`, and the rulebook says how.
const JVM_BUILD_FILES: [&str; 3] = ["build.gradle.kts", "build.gradle", "pom.xml"];

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
fn detect_framework() -> (String, String) {
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
    for (dependency, framework) in DEPENDENCY_HINTS {
        // `vite` builds the assets, and says nothing about who writes the
        // markup when there is a JVM build file next to it.
        if dependency == "vite" && jvm.is_some() {
            continue;
        }
        if dependencies.iter().any(|d| d == dependency) {
            return (framework.into(), format!("{dependency} is in package.json"));
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

    let (chosen, reason) = match arguments.flag("framework") {
        Some(requested) => (requested.to_string(), "given with --framework".to_string()),
        None => detect_framework(),
    };
    let books = rulebooks();
    let name = if books.contains(&chosen) {
        Some(chosen.as_str())
    } else {
        ALIASES.iter().find(|(a, _)| *a == chosen).map(|(_, n)| *n)
    };
    let Some(name) = name.and_then(|n| books.iter().find(|r| *r == n)) else {
        let names: Vec<&str> = books.iter().map(String::as_str).collect();
        fail(&format!(
            "Unknown framework \"{chosen}\".\n\nChoose from: {}\n\nVue, Svelte, Solid and Lit share \"bundles\", since they do the same with\nthe style sheets, the attribute names and the registration.\n",
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
