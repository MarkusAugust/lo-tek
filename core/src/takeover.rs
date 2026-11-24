//! What a component is called once a project has taken it over with
//! `lotek takeover`: which names in the manifest are the component's own,
//! the name each gets, and the fragment of the manifest for the copy.
//!
//! The rules are here and not in the command line because the check reads
//! the same names: a copy called `app-button` is known to
//! [`diagnose`](crate::diagnose) by its block, with the variants and the
//! parts, and the two must agree on what a block is. The command line copies
//! the files and rewrites their references, and asks here for the names.

use crate::json::Json;

/// The prefix the copy gets instead of `lt-`.
pub const PREFIX: &str = "app-";

/// The block a class belongs to: `lt-button` for `lt-button--primary`, and
/// `app-button` for `app-button__icon`.
pub(crate) fn block(name: &str) -> &str {
    let end = [name.find("__"), name.find("--")]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(name.len());
    &name[..end]
}

/// The blocks and elements that belong to the component, like `lt-avatar`
/// and `lt-avatar-stack`, read from the manifest.
pub fn own_names(manifest: &Json, component: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for (name, class) in manifest
        .get("classes")
        .and_then(Json::as_object)
        .unwrap_or(&[])
    {
        if class.get("component").and_then(Json::as_str) == Some(component) {
            names.push(block(name).to_string());
        }
    }
    let link_end = format!("/components/{component}/");
    for (tag, element) in manifest
        .get("elements")
        .and_then(Json::as_object)
        .unwrap_or(&[])
    {
        if element
            .get("link")
            .and_then(Json::as_str)
            .is_some_and(|l| l.ends_with(&link_end))
        {
            names.push(tag.clone());
        }
    }
    if names.is_empty() {
        names.push(format!("lt-{component}"));
    }
    names.sort();
    names.dedup();
    names
}

fn is_name_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b'_'
}

/// The new name for an `lt-` name.
pub fn renamed(name: &str) -> String {
    match name.strip_prefix("lt-") {
        Some(rest) => format!("{PREFIX}{rest}"),
        None => name.to_string(),
    }
}

/// Gives the component's own names the new name.
///
/// A name is replaced where it stands alone, or with a variant or an element
/// after it (`lt-button--primary`, `lt-button__icon`). `lt-button-group` is
/// another component, and `--lt-button-bg` a variable from the theme, and
/// both are left alone.
pub fn rename(content: &str, names: &[String]) -> String {
    let bytes = content.as_bytes();
    let mut out = String::with_capacity(content.len());
    let mut copied = 0;
    let mut at = 0;
    while at < bytes.len() {
        let free_before = at == 0 || !is_name_byte(bytes[at - 1]);
        let hit = free_before
            .then(|| {
                names.iter().find(|name| {
                    let end = at + name.len();
                    // Byte by byte: the names are ASCII, but the text around
                    // them is not.
                    bytes[at..].starts_with(name.as_bytes())
                        && (end == bytes.len()
                            || !is_name_byte(bytes[end])
                            || bytes[end..].starts_with(b"--")
                            || bytes[end..].starts_with(b"__"))
                })
            })
            .flatten();
        match hit {
            Some(name) => {
                out.push_str(&content[copied..at]);
                out.push_str(&renamed(name));
                at += name.len();
                copied = at;
            }
            None => at += 1,
        }
    }
    out.push_str(&content[copied..]);
    out
}

/// `value` with the new names in every string and every key. The selectors in
/// the parts and the descriptions mention the classes, and the copy has only
/// the new ones.
fn renamed_value(value: &Json, names: &[String]) -> Json {
    match value {
        Json::String(text) => Json::String(rename(text, names)),
        Json::Array(items) => Json::Array(items.iter().map(|v| renamed_value(v, names)).collect()),
        Json::Object(fields) => Json::Object(
            fields
                .iter()
                .map(|(key, v)| (rename(key, names), renamed_value(v, names)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// The fragment of the manifest for the copy: the elements and classes that
/// belong to the component, with the new names, also inside the selectors and
/// the descriptions.
pub fn fragment(manifest: &Json, component: &str, names: &[String]) -> Json {
    let owned = |name: &str| names.iter().any(|n| n == block(name) || n == name);
    let section = |key: &str| -> Json {
        Json::Object(
            manifest
                .get(key)
                .and_then(Json::as_object)
                .unwrap_or(&[])
                .iter()
                .filter(|(name, _)| owned(name))
                .map(|(name, value)| (rename(name, names), renamed_value(value, names)))
                .collect(),
        )
    };
    let version = manifest.get("version").cloned().unwrap_or(Json::Null);
    Json::Object(vec![
        (
            "schemaVersion".into(),
            Json::Number(f64::from(crate::manifest::SCHEMA_VERSION)),
        ),
        ("version".into(), version),
        ("component".into(), Json::String(component.into())),
        ("elements".into(), section("elements")),
        ("classes".into(), section("classes")),
    ])
}
