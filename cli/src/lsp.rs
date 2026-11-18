//! `lotek lsp`: the language server, over standard input and output.
//!
//! The same check as `lotek check`, while you type, in every editor that
//! speaks LSP: VS Code, Neovim and Helix. The findings become diagnostics,
//! with the rule name as the code and the component page as the link, and a
//! fix becomes a quick fix. The IntelliJ plugin does not use the server: it
//! runs the core itself, through the Kotlin package. Zed only starts servers
//! a Zed extension has registered, and no such extension exists yet.
//!
//! The vocabulary is the one the project actually has. The server looks in
//! the workspace for
//!
//! 1. `build/lotek/manifest.json`, which the Gradle plugin writes, with the
//!    fragments from `lotek takeover`;
//! 2. `node_modules/@lo-tek/interfaces/manifest/manifest.json`, the
//!    installed version of the package;
//!
//! and then the manifest in the package the host has given with
//! `LOTEK_PACKAGE`, as the VS Code extension does. If none of them exists,
//! nothing is checked, and the server says so once. The file is read again
//! when it changes, so a new build or an upgrade reaches the editor without a
//! restart.
//!
//! The positions are UTF-16, which LSP requires by default and the core
//! counts in. The documents are sent whole on every change: the core spends a
//! couple of milliseconds on a page, and that keeps the server simple.
//!
//! `initializationOptions` can have `manifest`, a path to a manifest that
//! comes before the others, and `rendered`, which checks the documents as
//! whole pages.

use std::io::{Read, Write};
use std::rc::Rc;
use std::time::SystemTime;

use lotek_core::json::{parse, Json};
use lotek_core::text::utf16;
use lotek_core::types::{Finding, Severity, SuggestionKind, Vocabulary};
use lotek_core::{diagnose_markup, diagnose_page, manifest, Lines};

/// Where the manifest is looked for: in the file's folder and every folder
/// above it up to and including the root of the workspace the file is in,
/// and then at the root of every workspace.
const CANDIDATES: [&str; 2] = [
    "build/lotek/manifest.json",
    "node_modules/@lo-tek/interfaces/manifest/manifest.json",
];

/// What makes the editor ask for suggestions as it is typed: a quote or an
/// equals sign opens a value, a space a new class or attribute, a hyphen
/// comes after `lt`, and `<` opens a tag.
const TRIGGERS: [&str; 6] = ["\"", "'", " ", "-", "<", "="];

struct Document {
    uri: String,
    /// The language the editor says the document is in, as `html` or `php`.
    language: String,
    text: Vec<u16>,
    findings: Vec<Finding>,
}

/// The manifest that applies, and where it came from.
struct Source {
    path: Option<String>,
    modified: Option<SystemTime>,
    vocabulary: Option<Rc<Vocabulary>>,
}

pub struct Server {
    documents: Vec<Document>,
    roots: Vec<String>,
    preferred: Option<String>,
    rendered: bool,
    /// The manifests that have been read, one per path. In a monorepo two
    /// documents can belong to different packages, each with its own version
    /// of LO-TEK.
    sources: Vec<Source>,
    shut_down: bool,
    /// Messages to the editor waiting to be sent.
    outgoing: Vec<Json>,
    /// The manifest has been read again, and every open document is to be
    /// checked.
    reloaded: bool,
    /// Whether the server has said that a document has no manifest.
    warned: bool,
    /// The manifest in the package the host has given in `LOTEK_PACKAGE`,
    /// read once. Not `node_modules` above the working directory: a package
    /// above the root of the workspace is not the project's, and the one at
    /// the root is already included.
    package_manifest: Option<String>,
    /// Changes are checked only when no more messages are queued, see
    /// [`Server::flush`]. Off in the tests, where every message is checked at
    /// once.
    deferred: bool,
    /// The documents that have changed and are not checked yet.
    dirty: Vec<String>,
    /// Whether the editor lets the server register file watchers itself.
    can_watch: bool,
}

fn object(entries: Vec<(&str, Json)>) -> Json {
    Json::Object(
        entries
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
    )
}

fn text(s: &str) -> Json {
    Json::String(s.to_string())
}

fn number(n: usize) -> Json {
    Json::Number(n as f64)
}

/// The path in a `file:` address, as the program sees the file system.
///
/// On Windows `file:///c%3A/project` is the drive `C:`. As a WASI module the
/// host has opened it as `/c`, and as an executable it is `C:/project`.
pub fn path_of(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    let decoded = percent_decode(rest);
    let bytes = decoded.as_bytes();
    let drive =
        bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':';
    if !drive {
        return Some(decoded);
    }
    let letter = (bytes[1] as char).to_ascii_lowercase();
    let after = &decoded[3..];
    Some(if cfg!(target_os = "wasi") {
        format!("/{letter}{after}")
    } else {
        format!("{}:{after}", letter.to_ascii_uppercase())
    })
}

/// The path to the manifest in `initializationOptions`, as the program sees
/// the file system. It can be a `file:` address, an absolute path, also on
/// Windows (`C:\\project\\…` or `\\\\server\\…`), or relative to the
/// workspace.
pub fn manifest_path(path: &str, root: Option<&str>) -> String {
    if let Some(from_uri) = path.strip_prefix("file:").and(path_of(path)) {
        return from_uri;
    }
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    if drive {
        // As a WASI module the host has opened the drive as `/c`.
        return if cfg!(target_os = "wasi") {
            format!(
                "/{}/{}",
                (bytes[0] as char).to_ascii_lowercase(),
                path[3..].replace('\\', "/")
            )
        } else {
            path.to_string()
        };
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return path.to_string();
    }
    match root {
        Some(root) => format!("{}/{path}", root.trim_end_matches('/')),
        None => path.to_string(),
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        // `%` and two hexadecimal digits. `from_str_radix` accepts a leading
        // `+`, and `%+f` is not an encoded byte.
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && bytes[i + 1..i + 3].iter().all(u8::is_ascii_hexdigit)
        {
            if let Ok(byte) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The LSP position, line and character from 0, for a UTF-16 offset.
fn position(lines: &Lines, at: usize) -> Json {
    let (line, column) = lines.line_and_column(at);
    object(vec![
        ("line", number(line - 1)),
        ("character", number(column - 1)),
    ])
}

fn range(lines: &Lines, start: usize, end: usize) -> Json {
    object(vec![
        ("start", position(lines, start)),
        ("end", position(lines, end)),
    ])
}

/// Markdown, as LSP wraps it.
fn markdown(value: &str) -> Json {
    object(vec![("kind", text("markdown")), ("value", text(value))])
}

/// The UTF-16 offset of an LSP position, line and character from 0. A line
/// ends with `\n`, `\r\n` or `\r`, as LSP counts them. A position past the
/// end of its line is the end of the line, and one past the last line is the
/// end of the text.
fn offset_of(text: &[u16], line: usize, character: usize) -> usize {
    const LF: u16 = 0x0A;
    const CR: u16 = 0x0D;
    let mut start = 0;
    for _ in 0..line {
        let Some(at) = text[start..].iter().position(|&u| u == LF || u == CR) else {
            return text.len();
        };
        start += at + 1;
        if text[start - 1] == CR && text.get(start) == Some(&LF) {
            start += 1;
        }
    }
    let length = text[start..]
        .iter()
        .position(|&u| u == LF || u == CR)
        .unwrap_or(text.len() - start);
    start + character.min(length)
}

fn diagnostic(lines: &Lines, finding: &Finding) -> Json {
    let mut entries = vec![
        ("range", range(lines, finding.start, finding.end)),
        (
            "severity",
            number(match finding.severity {
                Severity::Error => 1,
                Severity::Warning => 2,
            }),
        ),
        // The rule name is what `<!-- lotek-ignore-next … -->` takes.
        ("code", text(finding.rule)),
        ("source", text("LO-TEK")),
        ("message", text(&finding.message)),
    ];
    if !finding.link.is_empty() {
        entries.push((
            "codeDescription",
            object(vec![("href", text(&finding.link))]),
        ));
    }
    object(entries)
}

impl Default for Server {
    fn default() -> Self {
        Self::new()
    }
}

impl Server {
    pub fn new() -> Self {
        Server {
            documents: Vec::new(),
            roots: Vec::new(),
            preferred: None,
            rendered: false,
            sources: Vec::new(),
            shut_down: false,
            outgoing: Vec::new(),
            reloaded: false,
            warned: false,
            package_manifest: crate::package::given().map(|p| {
                p.join("manifest/manifest.json")
                    .to_string_lossy()
                    .into_owned()
            }),
            deferred: false,
            dirty: Vec::new(),
            can_watch: false,
        }
    }

    fn notify(&mut self, method: &str, params: Json) {
        self.outgoing.push(object(vec![
            ("jsonrpc", text("2.0")),
            ("method", text(method)),
            ("params", params),
        ]));
    }

    fn message(&mut self, kind: usize, message: &str) {
        self.notify(
            "window/showMessage",
            object(vec![("type", number(kind)), ("message", text(message))]),
        );
    }

    /// The manifest that applies to a document: the first one that exists,
    /// read again when the file has changed.
    ///
    /// The search goes from the document's folder upwards, as Node finds a
    /// package, and then at the roots of the workspaces. Before, only the
    /// root was looked at, so a page in `apps/web/` in a monorepo was checked
    /// against another manifest, even though `apps/web/node_modules` had the
    /// package.
    fn vocabulary(&mut self, uri: Option<&str>) -> Option<Rc<Vocabulary>> {
        let mut candidates: Vec<String> = self.preferred.iter().cloned().collect();
        if let Some(file) = uri.and_then(path_of) {
            // Not above the root of the workspace the file is in: a package in
            // the home folder is not the project's, and the editor does not
            // watch files there. The path is written with `/` as for the root
            // below, so the same file has the same key in `sources` on
            // Windows too.
            let file = file.replace('\\', "/");
            let root = self
                .roots
                .iter()
                .map(|r| r.replace('\\', "/").trim_end_matches('/').to_string())
                .filter(|r| file.starts_with(&format!("{r}/")))
                .max_by_key(String::len);
            // If the file is under no root, like a scratch file outside the
            // workspace, or when the editor gave no workspace, there is no
            // root to stop at. Then nothing is searched from the file at all,
            // as in the IntelliJ plugin; the root of every workspace is still
            // tried, below. Before, the search went all the way to the root of
            // the file system, and took the package in the home folder.
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
        for root in &self.roots {
            for candidate in CANDIDATES {
                candidates.push(format!("{}/{candidate}", root.trim_end_matches('/')));
            }
        }
        // Last, the package the host has given, which the extension points to.
        candidates.extend(self.package_manifest.clone());
        let found = candidates.into_iter().find_map(|path| {
            let modified = std::fs::metadata(&path).ok()?.modified().ok();
            Some((path, modified))
        });
        let (path, modified) = match found {
            Some((path, modified)) => (Some(path), modified),
            None => (None, None),
        };
        let known = self.sources.iter().position(|s| s.path == path);
        if let Some(index) = known {
            if self.sources[index].modified == modified {
                return self.sources[index].vocabulary.clone();
            }
        }
        // A manifest that is new or changed applies to every open document
        // that finds it. The first one read is not a change.
        self.reloaded = !self.sources.is_empty();
        let vocabulary = match &path {
            None => None,
            Some(file) => match std::fs::read(file)
                .map_err(|e| e.to_string())
                .and_then(|bytes| manifest::from_json(&String::from_utf8_lossy(&bytes)))
            {
                Ok(vocabulary) => Some(Rc::new(vocabulary)),
                Err(reason) => {
                    self.message(
                        2,
                        &format!("LO-TEK could not read {file}, and checks nothing until it can be read: {reason}"),
                    );
                    None
                }
            },
        };
        let source = Source {
            path,
            modified,
            vocabulary: vocabulary.clone(),
        };
        match known {
            Some(index) => self.sources[index] = source,
            None => self.sources.push(source),
        }
        vocabulary
    }

    fn check(&mut self, index: usize) {
        let uri = self.documents[index].uri.clone();
        let vocabulary = self.vocabulary(Some(&uri));
        // Only when a document actually has none, and once: `initialize` looks
        // only at the root, and in a monorepo the package is further down.
        if vocabulary.is_none() && !self.warned {
            self.warned = true;
            self.message(
                2,
                "LO-TEK found no manifest, and checks nothing. Install @lo-tek/interfaces in the project, and open the file in a workspace that has it.",
            );
        }
        let document = &mut self.documents[index];
        document.findings = match vocabulary {
            None => Vec::new(),
            Some(v) if self.rendered => diagnose_page(&document.text, &v),
            Some(v) => diagnose_markup(&document.text, &v),
        };
        let lines = Lines::new(&document.text);
        let diagnostics = Json::Array(
            document
                .findings
                .iter()
                .map(|f| diagnostic(&lines, f))
                .collect(),
        );
        self.notify(
            "textDocument/publishDiagnostics",
            object(vec![("uri", text(&uri)), ("diagnostics", diagnostics)]),
        );
    }

    /// Opens the document, or gives it new text. A change does not say the
    /// language again, so the one it was opened in stays.
    fn open(&mut self, uri: &str, content: &str, language: Option<&str>) {
        let index = match self.documents.iter().position(|d| d.uri == uri) {
            Some(index) => {
                self.documents[index].text = utf16(content);
                if let Some(language) = language {
                    self.documents[index].language = language.to_string();
                }
                index
            }
            None => {
                self.documents.push(Document {
                    uri: uri.to_string(),
                    language: language.unwrap_or("").to_string(),
                    text: utf16(content),
                    findings: Vec::new(),
                });
                self.documents.len() - 1
            }
        };
        if self.deferred {
            if !self.dirty.iter().any(|u| u == uri) {
                self.dirty.push(uri.to_string());
            }
        } else {
            self.check(index);
            self.after_reload();
        }
    }

    /// Checks every open document.
    fn check_all(&mut self) {
        for index in 0..self.documents.len() {
            self.check(index);
        }
        self.reloaded = false;
    }

    /// If the manifest was read again, the findings in the other documents are
    /// stale.
    fn after_reload(&mut self) {
        if self.reloaded {
            self.check_all();
        }
    }

    /// Checks the documents that have changed since last time. Runs when no
    /// more messages are queued, so keystrokes that came close together are
    /// checked as one change, with the newest text.
    pub fn flush(&mut self) {
        for uri in std::mem::take(&mut self.dirty) {
            if let Some(index) = self.documents.iter().position(|d| d.uri == uri) {
                self.check(index);
            }
        }
        self.after_reload();
    }

    fn initialize(&mut self, params: &Json) -> Json {
        self.can_watch = matches!(
            params
                .get("capabilities")
                .and_then(|c| c.get("workspace"))
                .and_then(|w| w.get("didChangeWatchedFiles"))
                .and_then(|d| d.get("dynamicRegistration")),
            Some(Json::Bool(true))
        );
        if let Some(folders) = params.get("workspaceFolders").and_then(Json::as_array) {
            self.roots = folders
                .iter()
                .filter_map(|f| f.get("uri").and_then(Json::as_str).and_then(path_of))
                .collect();
        }
        if self.roots.is_empty() {
            if let Some(root) = params
                .get("rootUri")
                .and_then(Json::as_str)
                .and_then(path_of)
            {
                self.roots.push(root);
            } else if let Some(root) = params.get("rootPath").and_then(Json::as_str) {
                self.roots.push(root.to_string());
            }
        }
        if let Some(options) = params.get("initializationOptions") {
            self.preferred = options
                .get("manifest")
                .and_then(Json::as_str)
                .map(|p| manifest_path(p, self.roots.first().map(String::as_str)));
            self.rendered = matches!(options.get("rendered"), Some(Json::Bool(true)));
        }
        // The version of LO-TEK the server checks against. Without a manifest
        // it is unknown, and the field is left out, as LSP allows.
        let version = self.vocabulary(None).map(|v| v.version.clone());
        object(vec![
            (
                "capabilities",
                object(vec![
                    ("positionEncoding", text("utf-16")),
                    (
                        "textDocumentSync",
                        object(vec![
                            ("openClose", Json::Bool(true)),
                            ("change", number(1)),
                            // A build may have written a new manifest.
                            ("save", object(vec![("includeText", Json::Bool(false))])),
                        ]),
                    ),
                    (
                        "codeActionProvider",
                        object(vec![(
                            "codeActionKinds",
                            Json::Array(vec![text("quickfix")]),
                        )]),
                    ),
                    (
                        "completionProvider",
                        object(vec![(
                            "triggerCharacters",
                            Json::Array(TRIGGERS.iter().map(|t| text(t)).collect()),
                        )]),
                    ),
                    ("hoverProvider", Json::Bool(true)),
                ]),
            ),
            (
                "serverInfo",
                object(
                    [("name", text("lotek"))]
                        .into_iter()
                        .chain(version.as_deref().map(|v| ("version", text(v))))
                        .collect(),
                ),
            ),
        ])
    }

    /// The document a request is about and where in it, as a UTF-16 index,
    /// with the vocabulary that applies to it. `None` for a document that is
    /// not open, and when there is no manifest.
    fn asked_at(&mut self, params: &Json) -> Option<(usize, usize, Rc<Vocabulary>)> {
        let uri = params
            .get("textDocument")?
            .get("uri")?
            .as_str()?
            .to_string();
        let index = self.documents.iter().position(|d| d.uri == uri)?;
        let place = |k| {
            params
                .get("position")
                .and_then(|p| p.get(k))
                .and_then(Json::as_f64)
                .unwrap_or(0.0) as usize
        };
        let offset = offset_of(
            &self.documents[index].text,
            place("line"),
            place("character"),
        );
        let vocabulary = self.vocabulary(Some(&uri))?;
        Some((index, offset, vocabulary))
    }

    /// What there is to write at the cursor, each as an edit of the word
    /// that is there.
    fn completion(&mut self, params: &Json) -> Json {
        let Some((index, offset, vocabulary)) = self.asked_at(params) else {
            return Json::Array(Vec::new());
        };
        let document = &self.documents[index];
        let lines = Lines::new(&document.text);
        // An HTML file has the editor's own service for the elements.
        let html = document.language == "html";
        let items = lotek_core::complete::complete(&document.text, offset, html, &vocabulary)
            .iter()
            .map(|s| {
                let mut entries = vec![
                    ("label", text(&s.label)),
                    (
                        "kind",
                        // Value, EnumMember, Class and Property in LSP.
                        number(match s.kind {
                            SuggestionKind::Class => 12,
                            SuggestionKind::Value => 20,
                            SuggestionKind::Element => 7,
                            SuggestionKind::Attribute => 10,
                        }),
                    ),
                ];
                if let Some(detail) = &s.detail {
                    entries.push(("detail", text(detail)));
                }
                if let Some(documentation) = &s.documentation {
                    entries.push(("documentation", markdown(documentation)));
                }
                entries.push((
                    "textEdit",
                    object(vec![
                        ("range", range(&lines, s.start, s.end)),
                        ("newText", text(&s.label)),
                    ]),
                ));
                object(entries)
            })
            .collect();
        Json::Array(items)
    }

    /// What the word under the pointer is, or `null`.
    fn hover(&mut self, params: &Json) -> Json {
        let Some((index, offset, vocabulary)) = self.asked_at(params) else {
            return Json::Null;
        };
        let document = &self.documents[index];
        match lotek_core::complete::hover(&document.text, offset, &vocabulary) {
            Some(found) => object(vec![
                ("contents", markdown(&found.text)),
                (
                    "range",
                    range(&Lines::new(&document.text), found.start, found.end),
                ),
            ]),
            None => Json::Null,
        }
    }

    /// The quick fixes for the findings that overlap the range.
    fn code_actions(&self, params: &Json) -> Json {
        let uri = params
            .get("textDocument")
            .and_then(|d| d.get("uri"))
            .and_then(Json::as_str)
            .unwrap_or("");
        let Some(document) = self.documents.iter().find(|d| d.uri == uri) else {
            return Json::Array(Vec::new());
        };
        let lines = Lines::new(&document.text);
        let line_and_character = |p: Option<&Json>| -> (usize, usize) {
            let get = |k| {
                p.and_then(|p| p.get(k))
                    .and_then(Json::as_f64)
                    .unwrap_or(0.0) as usize
            };
            (get("line"), get("character"))
        };
        let wanted = params.get("range");
        let from = line_and_character(wanted.and_then(|r| r.get("start")));
        let to = line_and_character(wanted.and_then(|r| r.get("end")));
        let at = |offset: usize| {
            let (line, column) = lines.line_and_column(offset);
            (line - 1, column - 1)
        };
        let actions = document
            .findings
            .iter()
            .filter(|f| f.fix.is_some())
            .filter(|f| at(f.start) <= to && from <= at(f.end))
            .map(|f| {
                let fix = f.fix.as_ref().unwrap();
                // One code action with all the edits: the editor applies them
                // together, so `id` on the field and `for` on the label come
                // together.
                let edits = fix
                    .edits
                    .iter()
                    .map(|e| {
                        object(vec![
                            ("range", range(&lines, e.start, e.end)),
                            ("newText", text(&e.text)),
                        ])
                    })
                    .collect();
                object(vec![
                    ("title", text(&fix.title)),
                    ("kind", text("quickfix")),
                    ("diagnostics", Json::Array(vec![diagnostic(&lines, f)])),
                    ("isPreferred", Json::Bool(fix.preferred)),
                    (
                        "edit",
                        object(vec![(
                            "changes",
                            Json::Object(vec![(uri.to_string(), Json::Array(edits))]),
                        )]),
                    ),
                ])
            })
            .collect();
        Json::Array(actions)
    }

    /// Handles one message. The answer, and everything else for the editor,
    /// is in [`Server::take`] afterwards. `Some(code)` means the server is to
    /// exit.
    pub fn handle(&mut self, message: &Json) -> Option<i32> {
        let method = message.get("method").and_then(Json::as_str).unwrap_or("");
        let id = message.get("id").cloned();
        let params = message.get("params").cloned().unwrap_or(Json::Null);
        let document_uri = params
            .get("textDocument")
            .and_then(|d| d.get("uri"))
            .and_then(Json::as_str)
            .unwrap_or("")
            .to_string();

        let result = match method {
            "initialize" => Some(self.initialize(&params)),
            "shutdown" => {
                self.shut_down = true;
                Some(Json::Null)
            }
            "exit" => return Some(if self.shut_down { 0 } else { 1 }),
            "initialized" => {
                // The editor watches the manifests and says when they change,
                // also in Neovim and Helix, where no extension does it.
                if self.can_watch {
                    self.outgoing.push(object(vec![
                        ("jsonrpc", text("2.0")),
                        ("id", text("lotek-manifest")),
                        ("method", text("client/registerCapability")),
                        (
                            "params",
                            object(vec![(
                                "registrations",
                                Json::Array(vec![object(vec![
                                    ("id", text("lotek-manifest")),
                                    ("method", text("workspace/didChangeWatchedFiles")),
                                    (
                                        "registerOptions",
                                        object(vec![(
                                            "watchers",
                                            Json::Array(
                                                CANDIDATES
                                                    .iter()
                                                    .map(|c| {
                                                        object(vec![(
                                                            "globPattern",
                                                            text(&format!("**/{c}")),
                                                        )])
                                                    })
                                                    .collect(),
                                            ),
                                        )]),
                                    ),
                                ])]),
                            )]),
                        ),
                    ]));
                }
                None
            }
            "textDocument/didOpen" => {
                let content = params
                    .get("textDocument")
                    .and_then(|d| d.get("text"))
                    .and_then(Json::as_str)
                    .unwrap_or("")
                    .to_string();
                let language = params
                    .get("textDocument")
                    .and_then(|d| d.get("languageId"))
                    .and_then(Json::as_str)
                    .map(str::to_string);
                self.open(&document_uri, &content, language.as_deref());
                None
            }
            "textDocument/didChange" => {
                // The whole document is in the last change.
                let content = params
                    .get("contentChanges")
                    .and_then(Json::as_array)
                    .and_then(|changes| changes.last())
                    .and_then(|c| c.get("text"))
                    .and_then(Json::as_str)
                    .map(str::to_string);
                if let Some(content) = content {
                    self.open(&document_uri, &content, None);
                }
                None
            }
            "textDocument/didClose" => {
                self.documents.retain(|d| d.uri != document_uri);
                self.dirty.retain(|u| *u != document_uri);
                self.notify(
                    "textDocument/publishDiagnostics",
                    object(vec![
                        ("uri", text(&document_uri)),
                        ("diagnostics", Json::Array(Vec::new())),
                    ]),
                );
                None
            }
            // A new build or an upgrade may have changed the manifest.
            "textDocument/didSave" | "workspace/didChangeWatchedFiles" => {
                self.flush();
                self.check_all();
                None
            }
            // The fixes apply to the newest text.
            "textDocument/codeAction" => {
                self.flush();
                Some(self.code_actions(&params))
            }
            "textDocument/completion" => Some(self.completion(&params)),
            "textDocument/hover" => Some(self.hover(&params)),
            _ => None,
        };

        if let Some(id) = id {
            let reply = match result {
                Some(result) => object(vec![
                    ("jsonrpc", text("2.0")),
                    ("id", id),
                    ("result", result),
                ]),
                None if method.is_empty() || method.starts_with("$/") => return None,
                None => object(vec![
                    ("jsonrpc", text("2.0")),
                    ("id", id),
                    (
                        "error",
                        object(vec![
                            ("code", Json::Number(-32601.0)),
                            ("message", text(&format!("lotek lsp cannot do {method}."))),
                        ]),
                    ),
                ]),
            };
            // The answer goes before the diagnostics it led to.
            self.outgoing.insert(0, reply);
        }
        None
    }

    /// The messages waiting to be sent.
    pub fn take(&mut self) -> Vec<Json> {
        std::mem::take(&mut self.outgoing)
    }
}

/// Reads exactly that many bytes, and waits instead of giving up when the
/// pipe is in non-blocking mode.
fn read_exact(input: &mut impl Read, buffer: &mut [u8]) -> bool {
    let mut filled = 0;
    while filled < buffer.len() {
        match input.read(&mut buffer[filled..]) {
            Ok(0) => return false,
            Ok(n) => filled += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            Err(_) => return false,
        }
    }
    true
}

/// What was read from the editor.
#[derive(Debug, PartialEq)]
enum Incoming {
    Message(Vec<u8>),
    /// The headers had no `Content-Length` that could be read.
    BadHeader,
    /// The editor closed the pipe.
    Closed,
}

/// One message: the headers up to an empty line, and then `Content-Length`
/// bytes of JSON.
fn read_message(input: &mut impl Read) -> Incoming {
    let mut header = Vec::new();
    let mut byte = [0u8];
    while !header.ends_with(b"\r\n\r\n") {
        if !read_exact(input, &mut byte) {
            return Incoming::Closed;
        }
        header.push(byte[0]);
    }
    let header = String::from_utf8_lossy(&header);
    let length = header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("content-length")
            .then(|| value.trim().parse::<usize>().ok())?
    });
    let Some(length) = length else {
        return Incoming::BadHeader;
    };
    let mut body = vec![0u8; length];
    if read_exact(input, &mut body) {
        Incoming::Message(body)
    } else {
        Incoming::Closed
    }
}

fn write_message(output: &mut impl Write, message: &Json) {
    let body = message.to_compact();
    let _ = write!(output, "Content-Length: {}\r\n\r\n{body}", body.len());
    let _ = output.flush();
}

/// The answer to a message that could not be read.
fn parse_error(reason: &str) -> Json {
    object(vec![
        ("jsonrpc", text("2.0")),
        ("id", Json::Null),
        (
            "error",
            object(vec![
                ("code", Json::Number(-32700.0)),
                ("message", text(reason)),
            ]),
        ),
    ])
}

pub fn run(_arguments: &[String]) {
    let mut server = Server::new();
    server.deferred = true;
    let stdin = std::io::stdin();
    // Its own buffer, so the server can see whether more messages are queued.
    let mut input = std::io::BufReader::with_capacity(1 << 16, stdin.lock());
    let stdout = std::io::stdout();
    loop {
        let code = match read_message(&mut input) {
            // The editor closed the pipe without `exit`.
            Incoming::Closed => std::process::exit(1),
            // One broken message must not take down the server.
            Incoming::BadHeader => {
                server.outgoing.push(parse_error(
                    "The message had no Content-Length that could be read.",
                ));
                None
            }
            Incoming::Message(body) => match parse(&String::from_utf8_lossy(&body)) {
                Ok(message) => server.handle(&message),
                Err(reason) => {
                    server.outgoing.push(parse_error(&reason));
                    None
                }
            },
        };
        // The answer first: completion comes right after a keystroke, and
        // must not wait for the check that keystroke leads to.
        let mut out = stdout.lock();
        for message in server.take() {
            write_message(&mut out, &message);
        }
        if input.buffer().is_empty() {
            server.flush();
            for message in server.take() {
                write_message(&mut out, &message);
            }
        }
        if let Some(code) = code {
            std::process::exit(code);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: usize, method: &str, params: &str) -> Json {
        parse(&format!(
            r#"{{"jsonrpc":"2.0","id":{id},"method":"{method}","params":{params}}}"#
        ))
        .unwrap()
    }

    fn notification(method: &str, params: &str) -> Json {
        parse(&format!(
            r#"{{"jsonrpc":"2.0","method":"{method}","params":{params}}}"#
        ))
        .unwrap()
    }

    fn started() -> Server {
        let mut server = Server::new();
        server.handle(&request(
            1,
            "initialize",
            r#"{"rootUri":null,"capabilities":{}}"#,
        ));
        server.take();
        server
    }

    #[test]
    fn says_what_it_can() {
        let mut server = Server::new();
        server.handle(&request(1, "initialize", r#"{"capabilities":{}}"#));
        let reply = &server.take()[0];
        let capabilities = reply.get("result").unwrap().get("capabilities").unwrap();
        assert_eq!(
            capabilities.get("positionEncoding").unwrap().as_str(),
            Some("utf-16")
        );
        assert!(capabilities.get("codeActionProvider").is_some());
    }

    #[test]
    fn publishes_findings_with_utf16_positions() {
        let mut server = started();
        server.handle(&notification(
            "textDocument/didOpen",
            r#"{"textDocument":{"uri":"file:///a.html","languageId":"html","version":1,"text":"<p>🧾æ</p>\n<b class=\"lt-buton\"></b>"}}"#,
        ));
        let sent = server.take();
        let params = sent[0].get("params").unwrap();
        let diagnostic = &params.get("diagnostics").unwrap().as_array().unwrap()[0];
        assert_eq!(
            diagnostic.get("code").unwrap().as_str(),
            Some("unknown-class")
        );
        let start = diagnostic.get("range").unwrap().get("start").unwrap();
        assert_eq!(start.get("line").unwrap().as_f64(), Some(1.0));
        assert_eq!(start.get("character").unwrap().as_f64(), Some(10.0));

        // The change replaces the whole document, and the finding is gone.
        server.handle(&notification(
            "textDocument/didChange",
            r#"{"textDocument":{"uri":"file:///a.html","version":2},"contentChanges":[{"text":"<button class=\"lt-button\"></button>"}]}"#,
        ));
        let sent = server.take();
        assert!(sent[0]
            .get("params")
            .unwrap()
            .get("diagnostics")
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn counts_carriage_returns_as_line_breaks_like_lsp() {
        // LSP splits lines on `\n`, `\r\n` and `\r`. A client that sends the
        // buffer as it is, like Neovim with fileformat=mac, sends `\r`.
        for (text, line, character) in [
            (
                r#"<div>\r<div>\r<span class=\"lt-buton\">x</span>"#,
                2.0,
                13.0,
            ),
            (
                r#"<div>\r\n<div>\r\n<span class=\"lt-buton\">x</span>"#,
                2.0,
                13.0,
            ),
            (r#"<div>\n\r<span class=\"lt-buton\">x</span>"#, 2.0, 13.0),
        ] {
            let mut server = started();
            server.handle(&notification(
                "textDocument/didOpen",
                &format!(
                    r#"{{"textDocument":{{"uri":"file:///a.html","languageId":"html","version":1,"text":"{text}"}}}}"#
                ),
            ));
            let sent = server.take();
            let params = sent[0].get("params").unwrap();
            let diagnostic = &params.get("diagnostics").unwrap().as_array().unwrap()[0];
            let start = diagnostic.get("range").unwrap().get("start").unwrap();
            assert_eq!(start.get("line").unwrap().as_f64(), Some(line), "{text}");
            assert_eq!(
                start.get("character").unwrap().as_f64(),
                Some(character),
                "{text}"
            );
        }
    }

    #[test]
    fn offers_the_fix_as_a_quick_fix() {
        let mut server = started();
        server.handle(&notification(
            "textDocument/didOpen",
            r#"{"textDocument":{"uri":"file:///a.html","languageId":"html","version":1,"text":"<b class=\"lt-buton\"></b>"}}"#,
        ));
        server.take();
        server.handle(&request(
            2,
            "textDocument/codeAction",
            r#"{"textDocument":{"uri":"file:///a.html"},"range":{"start":{"line":0,"character":12},"end":{"line":0,"character":12}},"context":{"diagnostics":[]}}"#,
        ));
        let reply = &server.take()[0];
        let action = &reply.get("result").unwrap().as_array().unwrap()[0];
        assert_eq!(
            action.get("title").unwrap().as_str(),
            Some("Change to lt-button")
        );
        let edit = &action
            .get("edit")
            .unwrap()
            .get("changes")
            .unwrap()
            .get("file:///a.html")
            .unwrap()
            .as_array()
            .unwrap()[0];
        assert_eq!(edit.get("newText").unwrap().as_str(), Some("lt-button"));
    }

    #[test]
    fn closing_clears_the_findings_and_exit_follows_shutdown() {
        let mut server = started();
        server.handle(&notification(
            "textDocument/didClose",
            r#"{"textDocument":{"uri":"file:///a.html"}}"#,
        ));
        let sent = server.take();
        assert!(sent[0]
            .get("params")
            .unwrap()
            .get("diagnostics")
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(server.handle(&notification("exit", "null")), Some(1));
        server.handle(&request(3, "shutdown", "null"));
        assert_eq!(server.handle(&notification("exit", "null")), Some(0));
    }

    #[test]
    fn answers_an_unknown_request_with_an_error() {
        let mut server = started();
        server.handle(&request(4, "textDocument/definition", "{}"));
        let reply = &server.take()[0];
        assert_eq!(
            reply.get("error").unwrap().get("code").unwrap().as_f64(),
            Some(-32601.0)
        );
    }

    /// Opens `marked` without its `|` as `file:///a` in the language given,
    /// and asks `method` where the `|` stood. The result of the answer.
    fn asked(server: &mut Server, method: &str, language: &str, marked: &str) -> Json {
        let before = marked.split('|').next().unwrap();
        let line = before.matches('\n').count();
        let character = utf16(before.rsplit('\n').next().unwrap()).len();
        let content = Json::String(marked.replace('|', "")).to_compact();
        server.handle(&notification(
            "textDocument/didOpen",
            &format!(
                r#"{{"textDocument":{{"uri":"file:///a","languageId":"{language}","version":1,"text":{content}}}}}"#
            ),
        ));
        server.take();
        server.handle(&request(
            7,
            method,
            &format!(
                r#"{{"textDocument":{{"uri":"file:///a"}},"position":{{"line":{line},"character":{character}}}}}"#
            ),
        ));
        server.take()[0].get("result").cloned().unwrap()
    }

    fn labels(items: &Json) -> Vec<&str> {
        items
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i.get("label").unwrap().as_str().unwrap())
            .collect()
    }

    #[test]
    fn says_it_completes_and_hovers() {
        let mut server = Server::new();
        server.handle(&request(1, "initialize", r#"{"capabilities":{}}"#));
        let reply = &server.take()[0];
        let capabilities = reply.get("result").unwrap().get("capabilities").unwrap();
        assert_eq!(capabilities.get("hoverProvider"), Some(&Json::Bool(true)));
        let triggers = capabilities
            .get("completionProvider")
            .unwrap()
            .get("triggerCharacters")
            .unwrap()
            .to_compact();
        assert_eq!(triggers, r#"["\"","'"," ","-","<","="]"#);
    }

    #[test]
    fn completes_a_class_as_an_edit_of_the_word_at_the_cursor() {
        let mut server = started();
        let items = asked(
            &mut server,
            "textDocument/completion",
            "html",
            "<p>ø</p>\n<b class=\"lt-bu|\"></b>",
        );
        let button = items
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i.get("label").unwrap().as_str() == Some("lt-button"))
            .expect("lt-button is not among the suggestions");
        assert_eq!(button.get("kind").unwrap().as_f64(), Some(12.0));
        assert_eq!(button.get("detail").unwrap().as_str(), Some("Button"));
        let documentation = button.get("documentation").unwrap();
        assert_eq!(
            documentation.get("kind").unwrap().as_str(),
            Some("markdown")
        );
        assert!(documentation
            .get("value")
            .unwrap()
            .as_str()
            .unwrap()
            .starts_with("**Button** · "));
        assert_eq!(
            button.get("textEdit").unwrap().to_compact(),
            r#"{"range":{"start":{"line":1,"character":10},"end":{"line":1,"character":15}},"newText":"lt-button"}"#
        );
    }

    #[test]
    fn completes_from_the_manifest_of_the_project() {
        let root = std::env::temp_dir().join(format!("lotek-lsp-complete-{}", std::process::id()));
        let folder = root.join("build/lotek");
        std::fs::create_dir_all(&folder).unwrap();
        let fragment = r#"{"schemaVersion":1,"version":"0","classes":{"app-button":{"title":"Button","link":"","attributes":{}}}}"#;
        std::fs::write(
            folder.join("manifest.json"),
            manifest::merged(&crate::package::manifest(), &[fragment])
                .unwrap()
                .to_pretty(),
        )
        .unwrap();
        let mut server = Server::new();
        server.handle(&request(
            1,
            "initialize",
            &format!(
                r#"{{"rootUri":"file://{}","capabilities":{{}}}}"#,
                root.display()
            ),
        ));
        server.take();
        let items = asked(
            &mut server,
            "textDocument/completion",
            "html",
            r#"<b class="|"></b>"#,
        );
        assert!(
            labels(&items).contains(&"app-button"),
            "a class the project took over"
        );
        assert!(labels(&items).contains(&"lt-button"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn completes_the_elements_where_the_editor_has_no_html_service() {
        let mut server = started();
        let php = asked(&mut server, "textDocument/completion", "php", "<lt-|");
        assert!(labels(&php).contains(&"lt-dialog"));
        let item = &php.as_array().unwrap()[0];
        assert_eq!(item.get("kind").unwrap().as_f64(), Some(7.0));
        assert!(item.get("detail").is_none());
        let html = asked(&mut server, "textDocument/completion", "html", "<lt-|");
        assert!(labels(&html).is_empty());
        let values = asked(
            &mut server,
            "textDocument/completion",
            "php",
            r#"<lt-popover placement="|""#,
        );
        assert!(!labels(&values).is_empty());
        let value = &values.as_array().unwrap()[0];
        assert_eq!(value.get("kind").unwrap().as_f64(), Some(20.0));
        let names = asked(
            &mut server,
            "textDocument/completion",
            "php",
            "<lt-popover |",
        );
        assert_eq!(
            names.as_array().unwrap()[0].get("kind").unwrap().as_f64(),
            Some(10.0)
        );
    }

    #[test]
    fn completes_in_the_text_of_the_last_change() {
        let mut server = started();
        asked(&mut server, "textDocument/completion", "html", "<b|");
        server.handle(&notification(
            "textDocument/didChange",
            r#"{"textDocument":{"uri":"file:///a","version":2},"contentChanges":[{"text":"<b class=\"\">"}]}"#,
        ));
        server.handle(&request(
            8,
            "textDocument/completion",
            r#"{"textDocument":{"uri":"file:///a"},"position":{"line":0,"character":10}}"#,
        ));
        let sent = server.take();
        let reply = sent.iter().find(|m| m.get("id").is_some()).unwrap();
        assert!(labels(reply.get("result").unwrap()).contains(&"lt-button"));
    }

    #[test]
    fn hovers_over_a_class_and_says_nothing_elsewhere() {
        let mut server = started();
        let hover = asked(
            &mut server,
            "textDocument/hover",
            "html",
            "<b\r\n class=\"lt-bu|tton\"></b>",
        );
        let contents = hover.get("contents").unwrap();
        assert_eq!(contents.get("kind").unwrap().as_str(), Some("markdown"));
        assert!(contents
            .get("value")
            .unwrap()
            .as_str()
            .unwrap()
            .starts_with("**Button** · "));
        assert_eq!(
            hover.get("range").unwrap().to_compact(),
            r#"{"start":{"line":1,"character":8},"end":{"line":1,"character":17}}"#
        );
        let nothing = asked(
            &mut server,
            "textDocument/hover",
            "html",
            "<b>lt-bu|tton</b>",
        );
        assert_eq!(nothing, Json::Null);
        let unopened = {
            server.handle(&request(
                9,
                "textDocument/hover",
                r#"{"textDocument":{"uri":"file:///other"},"position":{"line":0,"character":0}}"#,
            ));
            server.take()[0].get("result").cloned().unwrap()
        };
        assert_eq!(unopened, Json::Null);
    }

    #[test]
    fn reads_paths_from_file_addresses() {
        assert_eq!(path_of("file:///home/a%20b/x"), Some("/home/a b/x".into()));
        let windows = path_of("file:///c%3A/project").unwrap();
        if cfg!(target_os = "wasi") {
            assert_eq!(windows, "/c/project");
        } else {
            assert_eq!(windows, "C:/project");
        }
        assert_eq!(path_of("untitled:Untitled-1"), None);
        // The manifest in initializationOptions.
        let windows = manifest_path(r"C:\proj\build\lotek\manifest.json", Some("/c/proj"));
        if cfg!(target_os = "wasi") {
            assert_eq!(windows, "/c/proj/build/lotek/manifest.json");
        } else {
            assert_eq!(windows, r"C:\proj\build\lotek\manifest.json");
        }
        assert_eq!(
            manifest_path("build/m.json", Some("/r/")),
            "/r/build/m.json"
        );
        assert_eq!(manifest_path("/abs/m.json", Some("/r")), "/abs/m.json");
        assert_eq!(
            manifest_path("file:///abs/m%20x.json", Some("/r")),
            "/abs/m x.json"
        );
        assert_eq!(path_of("file:///a%+fb"), Some("/a%+fb".into()));
    }

    #[test]
    fn frames_messages_with_content_length() {
        let mut input: &[u8] = b"Content-Length: 2\r\n\r\n{}Content-Length: 4\r\n\r\nnull";
        assert_eq!(read_message(&mut input), Incoming::Message(b"{}".to_vec()));
        assert_eq!(
            read_message(&mut input),
            Incoming::Message(b"null".to_vec())
        );
        assert_eq!(read_message(&mut input), Incoming::Closed);
        // A header without a length is a broken message, not a closed pipe.
        let mut broken: &[u8] = b"Content-Type: x\r\n\r\nContent-Length: 2\r\n\r\n{}";
        assert_eq!(read_message(&mut broken), Incoming::BadHeader);
        assert_eq!(read_message(&mut broken), Incoming::Message(b"{}".to_vec()));
    }

    #[test]
    fn uses_the_manifest_in_the_workspace() {
        let root = std::env::temp_dir().join(format!("lotek-lsp-{}", std::process::id()));
        let folder = root.join("build/lotek");
        std::fs::create_dir_all(&folder).unwrap();
        let fragment = r#"{"schemaVersion":1,"version":"0","classes":{"app-button":{"title":"Button","link":"","attributes":{}}}}"#;
        std::fs::write(
            folder.join("manifest.json"),
            manifest::merged(&crate::package::manifest(), &[fragment])
                .unwrap()
                .to_pretty(),
        )
        .unwrap();
        let mut server = Server::new();
        server.handle(&request(
            1,
            "initialize",
            &format!(
                r#"{{"rootUri":"file://{}","capabilities":{{}}}}"#,
                root.display()
            ),
        ));
        server.handle(&notification(
            "textDocument/didOpen",
            r#"{"textDocument":{"uri":"file:///a.html","languageId":"html","version":1,"text":"<b class=\"app-button__x\"></b>"}}"#,
        ));
        let sent = server.take();
        let published = sent
            .iter()
            .find(|m| {
                m.get("method").and_then(Json::as_str) == Some("textDocument/publishDiagnostics")
            })
            .unwrap();
        assert_eq!(
            published
                .get("params")
                .unwrap()
                .get("diagnostics")
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finds_the_manifest_in_the_folder_above_the_document() {
        // A monorepo: the package is in `apps/web/node_modules`, not at the
        // root.
        let root = std::env::temp_dir().join(format!("lotek-lsp-up-{}", std::process::id()));
        let web = root.join("apps/web");
        let folder = web.join("node_modules/@lo-tek/interfaces/manifest");
        std::fs::create_dir_all(&folder).unwrap();
        let fragment = r#"{"schemaVersion":1,"version":"0","classes":{"app-button":{"title":"Button","link":"","attributes":{}}}}"#;
        std::fs::write(
            folder.join("manifest.json"),
            manifest::merged(&crate::package::manifest(), &[fragment])
                .unwrap()
                .to_pretty(),
        )
        .unwrap();
        let mut server = Server::new();
        server.handle(&request(
            1,
            "initialize",
            &format!(
                r#"{{"rootUri":"file://{}","capabilities":{{}}}}"#,
                root.display()
            ),
        ));
        server.take();
        let count = |server: &mut Server, uri: &str| {
            server.handle(&notification(
                "textDocument/didOpen",
                &format!(r#"{{"textDocument":{{"uri":"{uri}","languageId":"html","version":1,"text":"<b class=\"app-button__x\"></b>"}}}}"#),
            ));
            server
                .take()
                .iter()
                .find(|m| {
                    m.get("method").and_then(Json::as_str)
                        == Some("textDocument/publishDiagnostics")
                })
                .and_then(|m| {
                    m.get("params")?
                        .get("diagnostics")?
                        .as_array()
                        .map(<[Json]>::len)
                })
                .unwrap()
        };
        let inside = format!("file://{}/src/page.html", web.display());
        assert_eq!(
            count(&mut server, &inside),
            1,
            "the page in apps/web sees the package there"
        );
        let outside = format!("file://{}/page.html", root.display());
        assert_eq!(
            count(&mut server, &outside),
            0,
            "a page at the root does not see it"
        );

        // Nothing is searched above the root: the workspace `apps/web/src`
        // does not see the package in `apps/web`, which is outside it.
        let mut narrow = Server::new();
        narrow.handle(&request(
            1,
            "initialize",
            &format!(
                r#"{{"rootUri":"file://{}/src","capabilities":{{}}}}"#,
                web.display()
            ),
        ));
        narrow.take();
        assert_eq!(
            count(&mut narrow, &inside),
            0,
            "the package above the root does not apply"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn does_not_look_above_the_workspace_for_a_file_outside_it() {
        // The package is above the workspace, as in the home folder, and the
        // workspace itself has none. Before, the search stopped only at a root
        // the file was under, so a file outside the root, and every file when
        // the editor gave no root, went all the way to the root of the file
        // system and found it.
        let root = std::env::temp_dir().join(format!("lotek-lsp-outside-{}", std::process::id()));
        let folder = root.join("node_modules/@lo-tek/interfaces/manifest");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(root.join("proj")).unwrap();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        let fragment = r#"{"schemaVersion":1,"version":"0","classes":{"app-button":{"title":"Button","link":"","attributes":{}}}}"#;
        std::fs::write(
            folder.join("manifest.json"),
            manifest::merged(&crate::package::manifest(), &[fragment])
                .unwrap()
                .to_pretty(),
        )
        .unwrap();
        let count = |server: &mut Server, uri: &str| {
            server.handle(&notification(
                "textDocument/didOpen",
                &format!(r#"{{"textDocument":{{"uri":"{uri}","languageId":"html","version":1,"text":"<b class=\"app-button__x\"></b>"}}}}"#),
            ));
            server
                .take()
                .iter()
                .find(|m| {
                    m.get("method").and_then(Json::as_str)
                        == Some("textDocument/publishDiagnostics")
                })
                .and_then(|m| {
                    m.get("params")?
                        .get("diagnostics")?
                        .as_array()
                        .map(<[Json]>::len)
                })
                .unwrap()
        };

        let mut server = Server::new();
        server.handle(&request(
            1,
            "initialize",
            &format!(
                r#"{{"rootUri":"file://{}/proj","capabilities":{{}}}}"#,
                root.display()
            ),
        ));
        server.take();
        let outside = format!("file://{}/notes/a.html", root.display());
        assert_eq!(
            count(&mut server, &outside),
            0,
            "a file outside the workspace does not see the package above it"
        );

        // Without a workspace, like Neovim without a match on `root_markers`.
        let mut rootless = Server::new();
        rootless.handle(&request(
            1,
            "initialize",
            r#"{"rootUri":null,"capabilities":{}}"#,
        ));
        rootless.take();
        let inside = format!("file://{}/proj/page.html", root.display());
        assert_eq!(
            count(&mut rootless, &inside),
            0,
            "without a root nothing is searched upwards from the file"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deferred_changes_are_checked_once_with_the_newest_text() {
        let mut server = started();
        server.deferred = true;
        for (version, text) in [(1, "lt-buton"), (2, "lt-butto"), (3, "lt-button")] {
            server.handle(&notification(
                if version == 1 { "textDocument/didOpen" } else { "textDocument/didChange" },
                &format!(
                    r#"{{"textDocument":{{"uri":"file:///a.html","version":{version},"text":"<button class=\"{text}\"></button>"}},"contentChanges":[{{"text":"<button class=\"{text}\"></button>"}}]}}"#
                ),
            ));
        }
        assert!(
            server.take().is_empty(),
            "nothing is checked while messages are queued"
        );
        server.flush();
        let sent = server.take();
        assert_eq!(sent.len(), 1, "three changes give one check");
        assert!(sent[0]
            .get("params")
            .unwrap()
            .get("diagnostics")
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn registers_watchers_and_rechecks_every_document_when_the_manifest_changes() {
        let root = std::env::temp_dir().join(format!("lotek-lsp-all-{}", std::process::id()));
        std::fs::create_dir_all(root.join("build/lotek")).unwrap();
        let mut server = Server::new();
        server.handle(&request(
            1,
            "initialize",
            &format!(
                r#"{{"rootUri":"file://{}","capabilities":{{"workspace":{{"didChangeWatchedFiles":{{"dynamicRegistration":true}}}}}}}}"#,
                root.display()
            ),
        ));
        server.take();
        server.handle(&notification("initialized", "{}"));
        let registration = &server.take()[0];
        assert_eq!(
            registration.get("method").unwrap().as_str(),
            Some("client/registerCapability")
        );

        for uri in ["file:///a.html", "file:///b.html"] {
            server.handle(&notification(
                "textDocument/didOpen",
                &format!(r#"{{"textDocument":{{"uri":"{uri}","version":1,"text":"<b class=\"app-button\"></b>"}}}}"#),
            ));
        }
        server.take();
        let fragment = r#"{"schemaVersion":1,"version":"0","classes":{"app-button":{"title":"Button","link":"","attributes":{}}}}"#;
        std::fs::write(
            root.join("build/lotek/manifest.json"),
            manifest::merged(&crate::package::manifest(), &[fragment])
                .unwrap()
                .to_pretty(),
        )
        .unwrap();
        server.handle(&notification(
            "workspace/didChangeWatchedFiles",
            r#"{"changes":[]}"#,
        ));
        let published = server
            .take()
            .iter()
            .filter(|m| {
                m.get("method").and_then(Json::as_str) == Some("textDocument/publishDiagnostics")
            })
            .count();
        assert_eq!(published, 2, "both documents are checked again");
        std::fs::remove_dir_all(root).unwrap();
    }
}
