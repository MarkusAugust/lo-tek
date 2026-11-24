//! `lotek check <file|address…>`: the same check the editor runs while you
//! type, over finished files.
//!
//! Without files, standard input is read, so a test can send the HTML the
//! server actually sends. An address is fetched and checked as a whole page:
//! then every id referred to must also exist, and every field must be wired.
//! `--rendered` does the same for files and standard input. A template is not
//! checked that way without the flag, since an id in a template can be in
//! another file.

use std::io::{IsTerminal, Read};

use crate::fetch;
use crate::output::{count, error, fail, log, shown};
use lotek_core::styles::{read_styles, Styles};
use lotek_core::text::utf16;
use lotek_core::types::Severity;
use lotek_core::{diagnose_markup, diagnose_page, diagnose_styled, manifest, Lines};

/// The text without a leading BOM (U+FEFF), as the browser and the editor
/// read it. With it, line 1 would get one column more than the editor shows,
/// and the Node host, where `response.text()` removes it, would answer
/// differently from the executable and the JVM.
pub fn without_bom(text: String) -> String {
    match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_string(),
        None => text,
    }
}

/// All of standard input. If the pipe is in non-blocking mode, it waits and
/// reads again until the writer is done, instead of giving up with whatever
/// happened to have arrived.
fn read_all_input() -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut stdin = std::io::stdin().lock();
    loop {
        match stdin.read(&mut buffer) {
            Ok(0) => return bytes,
            Ok(n) => bytes.extend_from_slice(&buffer[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            Err(_) => return bytes,
        }
    }
}

/// The texts of the fragments from `lotek takeover`. A fragment that is not
/// there stops the run, before anything is checked.
fn fragment_texts(manifests: &[&str]) -> Vec<String> {
    manifests
        .iter()
        .map(|path| match std::fs::read(path) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(_) => fail(&format!(
                "Manifest not found: \"{}\".\n\nThe fragment is written by lotek takeover, next to the copy.\n",
                shown(path)
            )),
        })
        .collect()
}

/// Checks each fragment against `base` on its own, so an error says which
/// file it is in.
fn check_fragments(base: &str, manifests: &[&str], texts: &[String]) {
    for (path, text) in manifests.iter().zip(texts) {
        if let Err(reason) = manifest::with_fragments(base, &[text]) {
            fail(&format!(
                "\"{}\" cannot be read as a manifest: {reason}\n",
                shown(path)
            ));
        }
    }
}

/// The fragments in the files, each checked against `base` on its own.
pub fn read_fragments(base: &str, manifests: &[&str]) -> Vec<String> {
    let texts = fragment_texts(manifests);
    check_fragments(base, manifests, &texts);
    texts
}

/// The vocabulary each file is checked against: the manifest that applies
/// to it, with the fragments added.
///
/// The manifest is found as the editor finds it, with `lookup::candidates`:
/// from the folder of the file upwards to the working directory, the one the
/// project built before the package. When there is none, it is the package
/// the command line reads everything else from, which may be above the
/// working directory: `npx` from a folder in a monorepo finds the package at
/// its root. Each manifest is read once, however many files it applies to.
struct Vocabularies<'a> {
    manifests: &'a [&'a str],
    fragments: Vec<String>,
    /// The working directory, which the search stops at.
    root: Vec<String>,
    /// By the path of the manifest, or `None` for the one in the package.
    read: Vec<(Option<String>, std::rc::Rc<lotek_core::types::Vocabulary>)>,
}

impl<'a> Vocabularies<'a> {
    fn new(manifests: &'a [&'a str]) -> Self {
        let root = std::env::current_dir()
            .ok()
            .map(|here| here.to_string_lossy().replace('\\', "/"));
        Vocabularies {
            manifests,
            fragments: fragment_texts(manifests),
            root: root.into_iter().collect(),
            read: Vec::new(),
        }
    }

    /// The vocabulary for a file on disk, or for standard input and a page
    /// that was fetched, which have no folder.
    fn of(&mut self, file: Option<&str>) -> std::rc::Rc<lotek_core::types::Vocabulary> {
        let document = file.zip(self.root.first()).map(|(file, root)| {
            normalized(&std::path::Path::new(root).join(file))
                .to_string_lossy()
                .into_owned()
        });
        let found =
            crate::lookup::first_file(crate::lookup::candidates(document.as_deref(), &self.root))
                .map(|(path, _)| path);
        if let Some((_, known)) = self.read.iter().find(|(path, _)| *path == found) {
            return known.clone();
        }
        // The path from the working directory, as the user would write it.
        let named = found.as_ref().map(|path| {
            let relative = self
                .root
                .first()
                .and_then(|root| path.strip_prefix(&format!("{}/", root.trim_end_matches('/'))));
            shown(relative.unwrap_or(path))
        });
        let base = match (&found, &named) {
            (Some(path), Some(named)) => match std::fs::read(path) {
                Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                Err(_) => fail(&format!("Manifest not found: \"{named}\".\n")),
            },
            _ => crate::package::manifest(),
        };
        // The manifest on its own first, so one that cannot be read is blamed
        // and not the fragment that was to go onto it.
        if let Err(reason) = manifest::with_fragments(&base, &[]) {
            fail(&match &named {
                Some(named) => format!("\"{named}\" cannot be read as a manifest: {reason}\n"),
                None => format!(
                    "manifest/manifest.json in the package cannot be read as a manifest: {reason}\n"
                ),
            });
        }
        check_fragments(&base, self.manifests, &self.fragments);
        let all: Vec<&str> = self.fragments.iter().map(String::as_str).collect();
        let vocabulary = match manifest::with_fragments(&base, &all) {
            Ok(vocabulary) => std::rc::Rc::new(vocabulary),
            Err(reason) => fail(&format!(
                "The manifests cannot be read together: {reason}\n"
            )),
        };
        // A manifest the project has, built or installed nearer the file, is
        // named: when it is stale, nothing else says why a class is unknown.
        // Not when it is the manifest of the package the command reads from,
        // which is what an ordinary project has in `node_modules`. The texts
        // are compared, not the paths: pnpm installs the package through a
        // link, and as a WASI module the command cannot resolve one.
        if let Some(named) = &named {
            let own = crate::package::dir()
                .and_then(|package| std::fs::read(package.join("manifest/manifest.json")).ok());
            if own.as_deref() != Some(base.as_bytes()) {
                error(&format!("Checked against {named}."));
            }
        }
        self.read.push((found, vocabulary.clone()));
        vocabulary
    }
}

/// The path without `.` and `..`, so two paths to the same file are equal.
/// Without this, `a/../b/y.css` and `a/../b/../b/y.css` were two files, and
/// two style sheets importing each other through `../` gave an endless loop.
fn normalized(path: &std::path::Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut out = std::path::PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                } else {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The file a package path like `@lo-tek/interfaces/lotek.css` points to.
///
/// Looks for `node_modules/<package>` upwards from the style sheet's folder,
/// and looks up the subpath in `exports` in the package's `package.json`: an
/// exact key, otherwise a pattern like `./*`, and the value as a string or as
/// a conditions object (`style`, `default`). A package imported by name alone
/// uses `.` and then `style`. Without a match, the direct path is used.
///
/// A path that starts with `.` or `/` is a file, not a package, and gives
/// `None`.
fn package_file(folder: &std::path::Path, spec: &str) -> Option<std::path::PathBuf> {
    use lotek_core::json::{parse, Json};
    let spec = spec.strip_prefix('~').unwrap_or(spec);
    if spec.starts_with('.') || spec.starts_with('/') || spec.starts_with('\\') {
        return None;
    }
    let mut parts = spec.splitn(if spec.starts_with('@') { 3 } else { 2 }, '/');
    let name = if spec.starts_with('@') {
        format!("{}/{}", parts.next()?, parts.next()?)
    } else {
        parts.next()?.to_string()
    };
    let sub = parts.next().unwrap_or("");
    let start = if folder.is_absolute() {
        folder.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(folder)
    };
    fn pick(entry: &Json) -> Option<String> {
        match entry {
            Json::String(s) => Some(s.clone()),
            Json::Object(_) => ["style", "default", "import"]
                .iter()
                .find_map(|c| entry.get(c).and_then(pick)),
            _ => None,
        }
    }
    let lookup = |pkg: &Json| -> Option<String> {
        let key = if sub.is_empty() {
            ".".to_string()
        } else {
            format!("./{sub}")
        };
        let exports = pkg.get("exports");
        if let Some(found) = exports.and_then(|e| e.get(&key)).and_then(pick) {
            return Some(found);
        }
        // A pattern, like `"./*": "./dist/*"`.
        if let Some(Json::Object(entries)) = exports {
            for (pattern, value) in entries {
                let Some((before, after)) = pattern.split_once('*') else {
                    continue;
                };
                let Some(middle) = key
                    .strip_prefix(before)
                    .and_then(|rest| rest.strip_suffix(after))
                else {
                    continue;
                };
                if let Some(target) = pick(value) {
                    return Some(target.replace('*', middle));
                }
            }
        }
        if sub.is_empty() {
            return pkg.get("style").and_then(pick);
        }
        None
    };
    let mut dir = Some(normalized(&start));
    while let Some(here) = dir {
        let root = here.join("node_modules").join(&name);
        if let Ok(text) = std::fs::read_to_string(root.join("package.json")) {
            let target = parse(&text).ok().and_then(|pkg| lookup(&pkg));
            return Some(normalized(&root.join(target.as_deref().unwrap_or(sub))));
        }
        dir = here.parent().map(std::path::Path::to_path_buf);
    }
    None
}

/// The style sheets, with what they import.
///
/// `@import` is followed to a file next to it, and to a package in
/// `node_modules`, like `@lo-tek/interfaces/lotek.css`. An address on the
/// web is not fetched.
fn read_style_sheets(paths: &[&str]) -> Styles {
    let mut styles = Styles::default();
    let mut seen: Vec<std::path::PathBuf> = Vec::new();
    let mut queue: Vec<(std::path::PathBuf, bool)> = paths
        .iter()
        .map(|p| (normalized(std::path::Path::new(p)), true))
        .collect();
    while let Some((path, given)) = queue.pop() {
        if seen.contains(&path) {
            continue;
        }
        seen.push(path.clone());
        let Ok(bytes) = std::fs::read(&path) else {
            if given {
                fail(&format!(
                    "Style sheet not found: \"{}\".",
                    shown(&path.display().to_string())
                ));
            }
            continue;
        };
        let read = read_styles(&String::from_utf8_lossy(&bytes));
        let folder = path
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_default();
        for import in &read.imports {
            if import.contains("://") || import.starts_with("data:") {
                continue;
            }
            let beside = normalized(&folder.join(import));
            queue.push((
                if beside.exists() {
                    beside
                } else {
                    package_file(&folder, import).unwrap_or_else(|| {
                        if import.starts_with('.') || import.starts_with('/') {
                            beside
                        } else {
                            normalized(&std::path::Path::new("node_modules").join(import))
                        }
                    })
                },
                false,
            ));
        }
        styles.extend(read);
    }
    styles
}

struct Source {
    name: String,
    text: String,
    page: bool,
    /// The path, for a file on disk. It decides which manifest applies.
    file: Option<String>,
}

pub fn run(arguments: &[String]) {
    let rendered = arguments.iter().any(|a| a == "--rendered");
    let mut sources: Vec<Source> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    let mut unreachable: Vec<String> = Vec::new();

    // The fragments from `lotek takeover`, so the markup for a copy is checked
    // too.
    let manifests: Vec<&str> = arguments
        .iter()
        .filter_map(|a| a.strip_prefix("--manifest="))
        .collect();
    let inputs: Vec<&String> = arguments
        .iter()
        .filter(|a| *a != "--rendered" && !a.starts_with("--manifest=") && !a.starts_with("--css="))
        .collect();
    let mut vocabularies = Vocabularies::new(&manifests);
    // The style sheets, so the check also sees what is not styled.
    let style_sheets: Vec<&str> = arguments
        .iter()
        .filter_map(|a| a.strip_prefix("--css="))
        .collect();
    let styles = (!style_sheets.is_empty()).then(|| read_style_sheets(&style_sheets));

    if inputs.is_empty() {
        // WASI cannot see whether standard input is a terminal, so the host
        // says so. Chicory reports a pipe as a terminal, so as a WASI module
        // the command line trusts only the host.
        let terminal = if cfg!(target_os = "wasi") {
            std::env::var("LOTEK_TERMINAL").is_ok_and(|v| v == "1")
        } else {
            std::io::stdin().is_terminal()
        };
        if terminal {
            error("Reading markup from standard input. End with Ctrl-D.");
        }
        let bytes = read_all_input();
        let text = without_bom(String::from_utf8_lossy(&bytes).into_owned());
        // Empty input is not markup that matches. A glob that matched nothing
        // would otherwise pass without having looked at anything.
        if text.trim().is_empty() {
            fail("No markup to check: standard input was empty.");
        }
        sources.push(Source {
            name: "stdin".into(),
            text,
            page: rendered,
            file: None,
        });
    }

    for input in inputs {
        // A page the host has already fetched, in place of the address. See
        // `fetch::from_host`.
        let answer = if let Some(file) = input.strip_prefix("--fetched=") {
            Some(fetch::from_host(file))
        } else if fetch::is_address(input) {
            Some(fetch::page(input))
        } else {
            None
        };
        match answer {
            Some(Ok((address, text))) => sources.push(Source {
                name: address,
                text,
                page: true,
                file: None,
            }),
            Some(Err(reason)) => unreachable.push(reason),
            None => match std::fs::read(input) {
                Ok(bytes) => sources.push(Source {
                    name: input.clone(),
                    text: without_bom(String::from_utf8_lossy(&bytes).into_owned()),
                    page: rendered,
                    file: Some(input.clone()),
                }),
                Err(_) => missing.push(input.clone()),
            },
        }
    }

    if !missing.is_empty() || !unreachable.is_empty() {
        for path in &missing {
            error(&format!("File not found: \"{}\".", shown(path)));
        }
        for reason in &unreachable {
            error(reason);
        }
        std::process::exit(1);
    }

    // As for standard input: if every file is empty, there is nothing to
    // check. One empty file among several, like an empty partial in a glob,
    // is not an error.
    if !sources.is_empty() && sources.iter().all(|s| s.text.trim().is_empty()) {
        fail(&if sources.len() == 1 {
            format!(
                "No markup to check: \"{}\" is empty.",
                shown(&sources[0].name)
            )
        } else {
            format!("No markup to check: all {} files are empty.", sources.len())
        });
    }

    let mut found = 0;
    for source in &sources {
        let text = utf16(&source.text);
        let vocabulary = vocabularies.of(source.file.as_deref());
        let findings = match &styles {
            Some(styles) => diagnose_styled(&text, &vocabulary, styles, source.page),
            None if source.page => diagnose_page(&text, &vocabulary),
            None => diagnose_markup(&text, &vocabulary),
        };
        let lines = Lines::new(&text);
        for finding in findings {
            found += 1;
            let (line, column) = lines.line_and_column(finding.start);
            let kind = match finding.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            };
            log(&format!(
                "{}:{line}:{column}: {kind}: {}",
                shown(&source.name),
                finding.message
            ));
        }
    }

    let files = count(sources.len(), "file", "files");
    if found > 0 {
        fail(&format!(
            "\n{} in {files}.",
            count(found, "finding", "findings")
        ));
    }
    log(&format!("The markup matches LO-TEK in {files}."));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_paths() {
        assert_eq!(
            normalized(std::path::Path::new("a/../b/./y.css")),
            std::path::PathBuf::from("b/y.css")
        );
        assert_eq!(
            normalized(std::path::Path::new("../a/x.css")),
            std::path::PathBuf::from("../a/x.css")
        );
        assert_eq!(
            normalized(std::path::Path::new("/r/a/../b")),
            std::path::PathBuf::from("/r/b")
        );
    }

    #[test]
    fn style_sheets_that_import_each_other_are_read_once() {
        let root = std::env::temp_dir().join(format!("lotek-import-{}", std::process::id()));
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::fs::create_dir_all(root.join("b")).unwrap();
        std::fs::write(root.join("a/x.css"), "@import \"../b/y.css\";\n.lt-a { }").unwrap();
        std::fs::write(root.join("b/y.css"), "@import \"../a/x.css\";\n.lt-b { }").unwrap();
        let start = root.join("a/x.css");
        let styles = read_style_sheets(&[start.to_str().unwrap()]);
        assert!(styles.classes.contains("lt-a") && styles.classes.contains("lt-b"));
        assert_eq!(styles.imports.len(), 2, "each style sheet is read once");
        std::fs::remove_dir_all(root).unwrap();
    }
}
