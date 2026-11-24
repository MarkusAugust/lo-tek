//! Which manifest applies to a document: the one search `lotek lsp` and
//! `lotek check` share, so the editor and the command line answer alike.
//!
//! The cases are in `cli/manifest-lookup.json`, which the language server,
//! `lotek check` and the IntelliJ plugin each build and must agree on.

/// Where a manifest is looked for in a folder. The one the project built
/// goes before the package, since it has the project's own fragments in it.
pub const CANDIDATES: [&str; 2] = [
    "build/lotek/manifest.json",
    "node_modules/@lo-tek/interfaces/manifest/manifest.json",
];

/// The paths a manifest for `document` can have, in the order they are
/// tried: in the document's folder and every folder above it up to and
/// including the root the document is in, and then at every root.
///
/// The search goes upwards from the document, as Node finds a package.
/// Before, only the root was looked at, so a page in `apps/web/` in a
/// monorepo was checked against another manifest, even though
/// `apps/web/node_modules` had the package.
pub fn candidates(document: Option<&str>, roots: &[String]) -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(file) = document {
        // Not above the root the file is in: a package in the home folder is
        // not the project's, and the editor does not watch files there. The
        // path is written with `/` as for the root below, so the same file
        // has the same path on Windows too.
        let file = file.replace('\\', "/");
        let root = roots
            .iter()
            .map(|r| r.replace('\\', "/").trim_end_matches('/').to_string())
            .filter(|r| file.starts_with(&format!("{r}/")))
            .max_by_key(String::len);
        // If the file is under no root, like a scratch file outside the
        // workspace, or when there is no root at all, there is nothing to
        // stop at. Then nothing is searched from the file, as in the
        // IntelliJ plugin; every root is still tried, below. Before, the
        // search went all the way to the root of the file system, and took
        // the package in the home folder.
        let mut dir = root
            .as_ref()
            .and_then(|_| std::path::Path::new(&file).parent());
        while let Some(here) = dir {
            let here_text = here.to_string_lossy().replace('\\', "/");
            for candidate in CANDIDATES {
                candidates.push(format!("{}/{candidate}", here_text.trim_end_matches('/')));
            }
            if root.as_deref() == Some(here_text.trim_end_matches('/')) {
                break;
            }
            dir = here.parent();
        }
    }
    for root in roots {
        for candidate in CANDIDATES {
            candidates.push(format!("{}/{candidate}", root.trim_end_matches('/')));
        }
    }
    candidates
}

/// The first of the candidates that is a file, with when it was last
/// changed. A folder with the name is not a manifest, and the next candidate
/// is tried, as in the IntelliJ plugin.
pub fn first_file(
    candidates: impl IntoIterator<Item = String>,
) -> Option<(String, Option<std::time::SystemTime>)> {
    candidates.into_iter().find_map(|path| {
        let metadata = std::fs::metadata(&path).ok().filter(|m| m.is_file())?;
        Some((path, metadata.modified().ok()))
    })
}
