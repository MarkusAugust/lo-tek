//! The vocabulary from the manifest.
//!
//! The core carries no manifest of its own. The host gives it one, with
//! `load_manifest_raw`, and checks against the manifest the project actually
//! has installed, or one that includes a taken-over component. Without a
//! manifest the core checks nothing, and says so.

use std::cell::RefCell;
use std::rc::Rc;

use crate::json::{parse, Json};
use crate::types::*;

/// The manifest format this core understands.
pub const SCHEMA_VERSION: u32 = 1;

thread_local! {
    static CURRENT: RefCell<Option<Rc<Vocabulary>>> = const { RefCell::new(None) };
}

/// The vocabulary the host has given, if it has given one.
pub fn current() -> Option<Rc<Vocabulary>> {
    CURRENT.with(|c| c.borrow().clone())
}

/// Replaces the vocabulary.
pub fn set_current(vocabulary: Vocabulary) {
    CURRENT.with(|c| *c.borrow_mut() = Some(Rc::new(vocabulary)));
}

/// The manifest in the package, for the tests.
#[cfg(test)]
pub fn for_tests() -> Rc<Vocabulary> {
    Rc::new(from_json(&test_text()).expect("the manifest in the package must be readable"))
}

#[cfg(test)]
pub fn test_text() -> String {
    crate::package_file("manifest/manifest.json")
}

fn text(value: &Json, path: &str) -> Result<String, String> {
    value
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("{path} must be text."))
}

fn texts(value: &Json, path: &str) -> Result<Vec<String>, String> {
    value
        .as_array()
        .ok_or_else(|| format!("{path} must be an array."))?
        .iter()
        .enumerate()
        .map(|(i, v)| text(v, &format!("{path}[{i}]")))
        .collect()
}

fn field<'a>(value: &'a Json, key: &str, path: &str) -> Result<&'a Json, String> {
    value
        .get(key)
        .ok_or_else(|| format!("{path} is missing \"{key}\"."))
}

fn entries<'a>(value: &'a Json, path: &str) -> Result<&'a [(String, Json)], String> {
    value
        .as_object()
        .ok_or_else(|| format!("{path} must be an object."))
}

/// The parts in `parts`, when present. A manifest without them, like an older
/// fragment from `lotek takeover`, has none.
fn parts(value: &Json, path: &str) -> Result<Vec<Part>, String> {
    let Some(parts) = value.get("parts") else {
        return Ok(Vec::new());
    };
    let path = format!("{path}.parts");
    entries(parts, &path)?
        .iter()
        .map(|(name, part)| {
            let at = format!("{path}.{name}");
            Ok(Part {
                name: name.clone(),
                selector: text(field(part, "selector", &at)?, &at)?,
                description: part
                    .get("description")
                    .and_then(Json::as_str)
                    .unwrap_or("")
                    .to_string(),
                multiple: matches!(part.get("multiple"), Some(Json::Bool(true))),
                unique: matches!(part.get("unique"), Some(Json::Bool(true))),
                stable_id: matches!(part.get("stableId"), Some(Json::Bool(true))),
                named: named(part, &at)?,
            })
        })
        .collect()
}

/// `name` on an element or a part: `{}`, or `{"after": part, "id": true}`.
fn named(value: &Json, path: &str) -> Result<Option<Named>, String> {
    let Some(name) = value.get("name") else {
        return Ok(None);
    };
    let path = format!("{path}.name");
    entries(name, &path)?;
    Ok(Some(Named {
        after: name
            .get("after")
            .map(|f| text(f, &format!("{path}.after")))
            .transpose()?,
        id: matches!(name.get("id"), Some(Json::Bool(true))),
        component: matches!(name.get("component"), Some(Json::Bool(true))),
    }))
}

/// `texts` on an element: `{key: {text, replacedBy}}`.
fn default_texts(value: &Json, path: &str) -> Result<Vec<DefaultText>, String> {
    let Some(written) = value.get("texts") else {
        return Ok(Vec::new());
    };
    let path = format!("{path}.texts");
    entries(written, &path)?
        .iter()
        .map(|(key, t)| {
            let at = format!("{path}.{key}");
            Ok(DefaultText {
                key: key.clone(),
                text: text(field(t, "text", &at)?, &format!("{at}.text"))?,
                replaced_by: texts(field(t, "replacedBy", &at)?, &format!("{at}.replacedBy"))?,
            })
        })
        .collect()
}

/// `texts` on a class: `[{variable, text, attribute, value?}]`.
fn css_texts(value: &Json, path: &str) -> Result<Vec<CssText>, String> {
    let Some(list) = value.get("texts") else {
        return Ok(Vec::new());
    };
    let path = format!("{path}.texts");
    list.as_array()
        .ok_or_else(|| format!("{path} must be an array."))?
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let at = format!("{path}[{i}]");
            let get = |key: &str| text(field(t, key, &at)?, &format!("{at}.{key}"));
            Ok(CssText {
                variable: get("variable")?,
                text: get("text")?,
                attribute: get("attribute")?,
                value: t
                    .get("value")
                    .map(|v| text(v, &format!("{at}.value")))
                    .transpose()?,
                unless: t
                    .get("unless")
                    .map(|u| texts(u, &format!("{at}.unless")))
                    .transpose()?
                    .unwrap_or_default(),
                within: matches!(t.get("within"), Some(Json::Bool(true))),
            })
        })
        .collect()
}

/// Every `after` names a part of the same element.
fn check_named(parts: &[Part], own: Option<&Named>, path: &str) -> Result<(), String> {
    let names = parts
        .iter()
        .filter_map(|p| {
            p.named
                .as_ref()
                .map(|n| (format!("{path}.parts.{}", p.name), n))
        })
        .chain(own.map(|n| (path.to_string(), n)));
    for (at, n) in names {
        if let Some(from) = &n.after {
            if !parts.iter().any(|p| &p.name == from) {
                return Err(format!(
                    "{at}.name.after is \"{from}\", which is not one of its parts."
                ));
            }
        }
    }
    Ok(())
}

/// The attributes in `removed`, when present: the name and the note on what
/// to use instead.
fn removed(value: &Json, path: &str) -> Result<Vec<(String, String)>, String> {
    let Some(removed) = value.get("removed") else {
        return Ok(Vec::new());
    };
    let path = format!("{path}.removed");
    entries(removed, &path)?
        .iter()
        .map(|(name, note)| Ok((name.clone(), text(note, &format!("{path}.{name}"))?)))
        .collect()
}

/// Reads a manifest. The error message says what is wrong and where.
pub fn from_json(source: &str) -> Result<Vocabulary, String> {
    from_value(&parse(source)?)
}

/// The manifest with the fragments added.
///
/// A fragment has the same shape as the manifest, with the elements and
/// classes of one taken-over component, and is written by `lotek takeover`
/// next to the copy. A name that already exists is replaced.
pub fn with_fragments(base: &str, fragments: &[&str]) -> Result<Vocabulary, String> {
    from_value(&merged(base, fragments)?)
}

/// The manifest with the fragments added, as JSON.
pub fn merged(base: &str, fragments: &[&str]) -> Result<Json, String> {
    let mut root = parse(base)?;
    for fragment in fragments {
        let fragment = parse(fragment)?;
        let schema_version = field(&fragment, "schemaVersion", "The fragment")?
            .as_f64()
            .ok_or("schemaVersion must be a number.")? as u32;
        if schema_version != SCHEMA_VERSION {
            return Err(format!(
                "The fragment has schemaVersion {schema_version}, and this core understands {SCHEMA_VERSION}."
            ));
        }
        for section in ["elements", "classes"] {
            let Some(added) = fragment.get(section) else {
                continue;
            };
            let added = entries(added, section)?.to_vec();
            let Json::Object(root_entries) = &mut root else {
                return Err("The manifest must be an object.".into());
            };
            let Some((_, Json::Object(existing))) =
                root_entries.iter_mut().find(|(k, _)| k == section)
            else {
                return Err(format!("The manifest is missing \"{section}\"."));
            };
            for (name, value) in added {
                match existing.iter_mut().find(|(k, _)| *k == name) {
                    Some(entry) => entry.1 = value,
                    None => existing.push((name, value)),
                }
            }
        }
    }
    Ok(root)
}

fn from_value(root: &Json) -> Result<Vocabulary, String> {
    let schema_version = field(root, "schemaVersion", "The manifest")?
        .as_f64()
        .ok_or("schemaVersion must be a number.")? as u32;
    if schema_version != SCHEMA_VERSION {
        return Err(format!(
            "The manifest has schemaVersion {schema_version}, and this core understands {SCHEMA_VERSION}. Update the core and the manifest to the same version of LO-TEK."
        ));
    }
    let version = text(field(root, "version", "The manifest")?, "version")?;

    let mut elements = Vec::new();
    for (tag, element) in entries(field(root, "elements", "The manifest")?, "elements")? {
        let path = format!("elements.{tag}");
        let mut attributes = Vec::new();
        for (name, attribute) in entries(
            field(element, "attributes", &path)?,
            &format!("{path}.attributes"),
        )? {
            let attribute_path = format!("{path}.attributes.{name}");
            let kind = text(field(attribute, "type", &attribute_path)?, &attribute_path)?;
            let parsed = match kind.as_str() {
                "flag" => Attribute::Flag,
                "text" => Attribute::Text,
                "number" => Attribute::Number,
                "values" => Attribute::Values(texts(
                    field(attribute, "values", &attribute_path)?,
                    &attribute_path,
                )?),
                other => {
                    return Err(format!(
                        "{attribute_path} has the unknown type \"{other}\"."
                    ))
                }
            };
            attributes.push((name.clone(), parsed));
        }
        let element_parts = parts(element, &path)?;
        let element_named = named(element, &path)?;
        check_named(&element_parts, element_named.as_ref(), &path)?;
        elements.push(Element {
            tag: tag.clone(),
            link: text(field(element, "link", &path)?, &path)?,
            attributes,
            parts: element_parts,
            removed: removed(element, &path)?,
            named: element_named,
            texts: default_texts(element, &path)?,
        });
    }

    let mut classes = Vec::new();
    for (name, class) in entries(field(root, "classes", "The manifest")?, "classes")? {
        let path = format!("classes.{name}");
        let mut attributes = Vec::new();
        for (attribute_name, attribute) in entries(
            field(class, "attributes", &path)?,
            &format!("{path}.attributes"),
        )? {
            let attribute_path = format!("{path}.attributes.{attribute_name}");
            let flag = matches!(attribute.get("flag"), Some(Json::Bool(true)));
            attributes.push((
                attribute_name.clone(),
                ClassAttribute {
                    values: if flag {
                        Vec::new()
                    } else {
                        texts(
                            field(attribute, "values", &attribute_path)?,
                            &attribute_path,
                        )?
                    },
                    default_value: attribute
                        .get("default")
                        .map(|d| text(d, &attribute_path))
                        .transpose()?,
                    flag,
                },
            ));
        }
        classes.push(Class {
            name: name.clone(),
            title: text(field(class, "title", &path)?, &path)?,
            link: text(field(class, "link", &path)?, &path)?,
            attributes,
            parts: {
                let class_parts = parts(class, &path)?;
                check_named(&class_parts, named(class, &path)?.as_ref(), &path)?;
                class_parts
            },
            named: named(class, &path)?,
            texts: css_texts(class, &path)?,
        });
    }

    Ok(Vocabulary {
        version,
        schema_version,
        elements,
        classes,
        text_language: root
            .get("textLanguage")
            .map(|l| text(l, "textLanguage"))
            .transpose()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_a_fragment_to_the_manifest() {
        let base = test_text();
        let v = with_fragments(&base, &[r#"{"schemaVersion": 1, "version": "0", "elements": {"app-dialog": {"link": "", "attributes": {}}}, "classes": {"app-button": {"title": "Button", "link": "", "attributes": {}}}}"#]).unwrap();
        assert!(v.classes.iter().any(|c| c.name == "app-button"));
        assert!(
            v.classes.iter().any(|c| c.name == "lt-button"),
            "LO-TEK's own classes stay"
        );
        assert!(v.elements.iter().any(|e| e.tag == "app-dialog"));
        assert!(with_fragments(&base, &[r#"{"schemaVersion": 2}"#]).is_err());
    }

    #[test]
    fn reads_the_manifest_in_the_package() {
        let v = for_tests();
        assert!(v.elements.iter().any(|e| e.tag == "lt-field"));
        assert!(v.classes.iter().any(|c| c.name == "lt-button"));
    }

    #[test]
    fn reads_stable_id_and_removed() {
        let v = from_json(
            r#"{"schemaVersion": 1, "version": "0", "elements": {"lt-x": {"link": "", "attributes": {}, "parts": {"control": {"selector": "input", "stableId": true}, "help": {"selector": "p"}}, "removed": {"invalid": "Use a visible error text."}}}, "classes": {}}"#,
        )
        .unwrap();
        let element = &v.elements[0];
        assert!(element.parts[0].stable_id);
        assert!(!element.parts[1].stable_id);
        assert_eq!(
            element.removed,
            vec![(
                "invalid".to_string(),
                "Use a visible error text.".to_string()
            )]
        );

        let error = from_json(
            r#"{"schemaVersion": 1, "version": "0", "elements": {"lt-x": {"link": "", "attributes": {}, "removed": {"invalid": 1}}}, "classes": {}}"#,
        )
        .unwrap_err();
        assert!(error.contains("elements.lt-x.removed.invalid"), "{error}");
    }

    #[test]
    fn rejects_another_schema_version() {
        let error = from_json(r#"{"schemaVersion": 2}"#).unwrap_err();
        assert!(error.contains("schemaVersion 2"));
    }

    #[test]
    fn says_where_a_manifest_is_wrong() {
        let error = from_json(
            r#"{"schemaVersion": 1, "version": "0", "elements": {"lt-x": {"link": "", "attributes": {"a": {"type": "shade"}}}}, "classes": {}}"#,
        )
        .unwrap_err();
        assert!(error.contains("elements.lt-x.attributes.a"), "{error}");
    }
}
