//! What a taken-over component is called: the names `lotek takeover` gives a
//! copy, the fragment of the manifest it writes for it, and that the check
//! finds the copy by those names.
//!
//! The command line copies the files. The names are the core's, since the
//! check decides by the same rule which classes belong to a copy:
//! `app-button--primary` is `app-button`'s, and `app-button-row` is not.
//! Everything here goes through `lotek_core::takeover`, as the command line
//! does.

use lotek_core::json::{parse, Json};
use lotek_core::manifest::{self, with_fragments};
use lotek_core::takeover::{fragment, own_names, rename, renamed, PREFIX};
use lotek_core::text::utf16;

/// The manifest in the package.
fn package() -> String {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../interfaces/manifest/manifest.json"
    );
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// A manifest small enough to read: a box with a variant, a part and an
/// element, a row of boxes that is another component, and a line.
const SMALL: &str = r#"{"schemaVersion": 2, "version": "1.2.3",
  "elements": {
    "lt-x": {"link": "https://example.test/components/box/", "description": "Opens an `lt-box`.", "attributes": {}},
    "lt-y": {"link": "https://example.test/components/line/", "attributes": {}}},
  "classes": {
    "lt-box": {"component": "box", "title": "Box", "description": "Holds things. `lt-box--loud` shouts, and `lt-box-row` lines them up.", "link": "https://example.test/components/box/", "attributes": {}},
    "lt-box--loud": {"component": "box", "title": "Box", "link": "https://example.test/components/box/", "attributes": {}},
    "lt-box__part": {"component": "box", "title": "Box", "link": "https://example.test/components/box/", "attributes": {}},
    "lt-box-row": {"component": "box-row", "title": "Row of boxes", "link": "https://example.test/components/box-row/", "attributes": {}},
    "lt-line": {"component": "line", "title": "Line", "link": "https://example.test/components/line/", "attributes": {}}}}"#;

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|name| name.to_string()).collect()
}

fn keys(value: Option<&Json>) -> Vec<&str> {
    value
        .and_then(Json::as_object)
        .unwrap()
        .iter()
        .map(|(key, _)| key.as_str())
        .collect()
}

/// The classes the check does not know, in the markup, with this manifest.
fn unknown_classes(html: &str, vocabulary: &lotek_core::types::Vocabulary) -> Vec<String> {
    let text = utf16(html);
    lotek_core::diagnose_markup(&text, vocabulary)
        .into_iter()
        .filter(|finding| finding.rule == "unknown-class")
        .map(|finding| String::from_utf16_lossy(&text[finding.start..finding.end]))
        .collect()
}

#[test]
fn the_copy_gets_app_where_lotek_has_lt() {
    assert_eq!(PREFIX, "app-");
    assert_eq!(renamed("lt-button"), "app-button");
    assert_eq!(renamed("lt-avatar-stack"), "app-avatar-stack");
    // Only a name of LO-TEK's has another name to get.
    assert_eq!(renamed("button"), "button");
    assert_eq!(renamed("xlt-button"), "xlt-button");
    assert_eq!(renamed("app-button"), "app-button");
    assert_eq!(renamed(""), "");
}

#[test]
fn a_component_owns_the_blocks_of_its_classes_and_its_element() {
    let manifest = parse(&package()).unwrap();
    // Classes in two blocks, and no element.
    assert_eq!(
        own_names(&manifest, "avatar"),
        ["lt-avatar", "lt-avatar-stack"]
    );
    // One class.
    assert_eq!(own_names(&manifest, "button"), ["lt-button"]);
    // Six classes in one block, and the element of the same name: once.
    assert_eq!(own_names(&manifest, "dialog"), ["lt-dialog"]);
    // No class is the block itself: `lt-tabs__list` and `lt-tabs__panel`.
    assert_eq!(own_names(&manifest, "tabs"), ["lt-tabs"]);

    let small = parse(SMALL).unwrap();
    // The element is found by the page its link leads to, not by its name,
    // and the names come sorted.
    assert_eq!(own_names(&small, "box"), ["lt-box", "lt-x"]);
    assert_eq!(own_names(&small, "line"), ["lt-line", "lt-y"]);
    // `box-row` is another component, with its own page.
    assert_eq!(own_names(&small, "box-row"), ["lt-box-row"]);
}

#[test]
fn a_component_the_manifest_names_nothing_for_is_called_by_its_folder() {
    let manifest = parse(&package()).unwrap();
    assert_eq!(own_names(&manifest, "made-up"), ["lt-made-up"]);
    assert_eq!(own_names(&parse("{}").unwrap(), "box"), ["lt-box"]);
    assert_eq!(
        own_names(&parse(r#"{"classes": [], "elements": 3}"#).unwrap(), "box"),
        ["lt-box"]
    );
    // A link that only has the page somewhere in it is not that page.
    let elsewhere = parse(
        r#"{"elements": {"lt-x": {"link": "https://example.test/components/box/more/", "attributes": {}}}}"#,
    )
    .unwrap();
    assert_eq!(own_names(&elsewhere, "box"), ["lt-box"]);
}

#[test]
fn renames_its_own_names_and_nothing_else() {
    let avatar = names(&["lt-avatar", "lt-avatar-stack"]);
    // A name alone, with a variant and with a part. `lt-avatar-group` is
    // another component, and `--lt-avatar-bg` a variable from the theme.
    assert_eq!(
        rename(
            ".lt-avatar, .lt-avatar--small, .lt-avatar__image, .lt-avatar-stack { color: var(--lt-avatar-bg); } .lt-avatar-group, .xfs-avatar",
            &avatar
        ),
        ".app-avatar, .app-avatar--small, .app-avatar__image, .app-avatar-stack { color: var(--lt-avatar-bg); } .lt-avatar-group, .xfs-avatar"
    );
    assert_eq!(
        rename(
            "customElements.define(\"lt-dialog\", LtDialog); `lt-dialog--${color}`",
            &names(&["lt-dialog"])
        ),
        "customElements.define(\"app-dialog\", LtDialog); `app-dialog--${color}`"
    );
    // At the very start and the very end, and nothing but the name.
    assert_eq!(rename("lt-avatar", &avatar), "app-avatar");
    assert_eq!(
        rename("lt-avatar lt-avatar", &avatar),
        "app-avatar app-avatar"
    );
    // One hyphen or one underscore after it makes it another name.
    assert_eq!(
        rename(
            "lt-avatar- lt-avatar_x lt-avatars xlt-avatar _lt-avatar",
            &avatar
        ),
        "lt-avatar- lt-avatar_x lt-avatars xlt-avatar _lt-avatar"
    );
    assert_eq!(rename("", &avatar), "");
    assert_eq!(rename("lt-avatar", &[]), "lt-avatar");
}

#[test]
fn renames_a_name_next_to_text_that_is_not_ascii() {
    let avatar = names(&["lt-avatar"]);
    assert_eq!(
        rename(
            "«lt-avatar» på blåbær 🫐lt-avatar__bilde. Ålt-avatar ålt-avatar–",
            &avatar
        ),
        "«app-avatar» på blåbær 🫐app-avatar__bilde. Åapp-avatar åapp-avatar–"
    );
}

#[test]
fn the_fragment_is_the_components_part_of_the_manifest_under_the_new_names() {
    let manifest = parse(SMALL).unwrap();
    let own = own_names(&manifest, "box");
    let written = fragment(&manifest, "box", &own);

    assert_eq!(
        keys(Some(&written)),
        [
            "schemaVersion",
            "version",
            "component",
            "elements",
            "classes"
        ]
    );
    // Written in the version this core writes, not the oldest one it reads.
    assert_eq!(
        written.get("schemaVersion"),
        Some(&Json::Number(f64::from(manifest::SCHEMA_VERSION)))
    );
    assert_eq!(written.get("version"), Some(&Json::String("1.2.3".into())));
    assert_eq!(written.get("component"), Some(&Json::String("box".into())));
    // The keys have the new names, and what belongs to another component
    // is not there.
    assert_eq!(keys(written.get("elements")), ["app-x"]);
    assert_eq!(
        keys(written.get("classes")),
        ["app-box", "app-box--loud", "app-box__part"]
    );
    // And the texts inside: the component's own names are the new ones,
    // and another component's is left as it is.
    let text = |section: &str, name: &str| {
        written
            .get(section)
            .and_then(|s| s.get(name)?.get("description")?.as_str())
            .map(str::to_string)
    };
    assert_eq!(
        text("elements", "app-x").as_deref(),
        Some("Opens an `app-box`.")
    );
    assert_eq!(
        text("classes", "app-box").as_deref(),
        Some("Holds things. `app-box--loud` shouts, and `lt-box-row` lines them up.")
    );
    // Nothing of the component's own is left under the old name.
    let pretty = written.to_pretty();
    assert_eq!(rename(&pretty, &own), pretty);
}

#[test]
fn the_fragment_of_a_component_in_the_package_is_a_manifest_the_core_can_read() {
    let text = package();
    let manifest = parse(&text).unwrap();
    let own = own_names(&manifest, "dialog");
    let written = fragment(&manifest, "dialog", &own).to_pretty();
    assert_eq!(
        parse(&written).unwrap().get("schemaVersion"),
        Some(&Json::Number(2.0))
    );
    let vocabulary = with_fragments(&text, &[&written]).unwrap();
    assert!(vocabulary.elements.iter().any(|e| e.tag == "app-dialog"));
    for class in ["app-dialog", "app-dialog__title", "app-dialog__footer"] {
        assert!(
            vocabulary.classes.iter().any(|c| c.name == class),
            "{class}"
        );
    }
    // LO-TEK's own stay beside the copy.
    assert!(vocabulary.classes.iter().any(|c| c.name == "lt-dialog"));
    // No name of the component's own is left. `lt-dialog-title` is not
    // one: it is what the ids the copy creates begin with, and the copy
    // still creates them, so the fragment still says so.
    assert_eq!(rename(&written, &own), written);
    let taken = vocabulary.elements.iter().find(|e| e.tag == "app-dialog");
    assert_eq!(taken.unwrap().generated_ids, ["lt-dialog-title"]);
}

#[test]
fn every_component_with_a_class_gets_a_fragment_the_core_can_read() {
    let text = package();
    let manifest = parse(&text).unwrap();
    let mut components: Vec<&str> = manifest
        .get("classes")
        .and_then(Json::as_object)
        .unwrap()
        .iter()
        .filter_map(|(_, class)| class.get("component")?.as_str())
        .collect();
    components.sort_unstable();
    components.dedup();
    assert!(components.len() > 30, "{} components", components.len());
    for component in components {
        let own = own_names(&manifest, component);
        assert!(own.iter().all(|name| name.starts_with("lt-")), "{own:?}");
        let written = fragment(&manifest, component, &own).to_pretty();
        let vocabulary = with_fragments(&text, &[&written])
            .unwrap_or_else(|e| panic!("the fragment of {component}: {e}"));
        // Every name the component owns that the manifest describes is
        // there under its new name.
        let described = |name: &str| {
            vocabulary.classes.iter().any(|c| c.name == name)
                || vocabulary.elements.iter().any(|e| e.tag == name)
                || vocabulary
                    .classes
                    .iter()
                    .any(|c| c.name.starts_with(&format!("{name}__")))
        };
        for name in &own {
            assert!(described(&renamed(name)), "{component}: {}", renamed(name));
        }
    }
}

#[test]
fn the_check_finds_a_copy_by_the_names_it_was_given() {
    // The agreement the names are in the core for: a variant and a part of
    // a copy belong to the copy, in the naming and in the check alike.
    let manifest = parse(SMALL).unwrap();
    let own = own_names(&manifest, "box");
    let written = fragment(&manifest, "box", &own).to_pretty();
    let vocabulary = with_fragments(SMALL, &[&written]).unwrap();

    let right = rename(
        r#"<div class="lt-box lt-box--loud"><span class="lt-box__part">x</span></div>"#,
        &own,
    );
    assert_eq!(
        right,
        r#"<div class="app-box app-box--loud"><span class="app-box__part">x</span></div>"#
    );
    assert_eq!(unknown_classes(&right, &vocabulary), Vec::<String>::new());

    // A variant and a part the copy does not have are the copy's mistakes.
    assert_eq!(
        unknown_classes(
            r#"<div class="app-box app-box--lod"><span class="app-box__prt">x</span></div>"#,
            &vocabulary
        ),
        ["app-box--lod", "app-box__prt"]
    );
    // What only looks like it is the project's own business, as it is to
    // `rename`: one hyphen makes another name.
    let others = r#"<div class="app-box-row app-boxes app-other">x</div>"#;
    assert_eq!(
        rename(&others.replace("app-", "lt-"), &own),
        others.replace("app-", "lt-")
    );
    assert_eq!(unknown_classes(others, &vocabulary), Vec::<String>::new());
    // Without the fragment the check has nothing to say about the copy.
    let without = manifest::from_json(SMALL).unwrap();
    assert_eq!(
        unknown_classes(r#"<div class="app-box--lod">x</div>"#, &without),
        Vec::<String>::new()
    );
}

#[test]
fn a_part_of_a_copy_from_the_package_is_known_and_a_misspelt_one_is_not() {
    let text = package();
    let manifest = parse(&text).unwrap();
    let own = own_names(&manifest, "dialog");
    let written = fragment(&manifest, "dialog", &own).to_pretty();
    let vocabulary = with_fragments(&text, &[&written]).unwrap();
    assert_eq!(
        unknown_classes(r#"<h2 class="app-dialog__title">x</h2>"#, &vocabulary),
        Vec::<String>::new()
    );
    assert_eq!(
        unknown_classes(r#"<h2 class="app-dialog__titel">x</h2>"#, &vocabulary),
        ["app-dialog__titel"]
    );
}
