//! That the contract holds, and that the check that should speak up actually
//! does.
//!
//! The promises are guaranteed by construction and not by an adjustment
//! pass, so the tests here are the whole guarantee. If one of the numbers in
//! `color-contract.json` breaks, these are the ones that must turn red. They
//! were `contract.browser.test.ts` while the theme was written in TypeScript,
//! and the assertions are the same.

use super::check::{inspect_theme, parse_blocks, verdict, ParsedBlock, Report};
use super::color::{contrast_ratio, parse_hex, rgb_to_oklch};
use super::contract::{
    build_family, build_matrix, check_promises, contract, promises_for, role, role_to_css,
    Appearance, Family, Layers,
};

const APPEARANCES: [Appearance; 2] = [Appearance::Light, Appearance::Dark];

fn brands_with(changes: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut brands = contract().brands.clone();
    for (name, value) in changes {
        brands.iter_mut().find(|(n, _)| n == name).unwrap().1 = value.to_string();
    }
    brands
}

fn brand(name: &str) -> String {
    contract()
        .brands
        .iter()
        .find(|(n, _)| n == name)
        .unwrap()
        .1
        .clone()
}

fn tokens(appearance: Appearance) -> Vec<(String, String)> {
    build_matrix(&contract().brands, appearance).unwrap().tokens
}

fn white_layers() -> Layers {
    Layers {
        canvas: "#ffffff".into(),
        surface: "#f1f2f3".into(),
        raised: "#e4e4e5".into(),
    }
}

fn with(family: &Family, role_name: &str, value: &str) -> Family {
    family
        .iter()
        .map(|(r, v)| {
            (
                r.clone(),
                if r == role_name {
                    value.into()
                } else {
                    v.clone()
                },
            )
        })
        .collect()
}

fn declarations(tokens: &[(String, String)]) -> String {
    tokens
        .iter()
        .map(|(n, v)| format!("{n}: {v};"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn as_css(appearance: Appearance, selector: &str) -> String {
    format!(
        "{selector} {{\n  color-scheme: {};\n  {}\n}}",
        appearance.key(),
        declarations(&tokens(appearance))
    )
}

fn messages(report: &Report) -> Vec<&str> {
    report.problems.iter().map(|p| p.message.as_str()).collect()
}

fn declared<'a>(block: &'a ParsedBlock, name: &str) -> Option<&'a str> {
    block
        .declarations
        .iter()
        .find(|(n, _)| n == name)
        .map(|(_, v)| v.as_str())
}

fn role_count() -> usize {
    contract().roles.len()
}

fn family_count() -> usize {
    contract().families.len()
}

// LO-TEK's own theme.

#[test]
fn loteks_own_theme_keeps_every_promise() {
    for appearance in APPEARANCES {
        let matrix = build_matrix(&contract().brands, appearance).unwrap();
        assert!(
            matrix.violations.is_empty(),
            "{appearance:?}: {:?}",
            matrix.violations
        );
    }
}

#[test]
fn has_every_family_with_every_role() {
    for appearance in APPEARANCES {
        let tokens = tokens(appearance);
        assert_eq!(tokens.len(), family_count() * role_count() + 2);
        for family in &contract().families {
            for (r, _) in &contract().roles {
                let name = format!("--lt-color-{family}-{}", role_to_css(r));
                let value = &tokens.iter().find(|(n, _)| *n == name).unwrap().1;
                assert!(
                    value.len() == 7 && value.starts_with('#'),
                    "{name}: {value}"
                );
            }
        }
    }
}

// The contract must hold for any hue, not only for ours. The extreme ones
// are included on purpose: neon and magenta are where sRGB behaves worst.
// The neutral one is varied too, from black and white to tinted grey, since
// the surfaces and the text in the other roles sit on it.

#[test]
fn keeps_the_promises_for_any_neutral_and_hue() {
    let neutrals = [
        "#24272b", "#000000", "#ffffff", "#808080", "#1e3a5f", "#5b3fa0", "#8a5a00", "#3b2f2f",
        "#2e5a3a", "#c0c0c0",
    ];
    let accents = [
        "#ff0000", "#ff8800", "#ffd600", "#39ff14", "#00e676", "#00bcd4", "#0062ba", "#5b3fa0",
        "#ff00ff", "#ff2d6f", "#8a5a00", "#24272b",
    ];
    let mut checked = 0;
    let mut broken = Vec::new();
    for appearance in APPEARANCES {
        for neutral in neutrals {
            for accent in accents {
                let brands = brands_with(&[("accent", accent), ("neutral", neutral)]);
                match build_matrix(&brands, appearance) {
                    Ok(matrix) if matrix.violations.is_empty() => {}
                    Ok(matrix) => broken.push(format!(
                        "{neutral} x {accent} {appearance:?}: {:?}",
                        matrix.violations
                    )),
                    Err(error) => {
                        broken.push(format!("{neutral} x {accent} {appearance:?}: {error}"))
                    }
                }
                checked += 1;
            }
        }
    }
    assert_eq!(checked, 2 * neutrals.len() * accents.len());
    assert!(
        broken.is_empty(),
        "{} of {checked}:\n{}",
        broken.len(),
        broken.join("\n")
    );
}

// The promises can fail. Without these, `check_promises` could have answered
// empty regardless, and all the tests above would have reported green on a
// check that did not check.

#[test]
fn reports_text_that_is_too_light() {
    let family = build_family(&brand("danger"), Appearance::Light).unwrap();
    let clean = check_promises(&[("danger".into(), family.clone())], &white_layers()).unwrap();
    let broken = check_promises(
        &[("danger".into(), with(&family, "text", "#ff9999"))],
        &white_layers(),
    )
    .unwrap();
    assert!(clean.is_empty());
    assert!(!broken.is_empty());
    assert!(broken[0].promise.contains("text"));
}

#[test]
fn reports_content_on_fill_that_does_not_hold() {
    let family = build_family(&brand("accent"), Appearance::Light).unwrap();
    let broken = check_promises(
        &[("accent".into(), with(&family, "content", "#9ab8d8"))],
        &white_layers(),
    )
    .unwrap();
    assert!(broken.iter().any(|v| v.promise == "content on top of fill"));
}

// The requirement is above WCAG, so a small adjustment breaks nothing.

#[test]
fn the_requirements_have_a_margin_over_wcag() {
    assert!(contract().text_requirement > 4.5);
    assert!(contract().graphic_requirement > 3.0);
}

#[test]
fn every_lightness_is_within_the_scale() {
    // Above 0.1, since 0.001 is not a lightness any role can have.
    for (_, spec) in &contract().roles {
        for l in [spec.light, spec.dark] {
            assert!(l > 0.1 && l <= 1.0, "{l}");
        }
    }
}

// The check of a theme someone has written themselves.

#[test]
fn says_nothing_about_a_theme_that_holds() {
    let css = format!(
        "{}\n{}",
        as_css(Appearance::Light, ":root"),
        as_css(Appearance::Dark, "[data-theme=\"dark\"]")
    );
    assert!(inspect_theme(&css).problems.is_empty());
}

#[test]
fn finds_the_cell_that_breaks_and_where_it_is() {
    let css = as_css(Appearance::Light, ":root");
    let old = tokens(Appearance::Light)
        .into_iter()
        .find(|(n, _)| n == "--lt-color-danger-text")
        .unwrap()
        .1;
    let css = css.replace(
        &format!("--lt-color-danger-text: {old}"),
        "--lt-color-danger-text: #ff9999",
    );
    let report = inspect_theme(&css);
    assert!(!report.problems.is_empty());
    assert_eq!(report.problems[0].selector, ":root");
    assert!(report.problems[0].message.contains("danger"));
}

#[test]
fn reads_a_dark_block_inside_media() {
    let css = format!(
        "@media (prefers-color-scheme: dark) {{\n{}\n}}",
        as_css(Appearance::Dark, ":root")
    );
    let blocks = parse_blocks(&css);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].appearance, Appearance::Dark);
    assert!(inspect_theme(&css).problems.is_empty());
}

#[test]
fn reports_a_value_it_cannot_calculate() {
    let fill = tokens(Appearance::Light)
        .into_iter()
        .find(|(n, _)| n == "--lt-color-accent-fill")
        .unwrap()
        .1;
    let css = as_css(Appearance::Light, ":root").replace(
        &format!("--lt-color-accent-fill: {fill}"),
        "--lt-color-accent-fill: var(--noe-annet)",
    );
    let report = inspect_theme(&css);
    assert_eq!(report.problems.len(), 1);
    assert!(report.problems[0].message.contains("not checked"));
}

#[test]
fn reports_an_incomplete_family() {
    let report = inspect_theme(":root { color-scheme: light; --lt-color-brand4-fill: #336699; }");
    assert_eq!(messages(&report).len(), 1);
    assert!(report.problems[0].message.contains("brand4 is missing"));
}

#[test]
fn says_so_when_the_file_has_no_theme() {
    for css in [
        "body { color: red }",
        "body { color: var(--lt-color-neutral-text) }",
    ] {
        let report = inspect_theme(css);
        assert!(report.problems[0].message.contains("Found no"), "{css}");
        assert_eq!(report.others, 0, "{css}");
    }
}

#[test]
fn a_theme_with_only_shape_and_system_colors_is_not_a_missing_theme() {
    // The font, the shape and the system colours promise no contrast. A file
    // with only them is a theme without colours, also inside an `@layer` and
    // an `@media`.
    for css in [
        ":root { --lt-button-radius: 2.75rem }",
        "@layer lotek-theme { :root { --lt-font-family-base: Georgia, serif } }",
        "@media (prefers-color-scheme: dark) { :root { --lt-color-overlay: rgba(0, 0, 0, 0.72) } }",
    ] {
        let report = inspect_theme(css);
        assert!(report.problems.is_empty(), "{css}: {:?}", messages(&report));
        assert_eq!(report.blocks, 0, "{css}");
        assert_eq!(report.others, 1, "{css}");
    }
}

#[test]
fn the_matrix_needs_a_neutral_family() {
    let error = build_matrix(&[("accent".into(), "#1362ae".into())], Appearance::Light)
        .err()
        .unwrap();
    assert!(error.contains("neutral"), "{error}");
}

// The lightness comes from the role, not the brand colour. Two colours with
// the same lightness always have a contrast near 1, so what is tested is the
// lightness itself.

#[test]
fn every_role_has_the_same_lightness_whatever_the_brand() {
    for (r, spec) in &contract().roles {
        for brand in ["#ff0000", "#00ff00", "#0000ff", "#808080"] {
            let family = build_family(brand, Appearance::Light).unwrap();
            let l = rgb_to_oklch(parse_hex(role(&family, r).unwrap()).unwrap()).l;
            assert!((l - spec.light).abs() < 0.005, "{r} {brand}: {l}");
        }
    }
}

#[test]
fn takes_the_hue_from_the_brand() {
    let hue = |brand: &str| {
        let family = build_family(brand, Appearance::Light).unwrap();
        rgb_to_oklch(parse_hex(role(&family, "fill").unwrap()).unwrap()).h
    };
    assert!((hue("#ff0000") - hue("#0000ff")).abs() > 60.0);
}

// The raised surface is part of the promises: darkest in the light theme and
// lightest in the dark.

#[test]
fn border_fill_and_subtle_text_hold_against_raised() {
    for appearance in APPEARANCES {
        let matrix = build_matrix(&contract().brands, appearance).unwrap();
        assert!(matrix.violations.is_empty());
        let get = |name: &str| {
            parse_hex(&matrix.tokens.iter().find(|(n, _)| n == name).unwrap().1).unwrap()
        };
        let raised = get("--lt-color-neutral-raised");
        for family in &contract().families {
            for (r, required) in [
                ("border", contract().graphic_requirement),
                ("fill", contract().graphic_requirement),
                ("text-subtle", contract().text_requirement),
            ] {
                let ratio = contrast_ratio(get(&format!("--lt-color-{family}-{r}")), raised);
                assert!(ratio >= required, "{family} {r} {appearance:?}: {ratio}");
            }
        }
    }
}

#[test]
fn fails_when_the_border_is_too_weak_against_raised() {
    let family = build_family(&brand("accent"), Appearance::Light).unwrap();
    let broken = check_promises(
        &[("accent".into(), with(&family, "border", "#d8d8d8"))],
        &white_layers(),
    )
    .unwrap();
    assert!(broken.iter().any(|v| v.promise == "border on raised"));
}

// The check reads CSS the way it is actually written.

#[test]
fn keeps_a_value_before_a_nested_rule() {
    let css = ":root { --lt-color-danger-text: #ff9999; &:hover { color: red } }";
    let blocks = parse_blocks(css);
    assert_eq!(blocks.len(), 1);
    assert_eq!(
        declared(&blocks[0], "--lt-color-danger-text"),
        Some("#ff9999")
    );
    assert!(!inspect_theme(css).problems.is_empty());
}

#[test]
fn reads_media_inside_root_as_its_own_block() {
    let css = ":root { --lt-color-danger-text: #ff9999; @media print { --lt-color-accent-fill: #123456 } }";
    assert_eq!(parse_blocks(css).len(), 2);
}

#[test]
fn reads_a_nested_rule_that_starts_with_an_element_and_a_colon() {
    // `html:not(…)` starts like the declaration `html` with the value
    // `not(…) {…}`. When it was read that way, the block disappeared, and the
    // blocks after it too.
    for outer in [
        "@media (prefers-color-scheme: dark)",
        "@layer brand",
        ".kort",
    ] {
        for selector in [
            "html:not([data-theme=\"light\"])",
            "body:has(.x)",
            "a:hover",
        ] {
            let css = format!(
                "{outer} {{ {selector} {{ --lt-color-accent-text: #fdfdfd; --lt-color-accent-surface: #ffffff }} :root {{ --lt-color-danger-text: #ff9999 }} }}"
            );
            let blocks = parse_blocks(&css);
            assert_eq!(blocks.len(), 2, "{css}");
            assert_eq!(
                declared(&blocks[0], "--lt-color-accent-text"),
                Some("#fdfdfd"),
                "{css}"
            );
            assert_eq!(
                declared(&blocks[1], "--lt-color-danger-text"),
                Some("#ff9999"),
                "{css}"
            );
            let report = inspect_theme(&css);
            assert!(
                messages(&report).iter().any(|m| m.contains("accent: text")),
                "{css}: {:?}",
                messages(&report)
            );
        }
    }
}

#[test]
fn a_custom_property_may_hold_a_block() {
    let css = ":root { --noe: { a: b }; --lt-color-danger-text: #ff9999 }";
    let blocks = parse_blocks(css);
    assert_eq!(blocks.len(), 1);
    assert_eq!(
        declared(&blocks[0], "--lt-color-danger-text"),
        Some("#ff9999")
    );
}

#[test]
fn reads_light_dark_as_not_given() {
    let css = "[data-theme=\"dark\"] { color-scheme: light dark; --lt-color-danger-text: #ff9999 }";
    assert_eq!(parse_blocks(css)[0].appearance, Appearance::Dark);
}

#[test]
fn is_not_fooled_by_a_class_called_darkmode() {
    let css = ".darkmode-toggle { --lt-color-danger-text: #123456 }";
    assert_eq!(parse_blocks(css)[0].appearance, Appearance::Light);
}

#[test]
fn reports_a_token_name_the_system_does_not_have() {
    let report = inspect_theme(":root { --lt-color-danger-txt: #ff0000 }");
    assert_eq!(report.problems.len(), 1);
    assert!(report.problems[0]
        .message
        .contains("not a token in the system"));
}

#[test]
fn checks_a_family_with_a_hyphen_in_its_name() {
    // The role is read as the suffix. With the family as the prefix, seven
    // valid roles on "min-merkevare" fell outside without a word.
    let css: String = [
        "surface",
        "border-subtle",
        "border",
        "fill",
        "content",
        "text",
        "text-subtle",
    ]
    .iter()
    .map(|r| format!("--lt-color-min-merkevare-{r}: #ff0000;"))
    .collect();
    let report = inspect_theme(&format!(":root {{{css}}}"));
    assert!(!report.problems.is_empty());
    assert!(messages(&report)
        .iter()
        .any(|m| m.contains("min-merkevare")));
}

#[test]
fn reports_a_hex_color_with_alpha_instead_of_failing() {
    let report = inspect_theme(":root { --lt-color-danger-text: #ff9999cc }");
    assert_eq!(report.problems.len(), 1);
    assert!(report.problems[0].message.contains("not checked"));
}

// The check counts what it did.

#[test]
fn reports_blocks_and_promises() {
    let css = format!(
        ":root {{ color-scheme: light; {} }}",
        declarations(&tokens(Appearance::Light))
    );
    let report = inspect_theme(&css);
    let per_family = promises_for(
        &build_family(&brand("danger"), Appearance::Light).unwrap(),
        &white_layers(),
    )
    .unwrap()
    .len();
    assert_eq!(report.blocks, 1);
    assert_eq!(report.promises, family_count() * per_family);
    assert!(report.problems.is_empty());
}

#[test]
fn counts_no_promises_in_a_file_without_tokens() {
    let report = inspect_theme("body { color: red }");
    assert_eq!(report.promises, 0);
    assert_eq!(report.problems.len(), 1);
}

// The check reports what it could not read.

#[test]
fn reads_color_scheme_as_the_last_declaration_without_semicolon() {
    let css = format!(
        "[data-theme=\"mork\"] {{ {} color-scheme: dark }}",
        declarations(&tokens(Appearance::Dark))
    );
    assert_eq!(parse_blocks(&css)[0].appearance, Appearance::Dark);
    assert!(inspect_theme(&css).problems.is_empty());
}

#[test]
fn reads_every_dark_form_of_color_scheme() {
    for value in [
        "only dark",
        "dark only",
        "dark !important",
        "dark only !important",
        "ONLY DARK",
        "Only Dark",
    ] {
        let css = format!(":root {{ color-scheme: {value}; --lt-color-danger-text: #f1a7ab }}");
        assert_eq!(
            parse_blocks(&css)[0].appearance,
            Appearance::Dark,
            "{value}"
        );
    }
}

#[test]
fn the_last_color_scheme_wins() {
    let css = ":root { color-scheme: light; color-scheme: dark; --lt-color-danger-text: #f1a7ab }";
    assert_eq!(parse_blocks(css)[0].appearance, Appearance::Dark);
}

#[test]
fn does_not_read_a_custom_property_as_color_scheme() {
    let css = ":root { --my-color-scheme: dark; --lt-color-danger-text: #7a1f28 }";
    assert_eq!(parse_blocks(css)[0].appearance, Appearance::Light);
}

#[test]
fn keeps_the_brace_message_in_a_truncated_file() {
    let report = inspect_theme(":root { --lt-color-danger-text: #7a1f28");
    assert!(messages(&report).iter().any(|m| m.contains("not closed")));
}

#[test]
fn reports_a_block_that_is_not_closed() {
    let report = inspect_theme(":root { --lt-color-danger-text: #7a1f28 } [data-theme=\"dark\"] {");
    assert!(messages(&report).iter().any(|m| m.contains("not closed")));
}

#[test]
fn reports_a_layer_on_another_family_than_neutral() {
    let report = inspect_theme(":root { --lt-color-danger-canvas: #ff0000 }");
    assert_eq!(report.problems.len(), 1);
    assert!(report.problems[0]
        .message
        .contains("not a token in the system"));
}

#[test]
fn reads_a_value_with_important() {
    let report =
        inspect_theme(":root { color-scheme: light; --lt-color-danger-text: #7a1f28 !important }");
    assert_eq!(report.declarations, 1);
    assert!(report.problems.is_empty());
}

#[test]
fn counts_the_consumers_own_values_not_the_defaults() {
    let one_line =
        inspect_theme(":root { color-scheme: light; --lt-color-neutral-canvas: #ffffff }");
    let whole = inspect_theme(&format!(
        ":root {{ color-scheme: light; {} }}",
        declarations(&tokens(Appearance::Light))
    ));
    assert_eq!(one_line.promises, whole.promises);
    assert_eq!(one_line.declarations, 1);
    assert_eq!(whole.declarations, family_count() * role_count() + 2);
}

// The check reads CSS with the tokenizer, as the browser does. The old
// reading counted braces and semicolons character by character, and was
// fooled by all of these.

#[test]
fn a_brace_in_a_string_does_not_end_the_block() {
    let css = ":root { content: \"}\"; --lt-color-danger-text: #ff9999; }";
    let blocks = parse_blocks(css);
    assert_eq!(blocks.len(), 1);
    assert_eq!(
        declared(&blocks[0], "--lt-color-danger-text"),
        Some("#ff9999")
    );
    let report = inspect_theme(css);
    assert!(!messages(&report).iter().any(|m| m.contains("not closed")));
    assert!(messages(&report).iter().any(|m| m.contains("danger: text")));
}

#[test]
fn a_semicolon_in_a_string_does_not_split_a_declaration() {
    let css = ":root { color-scheme: light; font-family: \"a;--lt-color-accent-text: #ffffff\"; --lt-color-danger-text: #7a1f28 }";
    let blocks = parse_blocks(css);
    assert_eq!(
        blocks[0].declarations.len(),
        1,
        "{:?}",
        blocks[0].declarations
    );
    assert!(inspect_theme(css).problems.is_empty());
}

#[test]
fn a_brace_in_a_url_is_not_a_block() {
    let css = ":root { color-scheme: light; background: url(data:image/svg+xml,{x}); --lt-color-danger-text: #7a1f28 }";
    assert_eq!(parse_blocks(css).len(), 1);
    assert!(inspect_theme(css).problems.is_empty());
}

#[test]
fn a_comment_in_the_selector_is_not_shown() {
    let css = ":root /* lyst */ { --lt-color-danger-text: #ff9999 }";
    assert_eq!(parse_blocks(css)[0].selector, ":root");
}

#[test]
fn reads_a_block_that_is_not_closed_to_the_end_of_the_file() {
    let report = inspect_theme(":root { --lt-color-danger-text: #ff9999");
    assert_eq!(report.blocks, 1);
    assert!(messages(&report).iter().any(|m| m.contains("not closed")));
    assert!(messages(&report).iter().any(|m| m.contains("danger: text")));
}

// A bare `:root` applies in both themes. LO-TEK's dark block only overrides
// the tokens it has itself, so a light value no dark block takes also stands
// in dark.

#[test]
fn checks_a_bare_root_against_the_dark_theme_too() {
    let report = inspect_theme(":root { --lt-color-neutral-text: #0d4e8c }");
    assert!(
        report.problems.iter().any(
            |p| p.selector.contains("in the dark theme") && p.message.contains("neutral: text")
        ),
        "{:?}",
        messages(&report)
    );
}

#[test]
fn a_dark_block_takes_over_the_value_from_a_bare_root() {
    let css = ":root { --lt-color-neutral-text: #0d4e8c }
        [data-theme=\"dark\"] { --lt-color-neutral-text: #e8eaed }";
    assert!(
        inspect_theme(css).problems.is_empty(),
        "{:?}",
        messages(&inspect_theme(css))
    );
}

#[test]
fn a_block_bound_to_light_is_checked_only_as_light() {
    for css in [
        "[data-theme=\"light\"] { --lt-color-neutral-text: #0d4e8c }",
        ":root { color-scheme: light; --lt-color-neutral-text: #0d4e8c }",
    ] {
        assert!(inspect_theme(css).problems.is_empty(), "{css}");
    }
}

#[test]
fn light_and_dark_together_is_both_themes() {
    let report =
        inspect_theme(":root { color-scheme: light dark; --lt-color-neutral-text: #0d4e8c }");
    assert!(
        report
            .problems
            .iter()
            .any(|p| p.selector.contains("in the dark theme")),
        "{:?}",
        messages(&report)
    );
}

#[test]
fn a_print_block_is_not_checked_as_dark() {
    let report = inspect_theme(":root { @media print { --lt-color-neutral-text: #0d4e8c } }");
    assert!(report.problems.is_empty(), "{:?}", messages(&report));
}

#[test]
fn light_must_be_a_word() {
    for selector in [".highlight", ".lightbox", "@layer brand { :root"] {
        let close = if selector.contains('{') { "}" } else { "" };
        let css = format!("{selector} {{ --lt-color-neutral-text: #0d4e8c }}{close}");
        let report = inspect_theme(&css);
        assert!(
            report
                .problems
                .iter()
                .any(|p| p.selector.contains("in the dark theme")),
            "{css}: {:?}",
            messages(&report)
        );
    }
    for css in [
        ".light-mode { --lt-color-neutral-text: #0d4e8c }",
        "@media only print { :root { --lt-color-neutral-text: #0d4e8c } }",
    ] {
        assert!(inspect_theme(css).problems.is_empty(), "{css}");
    }
}

#[test]
fn not_dark_is_both_themes_and_not_light() {
    // `:root:not([data-theme="dark"])` also matches the system's dark mode
    // when `data-theme` is missing.
    let report =
        inspect_theme(":root:not([data-theme=\"dark\"]) { --lt-color-neutral-text: #0d4e8c }");
    assert!(
        report.problems.iter().any(
            |p| p.selector.contains("in the dark theme") && p.message.contains("neutral: text")
        ),
        "{:?}",
        messages(&report)
    );
}

#[test]
fn dark_inside_not_does_not_make_a_dark_block() {
    let blocks =
        parse_blocks(".kort:not([data-theme=\"dark\"]) { --lt-color-neutral-text: #0d4e8c }");
    assert_eq!(blocks[0].appearance, Appearance::Light);
}

// The system colours are no cell, and promise no contrast.

#[test]
fn loteks_own_tokens_css_has_no_problems() {
    let report = inspect_theme(&crate::package_file("src/tokens/tokens.css"));
    assert!(report.problems.is_empty(), "{:?}", messages(&report));
    assert!(report.promises > 0);
}

#[test]
fn the_system_colors_are_not_cells() {
    // As design-tokens.mdx asks: the override is written on every theme boundary.
    let css = "[data-theme=\"light\"] {
            --lt-color-disabled-surface: #e4e4e5;
            --lt-color-disabled-text: #8a8d91;
            --lt-color-overlay: #000000;
            --lt-color-danger-text: #7a1f28;
        }
        [data-theme=\"dark\"] {
            --lt-color-disabled-surface: var(--lt-color-neutral-raised);
            --lt-color-disabled-text: #5c5f63;
            --lt-color-overlay: rgba(0, 0, 0, 0.72);
        }";
    let report = inspect_theme(css);
    assert!(report.problems.is_empty(), "{:?}", messages(&report));
    assert_eq!(report.blocks, 1);
    assert_eq!(report.declarations, 1);
}

#[test]
fn media_not_dark_is_light_and_only_light() {
    // `not` inverts the media query. The block applies in the light theme,
    // and only there, so it is not checked against the dark default values
    // either.
    for media in [
        "not (prefers-color-scheme: dark)",
        "not all and (prefers-color-scheme: dark)",
        "not screen and (prefers-color-scheme: dark)",
        "NOT (Prefers-Color-Scheme:dark)",
    ] {
        let css = format!("@media {media} {{ :root {{ --lt-color-accent-text: #0d4e8c }} }}");
        assert_eq!(
            parse_blocks(&css)[0].appearance,
            Appearance::Light,
            "{media}"
        );
        let report = inspect_theme(&css);
        assert!(
            report.problems.is_empty(),
            "{media}: {:?}",
            messages(&report)
        );
    }
}

#[test]
fn media_not_print_and_dark_applies_in_both_schemes() {
    // `not print and (dark)` is not(print and dark): true on every screen, in
    // the light and the dark theme. The block is not tied to the light theme,
    // and a light value is also checked against the dark default values.
    for media in [
        "not print and (prefers-color-scheme: dark)",
        "not tv and (prefers-color-scheme: dark)",
        "not print and (prefers-color-scheme: light)",
    ] {
        let css = format!("@media {media} {{ :root {{ --lt-color-accent-text: #0d4e8c }} }}");
        let blocks = parse_blocks(&css);
        assert_eq!(blocks[0].appearance, Appearance::Light, "{media}");
        let bare = inspect_theme(":root { --lt-color-accent-text: #0d4e8c }");
        let report = inspect_theme(&css);
        assert!(!report.problems.is_empty(), "{media}");
        assert_eq!(messages(&report).len(), messages(&bare).len(), "{media}");
        assert_eq!(report.promises, bare.promises, "{media}");
    }
}

#[test]
fn media_not_type_without_and_stays_dark() {
    // A media type without `and` before the scheme is not a negated query
    // about colour scheme, and `dark` is read as before.
    let css = "@media not screen, (prefers-color-scheme: dark) { :root { --lt-color-danger-text: #f1a7ab } }";
    assert_eq!(parse_blocks(css)[0].appearance, Appearance::Dark);
}

#[test]
fn media_not_light_is_dark() {
    let css =
        "@media not (prefers-color-scheme: light) { :root { --lt-color-danger-text: #f1a7ab } }";
    assert_eq!(parse_blocks(css)[0].appearance, Appearance::Dark);
    assert!(inspect_theme(css).problems.is_empty());
}

#[test]
fn writes_numbers_like_string_in_javascript() {
    // The expected value is `String(number)` in Node.
    for (n, expected) in [
        (600.0, "600"),
        (2.5, "2.5"),
        (0.1, "0.1"),
        (-0.5, "-0.5"),
        (1.0 / 3.0, "0.3333333333333333"),
        (1e-6, "0.000001"),
        (0.000001234, "0.000001234"),
        (1e-7, "1e-7"),
        (1.5e-7, "1.5e-7"),
        (1e20, "100000000000000000000"),
        (123456789012345680000.0, "123456789012345680000"),
        (1e21, "1e+21"),
        (1.2345e21, "1.2345e+21"),
        (-1e21, "-1e+21"),
        (5e-324, "5e-324"),
        (f64::MAX, "1.7976931348623157e+308"),
        (-0.0, "0"),
        (f64::INFINITY, "Infinity"),
        (f64::NEG_INFINITY, "-Infinity"),
        (f64::NAN, "NaN"),
    ] {
        assert_eq!(super::js_number(n), expected, "{n:?}");
    }
}

/// The report of one of the themes in `core/theme`.
fn report_of(name: &str) -> Report {
    let path = format!("{}/theme/{name}.css", env!("CARGO_MANIFEST_DIR"));
    inspect_theme(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}")))
}

#[test]
fn the_verdict_of_one_theme_is_what_the_expected_results_say() {
    // The same file the package and Kotlin are held to. The messages there
    // are the ones `lotek check-theme` had while the command worded the
    // verdict itself, put together from each report's own counts.
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/theme/reports.json");
    let expected = crate::json::parse(&std::fs::read_to_string(path).unwrap()).unwrap();
    let crate::json::Json::Object(cases) = expected else {
        panic!("reports.json is not an object")
    };
    let mut kinds: Vec<String> = Vec::new();
    for (name, case) in &cases {
        let report = report_of(name);
        assert_eq!(
            Some(report.others as f64),
            case.get("others").and_then(|n| n.as_f64()),
            "{name}: tokens without a contrast promise"
        );
        let wanted = case
            .get("verdict")
            .unwrap_or_else(|| panic!("{name} has no verdict"));
        let text = |key: &str| wanted.get(key).unwrap().as_str().unwrap().to_string();
        let found = verdict(&[report]);
        assert_eq!(
            (found.kind.as_str().to_string(), found.message),
            (text("kind"), text("message")),
            "{name}"
        );
        kinds.push(text("kind"));
    }
    for kind in ["kept", "broken", "withoutColours"] {
        assert!(kinds.iter().any(|k| k == kind), "no theme is {kind}");
    }
}

#[test]
fn several_themes_get_one_verdict() {
    // What `lotek check-theme` said of these files together while the
    // command worded the verdict itself. The counts are summed, a problem in
    // one file breaks the whole, and a theme without colours beside one with
    // colours is nothing to remark on.
    let cases: [(&[&str], &str, &str); 6] = [
        (
            &["own-theme-holds", "dark-in-media"],
            "kept",
            "The theme keeps every promise. Checked 249 values in 3 blocks, against 459 promises, in 2 files.",
        ),
        (
            &["own-theme-holds", "text-too-light"],
            "broken",
            "8 problems. Checked 168 values in 3 blocks, against 612 promises, in 2 files.",
        ),
        (
            &["no-tokens", "own-theme-holds"],
            "broken",
            "1 problem. Checked 166 values in 2 blocks, against 306 promises, in 2 files.",
        ),
        (
            &["without-colors", "own-theme-holds"],
            "kept",
            "The theme keeps every promise. Checked 166 values in 2 blocks, against 306 promises, in 2 files.",
        ),
        (
            &["without-colors", "without-colors"],
            "withoutColours",
            "No contrast to check: 2 files sets only 8 tokens without a contrast promise, such as font, shape and the system colours.",
        ),
        (
            &["without-colors", "no-tokens"],
            "broken",
            "1 problem. Checked 0 values in 0 blocks, against 0 promises, in 2 files.",
        ),
    ];
    for (names, kind, message) in cases {
        let reports: Vec<Report> = names.iter().map(|name| report_of(name)).collect();
        let found = verdict(&reports);
        assert_eq!(
            (found.kind.as_str(), found.message.as_str()),
            (kind, message),
            "{names:?}"
        );
    }
}

#[test]
fn a_file_with_no_value_in_it_is_broken() {
    // Not a theme that holds and not a theme without colours: the report has
    // the problem that says nothing was found, and the verdict counts it.
    for css in [
        "",
        "body { color: red }",
        ":root { color-scheme: dark; }",
        "/* --lt-color-accent-fill: #000000; */",
        "--lt-color-accent-fill: #000000;",
    ] {
        let report = inspect_theme(css);
        assert_eq!(
            messages(&report),
            ["Found no --lt-color-* values. Is this a LO-TEK theme, and are the values inside a block?"],
            "{css:?}"
        );
        let found = verdict(&[report]);
        assert_eq!(found.kind.as_str(), "broken", "{css:?}");
        assert!(
            found.message.starts_with("1 problem. Checked 0 values in "),
            "{css:?}: {}",
            found.message
        );
    }
}

#[test]
fn reports_of_nothing_are_never_a_theme_that_holds() {
    // No value, no other token and no problem. `inspect_theme` never
    // answers that, so the report is written by hand: whoever puts one
    // together, or asks about no reports at all, is not told that a theme
    // keeps its promises. The command exits by the kind.
    let nothing = || Report {
        problems: Vec::new(),
        blocks: 0,
        declarations: 0,
        promises: 0,
        others: 0,
    };
    for reports in [vec![], vec![nothing()], vec![nothing(), nothing()]] {
        let found = verdict(&reports);
        assert_eq!(found.kind.as_str(), "broken", "{} reports", reports.len());
        assert!(
            !found.message.contains("keeps every promise"),
            "{}",
            found.message
        );
    }
}
