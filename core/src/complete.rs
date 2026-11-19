//! What an editor suggests while the template is written, and what it says
//! about a class under the pointer.
//!
//! The same vocabulary the check reads, asked from the other side: not "is
//! this class one of ours" but "which classes are there to write here".
//! The language server answers `textDocument/completion` and
//! `textDocument/hover` with what these give.

use crate::text::lossy;
use crate::types::*;

/// How far back and forth to read for the tag the cursor is in. A tag is
/// shorter, and the answer does not grow with the file.
const WINDOW: usize = 4000;

/// The tag the cursor is in.
struct Tag {
    /// From `<` to the cursor.
    before: Vec<char>,
    /// From the cursor to `>`, empty when the tag is not closed within the window.
    after: Vec<char>,
}

/// Where the tag that begins before `from` ends, or `None` when it is not
/// closed. `>` in a quoted value, and in `<?…?>` and `<%…%>`, does not end it.
fn tag_end(text: &[char], from: usize) -> Option<usize> {
    let mut quote: Option<char> = None;
    let mut i = from;
    while i < text.len() {
        let c = text[i];
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
        } else if c == '"' || c == '\'' {
            quote = Some(c);
        } else if c == '<' && matches!(text.get(i + 1), Some('?' | '%')) {
            let closer = text[i + 1];
            let end = (i + 2..text.len().saturating_sub(1))
                .find(|&j| text[j] == closer && text[j + 1] == '>')?;
            i = end + 1;
        } else if c == '>' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// The quote the text ends inside, if any.
fn open_quote(text: &[char]) -> Option<char> {
    let mut quote = None;
    for &c in text {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == '"' || c == '\'' => quote = Some(c),
            None => {}
        }
    }
    quote
}

fn tag_at(text: &[u16], offset: usize) -> Option<Tag> {
    let offset = offset.min(text.len());
    let window: Vec<char> = lossy(&text[offset.saturating_sub(WINDOW)..offset])
        .chars()
        .collect();
    let start = window.iter().rposition(|&c| c == '<')?;
    let before = window[start..].to_vec();
    // A `>` inside a value, like `x-show="n > 0"`, does not end the tag.
    if tag_end(&before, 1).is_some() {
        return None;
    }
    let rest: Vec<char> = lossy(&text[offset..(offset + WINDOW).min(text.len())])
        .chars()
        .collect();
    // If the cursor is inside a value, that value is closed first; otherwise
    // the parity flips and a `"` in a later tag is read as an opening.
    let end = match open_quote(&before) {
        Some(quote) => rest
            .iter()
            .position(|&c| c == quote)
            .and_then(|from| tag_end(&rest, from + 1)),
        None => tag_end(&rest, 0),
    };
    let after = end.map_or_else(Vec::new, |end| rest[..end].to_vec());
    Some(Tag { before, after })
}

/// Skips whitespace, an equals sign and whitespace from `at`, and says
/// where the value begins.
fn after_equals(text: &[char], mut at: usize) -> Option<usize> {
    while text.get(at).is_some_and(|c| c.is_whitespace()) {
        at += 1;
    }
    if text.get(at) != Some(&'=') {
        return None;
    }
    at += 1;
    while text.get(at).is_some_and(|c| c.is_whitespace()) {
        at += 1;
    }
    Some(at)
}

/// Where `class` or `:class` stands as an attribute name of its own, and
/// where the name ends. `bound` asks for the one with the colon.
fn class_names(text: &[char], bound: Option<bool>) -> impl Iterator<Item = usize> + '_ {
    const NAME: [char; 5] = ['c', 'l', 'a', 's', 's'];
    (0..text.len()).filter_map(move |i| {
        if i > 0 && !text[i - 1].is_whitespace() {
            return None;
        }
        let colon = text[i] == ':';
        if bound.is_some_and(|b| b != colon) {
            return None;
        }
        let at = i + usize::from(colon);
        let name = text.get(at..at + NAME.len())?;
        name.iter()
            .zip(NAME)
            .all(|(c, n)| c.to_ascii_lowercase() == n)
            .then_some(at + NAME.len())
    })
}

/// Whether the cursor is inside the value of `class`.
fn in_class_value(tag: &Tag) -> bool {
    let text = &tag.before;
    class_names(text, None).any(|end| {
        let Some(at) = after_equals(text, end) else {
            return false;
        };
        let rest = &text[at..];
        match rest.first() {
            Some(&q @ ('"' | '\'')) if !rest[1..].contains(&q) => true,
            _ => !rest
                .iter()
                .any(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '>')),
        }
    })
}

/// The classes on the tag, before and after the cursor. `class` takes
/// precedence over `:class`.
fn classes_in(tag: &Tag) -> Vec<String> {
    let text: Vec<char> = tag.before.iter().chain(&tag.after).copied().collect();
    let value = |bound: bool| {
        class_names(&text, Some(bound)).find_map(|end| {
            let rest = &text[after_equals(&text, end)?..];
            match rest.first() {
                Some(&q @ ('"' | '\'')) => {
                    let close = rest[1..].iter().position(|&c| c == q)?;
                    Some(rest[1..=close].to_vec())
                }
                _ => {
                    let end = rest
                        .iter()
                        .position(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '>'))
                        .unwrap_or(rest.len());
                    (end > 0).then(|| rest[..end].to_vec())
                }
            }
        })
    };
    value(false)
        .or_else(|| value(true))
        .map(|v| {
            v.iter()
                .collect::<String>()
                .split_whitespace()
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// The attribute whose value the cursor is in, in lower case: a name, an
/// equals sign, and then nothing that ends a value before the cursor.
fn value_of(tag: &Tag) -> Option<String> {
    let text = &tag.before;
    let in_name = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '-');
    (0..text.len()).find_map(|i| {
        if !text[i].is_ascii_alphabetic() {
            return None;
        }
        let mut end = i + 1;
        while text.get(end).is_some_and(|&c| in_name(c)) {
            end += 1;
        }
        let mut at = after_equals(text, end)?;
        if matches!(text.get(at), Some('"' | '\'')) {
            at += 1;
        }
        text[at..]
            .iter()
            .all(|c| !matches!(c, '"' | '\'' | '>'))
            .then(|| text[i..end].iter().collect::<String>().to_lowercase())
    })
}

/// The `<lt-…>` element the tag is, in lower case, once its name is written.
fn element_of(tag: &Tag) -> Option<String> {
    let name: String = tag.before[1..]
        .iter()
        .take_while(|c| c.is_ascii_alphanumeric() || **c == '-')
        .collect();
    let ended = tag
        .before
        .get(1 + name.chars().count())
        .is_some_and(|c| c.is_whitespace() || *c == '/');
    let name = name.to_lowercase();
    (ended && name.len() > 3 && name.starts_with("lt-")).then_some(name)
}

/// The word the cursor is in or beside, as UTF-16 indices: letters, digits,
/// `_` and `-`.
fn word_at(text: &[u16], offset: usize) -> (usize, usize) {
    let in_word = |u: u16| {
        char::from_u32(u32::from(u))
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    };
    let offset = offset.min(text.len());
    let mut start = offset;
    while start > 0 && in_word(text[start - 1]) {
        start -= 1;
    }
    let mut end = offset;
    while end < text.len() && in_word(text[end]) {
        end += 1;
    }
    (start, end)
}

/// What an editor shows about a class: the component, what it is, the
/// attributes it takes and the link, as Markdown.
fn class_documentation(class: &Class) -> String {
    let takes: Vec<String> = class
        .attributes
        .iter()
        .map(|(name, a)| {
            if a.flag {
                format!("`{name}`: flag, takes effect by being present")
            } else {
                let default = a
                    .default_value
                    .as_ref()
                    .map_or_else(String::new, |d| format!(" ({d} without the attribute)"));
                format!("`{name}`: {}{default}", a.values.join(", "))
            }
        })
        .collect();
    let takes = if takes.is_empty() {
        String::new()
    } else {
        format!("{}\n\n", takes.join("  \n"))
    };
    // A manifest written by hand may say nothing about what the class is.
    let description = if class.description.is_empty() {
        String::new()
    } else {
        format!(" · {}", class.description)
    };
    format!(
        "**{}**{description}\n\n{takes}[Documentation]({})",
        class.title, class.link
    )
}

/// What there is to write where the cursor is, at the UTF-16 index
/// `offset`. `html` is a file in a language the editor has a service of its
/// own in for the `<lt-…>` elements and their attributes, as VS Code has for
/// HTML and Handlebars from `html-data.json`: there they are left out.
pub fn complete(
    text: &[u16],
    offset: usize,
    html: bool,
    vocabulary: &Vocabulary,
) -> Vec<Suggestion> {
    let Some(tag) = tag_at(text, offset) else {
        return Vec::new();
    };
    let (start, end) = word_at(text, offset);
    if in_class_value(&tag) {
        return vocabulary
            .classes
            .iter()
            .map(|class| Suggestion {
                label: class.name.clone(),
                kind: SuggestionKind::Class,
                detail: Some(class.title.clone()),
                documentation: Some(class_documentation(class)),
                start,
                end,
            })
            .collect();
    }
    let suggestion = |label: &str, kind, detail: String| Suggestion {
        label: label.to_string(),
        kind,
        detail: Some(detail),
        documentation: None,
        start,
        end,
    };
    let element = (!html)
        .then(|| element_of(&tag))
        .flatten()
        .and_then(|name| vocabulary.elements.iter().find(|e| e.tag == name));

    // The values of an attribute: one a class on the tag takes, or one an
    // `<lt-…>` element takes outside HTML.
    if let Some(attribute) = value_of(&tag) {
        let mut found = Vec::new();
        for name in classes_in(&tag) {
            let Some(class) = vocabulary.classes.iter().find(|c| c.name == name) else {
                continue;
            };
            // A flag has no values to suggest.
            let Some((_, takes)) = class
                .attributes
                .iter()
                .find(|(a, takes)| *a == attribute && !takes.flag)
            else {
                continue;
            };
            for value in &takes.values {
                found.push(suggestion(
                    value,
                    SuggestionKind::Value,
                    format!("{attribute} on {}", class.title),
                ));
            }
            if let Some(default) = &takes.default_value {
                found.push(suggestion(
                    default,
                    SuggestionKind::Value,
                    format!("default: the same as no {attribute}"),
                ));
            }
        }
        if let Some(element) = element {
            if let Some((_, Attribute::Values(values))) =
                element.attributes.iter().find(|(a, _)| *a == attribute)
            {
                for value in values {
                    found.push(suggestion(
                        value,
                        SuggestionKind::Value,
                        format!("{attribute} on <{}>", element.tag),
                    ));
                }
            }
        }
        return found;
    }

    // Outside HTML there is no HTML service, so the elements and their
    // attributes are completed here.
    if html {
        return Vec::new();
    }
    let writing_element = tag.before.len() >= 4
        && tag.before[1..4]
            .iter()
            .map(char::to_ascii_lowercase)
            .eq("lt-".chars())
        && tag.before[4..]
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || *c == '-');
    if writing_element {
        return vocabulary
            .elements
            .iter()
            .map(|element| Suggestion {
                label: element.tag.clone(),
                kind: SuggestionKind::Element,
                detail: None,
                documentation: Some(format!("[Documentation]({})", element.link)),
                start,
                end,
            })
            .collect();
    }
    // Attribute names: the cursor is in the tag, outside quotes.
    match element {
        Some(element) if open_quote(&tag.before).is_none() => element
            .attributes
            .iter()
            .map(|(name, attribute)| {
                let detail = match attribute {
                    Attribute::Flag => "flag".to_string(),
                    Attribute::Text => "text".to_string(),
                    Attribute::Number => "number".to_string(),
                    Attribute::Values(values) => values.join(" | "),
                };
                suggestion(name, SuggestionKind::Attribute, detail)
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// What there is to say about the word at the UTF-16 index `offset`: an
/// `lt-` class, when it stands in a class attribute.
pub fn hover(text: &[u16], offset: usize, vocabulary: &Vocabulary) -> Option<Hover> {
    let (start, end) = word_at(text, offset);
    let word = lossy(&text[start..end]);
    let class = vocabulary.classes.iter().find(|c| c.name == word)?;
    // Only in a class attribute: "use lt-button here" in running text is text.
    in_class_value(&tag_at(text, start)?).then(|| Hover {
        text: class_documentation(class),
        start,
        end,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest;
    use crate::text::utf16;

    /// Two classes and one element, as small as a manifest gets.
    fn small() -> Vocabulary {
        manifest::from_json(
            r#"{"schemaVersion": 1, "version": "0", "elements": {
              "lt-x": {"link": "https://example.test/x/", "attributes": {
                "open": {"type": "flag"}, "placement": {"type": "values", "values": ["top", "bottom"]}, "label": {"type": "text"}}}},
              "classes": {
              "lt-box": {"title": "Box", "description": "Holds things.", "link": "https://example.test/box/", "attributes": {
                "data-variant": {"values": ["quiet", "loud"], "default": "plain"},
                "data-wide": {"flag": true}}},
              "lt-line": {"title": "Line", "description": "Divides.", "link": "https://example.test/line/", "attributes": {}}}}"#,
        )
        .unwrap()
    }

    /// The suggestions where `|` stands in the markup.
    fn at(marked: &str, html: bool) -> Vec<Suggestion> {
        let offset = utf16(marked.split('|').next().unwrap()).len();
        complete(&utf16(&marked.replace('|', "")), offset, html, &small())
    }

    fn labels(found: &[Suggestion]) -> Vec<&str> {
        found.iter().map(|s| s.label.as_str()).collect()
    }

    #[test]
    fn the_classes_inside_a_class_attribute() {
        let found = at(r#"<div class="lt-|"></div>"#, true);
        assert_eq!(labels(&found), ["lt-box", "lt-line"]);
        let box_ = &found[0];
        assert_eq!(box_.kind, SuggestionKind::Class);
        assert_eq!(box_.detail.as_deref(), Some("Box"));
        assert_eq!(
            box_.documentation.as_deref(),
            Some("**Box** · Holds things.\n\n`data-variant`: quiet, loud (plain without the attribute)  \n`data-wide`: flag, takes effect by being present\n\n[Documentation](https://example.test/box/)")
        );
        assert_eq!(
            found[1].documentation.as_deref(),
            Some("**Line** · Divides.\n\n[Documentation](https://example.test/line/)")
        );
        // The word under the cursor is what the suggestion replaces.
        assert_eq!((box_.start, box_.end), (12, 15));
    }

    #[test]
    fn a_class_attribute_in_any_writing() {
        for markup in [
            "<div class='lt-|'>",
            "<div class=lt-|",
            r#"<div :class="lt-|">"#,
            r#"<div id="a" CLASS = "lt-line lt-|"#,
            "<div\n  class=\"|\"",
        ] {
            assert_eq!(labels(&at(markup, true)), ["lt-box", "lt-line"], "{markup}");
        }
    }

    #[test]
    fn nothing_outside_a_tag_or_after_it_closed() {
        for markup in [
            "lt-|",
            r#"<div class="lt-box">lt-|"#,
            r#"<p x-show="n > 0">class="|"#,
            r#"<div data-class="lt-|">"#,
        ] {
            assert!(at(markup, true).is_empty(), "{markup}");
        }
    }

    #[test]
    fn a_greater_than_inside_a_value_does_not_end_the_tag() {
        let found = at(r#"<div x-show="n > 0" class="|">"#, true);
        assert_eq!(labels(&found), ["lt-box", "lt-line"]);
    }

    fn with_details(found: &[Suggestion]) -> Vec<(&str, &str)> {
        found
            .iter()
            .map(|s| (s.label.as_str(), s.detail.as_deref().unwrap_or("")))
            .collect()
    }

    #[test]
    fn the_values_an_attribute_takes_from_a_class_on_the_tag() {
        let found = at(r#"<div class="lt-line lt-box" data-variant="|">"#, true);
        assert_eq!(
            with_details(&found),
            [
                ("quiet", "data-variant on Box"),
                ("loud", "data-variant on Box"),
                ("plain", "default: the same as no data-variant"),
            ]
        );
        assert!(found.iter().all(|s| s.kind == SuggestionKind::Value));
        assert!(found.iter().all(|s| s.documentation.is_none()));
    }

    #[test]
    fn the_class_may_stand_after_the_cursor_and_be_bound() {
        for markup in [
            r#"<div data-variant="qu|" class="lt-box">"#,
            r#"<div DATA-VARIANT='|' :class="lt-box">"#,
            r#"<div data-variant=| class=lt-box>"#,
        ] {
            assert_eq!(
                labels(&at(markup, true)),
                ["quiet", "loud", "plain"],
                "{markup}"
            );
        }
        // The written-out class wins over the bound one.
        let both = r#"<div :class="lt-box" class="lt-line" data-variant="|">"#;
        assert!(at(both, true).is_empty());
    }

    #[test]
    fn no_values_for_a_flag_or_an_attribute_no_class_on_the_tag_takes() {
        for markup in [
            r#"<div class="lt-box" data-wide="|">"#,
            r#"<div class="lt-line" data-variant="|">"#,
            r#"<div class="lt-box" data-size="|">"#,
            r#"<div data-variant="|">"#,
        ] {
            assert!(at(markup, true).is_empty(), "{markup}");
        }
    }

    #[test]
    fn the_values_of_an_element_outside_html() {
        let markup = r#"<lt-x placement="|">"#;
        assert_eq!(
            with_details(&at(markup, false)),
            [
                ("top", "placement on <lt-x>"),
                ("bottom", "placement on <lt-x>")
            ]
        );
        assert!(at(markup, true).is_empty());
        assert!(at(r#"<lt-x label="|">"#, false).is_empty());
        assert!(at(r#"<LT-X PLACEMENT="|">"#, false).len() == 2);
    }

    #[test]
    fn the_elements_outside_html_once_their_prefix_is_written() {
        let found = at("<section><lt-|", false);
        assert_eq!(labels(&found), ["lt-x"]);
        assert_eq!(found[0].kind, SuggestionKind::Element);
        assert_eq!(found[0].detail, None);
        assert_eq!(
            found[0].documentation.as_deref(),
            Some("[Documentation](https://example.test/x/)")
        );
        assert_eq!(labels(&at("<LT-x|", false)), ["lt-x"]);
        // In HTML the editor's own service completes them, from html-data.json.
        assert!(at("<lt-|", true).is_empty());
        assert!(at("<l|", false).is_empty());
        assert!(at("<div lt-|", false).is_empty());
    }

    #[test]
    fn the_attributes_of_an_element_outside_html() {
        for markup in [
            "<lt-x |",
            r#"<lt-x open placement="top" la|"#,
            "<lt-x\n  |>",
        ] {
            let found = at(markup, false);
            assert_eq!(
                with_details(&found),
                [
                    ("open", "flag"),
                    ("placement", "top | bottom"),
                    ("label", "text")
                ],
                "{markup}"
            );
            assert!(found.iter().all(|s| s.kind == SuggestionKind::Attribute));
        }
        assert!(at("<lt-x |", true).is_empty());
        assert!(at("<lt-unknown |", false).is_empty());
        assert!(at("<div |", false).is_empty());
        // The name is not finished, so it is an element still being written.
        assert_eq!(labels(&at("<lt-x|", false)), ["lt-x"]);
    }

    fn hover_at(marked: &str) -> Option<Hover> {
        let offset = utf16(marked.split('|').next().unwrap()).len();
        hover(&utf16(&marked.replace('|', "")), offset, &small())
    }

    #[test]
    fn a_class_in_a_class_attribute_says_what_it_is() {
        let found = hover_at(r#"<div class="lt-line lt-b|ox">"#).unwrap();
        assert_eq!(
            found.text,
            "**Box** · Holds things.\n\n`data-variant`: quiet, loud (plain without the attribute)  \n`data-wide`: flag, takes effect by being present\n\n[Documentation](https://example.test/box/)"
        );
        assert_eq!((found.start, found.end), (20, 26));
        // At either end of the word too.
        assert!(hover_at(r#"<div class="|lt-box">"#).is_some());
        assert!(hover_at(r#"<div class="lt-box|">"#).is_some());
    }

    #[test]
    fn nothing_is_said_about_other_words() {
        for markup in [
            // "Use lt-box here" in running text is text.
            "<p>Use lt-b|ox here</p>",
            r#"<div title="lt-b|ox">"#,
            r#"<div class="lt-unk|nown">"#,
            r#"<div cl|ass="lt-box">"#,
            r#"<lt-|x class="lt-box">"#,
        ] {
            assert!(hover_at(markup).is_none(), "{markup}");
        }
    }

    #[test]
    fn a_class_the_manifest_does_not_describe_is_said_by_its_title_alone() {
        let vocabulary = manifest::from_json(
            r#"{"schemaVersion": 1, "version": "0", "elements": {}, "classes": {
              "app-box": {"title": "Box", "link": "https://example.test/box/", "attributes": {}}}}"#,
        )
        .unwrap();
        let found = hover(&utf16(r#"<div class="app-box">"#), 14, &vocabulary).unwrap();
        assert_eq!(
            found.text,
            "**Box**\n\n[Documentation](https://example.test/box/)"
        );
    }
}
