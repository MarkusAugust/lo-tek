//! The colour contract: what each role is, and what it promises.
//!
//! One colour layer, not two. A colour is a point in a matrix of **family**
//! (what it means) and **role** (what it does), and every family has the
//! same roles. That structure is what makes the families match.
//!
//! The hue comes from the consumer, the lightness from the role. That way
//! the contrast is guaranteed by construction rather than by a check
//! afterwards.
//!
//! The numbers are in `interfaces/src/tokens/color-contract.json`, not
//! here, so the TypeScript scripts and the core read the same ones. The core
//! does not carry the file: the host gives it with `load_contract_raw`, as it
//! gives the manifest. Three choices in the numbers that are not obvious:
//!
//! - `fill` is set by `content` having to be readable on top of it, not by
//!   the distance to the page. Chosen by the page alone, it becomes too light
//!   to carry text.
//! - Text and border have three steps each. Body text should not sit at the
//!   minimum requirement: set to `text` it became `#4a4d51` rather than
//!   `#1a1a1a`, and that is a real loss in readability even though the
//!   requirement held.
//! - `textStrong` has low chroma, since a strong text colour is nearly black
//!   or white whatever the hue.
//!
//! The lightness values were worked out against a sweep around the whole
//! colour wheel, at the highest chroma sRGB can show for each hue. If you
//! change one of the numbers, the promises are what tell you.
//!
//! `borderSubtle` has no promise on purpose: a decorative divider is not
//! needed to understand the page, and WCAG 1.4.11 does not apply to it. When
//! the border needs to mean something, `border` is the right one.

use std::sync::{Arc, RwLock};

use super::color::{
    chroma_kept, contrast_ratio, oklch_to_rgb, parse_hex, rgb_to_oklch, to_hex, Oklch,
};
use crate::json::{parse, Json};

/// Light or dark. A theme is one or the other, never both.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Appearance {
    Light,
    Dark,
}

impl Appearance {
    pub fn key(self) -> &'static str {
        match self {
            Appearance::Light => "light",
            Appearance::Dark => "dark",
        }
    }
}

/// Lightness in each appearance, and the chroma as a share of the brand colour's.
#[derive(Clone, Debug)]
pub struct Spec {
    pub light: f64,
    pub dark: f64,
    pub chroma: f64,
}

impl Spec {
    pub fn lightness(&self, appearance: Appearance) -> f64 {
        match appearance {
            Appearance::Light => self.light,
            Appearance::Dark => self.dark,
        }
    }
}

/// A promise: the foreground meets the requirement against the background.
#[derive(Clone, Debug)]
pub struct Promise {
    pub name: String,
    pub foreground: String,
    pub background: String,
    /// The background is the family's own role, not the layer in the neutral family.
    pub own: bool,
    pub required: f64,
}

#[derive(Clone, Debug)]
pub struct Contract {
    pub families: Vec<String>,
    /// LO-TEK's own brand colours, in the order of the families.
    pub brands: Vec<(String, String)>,
    /// The roles, in the order the tokens are written.
    pub roles: Vec<(String, Spec)>,
    pub canvas: Spec,
    pub raised: Spec,
    /// The contrast requirements, with a margin above WCAG: text and graphics.
    pub text_requirement: f64,
    pub graphic_requirement: f64,
    pub promises: Vec<Promise>,
}

/// The contract the host has given, for the whole process and every thread.
static CONTRACT: RwLock<Option<Arc<Contract>>> = RwLock::new(None);

/// The answer from the theme when the host has not given a contract.
pub const NOT_LOADED: &str =
    "The core has not been given a colour contract. Give it color-contract.json from the package with load_contract_raw first.";

/// Reads the contract the host has given, and uses it from now on.
pub fn load(source: &str) -> Result<(), String> {
    let contract = read(source)?;
    *CONTRACT.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(contract));
    Ok(())
}

/// Whether the host has given a contract. `build_theme` and `inspect_theme`
/// ask first, so `contract()` is never called without one.
pub fn loaded() -> bool {
    #[cfg(test)]
    if CONTRACT.read().unwrap_or_else(|e| e.into_inner()).is_none() {
        let _ = load(&crate::package_file("src/tokens/color-contract.json"));
    }
    CONTRACT.read().unwrap_or_else(|e| e.into_inner()).is_some()
}

/// The contract the host has given. In the tests, the one in the package.
pub fn contract() -> Arc<Contract> {
    #[cfg(test)]
    loaded();
    CONTRACT
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .expect(NOT_LOADED)
}

fn spec(value: &Json) -> Option<Spec> {
    let lightness = value.get("lightness")?;
    Some(Spec {
        light: lightness.get("light")?.as_f64()?,
        dark: lightness.get("dark")?.as_f64()?,
        chroma: value.get("chroma")?.as_f64()?,
    })
}

fn read(source: &str) -> Result<Contract, String> {
    let root = parse(source)?;
    let wrong = |what: &str| format!("color-contract.json: {what}");
    let texts = |value: Option<&Json>| -> Option<Vec<String>> {
        value?
            .as_array()?
            .iter()
            .map(|v| v.as_str().map(str::to_string))
            .collect()
    };
    let requirements = root
        .get("requirements")
        .ok_or_else(|| wrong("requirements is missing"))?;
    Ok(Contract {
        families: texts(root.get("families")).ok_or_else(|| wrong("families"))?,
        brands: root
            .get("brands")
            .and_then(Json::as_object)
            .ok_or_else(|| wrong("brands"))?
            .iter()
            .map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
            .collect::<Option<_>>()
            .ok_or_else(|| wrong("brands"))?,
        roles: root
            .get("roles")
            .and_then(Json::as_object)
            .ok_or_else(|| wrong("roles"))?
            .iter()
            .map(|(k, v)| Some((k.clone(), spec(v)?)))
            .collect::<Option<_>>()
            .ok_or_else(|| wrong("roles"))?,
        canvas: root
            .get("layers")
            .and_then(|l| spec(l.get("canvas")?))
            .ok_or_else(|| wrong("layers.canvas"))?,
        raised: root
            .get("layers")
            .and_then(|l| spec(l.get("raised")?))
            .ok_or_else(|| wrong("layers.raised"))?,
        text_requirement: requirements
            .get("text")
            .and_then(Json::as_f64)
            .ok_or_else(|| wrong("requirements.text"))?,
        graphic_requirement: requirements
            .get("graphic")
            .and_then(Json::as_f64)
            .ok_or_else(|| wrong("requirements.graphic"))?,
        promises: root
            .get("promises")
            .and_then(Json::as_array)
            .ok_or_else(|| wrong("promises"))?
            .iter()
            .map(|p| {
                Some(Promise {
                    name: p.get("name")?.as_str()?.to_string(),
                    foreground: p.get("foreground")?.as_str()?.to_string(),
                    background: p.get("background")?.as_str()?.to_string(),
                    own: matches!(p.get("own"), Some(Json::Bool(true))),
                    required: requirements
                        .get(p.get("requirement")?.as_str()?)?
                        .as_f64()?,
                })
            })
            .collect::<Option<_>>()
            .ok_or_else(|| wrong("promises"))?,
    })
}

/// A family: role name to hex colour, in the order of the roles.
pub type Family = Vec<(String, String)>;

pub fn role<'a>(family: &'a Family, name: &str) -> Option<&'a str> {
    family
        .iter()
        .find(|(r, _)| r == name)
        .map(|(_, v)| v.as_str())
}

/// The role name as written in CSS. `textSubtle` becomes `text-subtle`.
pub fn role_to_css(role: &str) -> String {
    let mut out = String::with_capacity(role.len() + 2);
    for c in role.chars() {
        if c.is_ascii_uppercase() {
            out.push('-');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// The colour a role asks for from a brand colour, before it is fitted into
/// sRGB: the hue of the brand, the lightness of the role, and the chroma of
/// the brand times the share of the role.
fn asked(brand: Oklch, spec: &Spec, appearance: Appearance) -> Oklch {
    Oklch {
        l: spec.lightness(appearance),
        c: brand.c * spec.chroma,
        h: brand.h,
    }
}

/// Builds one family from one brand colour.
pub fn build_family(brand: &str, appearance: Appearance) -> Result<Family, String> {
    let brand = rgb_to_oklch(parse_hex(brand)?);
    Ok(contract()
        .roles
        .iter()
        .map(|(name, spec)| {
            let color = oklch_to_rgb(asked(brand, spec, appearance));
            (name.clone(), to_hex(color))
        })
        .collect())
}

/// The share of the chroma `fill` asks for that the fill of a brand colour
/// has. Below 1 when sRGB cannot show that much at the lightness of the role.
pub fn fill_chroma_kept(brand: &str, appearance: Appearance) -> Result<f64, String> {
    let brand = rgb_to_oklch(parse_hex(brand)?);
    Ok(contract()
        .roles
        .iter()
        .find(|(role, _)| role == "fill")
        .map_or(1.0, |(_, spec)| chroma_kept(asked(brand, spec, appearance))))
}

/// The page, the card and the raised surface, which only the neutral family has.
#[derive(Clone, Debug)]
pub struct Layers {
    pub canvas: String,
    pub surface: String,
    pub raised: String,
}

impl Layers {
    fn get(&self, name: &str) -> Option<&str> {
        match name {
            "canvas" => Some(&self.canvas),
            "surface" => Some(&self.surface),
            "raised" => Some(&self.raised),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Violation {
    pub family: String,
    pub promise: String,
    pub ratio: f64,
    pub required: f64,
}

impl Violation {
    /// The promise that does not hold, in one sentence. A host shows this,
    /// and writes none of its own from the numbers.
    pub fn summary(&self) -> String {
        format!(
            "{}: {} is {}:1, the requirement is {}:1.",
            self.family,
            self.promise,
            super::to_fixed2(self.ratio),
            super::js_number(self.required)
        )
    }
}

/// Every promise for one family: the name, the ratio and the requirement.
pub fn promises_for(family: &Family, layers: &Layers) -> Result<Vec<(String, f64, f64)>, String> {
    let ratio = |a: &str, b: &str| -> Result<f64, String> {
        Ok(contrast_ratio(parse_hex(a)?, parse_hex(b)?))
    };
    contract()
        .promises
        .iter()
        .map(|p| {
            let foreground = role(family, &p.foreground).unwrap_or_default();
            let background = if p.own {
                role(family, &p.background)
            } else {
                layers.get(&p.background)
            }
            .unwrap_or_default();
            Ok((p.name.clone(), ratio(foreground, background)?, p.required))
        })
        .collect()
}

/// All promises in all families, with those that do not hold.
pub fn check_promises(
    families: &[(String, Family)],
    layers: &Layers,
) -> Result<Vec<Violation>, String> {
    let mut violations = Vec::new();
    for (name, family) in families {
        for (promise, ratio, required) in promises_for(family, layers)? {
            if ratio < required {
                violations.push(Violation {
                    family: name.clone(),
                    promise,
                    ratio,
                    required,
                });
            }
        }
    }
    Ok(violations)
}

/// The token name for one cell in the matrix.
pub fn token_name(family: &str, role: &str) -> String {
    format!("--lt-color-{family}-{role}")
}

pub struct Matrix {
    /// Token name to hex value, for one appearance.
    pub tokens: Vec<(String, String)>,
    /// Promises that do not hold. Empty when the matrix is in order.
    pub violations: Vec<Violation>,
    /// The families the tokens were written from, and the layers they are
    /// checked against.
    pub families: Vec<(String, Family)>,
    pub layers: Layers,
}

/// The promises about `fill` that would break if `given` itself were the
/// fill of `family`, with every other role and layer as the matrix has them.
///
/// The lightness of the fill is the role's, so the brand colour is moved.
/// This is the reason, in the contract's own terms.
pub fn breaks_as_fill(
    matrix: &Matrix,
    family: &str,
    given: &str,
) -> Result<Vec<Violation>, String> {
    let Some((_, roles)) = matrix.families.iter().find(|(n, _)| n == family) else {
        return Ok(Vec::new());
    };
    let as_fill: Family = roles
        .iter()
        .map(|(role, value)| {
            let value = if role == "fill" { given } else { value };
            (role.clone(), value.to_string())
        })
        .collect();
    let contract = contract();
    Ok(promises_for(&as_fill, &matrix.layers)?
        .into_iter()
        .zip(&contract.promises)
        .filter(|((_, ratio, required), promise)| {
            (promise.foreground == "fill" || promise.background == "fill") && ratio < required
        })
        .map(|((promise, ratio, required), _)| Violation {
            family: family.to_string(),
            promise,
            ratio,
            required,
        })
        .collect())
}

/// Builds the whole matrix for one appearance.
///
/// `neutral` gets `canvas` and `raised` in addition to its roles. They only
/// belong there: a red page is not a state the system has.
pub fn build_matrix(brands: &[(String, String)], appearance: Appearance) -> Result<Matrix, String> {
    let Some((_, neutral)) = brands.iter().find(|(n, _)| n == "neutral") else {
        return Err("The matrix needs a neutral family. It carries the page, the text and the borders, and the other families are checked against it.".into());
    };
    let families = brands
        .iter()
        .map(|(name, brand)| Ok((name.clone(), build_family(brand, appearance)?)))
        .collect::<Result<Vec<_>, String>>()?;

    // The layers are computed from the neutral hue, with even less chroma
    // than the surfaces: a page with hue in it looks painted, not neutral.
    let Oklch { c, h, .. } = rgb_to_oklch(parse_hex(neutral)?);
    let layer = |spec: &Spec| {
        to_hex(oklch_to_rgb(Oklch {
            l: spec.lightness(appearance),
            c: c * spec.chroma,
            h,
        }))
    };
    let neutral_family = &families.iter().find(|(n, _)| n == "neutral").unwrap().1;
    let layers = Layers {
        canvas: layer(&contract().canvas),
        surface: role(neutral_family, "surface")
            .unwrap_or_default()
            .to_string(),
        raised: layer(&contract().raised),
    };

    let mut tokens = Vec::new();
    for (name, family) in &families {
        for (role, hex) in family {
            tokens.push((token_name(name, &role_to_css(role)), hex.clone()));
        }
    }
    tokens.push((token_name("neutral", "canvas"), layers.canvas.clone()));
    tokens.push((token_name("neutral", "raised"), layers.raised.clone()));

    Ok(Matrix {
        violations: check_promises(&families, &layers)?,
        tokens,
        families,
        layers,
    })
}
