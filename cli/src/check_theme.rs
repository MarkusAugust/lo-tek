//! `lotek check-theme <file…>`: checks a theme someone wrote by hand.
//!
//! The generator keeps the promises by construction, but a hand-written theme
//! is the consumer's responsibility. Without this command, "you can override
//! any cell" is a trap.
//!
//! The count comes last and requires the number to be greater than zero. A
//! run that found not a single file must not look like a run without
//! findings.

use std::io::ErrorKind;

use crate::output::{error, fail, log, shown};
use lotek_core::theme::check::{inspect_theme, verdict, VerdictKind};

pub fn run(arguments: &[String]) {
    // An unknown flag stops the run instead of disappearing: a typo in a flag
    // looks as if the command did what you asked.
    let unknown: Vec<&str> = arguments
        .iter()
        .filter(|a| a.starts_with('-'))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        fail(&format!(
            "Unknown flag: {}.\n\n`lotek check-theme` takes only file names.\n",
            unknown.join(", ")
        ));
    }
    if arguments.is_empty() {
        fail("Give at least one CSS file: `lotek check-theme theme.css`.\n\nThe command reads the --lt-color-* values in the file and checks that every contrast promise holds, in every block.\n");
    }

    // Files that could not be read are collected and reported together.
    let mut sources: Vec<(&str, String)> = Vec::new();
    let mut unreadable: Vec<String> = Vec::new();
    for path in arguments {
        let read = std::fs::metadata(path).and_then(|m| {
            if m.is_dir() {
                Err(std::io::Error::from(ErrorKind::IsADirectory))
            } else {
                std::fs::read(path)
            }
        });
        match read {
            Ok(bytes) => sources.push((path, String::from_utf8_lossy(&bytes).into_owned())),
            Err(e) => unreadable.push({
                let path = shown(path);
                match e.kind() {
                    ErrorKind::IsADirectory => format!("{path} (is a folder)"),
                    ErrorKind::NotFound => format!("{path} (does not exist)"),
                    ErrorKind::PermissionDenied => format!("{path} (EACCES)"),
                    _ => format!("{path} (could not be read)"),
                }
            }),
        }
    }
    if !unreadable.is_empty() {
        fail(&format!("Could not read: {}.", unreadable.join(", ")));
    }

    crate::package::load_contract();
    let mut reports = Vec::new();
    for (path, css) in &sources {
        let report = inspect_theme(css);
        for problem in &report.problems {
            error(&format!(
                "{}  {}\n  {}",
                shown(path),
                problem.selector,
                problem.message
            ));
        }
        reports.push(report);
    }

    // The verdict is the core's, for the files together. What this does
    // with it is the command's: where it is written, and how the run ends.
    let verdict = verdict(&reports);
    match verdict.kind {
        VerdictKind::Kept | VerdictKind::WithoutColours => log(&verdict.message),
        VerdictKind::Broken => fail(&format!("\n{}", verdict.message)),
    }
}
