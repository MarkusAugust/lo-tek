//! Checks a theme a consumer has written themselves.
//!
//! The generator keeps the promises by construction. When someone writes in
//! their own values, the promises are theirs to keep, and then we owe them an
//! answer on which cell breaks. Without this, "you can override anything" is
//! a trap.
//!
//! The file is read as text. The only thing that matters is which
//! `--lt-color-*` are in which block, and a value we cannot compute with is
//! reported as exactly that rather than skipped.

use super::contract::{
    build_matrix, check_promises, contract, promises_for, role_to_css, token_name, Appearance,
    Family, Layers,
};
use super::{is_js_space, js_trim};
use cssparser::{
    AtRuleParser, CowRcStr, DeclarationParser, ParseError, Parser, ParserState,
    QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser, StyleSheetParser, Token,
};

pub struct ParsedBlock {
    /// The selector the block was under, used in the messages.
    pub selector: String,
    /// The appearance the block applies to, read from `color-scheme` or the selector.
    pub appearance: Appearance,
    /// Token name to value, as they were written.
    pub declarations: Vec<(String, String)>,
    /// Whether the block itself said `color-scheme: light`, and not `dark` next to it.
    pub light_scheme: bool,
}

/// The comments removed, for the text of a selector and a value.
fn without_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// A block as the CSS writes it: the selector, the declarations in it, and
/// the blocks inside.
struct Node {
    selector: String,
    declarations: Vec<(String, String)>,
    children: Vec<Node>,
}

/// What one rule in a block is: a declaration, a nested block, or something
/// the check does not care about, like `@import`.
enum Item {
    Declaration(String, String),
    Block(Node),
    Nothing,
}

/// The reader cssparser calls for each rule. It keeps the text as it was, so
/// the messages show the selector the consumer wrote.
struct Reader;

/// All the remaining tokens, as the text they were written with.
fn rest_as_text<'i>(input: &mut Parser<'i>) -> String {
    let start = input.position();
    while input.next_including_whitespace_and_comments().is_ok() {}
    js_trim(&without_comments(input.slice_from(start))).to_string()
}

fn body<'i>(input: &mut Parser<'i>) -> (Vec<(String, String)>, Vec<Node>) {
    let mut declarations: Vec<(String, String)> = Vec::new();
    let mut children = Vec::new();
    let mut reader = Reader;
    for item in RuleBodyParser::new(input, &mut reader).flatten() {
        match item {
            Item::Declaration(name, value) => {
                match declarations.iter_mut().find(|(n, _)| *n == name) {
                    Some(existing) => existing.1 = value,
                    None => declarations.push((name, value)),
                }
            }
            Item::Block(node) => children.push(node),
            Item::Nothing => {}
        }
    }
    (declarations, children)
}

impl<'i> DeclarationParser<'i> for Reader {
    type Declaration = Item;
    type Error = ();

    fn parse_value(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i>,
        _start: &ParserState,
    ) -> Result<Item, ParseError<()>> {
        // A value with a `{}` block is no declaration, but a nested rule like
        // `html:not(…) { … }` or `a:hover { … }`. CSS Syntax throws it out as
        // a declaration, and only then does cssparser read it again as a
        // rule. Had we answered `Ok`, it swallowed everything up to the next
        // semicolon, the blocks after it included. A custom property can have
        // a block in its value.
        let state = input.state();
        let mut block = false;
        while let Ok(token) = input.next() {
            block |= matches!(token, Token::CurlyBracketBlock);
        }
        if block && !name.starts_with("--") {
            return Err(ParseError::custom(()));
        }
        input.reset(&state);
        let value = rest_as_text(input);
        // Only what the check uses: LO-TEK's tokens, and `color-scheme`, which
        // says whether the block is light or dark. The font and the shape are
        // not checked, but they tell a theme without colours apart from a
        // file that is not a theme. The name of a custom property is
        // case-sensitive, the name of a property is not.
        if name.starts_with("--lt-") || name.eq_ignore_ascii_case("color-scheme") {
            let name = if name.starts_with("--") {
                name.to_string()
            } else {
                name.to_ascii_lowercase()
            };
            Ok(Item::Declaration(name, value))
        } else {
            Ok(Item::Nothing)
        }
    }
}

impl<'i> QualifiedRuleParser<'i> for Reader {
    type Prelude = String;
    type QualifiedRule = Item;
    type Error = ();

    fn parse_prelude(&mut self, input: &mut Parser<'i>) -> Result<String, ParseError<()>> {
        Ok(rest_as_text(input))
    }

    fn parse_block(
        &mut self,
        selector: String,
        _start: &ParserState,
        input: &mut Parser<'i>,
    ) -> Result<Item, ParseError<()>> {
        let (declarations, children) = body(input);
        Ok(Item::Block(Node {
            selector,
            declarations,
            children,
        }))
    }
}

impl<'i> AtRuleParser<'i> for Reader {
    type Prelude = String;
    type AtRule = Item;
    type Error = ();

    fn parse_prelude(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i>,
    ) -> Result<String, ParseError<()>> {
        let prelude = rest_as_text(input);
        Ok(js_trim(&format!("@{name} {prelude}")).to_string())
    }

    fn rule_without_block(&mut self, _prelude: String, _start: &ParserState) -> Result<Item, ()> {
        Ok(Item::Nothing)
    }

    fn parse_block(
        &mut self,
        selector: String,
        _start: &ParserState,
        input: &mut Parser<'i>,
    ) -> Result<Item, ParseError<()>> {
        let (declarations, children) = body(input);
        Ok(Item::Block(Node {
            selector,
            declarations,
            children,
        }))
    }
}

impl<'i> RuleBodyItemParser<'i, Item, ()> for Reader {
    fn parse_declarations(&self) -> bool {
        true
    }
    fn parse_qualified(&self) -> bool {
        true
    }
}

/// The colours outside the matrix: the disabled state and the surface behind
/// a modal. They are no cell, have no family and no role, and promise no
/// contrast. A control that is disabled is exempt from the requirement in
/// WCAG 1.4.3. The same as `SystemColorToken` in
/// `interfaces/src/tokens/tokens.ts`, without the shadow.
const SYSTEM_COLORS: [&str; 3] = [
    "--lt-color-disabled-surface",
    "--lt-color-disabled-text",
    "--lt-color-overlay",
];

/// The blocks in the order they end, the innermost first, with the selectors
/// above them as a path. The system colours are not included; they are
/// counted in `others` together with the other tokens without a contrast
/// promise.
///
/// `others` counts every `--lt-*` name that is not a colour with a promise,
/// also a misspelt one. The components have their own tokens, like
/// `--lt-label-required-text` and `--lt-progress-height`, and a list of known
/// names would have given an error code for a theme that only sets one of
/// them. The count is in the answer, so a misspelt colour name shows there.
fn flatten(node: Node, path: &mut Vec<String>, out: &mut Vec<ParsedBlock>, others: &mut usize) {
    path.push(node.selector);
    for child in node.children {
        flatten(child, path, out, others);
    }
    let colors: Vec<(String, String)> = node
        .declarations
        .iter()
        .filter(|(n, _)| n.starts_with("--lt-color-") && !SYSTEM_COLORS.contains(&n.as_str()))
        .map(|(n, v)| (n.clone(), without_important(v).to_string()))
        .collect();
    *others += node
        .declarations
        .iter()
        .filter(|(n, _)| n.starts_with("--lt-"))
        .count()
        - colors.len();
    if !colors.is_empty() {
        let scheme = node
            .declarations
            .iter()
            .rev()
            .find(|(n, _)| n == "color-scheme")
            .map(|(_, v)| v.as_str());
        out.push(ParsedBlock {
            selector: path
                .iter()
                .filter(|s| !s.is_empty())
                .cloned()
                .collect::<Vec<_>>()
                .join(" "),
            appearance: read_appearance(&path.join(" "), scheme),
            declarations: colors,
            light_scheme: scheme.is_some_and(|v| {
                let v = v.to_lowercase();
                let words: Vec<&str> = v.split(is_js_space).collect();
                words.contains(&"light") && !words.contains(&"dark")
            }),
        });
    }
    path.pop();
}

/// Splits the CSS text into blocks, with one frame per level.
///
/// Read with the CSS tokenizer from Servo, following CSS Syntax Level 3, so a
/// brace or a semicolon in a string, a comment or `url(…)` does not split a
/// block, and nested rules and `@media` inside a block become their own. A
/// block that is not closed is read as if it ends where the file ends, as the
/// browser does.
pub fn parse_blocks(css: &str) -> Vec<ParsedBlock> {
    read_blocks(css).0
}

/// The blocks, and how many other `--lt-*` tokens the file sets.
fn read_blocks(css: &str) -> (Vec<ParsedBlock>, usize) {
    let mut parser = Parser::new(css);
    let mut reader = Reader;
    let mut blocks = Vec::new();
    let mut others = 0;
    for item in StyleSheetParser::new(&mut parser, &mut reader).flatten() {
        if let Item::Block(node) = item {
            flatten(node, &mut Vec::new(), &mut blocks, &mut others);
        }
    }
    (blocks, others)
}

/// The braces in the text, `{` and `}`, apart from those in strings,
/// comments and escape sequences.
fn braces(css: &str) -> (usize, usize) {
    let (mut opened, mut closed) = (0, 0);
    let mut chars = css.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                chars.next();
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = ' ';
                for c in chars.by_ref() {
                    if previous == '*' && c == '/' {
                        break;
                    }
                    previous = c;
                }
            }
            '"' | '\'' => {
                while let Some(d) = chars.next() {
                    if d == '\\' {
                        chars.next();
                    } else if d == c || d == '\n' {
                        break;
                    }
                }
            }
            '{' => opened += 1,
            '}' => closed += 1,
            _ => {}
        }
    }
    (opened, closed)
}

/// `\s*!important\s*$`, ignoring case, removed.
fn without_important(value: &str) -> &str {
    let trimmed = value.trim_end_matches(is_js_space);
    let lower = trimmed.to_lowercase();
    if lower.len() == trimmed.len() && lower.ends_with("!important") {
        return trimmed[..trimmed.len() - "!important".len()].trim_end_matches(is_js_space);
    }
    value
}

/// Whether the block only applies in the light theme: the selector has
/// `light` as a word of its own outside a `:not()`, it is in
/// `@media not (prefers-color-scheme: dark)`, or it is in an `@media` for
/// `print`, which prints light. `.highlight` and `.lightbox` are not the
/// light theme.
fn only_light(selector: &str) -> bool {
    let s = flip_negated_scheme(&without_not(selector)).to_ascii_lowercase();
    let words: Vec<&str> = s
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
        .collect();
    words.contains(&"light")
        || words
            .iter()
            .any(|w| w.starts_with("light-") || w.ends_with("-light"))
        || s.split("@media").skip(1).any(|media| {
            media
                .split(|c: char| !c.is_ascii_alphanumeric())
                .any(|w| w == "print")
        })
}

/// The selector with the content of every `:not(…)` removed.
fn without_not(selector: &str) -> String {
    let mut out = String::new();
    let mut rest = selector;
    while let Some(start) = rest.to_ascii_lowercase().find(":not(") {
        out.push_str(&rest[..start]);
        let mut depth = 0;
        let mut end = rest.len();
        for (i, c) in rest[start + 4..].char_indices() {
            match c {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = start + 4 + i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// Every negated media query about colour scheme rewritten as what it
/// applies to.
///
/// `not (prefers-color-scheme: dark)`, `not all and (…)` and `not screen and
/// (…)` apply to the opposite scheme, and are rewritten as that. Otherwise
/// `dark` in them is read as the dark theme. With another media type, as in
/// `not print and (…)`, the block applies to the screen in both schemes, and
/// the query is removed, so the block is read as a block without a condition.
fn flip_negated_scheme(selector: &str) -> String {
    let lower = selector.to_ascii_lowercase();
    // The text after the keyword, when it is a word of its own.
    fn after<'a>(rest: &'a str, keyword: &str) -> Option<&'a str> {
        rest.strip_prefix(keyword)
            .filter(|r| r.starts_with(is_js_space) || r.starts_with('('))
            .map(|r| r.trim_start_matches(is_js_space))
    }
    let word = |c: u8| c.is_ascii_alphanumeric() || c == b'-' || c == b'_';
    let mut out = String::new();
    let mut copied = 0;
    let mut from = 0;
    while let Some(found) = lower[from..].find("not") {
        let at = from + found;
        from = at + 3;
        if at > 0 && word(lower.as_bytes()[at - 1]) {
            continue;
        }
        let Some(mut rest) = after(&lower[at..], "not") else {
            continue;
        };
        // `not <media type> and (…)` negates the whole query, the media type
        // included. For `all` and `screen` the block then applies to the
        // opposite scheme on screen. For `print`, `tv` and the others `not`
        // is true on every screen, in the light and the dark theme, and the
        // query says nothing about the scheme.
        let media_type = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
            .map_or(rest, |end| &rest[..end]);
        let mut any_scheme = false;
        if !media_type.is_empty() && !matches!(media_type, "and" | "not" | "only" | "or") {
            if let Some(r) = after(rest, media_type).and_then(|r| after(r, "and")) {
                rest = r;
                any_scheme = !matches!(media_type, "all" | "screen");
            }
        }
        let scheme = rest
            .strip_prefix('(')
            .map(|r| r.trim_start_matches(is_js_space))
            .and_then(|r| r.strip_prefix("prefers-color-scheme"))
            .map(|r| r.trim_start_matches(is_js_space))
            .and_then(|r| r.strip_prefix(':'))
            .map(|r| r.trim_start_matches(is_js_space));
        let Some((opposite, r)) = scheme.and_then(|r| {
            r.strip_prefix("dark")
                .map(|r| ("light", r))
                .or_else(|| r.strip_prefix("light").map(|r| ("dark", r)))
        }) else {
            continue;
        };
        let Some(r) = r.trim_start_matches(is_js_space).strip_prefix(')') else {
            continue;
        };
        let end = lower.len() - r.len();
        out.push_str(&selector[copied..at]);
        if !any_scheme {
            out.push_str(&format!("(prefers-color-scheme: {opposite})"));
        }
        copied = end;
        from = end;
    }
    out.push_str(&selector[copied..]);
    out
}

/// Dark or light, read from `color-scheme` first and from the selector
/// otherwise.
///
/// `scheme` is the value of the block's last `color-scheme`, which wins in
/// the cascade.
fn read_appearance(selector: &str, scheme: Option<&str>) -> Appearance {
    let declared = scheme;
    if let Some(value) = declared {
        // The value is parsed, not pattern-matched. The grammar is
        // `normal | [ light | dark | <custom-ident> ]+ && only?`, and `only`
        // can be on either side. When both keywords are there, the block says
        // it works in both, and then the selector is the best answer.
        let lowered = value.to_lowercase().replace("!important", "");
        let words: Vec<&str> = lowered
            .split(is_js_space)
            .filter(|w| !w.is_empty())
            .collect();
        let light = words.contains(&"light");
        let dark = words.contains(&"dark");
        if light != dark {
            return if dark {
                Appearance::Dark
            } else {
                Appearance::Light
            };
        }
    }
    // `dark` must be a word of its own: `.darkmode-toggle` is not a dark
    // theme. What is in `:not(…)` and after `@media not` says what the block
    // is not.
    let selector = flip_negated_scheme(&without_not(selector));
    let s: Vec<char> = selector.chars().collect();
    let letter = |c: Option<&char>| c.is_some_and(|c| c.is_ascii_alphabetic());
    for k in 0..s.len() {
        let word: String = s[k..(k + 4).min(s.len())].iter().collect();
        if word.eq_ignore_ascii_case("dark")
            && !letter(k.checked_sub(1).and_then(|p| s.get(p)))
            && !letter(s.get(k + 4))
        {
            return Appearance::Dark;
        }
    }
    Appearance::Light
}

/// The role names as they are written in CSS, longest first.
fn role_names() -> Vec<(String, String)> {
    let mut names: Vec<(String, String)> = contract()
        .roles
        .iter()
        .map(|(r, _)| (role_to_css(r), r.clone()))
        .collect();
    names.sort_by_key(|n| std::cmp::Reverse(n.0.len()));
    names
}

/// Splits `--lt-color-my-brand-text` into family and role.
///
/// The role is read as the **suffix**. With the family as the prefix, a
/// family name with a hyphen fell outside without a word. `None` as the role
/// means a known layer, and those only belong to the neutral family.
fn split_token(token: &str) -> Option<(String, Option<String>)> {
    let rest = token
        .strip_prefix("--lt-color-")
        .filter(|r| !r.is_empty())?;
    for layer in ["canvas", "raised"] {
        if let Some(family) = rest.strip_suffix(&format!("-{layer}")) {
            return (family == "neutral").then(|| (family.to_string(), None));
        }
    }
    for (css, role) in role_names() {
        if let Some(family) = rest.strip_suffix(&format!("-{css}")) {
            if family.is_empty() {
                return None;
            }
            return Some((family.to_string(), Some(role)));
        }
    }
    None
}

fn is_hex(value: &str) -> bool {
    let Some(digits) = value.strip_prefix('#') else {
        return false;
    };
    (digits.len() == 3 || digits.len() == 6) && digits.bytes().all(|b| b.is_ascii_hexdigit())
}

pub struct Problem {
    pub selector: String,
    pub message: String,
}

pub struct Report {
    pub problems: Vec<Problem>,
    /// Blocks that were actually read.
    pub blocks: usize,
    /// Values the consumer wrote themselves, and that were understood.
    pub declarations: usize,
    /// Promises that were actually checked.
    pub promises: usize,
    /// Other `--lt-*` tokens the file sets, without a contrast promise: the
    /// font, the shape and the system colours. With them and no colours, the
    /// file is a theme without colours, not a file without a theme.
    pub others: usize,
}

/// Reads a theme and checks every promise in every block.
///
/// Missing values are filled from LO-TEK's own theme, so a consumer who has
/// only overridden one cell gets it checked against the rest of their system
/// rather than against nothing.
pub fn inspect_theme(css: &str) -> Report {
    if !super::contract::loaded() {
        return Report {
            problems: vec![Problem {
                selector: String::new(),
                message: super::contract::NOT_LOADED.into(),
            }],
            blocks: 0,
            declarations: 0,
            promises: 0,
            others: 0,
        };
    }
    let mut problems = Vec::new();
    let (blocks, others) = read_blocks(css);
    let mut checked_promises = 0;
    let mut understood = 0;

    // The braces are counted on their own: when they do not balance, the
    // file is probably truncated, and what should have come after is not
    // checked.
    let (opened, closed) = braces(css);
    if opened != closed {
        problems.push(Problem {
            selector: "(whole file)".into(),
            message: format!("The file has {opened} \"{{\" and {closed} \"}}\". A block that is not closed is read to the end of the file, so part of the theme may be missing or read wrongly."),
        });
    }

    // A theme without colours, only typography and shape, has no contrast to
    // check, and that is not a problem.
    if blocks.is_empty() {
        if others == 0 {
            problems.push(Problem {
                selector: "(whole file)".into(),
                message: "Found no --lt-color-* values. Is this a LO-TEK theme, and are the values inside a block?".into(),
            });
        }
        return Report {
            problems,
            blocks: 0,
            declarations: 0,
            promises: 0,
            others,
        };
    }

    let role_list = role_names()
        .into_iter()
        .map(|(css, _)| css)
        .collect::<Vec<_>>()
        .join(", ");

    // A light block that is not tied to the light theme (a bare `:root`) also
    // applies in dark, for the tokens no dark block overrides. They are
    // checked against the dark default values.
    let dark_names: Vec<&String> = blocks
        .iter()
        .filter(|b| b.appearance == Appearance::Dark)
        .flat_map(|b| b.declarations.iter().map(|(n, _)| n))
        .collect();
    let mut checks: Vec<ParsedBlock> = Vec::new();
    for b in &blocks {
        if b.appearance != Appearance::Light || b.light_scheme || only_light(&b.selector) {
            continue;
        }
        let rest: Vec<(String, String)> = b
            .declarations
            .iter()
            .filter(|(n, v)| !dark_names.contains(&n) && is_hex(v) && split_token(n).is_some())
            .cloned()
            .collect();
        if !rest.is_empty() {
            checks.push(ParsedBlock {
                selector: format!(
                    "{} (in the dark theme, no dark block overrides)",
                    b.selector
                ),
                appearance: Appearance::Dark,
                declarations: rest,
                light_scheme: false,
            });
        }
    }
    let originals = blocks.len();
    let all: Vec<&ParsedBlock> = blocks.iter().chain(checks.iter()).collect();

    for (nth, block) in all.iter().enumerate() {
        let defaults = build_matrix(&contract().brands, block.appearance)
            .expect("LO-TEK's own colours must always give a matrix")
            .tokens;
        let mut values: Vec<(String, String)> = defaults;

        for (name, value) in &block.declarations {
            if !is_hex(value) {
                problems.push(Problem {
                    selector: block.selector.clone(),
                    message: format!("{name} is \"{value}\". The contrast can only be computed for a hex colour, so this one is not checked."),
                });
                continue;
            }
            match values.iter_mut().find(|(n, _)| n == name) {
                Some(existing) => existing.1 = value.clone(),
                None => values.push((name.clone(), value.clone())),
            }
            if split_token(name).is_some() && nth < originals {
                understood += 1;
            }
        }

        let mut families: Vec<(String, Family)> = Vec::new();
        for (name, value) in &values {
            let Some((family, role)) = split_token(name) else {
                // Only names the consumer wrote themselves are reported. The
                // default values are our own, and they always split.
                if block.declarations.iter().any(|(n, _)| n == name) {
                    problems.push(Problem {
                        selector: block.selector.clone(),
                        message: format!("{name} is not a token in the system. The name is --lt-color-<family>-<role>, and the roles are {role_list}."),
                    });
                }
                continue;
            };
            let Some(role) = role else { continue };
            let index = match families.iter().position(|(f, _)| *f == family) {
                Some(i) => i,
                None => {
                    families.push((family, Vec::new()));
                    families.len() - 1
                }
            };
            let entries = &mut families[index].1;
            match entries.iter_mut().find(|(r, _)| *r == role) {
                Some(existing) => existing.1 = value.clone(),
                None => entries.push((role, value.clone())),
            }
        }

        // A family the consumer invented is not filled by the defaults and
        // can have gaps. It is reported as incomplete rather than thrown away.
        let mut complete = Vec::new();
        for (name, family) in families {
            let missing: Vec<String> = contract()
                .roles
                .iter()
                .filter(|(r, _)| !family.iter().any(|(k, _)| k == r))
                .map(|(r, _)| role_to_css(r))
                .collect();
            if missing.is_empty() {
                complete.push((name, family));
            } else if nth < originals {
                // The check in the dark theme is the same block, and it has
                // already reported that the family is missing roles.
                problems.push(Problem {
                    selector: block.selector.clone(),
                    message: format!("{name} is missing {}. A family must have every role for the promises to be checked.", missing.join(", ")),
                });
            }
        }

        let value = |family: &str, role: &str| {
            let name = token_name(family, role);
            values
                .iter()
                .find(|(n, _)| *n == name)
                .map(|(_, v)| v.clone())
                .unwrap_or_default()
        };
        let layers = Layers {
            canvas: value("neutral", "canvas"),
            surface: value("neutral", "surface"),
            raised: value("neutral", "raised"),
        };

        for (_, family) in &complete {
            checked_promises += promises_for(family, &layers).map_or(0, |p| p.len());
        }
        for violation in check_promises(&complete, &layers).unwrap_or_default() {
            problems.push(Problem {
                selector: block.selector.clone(),
                message: violation.summary(),
            });
        }
    }

    Report {
        problems,
        blocks: blocks.len(),
        declarations: understood,
        promises: checked_promises,
        others,
    }
}
