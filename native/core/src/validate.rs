//! Checking a whole project before the app uses it (`src/validate.ts`). Projects come from
//! outside the code's control (a file someone opened), so this is where their shape is
//! established: every field of the right type and in range, every id unique, every
//! placement's photo real, and each photo in one place at most. It builds the Project as it
//! goes, so what comes out holds only what was checked.

use std::collections::HashSet;

use indexmap::IndexMap;
use serde_json::{Map, Value};

use crate::crop::clean_crop;
use crate::model::*;
use crate::{GuideId, PhotoId, SpreadId};

/// A damaged project, naming the first problem.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvalidProject(pub String);

impl std::fmt::Display for InvalidProject {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "Damaged project ({})", self.0)
  }
}

impl std::error::Error for InvalidProject {}

type Result<T> = std::result::Result<T, InvalidProject>;
type Raw = Map<String, Value>;

fn fail<T>(where_: impl Into<String>) -> Result<T> {
  Err(InvalidProject(where_.into()))
}

fn record<'a>(v: Option<&'a Value>, where_: &str) -> Result<&'a Raw> {
  match v {
    Some(Value::Object(m)) => Ok(m),
    _ => fail(where_),
  }
}

fn list<'a>(v: Option<&'a Value>, where_: &str) -> Result<&'a Vec<Value>> {
  match v {
    Some(Value::Array(a)) => Ok(a),
    _ => fail(where_),
  }
}

fn text(v: Option<&Value>, where_: &str) -> Result<String> {
  match v {
    Some(Value::String(s)) if !s.is_empty() => Ok(s.clone()),
    _ => fail(where_),
  }
}

fn finite(v: Option<&Value>) -> Option<f64> {
  v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// A finite number, at least `min` (above it, with `above`).
fn num(v: Option<&Value>, where_: &str, min: f64, above: bool) -> Result<f64> {
  match finite(v) {
    Some(n) if (above && n > min) || (!above && n >= min) => Ok(n),
    _ => fail(where_),
  }
}

fn any_num(v: Option<&Value>, where_: &str) -> Result<f64> {
  num(v, where_, f64::NEG_INFINITY, false)
}

fn positive(v: Option<&Value>, where_: &str) -> Result<f64> {
  num(v, where_, 0.0, true)
}

fn bool_(v: Option<&Value>, where_: &str) -> Result<bool> {
  match v {
    Some(Value::Bool(b)) => Ok(*b),
    _ => fail(where_),
  }
}

/// Fails on a repeated id, so each one names exactly one thing.
fn unique(seen: &mut HashSet<String>, id: String, where_: &str) -> Result<String> {
  if !seen.insert(id.clone()) {
    return fail(format!("{where_}: repeated id"));
  }
  Ok(id)
}

/// A photo's crop, kept inside the photo; a damaged one is left out.
fn crop_of(v: Option<&Value>) -> Option<Crop> {
  let c = v?.as_object()?;
  let n = |k: &str| finite(c.get(k));
  clean_crop(Crop {
    x: n("x")?,
    y: n("y")?,
    w: n("w")?,
    h: n("h")?,
  })
}

fn photo(v: &Value, key: &str, where_: &str) -> Result<PhotoMeta> {
  let p = record(Some(v), where_)?;
  let id = text(p.get("id"), &format!("{where_}.id"))?;
  if id != key {
    return fail(format!("{where_}.id"));
  }
  let name = match p.get("name") {
    Some(Value::String(s)) => s.clone(),
    _ => return fail(format!("{where_}.name")),
  };
  Ok(PhotoMeta {
    id: PhotoId(id),
    name,
    px_w: positive(p.get("pxW"), &format!("{where_}.pxW"))?,
    px_h: positive(p.get("pxH"), &format!("{where_}.pxH"))?,
    crop: crop_of(p.get("crop")),
  })
}

fn ink_of(v: Option<&Value>) -> Option<Ink> {
  match v.and_then(Value::as_str) {
    Some("white") => Some(Ink::White),
    Some("black") => Some(Ink::Black),
    _ => None,
  }
}

/// A photo's border; a damaged one is left out rather than refusing the project.
fn border_of(v: Option<&Value>) -> Option<PhotoBorder> {
  let b = v?.as_object()?;
  let width = finite(b.get("width")).filter(|w| *w > 0.0)?;
  Some(PhotoBorder {
    width,
    color: ink_of(b.get("color"))?,
  })
}

struct Placements<'a> {
  placed: HashSet<String>,
  photos: &'a IndexMap<PhotoId, PhotoMeta>,
}

impl Placements<'_> {
  fn item(&mut self, v: &Value, where_: &str) -> Result<Placement> {
    let p = record(Some(v), where_)?;
    let photo_id = text(p.get("photoId"), &format!("{where_}.photoId"))?;
    if !self.photos.contains_key(&PhotoId(photo_id.clone())) {
      return fail(format!("{where_}.photoId: no such photo"));
    }
    // One place per photo: the desk, or one spread, once.
    let photo_id = unique(&mut self.placed, photo_id, &format!("{where_}.photoId"))?;
    Ok(Placement {
      photo_id: PhotoId(photo_id),
      x: any_num(p.get("x"), &format!("{where_}.x"))?,
      y: any_num(p.get("y"), &format!("{where_}.y"))?,
      w: positive(p.get("w"), &format!("{where_}.w"))?,
      h: positive(p.get("h"), &format!("{where_}.h"))?,
      z: any_num(p.get("z"), &format!("{where_}.z"))?,
      border: border_of(p.get("border")),
    })
  }

  fn spread(&mut self, v: Option<&Value>, kind: SpreadKind, ids: &mut HashSet<String>, where_: &str) -> Result<Spread> {
    let s = record(v, where_)?;
    let expected = serde_json::to_value(kind).unwrap_or(Value::Null);
    if s.get("kind") != Some(&expected) {
      return fail(format!("{where_}.kind"));
    }
    let id = unique(
      ids,
      text(s.get("id"), &format!("{where_}.id"))?,
      &format!("{where_}.id"),
    )?;
    let items = list(s.get("items"), &format!("{where_}.items"))?
      .iter()
      .enumerate()
      .map(|(i, p)| self.item(p, &format!("{where_}.items[{i}]")))
      .collect::<Result<Vec<_>>>()?;
    // White is the default, kept as none; an unknown color is too.
    let background = ink_of(s.get("background")).filter(|i| *i == Ink::Black);
    Ok(Spread {
      kind,
      id: SpreadId(id),
      items,
      background,
    })
  }

  fn layout(&mut self, v: Option<&Value>) -> Result<Layout> {
    let l = record(v, "layout")?;
    let mut ids = HashSet::new();
    match l.get("kind").and_then(Value::as_str) {
      Some("spreads") => {
        let first_spread = self.spread(l.get("firstSpread"), SpreadKind::First, &mut ids, "layout.firstSpread")?;
        let spreads = list(l.get("spreads"), "layout.spreads")?
          .iter()
          .enumerate()
          .map(|(i, s)| self.spread(Some(s), SpreadKind::Middle, &mut ids, &format!("layout.spreads[{i}]")))
          .collect::<Result<Vec<_>>>()?;
        let last_spread = self.spread(l.get("lastSpread"), SpreadKind::Last, &mut ids, "layout.lastSpread")?;
        Ok(Layout::Spreads {
          first_spread,
          spreads,
          last_spread,
        })
      }
      Some("frames") => {
        let frames = list(l.get("frames"), "layout.frames")?
          .iter()
          .enumerate()
          .map(|(i, s)| self.spread(Some(s), SpreadKind::Frame, &mut ids, &format!("layout.frames[{i}]")))
          .collect::<Result<Vec<_>>>()?;
        if frames.is_empty() {
          return fail("layout.frames: none");
        }
        Ok(Layout::Frames { frames })
      }
      _ => fail("layout.kind"),
    }
  }
}

fn border(v: &Value, ids: &mut HashSet<String>, where_: &str) -> Result<BorderGuide> {
  let g = record(Some(v), where_)?;
  let id = GuideId(unique(
    ids,
    text(g.get("id"), &format!("{where_}.id"))?,
    &format!("{where_}.id"),
  )?);
  let d = |k: &str| num(g.get(k), &format!("{where_}.{k}"), 0.0, false);
  let shape = match g.get("kind").and_then(Value::as_str) {
    Some("even") => BorderShape::Even { inset: d("inset")? },
    Some("edges") => BorderShape::Edges(Edges {
      top: d("top")?,
      bottom: d("bottom")?,
      inside: d("inside")?,
      outside: d("outside")?,
    }),
    _ => return fail(format!("{where_}.kind")),
  };
  Ok(BorderGuide { id, shape })
}

fn line(v: &Value, ids: &mut HashSet<String>, where_: &str) -> Result<LineGuide> {
  let g = record(Some(v), where_)?;
  let id = GuideId(unique(
    ids,
    text(g.get("id"), &format!("{where_}.id"))?,
    &format!("{where_}.id"),
  )?);
  let axis = match g.get("axis").and_then(Value::as_str) {
    Some("vertical") => Axis::Vertical,
    Some("horizontal") => Axis::Horizontal,
    _ => return fail(format!("{where_}.axis")),
  };
  Ok(LineGuide {
    id,
    axis,
    at: any_num(g.get("at"), &format!("{where_}.at"))?,
  })
}

fn settings(v: Option<&Value>) -> Result<Settings> {
  let s = record(v, "settings")?;
  let mut ids = HashSet::new();
  let borders = list(s.get("borders"), "settings.borders")?
    .iter()
    .enumerate()
    .map(|(i, g)| border(g, &mut ids, &format!("settings.borders[{i}]")))
    .collect::<Result<Vec<_>>>()?;
  let lines = list(s.get("lines"), "settings.lines")?
    .iter()
    .enumerate()
    .map(|(i, g)| line(g, &mut ids, &format!("settings.lines[{i}]")))
    .collect::<Result<Vec<_>>>()?;
  // A drop guide that's gone isn't damage: it means the largest.
  let drop_border = match s.get("dropBorder") {
    Some(Value::Null) => None,
    other => Some(GuideId(text(other, "settings.dropBorder")?)),
  };
  Ok(Settings {
    center_v: bool_(s.get("centerV"), "settings.centerV")?,
    center_h: bool_(s.get("centerH"), "settings.centerH")?,
    keep_relative: bool_(s.get("keepRelative"), "settings.keepRelative")?,
    borders,
    lines,
    drop_border,
  })
}

fn page(v: Option<&Value>) -> Result<PageSetup> {
  let p = record(v, "page")?;
  let unit = match p.get("unit").and_then(Value::as_str) {
    Some("in") => Unit::In,
    Some("px") => Unit::Px,
    _ => return fail("page.unit"),
  };
  Ok(PageSetup {
    w: positive(p.get("w"), "page.w")?,
    h: positive(p.get("h"), "page.h")?,
    unit,
    px_per_unit: positive(p.get("pxPerUnit"), "page.pxPerUnit")?,
  })
}

fn within(v: Option<&Value>, min: f64, max: f64) -> Option<f64> {
  finite(v).filter(|n| *n >= min && *n <= max)
}

fn one_of<T: serde::de::DeserializeOwned>(v: Option<&Value>) -> Option<T> {
  v.filter(|v| v.is_string())
    .and_then(|v| serde_json::from_value(v.clone()).ok())
}

/// Room for a caption Instagram would take, with some to spare.
const MAX_CAPTION: usize = 10_000;
const MAX_CHOSEN: usize = 1_000;

fn tagged_username(s: &str) -> bool {
  (1..=30).contains(&s.len())
    && s
      .bytes()
      .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_')
}

/// The first `n` UTF-16 units of a string, as JavaScript's `slice(0, n)` keeps them (a
/// surrogate pair cut in half is dropped).
fn js_slice(s: &str, n: usize) -> String {
  let mut units = 0;
  let mut out = String::new();
  for c in s.chars() {
    units += c.len_utf16();
    if units > n {
      break;
    }
    out.push(c);
  }
  out
}

/// The Export choices, checked leniently: any that's damaged is left out.
fn export_state(v: Option<&Value>) -> Option<ExportState> {
  let v = v?.as_object()?;
  let mut state = ExportState {
    to: one_of(v.get("to")),
    ..Default::default()
  };
  if let Some(o) = v.get("options").and_then(Value::as_object) {
    state.options = Some(ExportOptions {
      per: one_of(o.get("per")),
      format: one_of(o.get("format")),
      quality: within(o.get("quality"), 0.0, 1.0),
      print_at: within(o.get("printAt"), 1.0, 10_000.0),
    });
  }
  if let Some(ig) = v.get("instagram").and_then(Value::as_object) {
    let chosen = ig.get("chosen").and_then(Value::as_array).map(|a| {
      a.iter()
        .filter_map(|k| k.as_str().map(str::to_owned))
        .take(MAX_CHOSEN)
        .collect::<Vec<_>>()
    });
    let mut tags = IndexMap::new();
    if let Some(t) = ig.get("tags").and_then(Value::as_object) {
      for (key, list) in t {
        let Some(list) = list.as_array() else { continue };
        if key == "__proto__" {
          continue;
        }
        let kept: Vec<Tag> = list
          .iter()
          .filter_map(|t| {
            let t = t.as_object()?;
            let username = t.get("username")?.as_str().filter(|u| tagged_username(u))?;
            Some(Tag {
              username: username.into(),
              x: within(t.get("x"), 0.0, 1.0)?,
              y: within(t.get("y"), 0.0, 1.0)?,
            })
          })
          .take(20)
          .collect();
        if !kept.is_empty() {
          tags.insert(key.clone(), kept);
        }
      }
    }
    state.instagram = Some(InstagramState {
      kind: one_of(ig.get("kind")),
      fit: one_of(ig.get("fit")),
      caption: ig
        .get("caption")
        .and_then(Value::as_str)
        .map(|c| js_slice(c, MAX_CAPTION)),
      chosen,
      tags: if tags.is_empty() { None } else { Some(tags) },
    });
  }
  Some(state)
}

/// The project, checked; fails, naming the first problem, if it's damaged.
pub fn validate_project(v: &Value) -> Result<Project> {
  let d = record(Some(v), "project")?;
  if d.get("schemaVersion").and_then(Value::as_f64) != Some(f64::from(CURRENT_SCHEMA)) {
    return fail("schemaVersion");
  }

  let mut photos = IndexMap::new();
  for (key, p) in record(d.get("photos"), "photos")? {
    // In JavaScript, as a key, it would set the table's prototype rather than file a photo.
    if key == "__proto__" {
      return fail("photos.__proto__");
    }
    photos.insert(PhotoId(key.clone()), photo(p, key, &format!("photos.{key}"))?);
  }

  let mut placements = Placements {
    placed: HashSet::new(),
    photos: &photos,
  };
  let pile = list(d.get("pile"), "pile")?
    .iter()
    .enumerate()
    .map(|(i, p)| placements.item(p, &format!("pile[{i}]")))
    .collect::<Result<Vec<_>>>()?;
  let layout = placements.layout(d.get("layout"))?;

  // New placements go on top: nextZ stays above every z (repaired if it isn't).
  let declared = any_num(d.get("nextZ"), "nextZ")?;
  let next_z = pile
    .iter()
    .chain(layout.all().into_iter().flat_map(|s| s.items.iter()))
    .map(|p| p.z + 1.0)
    .fold(declared, f64::max);

  let page = page(d.get("page"))?;
  let settings = settings(d.get("settings"))?;
  Ok(Project {
    schema_version: CURRENT_SCHEMA,
    photos,
    pile,
    page,
    layout,
    settings,
    next_z,
    export: export_state(d.get("export")),
  })
}
