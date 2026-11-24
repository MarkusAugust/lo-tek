//! Palettes to go with an accent: a colour for each family an organisation
//! seldom has one for.
//!
//! A role takes the hue and the chroma of a brand colour and has a lightness
//! of its own, so a suggestion is made at the lightness of `fill` in the
//! light appearance: the colour shown is the fill the theme gets, and not a
//! colour the theme then moves.

use super::color::{oklch_to_rgb, parse_hex, rgb_to_oklch, to_hex, Oklch};
use super::contract::contract;
use super::read;
use crate::json::Json;

/// The palettes for a recipe, and the accent they are built on.
pub struct Palettes {
    /// The accent as `#rrggbb`: the recipe's, or LO-TEK's own when the
    /// recipe gives none.
    pub from: String,
    pub palettes: Vec<Palette>,
}

/// One palette: its name, what it is in a sentence, and a colour for each
/// family it has one for.
pub struct Palette {
    pub name: String,
    pub description: String,
    pub colors: Vec<PaletteColor>,
}

/// The colour of one family in a palette.
pub struct PaletteColor {
    pub family: String,
    pub color: String,
    /// The colour is the recipe's own, and not a suggestion.
    pub kept: bool,
}

/// The families that are the same in every palette, and the three the
/// palettes differ in.
const SHARED: [&str; 2] = ["visited", "neutral"];
const BRANDS: [&str; 3] = ["brand1", "brand2", "brand3"];
/// The order of the rows.
const ROWS: [&str; 5] = ["visited", "brand1", "brand2", "brand3", "neutral"];
/// The families that carry a meaning, which a brand colour must not be
/// taken for.
const STATUSES: [&str; 3] = ["danger", "warning", "success"];

/// How near the hue of a status a suggestion may be, in degrees, and how
/// near an earlier colour of the palette one that is moved may land.
const CLEAR_OF_STATUS: f64 = 25.0;
const CLEAR_OF_EARLIER: f64 = 15.0;
/// Below this chroma a colour is a grey, and its hue says nothing.
const GREY: f64 = 0.02;

/// A palette as it is made: for each of the three, the hue from the accent
/// in degrees and the share of its chroma.
struct Make {
    name: &'static str,
    description: &'static str,
    turns: [f64; 3],
    shares: [f64; 3],
}

const MAKES: [Make; 4] = [
    Make {
        name: "Near",
        description: "The hues beside the accent on the colour wheel.",
        turns: [30.0, -30.0, 60.0],
        shares: [1.0; 3],
    },
    Make {
        name: "Opposite",
        description: "The hues across the colour wheel from the accent.",
        turns: [180.0, 150.0, 210.0],
        shares: [1.0; 3],
    },
    Make {
        name: "Three ways",
        description: "Three hues that share the colour wheel evenly with the accent.",
        turns: [90.0, 180.0, 270.0],
        shares: [1.0; 3],
    },
    Make {
        name: "One hue",
        description: "The hue of the accent, in three saturations.",
        turns: [0.0; 3],
        shares: [0.75, 0.5, 0.25],
    },
];

/// How far apart two hues are, in degrees.
fn apart(a: f64, b: f64) -> f64 {
    let d = (a - b).rem_euclid(360.0);
    d.min(360.0 - d)
}

/// The hues the three get: the ones meant, with each that is too near a
/// status moved to the nearest hue that is clear, a degree at a time and
/// upwards first. One that is moved also stays clear of an earlier colour
/// meant for another hue, so that two do not end up as one.
fn placed(intended: [f64; 3], statuses: &[f64]) -> [f64; 3] {
    let clear = |hue: f64| statuses.iter().all(|s| apart(hue, *s) >= CLEAR_OF_STATUS);
    let mut out = intended;
    for i in 0..3 {
        if clear(intended[i]) {
            continue;
        }
        let found = (1..=180)
            .flat_map(|d| [intended[i] + f64::from(d), intended[i] - f64::from(d)])
            .find(|hue| {
                clear(*hue)
                    && (0..i).all(|j| {
                        apart(intended[j], intended[i]) < 0.001
                            || apart(*hue, out[j]) >= CLEAR_OF_EARLIER
                    })
            });
        // Three statuses cannot close the whole wheel, but a recipe may
        // give them any hues: then the colour stands where it was meant.
        if let Some(hue) = found {
            out[i] = hue;
        }
    }
    out
}

/// The fill a brand colour gets in the light appearance.
fn fill_of(color: Oklch, lightness: f64) -> String {
    to_hex(oklch_to_rgb(Oklch {
        l: lightness,
        c: color.c,
        h: color.h,
    }))
}

/// The colour with this hue and chroma that is its own fill. Written as hex
/// a colour is rounded, and the fill of a fill is not always the fill, so
/// it is asked again until it is, with a little less chroma if it never is.
fn own_fill(hue: f64, chroma: f64, lightness: f64) -> String {
    let mut chroma = chroma;
    loop {
        let mut hex = fill_of(
            Oklch {
                l: lightness,
                c: chroma,
                h: hue.rem_euclid(360.0),
            },
            lightness,
        );
        for _ in 0..64 {
            let next = match parse_hex(&hex) {
                Ok(rgb) => fill_of(rgb_to_oklch(rgb), lightness),
                Err(_) => return hex,
            };
            if next == hex {
                return hex;
            }
            hex = next;
        }
        if chroma < 0.001 {
            return hex;
        }
        chroma *= 0.97;
    }
}

/// Four palettes to go with the accent of a recipe: Near, Opposite, Three
/// ways and One hue, each with a colour for visited, the three brand
/// families and neutral. The status families are never suggested.
///
/// A family the recipe gives a colour stands as it is, as `kept`, and one
/// whose value the core refuses has no row, so a host that fills a form
/// from a palette writes over nothing. Visited and neutral are the same in
/// all four, and stand to the accent as LO-TEK's own stand to LO-TEK's
/// accent.
///
/// `None` when the recipe is not an object, and when its accent is not a
/// colour: half a colour has no palettes.
pub fn suggest_palettes(input: &Json) -> Option<Palettes> {
    if !matches!(input, Json::Object(_)) {
        return None;
    }
    let contract = contract();
    let (values, problems) = read(input);
    let refused = |family: &str| problems.iter().any(|p| p.path == [family]);
    // The colour the recipe gives a family, when the core takes it.
    let given = |family: &str| -> Option<String> {
        if refused(family) {
            return None;
        }
        let value = values.iter().find(|v| v.path == [family])?;
        parse_hex(&value.text).ok().map(to_hex)
    };
    let own = |family: &str| -> Option<Oklch> {
        let (_, hex) = contract.brands.iter().find(|(name, _)| name == family)?;
        parse_hex(hex).ok().map(rgb_to_oklch)
    };
    if refused("accent") {
        return None;
    }
    let from = match given("accent") {
        Some(accent) => accent,
        None => to_hex(parse_hex(&contract.brands.iter().find(|(n, _)| n == "accent")?.1).ok()?),
    };
    let accent = rgb_to_oklch(parse_hex(&from).ok()?);
    let our_accent = own("accent")?;
    let lightness = contract
        .roles
        .iter()
        .find(|(role, _)| role == "fill")
        .map(|(_, spec)| spec.light)?;

    // A grey has no hue to keep clear of anything, and a status that is a
    // grey none to keep clear of.
    let statuses: Vec<f64> = if accent.c < GREY {
        Vec::new()
    } else {
        STATUSES
            .iter()
            .filter_map(|status| {
                given(status)
                    .and_then(|hex| parse_hex(&hex).ok().map(rgb_to_oklch))
                    .or_else(|| own(status))
            })
            .filter(|color| color.c >= GREY)
            .map(|color| color.h)
            .collect()
    };

    let shared: Vec<(&str, String)> = SHARED
        .iter()
        .filter_map(|family| {
            let ours = own(family)?;
            let share = if our_accent.c > 0.0 {
                ours.c / our_accent.c
            } else {
                0.0
            };
            Some((
                *family,
                own_fill(
                    accent.h + (ours.h - our_accent.h),
                    accent.c * share,
                    lightness,
                ),
            ))
        })
        .collect();

    let palettes = MAKES
        .iter()
        .map(|make| {
            let hues = placed(make.turns.map(|turn| accent.h + turn), &statuses);
            let colors = ROWS
                .iter()
                .filter(|family| !refused(family))
                .filter_map(|family| {
                    if let Some(color) = given(family) {
                        return Some(PaletteColor {
                            family: family.to_string(),
                            color,
                            kept: true,
                        });
                    }
                    let color = match BRANDS.iter().position(|brand| brand == family) {
                        Some(i) => own_fill(hues[i], accent.c * make.shares[i], lightness),
                        None => shared.iter().find(|(name, _)| name == family)?.1.clone(),
                    };
                    Some(PaletteColor {
                        family: family.to_string(),
                        color,
                        kept: false,
                    })
                })
                .collect();
            Palette {
                name: make.name.to_string(),
                description: make.description.to_string(),
                colors,
            }
        })
        .collect();
    Some(Palettes { from, palettes })
}
