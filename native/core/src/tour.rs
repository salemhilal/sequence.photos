//! The tour's sample project (`src/tour.ts`): three photos on the desk, and three in the
//! book (the first page, and the first two-page spread), so Preview and Export open on a
//! photo. At 150 dpi, which the small samples have enough detail for, so none is marked.

use crate::PhotoId;
use crate::actions::put_on_page;
use crate::geometry::pile_size;
use crate::model::{PageSide, PhotoMeta, Placement, Project};

/// The samples, by name: their photos are `tour-<name>`, from `<name>.jpg`.
pub const SAMPLES: [&str; 6] = ["taxi", "spire", "reflections", "door", "leaves", "lily"];
/// Every sample's size.
pub const SAMPLE_PX: (f64, f64) = (795.0, 1200.0);
/// The sample desk photos' spacing, as a share of their width.
pub const SAMPLE_STEP: f64 = 1.12;
/// How many samples are on the desk; the rest are in the book.
pub const ON_DESK: usize = 3;

/// A sample's photo id.
pub fn sample_id(name: &str) -> PhotoId {
  PhotoId::from(format!("tour-{name}").as_str())
}

/// The sample project.
pub fn sample_project() -> Project {
  let mut project = Project::empty();
  project.page.px_per_unit = 150.0;
  for (i, name) in SAMPLES.iter().enumerate() {
    let photo = PhotoMeta {
      id: sample_id(name),
      name: format!("{name}.jpg"),
      px_w: SAMPLE_PX.0,
      px_h: SAMPLE_PX.1,
      crop: None,
    };
    project.photos.insert(photo.id.clone(), photo.clone());
    if i >= ON_DESK {
      continue;
    }
    let (w, h) = pile_size(&photo);
    // A loose row, like prints set down by hand.
    let z = project.next_z;
    project.next_z += 1.0;
    project.pile.push(Placement {
      photo_id: photo.id,
      x: i as f64 * w * SAMPLE_STEP,
      y: [0.05, 0.0, 0.12][i] * h,
      w,
      h,
      z,
      border: None,
    });
  }
  let spreads: Vec<_> = project.layout.all().iter().map(|s| s.id.clone()).collect();
  if let [first, spread, ..] = spreads.as_slice() {
    put_on_page(&mut project, &[sample_id("door")], first, PageSide::Right);
    put_on_page(&mut project, &[sample_id("leaves")], spread, PageSide::Left);
    put_on_page(&mut project, &[sample_id("lily")], spread, PageSide::Right);
  }
  project
}

/// The desk view that shows the sample photos in a desk `w` × `h` pixels, at `ppi` pixels
/// to the desk inch: (zoom, pan x, pan y), leaving room below for the tour's card.
pub fn frame_samples(w: f64, h: f64, ppi: f64) -> (f64, f64, f64) {
  let probe = PhotoMeta {
    id: PhotoId::from("tour"),
    name: String::new(),
    px_w: SAMPLE_PX.0,
    px_h: SAMPLE_PX.1,
    crop: None,
  };
  let (pw, ph) = pile_size(&probe);
  let bw = (ON_DESK - 1) as f64 * pw * SAMPLE_STEP + pw;
  let bh = ph * 1.12;
  let zoom = 1f64.min(w * 0.8 / (bw * ppi)).min(h * 0.5 / (bh * ppi));
  (zoom, (w - bw * ppi * zoom) / 2.0, (h - bh * ppi * zoom) / 3.0)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sample() {
    let p = sample_project();
    assert_eq!(p.photos.len(), 6);
    assert_eq!(p.pile.len(), 3);
    let placed: usize = p.layout.all().iter().map(|s| s.items.len()).sum();
    assert_eq!(placed, 3);
  }
}
