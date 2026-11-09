//! Whether photos have enough detail for the page's resolution (`src/resolution.ts`). One
//! measure works for any unit: how many of the photo's pixels there are per output pixel it
//! covers (the page's units times its pxPerUnit). Below 1, it has less detail than the page
//! asks for. Too much detail isn't flagged: exports downsample.

use crate::crop::visible_size;
use crate::model::{PhotoMeta, Placement, Project, Sheet, Unit};
use crate::units::js_round;
use crate::{PhotoId, SpreadId};

/// Under this is a warning; a hair under 1 (from rounding in the fields) isn't.
pub const COVERAGE_MIN: f64 = 0.99;

/// The photo's pixels per output pixel it covers, on its thinner axis. 1 or more: enough.
pub fn coverage(photo: &PhotoMeta, item: &Placement, px_per_unit: f64) -> f64 {
  let (w, h) = visible_size(photo);
  (w / (item.w * px_per_unit)).min(h / (item.h * px_per_unit))
}

pub fn is_soft(c: f64) -> bool {
  c < COVERAGE_MIN
}

/// Whether a placed photo has less detail than the page asks for.
pub fn placed_soft(photo: Option<&PhotoMeta>, item: &Placement, px_per_unit: f64) -> bool {
  photo.is_some_and(|p| is_soft(coverage(p, item, px_per_unit)))
}

/// What the inspector says about a placed photo's detail: in inches, its resolution on
/// the page; in pixels, how much it's enlarged, only when it is. With whether it's soft.
pub fn resolution_note(photo: &PhotoMeta, item: &Placement, sheet: &Sheet) -> Option<(String, bool)> {
  let c = coverage(photo, item, sheet.px_per_unit);
  let soft = is_soft(c);
  if sheet.unit == Unit::In {
    let (w, h) = visible_size(photo);
    let dpi = js_round((w / item.w).min(h / item.h));
    let text = if soft {
      format!(
        "This image is {dpi} dpi, which is below the project’s {} dpi.",
        sheet.px_per_unit
      )
    } else {
      format!("This image is {dpi} dpi.")
    };
    return Some((text, soft));
  }
  soft.then(|| (format!("This image is enlarged {}%.", js_round(100.0 / c)), true))
}

/// A placed photo, and the spread it's on.
#[derive(Clone, Debug, PartialEq)]
pub struct Located {
  pub photo_id: PhotoId,
  pub spread_id: SpreadId,
}

/// Placed photos with less detail than the page asks for (or an export's `px_per_unit`),
/// in book order.
pub fn soft_photos(project: &Project, px_per_unit: Option<f64>) -> Vec<Located> {
  let k = px_per_unit.unwrap_or(project.sheet().px_per_unit);
  project
    .layout
    .all()
    .into_iter()
    .flat_map(|spread| {
      spread
        .items
        .iter()
        .filter(|item| placed_soft(project.photos.get(&item.photo_id), item, k))
        .map(|item| Located {
          photo_id: item.photo_id.clone(),
          spread_id: spread.id.clone(),
        })
    })
    .collect()
}

/// The soft photo after `current` in book order (from the start, with none or after the
/// last), or None if there's no other.
pub fn next_soft_photo(project: &Project, current: Option<&PhotoId>) -> Option<Located> {
  let soft = soft_photos(project, None);
  let at = soft.iter().position(|s| Some(&s.photo_id) == current);
  if !soft.iter().any(|s| Some(&s.photo_id) != current) {
    return None;
  }
  let next = at.map_or(0, |i| (i + 1) % soft.len());
  soft.into_iter().nth(next)
}

fn photos(count: usize) -> String {
  format!("{count} {}", if count == 1 { "photo" } else { "photos" })
}

/// "2 photos below 300 dpi", or "2 photos enlarged".
pub fn soft_label(count: usize, unit: Unit, px_per_unit: f64) -> String {
  if unit == Unit::In {
    format!("{} below {px_per_unit} dpi", photos(count))
  } else {
    format!("{} enlarged", photos(count))
  }
}

/// "2 photos are below 300 dpi.", or "1 photo is enlarged." (`would`: for a draft).
pub fn soft_sentence(count: usize, unit: Unit, px_per_unit: f64, would: bool) -> String {
  let verb = if would {
    "would be"
  } else if count == 1 {
    "is"
  } else {
    "are"
  };
  if unit == Unit::In {
    format!("{} {verb} below {px_per_unit} dpi.", photos(count))
  } else {
    format!("{} {verb} enlarged.", photos(count))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sentences() {
    assert_eq!(soft_label(2, Unit::In, 300.0), "2 photos below 300 dpi");
    assert_eq!(soft_sentence(1, Unit::Px, 1.0, false), "1 photo is enlarged.");
    assert_eq!(
      soft_sentence(3, Unit::In, 240.0, true),
      "3 photos would be below 240 dpi."
    );
  }

  #[test]
  fn soft_in_the_book_fixture() {
    let json = serde_json::from_str(include_str!("../../../shared/fixtures/book.json")).expect("json");
    let project = crate::schema::migrate_project(&json).expect("a project");
    let all = soft_photos(&project, Some(1e6));
    assert!(!all.is_empty());
    assert!(soft_photos(&project, Some(1e-6)).is_empty());
    let first = next_soft_photo(&project, None);
    let k = project.sheet().px_per_unit;
    assert_eq!(first, soft_photos(&project, Some(k)).into_iter().next());
  }
}
