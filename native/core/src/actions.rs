//! Changes to a project (`src/actions.ts`): recipes that change a `Project` in place, for
//! `History::apply` and friends. Where the TypeScript asks the desk what's in view, these
//! take the visible desk area (`visible`, in desk inches).

#![allow(clippy::manual_clamp)] // min/max as the TypeScript does, for NaN parity

use std::collections::{HashMap, HashSet};

use crate::crop::{WHOLE, clean_crop, crop_from, crop_of, whole_rect};
use crate::geometry::{Rect, drop_box, fit_centered, page_rect, pile_size};
use crate::model::*;
use crate::{PhotoId, SpreadId};

/// Photos per row when several land on the desk at once.
pub const DESK_COLUMNS: usize = 6;
/// Space between desk photos, as a share of the largest one.
pub const DESK_GAP: f64 = 0.08;
/// How far a duplicate lands from its original (see `place_copies`).
pub const DUPLICATE_OFFSET: f64 = 0.25;

/// Sizes in a grid of `columns` from `origin`: cells as wide as the widest and as tall as
/// the tallest, each photo centered in its cell. The placements and the grid's bounds.
pub fn desk_grid(sizes: &[(f64, f64)], origin: (f64, f64), columns: usize) -> (Vec<Rect>, Rect) {
  let cw = sizes.iter().map(|s| s.0).fold(f64::NEG_INFINITY, f64::max);
  let ch = sizes.iter().map(|s| s.1).fold(f64::NEG_INFINITY, f64::max);
  let gap = cw.max(ch) * DESK_GAP;
  let cols = columns.min(sizes.len()).max(1);
  let rows = sizes.len().div_ceil(cols);
  let at = sizes
    .iter()
    .enumerate()
    .map(|(i, &(w, h))| {
      Rect::new(
        origin.0 + (i % cols) as f64 * (cw + gap) + (cw - w) / 2.0,
        origin.1 + (i / cols) as f64 * (ch + gap) + (ch - h) / 2.0,
        w,
        h,
      )
    })
    .collect();
  let bounds = Rect::new(
    origin.0,
    origin.1,
    cols as f64 * (cw + gap) - gap,
    rows as f64 * (ch + gap) - gap,
  );
  (at, bounds)
}

/// The bounds of every photo on the desk, if there are any.
pub fn pile_bounds(p: &Project) -> Option<Rect> {
  if p.pile.is_empty() {
    return None;
  }
  let x = p.pile.iter().map(|i| i.x).fold(f64::INFINITY, f64::min);
  let y = p.pile.iter().map(|i| i.y).fold(f64::INFINITY, f64::min);
  let r = p.pile.iter().map(|i| i.x + i.w).fold(f64::NEG_INFINITY, f64::max);
  let b = p.pile.iter().map(|i| i.y + i.h).fold(f64::NEG_INFINITY, f64::max);
  Some(Rect::new(x, y, r - x, b - y))
}

/// Add new photos to the desk, at full size, in rows of six below anything already there
/// (or at the top left of the view). Returns the grid's bounds, for the view to fit.
pub fn add_photos_to_pile(d: &mut Project, photos: Vec<PhotoMeta>, visible: Rect) -> Option<Rect> {
  if photos.is_empty() {
    return None;
  }
  let sizes: Vec<(f64, f64)> = photos.iter().map(pile_size).collect();
  let gap = sizes.iter().map(|s| s.0.max(s.1)).fold(f64::NEG_INFINITY, f64::max) * DESK_GAP;
  let origin = match pile_bounds(d) {
    Some(b) => (b.x, b.y + b.h + gap),
    None => (visible.x + gap, visible.y + gap),
  };
  let (at, bounds) = desk_grid(&sizes, origin, DESK_COLUMNS);
  for (photo, b) in photos.into_iter().zip(at) {
    let id = photo.id.clone();
    d.photos.insert(id.clone(), photo);
    let z = bump_z(d);
    d.pile.push(Placement {
      photo_id: id,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      z,
      border: None,
    });
  }
  Some(bounds)
}

/// The next z, taking it.
pub fn bump_z(d: &mut Project) -> f64 {
  let z = d.next_z;
  d.next_z += 1.0;
  z
}

/// A photo freshly dropped on a page: inside the drop border guide, centered on the page.
pub fn placement_on_page(d: &Project, photo_id: &PhotoId, side: PageSide) -> Option<Placement> {
  let photo = d.photos.get(photo_id)?;
  let sheet = d.sheet();
  let page = page_rect(side, &sheet);
  let r = fit_centered(photo, drop_box(side, &sheet), Some(page));
  Some(Placement {
    photo_id: photo_id.clone(),
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    z: 0.0,
    border: None,
  })
}

/// Where a photo is.
#[derive(Clone, Debug, PartialEq)]
pub enum Location {
  Desk,
  Spread(SpreadId),
}

/// Where a photo is placed, if anywhere.
pub fn locate(d: &Project, photo_id: &PhotoId) -> Option<(Location, Placement)> {
  if let Some(p) = d.pile.iter().find(|p| &p.photo_id == photo_id) {
    return Some((Location::Desk, p.clone()));
  }
  for s in d.layout.all() {
    if let Some(p) = s.items.iter().find(|p| &p.photo_id == photo_id) {
      return Some((Location::Spread(s.id.clone()), p.clone()));
    }
  }
  None
}

/// A photo's placement, to change, wherever it is.
pub fn placement_mut<'a>(d: &'a mut Project, photo_id: &PhotoId) -> Option<&'a mut Placement> {
  if let Some(i) = d.pile.iter().position(|p| &p.photo_id == photo_id) {
    return d.pile.get_mut(i);
  }
  d.layout
    .all_mut()
    .into_iter()
    .flat_map(|s| s.items.iter_mut())
    .find(|p| &p.photo_id == photo_id)
}

/// A spread (or frame), to change.
pub fn spread_mut<'a>(d: &'a mut Project, id: &SpreadId) -> Option<&'a mut Spread> {
  d.layout.all_mut().into_iter().find(|s| &s.id == id)
}

/// What the pointer is over during a drag: where dropping photos puts them.
#[derive(Clone, Debug, PartialEq)]
pub enum DropTarget {
  Page {
    spread: SpreadId,
    side: PageSide,
  },
  Desk,
  /// The desk strip at the bottom of the spread editor.
  Strip,
  /// The gap before spread `index` in the sidebar: dropping there adds a spread.
  Insert(usize),
}

/// What dropping photos on a target does. Pages fit and center them; gaps between spreads
/// add a spread; the desk (at `at`, in desk inches) and the strip return them to the desk.
pub fn drop_photos(d: &mut Project, target: &DropTarget, ids: &[PhotoId], at: Option<(f64, f64)>, visible: Rect) {
  match target {
    DropTarget::Page { spread, side } => put_on_page(d, ids, spread, *side),
    DropTarget::Insert(index) => put_on_new_spread(d, ids, *index),
    DropTarget::Desk | DropTarget::Strip => {
      let at = if *target == DropTarget::Desk { at } else { None };
      for id in ids {
        put_in_pile(d, id, at, visible);
      }
    }
  }
}

/// Bring a clicked photo to the front of its desk or spread, unless it's already there.
pub fn raise(d: &mut Project, photo_id: &PhotoId) {
  let Some((loc, p)) = locate(d, photo_id) else { return };
  let among: Vec<f64> = match &loc {
    Location::Desk => d.pile.iter().map(|i| i.z).collect(),
    Location::Spread(s) => d
      .find_spread(s)
      .map(|s| s.items.iter().map(|i| i.z).collect())
      .unwrap_or_default(),
  };
  if among.iter().any(|&z| z > p.z) {
    let z = bump_z(d);
    if let Some(p) = placement_mut(d, photo_id) {
      p.z = z;
    }
  }
}

fn remove_from_spreads(d: &mut Project, id: &PhotoId) {
  for s in d.layout.all_mut() {
    s.items.retain(|i| &i.photo_id != id);
  }
}

/// Put photos onto a page (from anywhere), each centered and fitted.
pub fn put_on_page(d: &mut Project, ids: &[PhotoId], spread: &SpreadId, side: PageSide) {
  if d.find_spread(spread).is_none() {
    return;
  }
  for id in ids {
    let Some(mut p) = placement_on_page(d, id, side) else {
      continue;
    };
    d.pile.retain(|i| &i.photo_id != id);
    remove_from_spreads(d, id);
    p.z = bump_z(d);
    if let Some(s) = spread_mut(d, spread) {
      s.items.push(p);
    }
  }
}

/// Where a spread inserted before book position `index` goes among a book's middle spreads.
pub fn middle_index(len: usize, index: usize) -> usize {
  index.saturating_sub(1).min(len)
}

/// Add a spread (a book's middle spread, or a frame) before position `index`; its id.
pub fn add_spread(d: &mut Project, index: usize) -> SpreadId {
  let id = SpreadId::new();
  match &mut d.layout {
    Layout::Spreads { spreads, .. } => {
      let at = middle_index(spreads.len(), index);
      let mut s = Spread::empty(SpreadKind::Middle);
      s.id = id.clone();
      spreads.insert(at, s);
    }
    Layout::Frames { frames } => {
      let at = index.min(frames.len());
      let mut s = Spread::empty(SpreadKind::Frame);
      s.id = id.clone();
      frames.insert(at, s);
    }
  }
  id
}

/// Add a spread before position `index` with photos on it (a new spread's left page).
pub fn put_on_new_spread(d: &mut Project, ids: &[PhotoId], index: usize) {
  let id = add_spread(d, index);
  let side = match d.layout {
    Layout::Spreads { .. } => PageSide::Left,
    Layout::Frames { .. } => PageSide::Whole,
  };
  put_on_page(d, ids, &id, side);
}

/// Return a photo to the desk, centered on a desk point (or the clear spot nearest the
/// middle of the view).
pub fn put_in_pile(d: &mut Project, id: &PhotoId, at: Option<(f64, f64)>, visible: Rect) {
  let Some(photo) = d.photos.get(id) else { return };
  let (w, h) = pile_size(photo);
  remove_from_spreads(d, id);
  if d.pile.iter().any(|p| &p.photo_id == id) {
    return;
  }
  let (x, y) = match at {
    Some((x, y)) => (x - w / 2.0, y - h / 2.0),
    None => free_spot(
      &d.pile,
      (w, h),
      (visible.x + visible.w / 2.0, visible.y + visible.h / 2.0),
    ),
  };
  let z = bump_z(d);
  d.pile.push(Placement {
    photo_id: id.clone(),
    x,
    y,
    w,
    h,
    z,
    border: None,
  });
}

/// Where a photo of `size` can go on the desk without overlapping any other (a gap
/// apart): the clear spot nearest `near`, in widening rings. Its top-left corner.
pub fn free_spot(pile: &[Placement], size: (f64, f64), near: (f64, f64)) -> (f64, f64) {
  let (w, h) = size;
  let gap = DESK_GAP * w.max(h);
  let step = (w + gap, h + gap);
  let clear = |x: f64, y: f64| {
    pile
      .iter()
      .all(|p| x + w + gap <= p.x || p.x + p.w + gap <= x || y + h + gap <= p.y || p.y + p.h + gap <= y)
  };
  let origin = (near.0 - w / 2.0, near.1 - h / 2.0);
  for ring in 0..=40i32 {
    let mut best: Option<(f64, f64, f64)> = None;
    for i in -ring..=ring {
      for j in -ring..=ring {
        if i.abs().max(j.abs()) != ring {
          continue;
        }
        let x = origin.0 + f64::from(i) * step.0;
        let y = origin.1 + f64::from(j) * step.1;
        let dist = (f64::from(i) * step.0).hypot(f64::from(j) * step.1);
        if clear(x, y) && best.is_none_or(|b| dist < b.2) {
          best = Some((x, y, dist));
        }
      }
    }
    if let Some((x, y, _)) = best {
      return (x, y);
    }
  }
  origin
}

/// Arrange desk photos in a tidy grid, keeping their rough reading order. Tidies `ids` if
/// there are two or more, otherwise the whole desk; rows wider than the view wrap.
pub fn tidy_pile(d: &mut Project, ids: &[PhotoId], visible: Rect) {
  let only: Option<HashSet<&PhotoId>> = (ids.len() > 1).then(|| ids.iter().collect());
  let items: Vec<Placement> = d
    .pile
    .iter()
    .filter(|p| only.as_ref().is_none_or(|s| s.contains(&p.photo_id)))
    .cloned()
    .collect();
  if items.len() < 2 {
    return;
  }
  let big = items.iter().map(|p| p.w.max(p.h)).fold(f64::NEG_INFINITY, f64::max);
  let cell = big + big * DESK_GAP;
  let cy = |p: &Placement| p.y + p.h / 2.0;
  let cx = |p: &Placement| p.x + p.w / 2.0;
  let mut sorted = items.clone();
  sorted.sort_by(|a, b| cy(a).total_cmp(&cy(b)));
  let mut rows: Vec<Vec<Placement>> = Vec::new();
  for p in sorted {
    match rows.last_mut() {
      Some(row) if cy(&p) - cy(&row[0]) < cell / 2.0 => row.push(p),
      _ => rows.push(vec![p]),
    }
  }
  let left = items.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
  let top = items.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
  let cols = (((visible.x + visible.w - left) / cell).floor() as i64).max(1) as usize;
  let mut slot: HashMap<PhotoId, (usize, usize)> = HashMap::new();
  let mut grid_row = 0;
  for mut row in rows {
    row.sort_by(|a, b| cx(a).total_cmp(&cx(b)));
    for (i, p) in row.iter().enumerate() {
      slot.insert(p.photo_id.clone(), (i % cols, grid_row + i / cols));
    }
    grid_row += row.len().div_ceil(cols);
  }
  for p in &mut d.pile {
    if let Some(&(c, r)) = slot.get(&p.photo_id) {
      p.x = left + c as f64 * cell + (big - p.w) / 2.0;
      p.y = top + r as f64 * cell + (big - p.h) / 2.0;
    }
  }
}

/// "IMG_2103.jpg" → "IMG_2103 copy.jpg".
pub fn copy_name(name: &str) -> String {
  match name.rfind('.') {
    Some(dot) if dot > 0 => format!("{} copy{}", &name[..dot], &name[dot..]),
    _ => format!("{name} copy"),
  }
}

/// A photo being copied: the original, and the new photo's id.
#[derive(Clone, Debug, PartialEq)]
pub struct PhotoCopy {
  pub from: PhotoId,
  pub id: PhotoId,
}

/// New ids for copies of these photos.
pub fn copies_of(ids: &[PhotoId]) -> Vec<PhotoCopy> {
  ids
    .iter()
    .map(|from| PhotoCopy {
      from: from.clone(),
      id: PhotoId::new(),
    })
    .collect()
}

/// Add copies: each a new photo ("… copy") where its original is, above everything,
/// `offset` down and right (on a page, in proportion to a 10 in page).
pub fn place_copies(d: &mut Project, copies: &[PhotoCopy], offset: f64, visible: Rect) {
  let on_spread = offset * d.page.w / 10.0;
  for c in copies {
    let Some(meta) = d.photos.get(&c.from).cloned() else {
      continue;
    };
    d.photos.insert(
      c.id.clone(),
      PhotoMeta {
        id: c.id.clone(),
        name: copy_name(&meta.name),
        ..meta
      },
    );
    let Some((loc, p)) = locate(d, &c.from) else {
      put_in_pile(d, &c.id, None, visible);
      continue;
    };
    let step = if loc == Location::Desk {
      offset * p.w.max(p.h) / 2.0
    } else {
      on_spread
    };
    let z = bump_z(d);
    let copy = Placement {
      photo_id: c.id.clone(),
      x: p.x + step,
      y: p.y + step,
      z,
      ..p
    };
    match loc {
      Location::Desk => d.pile.push(copy),
      Location::Spread(s) => {
        if let Some(s) = spread_mut(d, &s) {
          s.items.push(copy);
        }
      }
    }
  }
}

/// Crop a photo, or show all of it (none): its frame changes to show the new crop, and the
/// photo stays where it was under it.
pub fn set_crop(d: &mut Project, id: &PhotoId, crop: Option<Crop>) {
  let Some(photo) = d.photos.get(id) else { return };
  let old = crop_of(photo);
  if let Some(p) = placement_mut(d, id) {
    let whole = whole_rect(Rect::from(&*p), old);
    let c = crop.unwrap_or(WHOLE);
    p.x = whole.x + c.x * whole.w;
    p.y = whole.y + c.y * whole.h;
    p.w = c.w * whole.w;
    p.h = c.h * whole.h;
  }
  if let Some(photo) = d.photos.get_mut(id) {
    photo.crop = crop;
  }
}

/// A crop made in crop mode: the frame where it's been dragged, over the whole photo at `whole`.
pub fn set_crop_frame(d: &mut Project, id: &PhotoId, frame: Rect, whole: Rect) {
  if !d.photos.contains_key(id) {
    return;
  }
  let crop = clean_crop(crop_from(frame, whole));
  let r = if crop.is_some() { frame } else { whole };
  let Some(p) = placement_mut(d, id) else { return };
  p.x = r.x;
  p.y = r.y;
  p.w = r.w;
  p.h = r.h;
  if let Some(photo) = d.photos.get_mut(id) {
    photo.crop = crop;
  }
}

/// Remove photos from the project.
pub fn delete_photos(d: &mut Project, ids: &[PhotoId]) {
  let gone: HashSet<&PhotoId> = ids.iter().collect();
  d.pile.retain(|p| !gone.contains(&p.photo_id));
  for s in d.layout.all_mut() {
    s.items.retain(|p| !gone.contains(&p.photo_id));
  }
  d.photos.retain(|id, _| !gone.contains(id));
}

/// Whether a spread can move or be deleted: a book's middle spreads, and any frame.
pub fn is_movable(kind: SpreadKind) -> bool {
  matches!(kind, SpreadKind::Middle | SpreadKind::Frame)
}

/// Delete spreads (or frames), their photos back on the desk in a small grid in the middle
/// of the view. A book's first and last spreads stay, and so does a sequence's last frame.
pub fn delete_spreads(d: &mut Project, ids: &[SpreadId], visible: Rect) {
  let doomed: HashSet<&SpreadId> = ids.iter().collect();
  let removed: Vec<Spread> = match &mut d.layout {
    Layout::Spreads { spreads, .. } => {
      let (gone, kept) = spreads.drain(..).partition(|s| doomed.contains(&s.id));
      *spreads = kept;
      gone
    }
    Layout::Frames { frames } => {
      let (mut gone, mut kept): (Vec<Spread>, Vec<Spread>) = frames.drain(..).partition(|s| doomed.contains(&s.id));
      if kept.is_empty() {
        kept.push(gone.remove(0));
      }
      *frames = kept;
      gone
    }
  };
  let ids: Vec<PhotoId> = removed
    .iter()
    .flat_map(|s| s.items.iter().map(|i| i.photo_id.clone()))
    .collect();
  let sizes: Vec<(f64, f64)> = ids.iter().filter_map(|id| d.photos.get(id).map(pile_size)).collect();
  if sizes.is_empty() {
    return;
  }
  let (_, bounds) = desk_grid(&sizes, (0.0, 0.0), 4);
  let (at, _) = desk_grid(
    &sizes,
    (
      visible.x + (visible.w - bounds.w) / 2.0,
      visible.y + (visible.h - bounds.h) / 2.0,
    ),
    4,
  );
  for (id, b) in ids.iter().zip(at) {
    put_in_pile(d, id, Some((b.x + b.w / 2.0, b.y + b.h / 2.0)), visible);
  }
}

/// Move spreads (or frames) together, keeping their order, to just before position
/// `drop_index` in the whole run (counted before they're taken out).
pub fn move_spreads(d: &mut Project, ids: &[SpreadId], drop_index: usize) {
  let moving: HashSet<&SpreadId> = ids.iter().collect();
  let reorder = |run: &mut Vec<Spread>, at: usize| {
    let i = at.min(run.len());
    let (before, after) = run.split_at(i);
    let stays = |s: &&Spread| !moving.contains(&s.id);
    let next: Vec<Spread> = before
      .iter()
      .filter(stays)
      .chain(run.iter().filter(|s| moving.contains(&s.id)))
      .chain(after.iter().filter(stays))
      .cloned()
      .collect();
    *run = next;
  };
  match &mut d.layout {
    Layout::Spreads { spreads, .. } => reorder(spreads, drop_index.saturating_sub(1)),
    Layout::Frames { frames } => reorder(frames, drop_index),
  }
}

/// Page labels: "1", "2–3", counting a book's single first and last pages; a frame's number.
pub fn spread_label(index: usize, total: usize, arrangement: Arrangement) -> String {
  if arrangement == Arrangement::Frames || index == 0 {
    return (index + 1).to_string();
  }
  let left = index * 2;
  if index == total - 1 {
    return left.to_string();
  }
  format!("{}–{}", left, left + 1)
}

/// Folio-style labels, zero-padded: "01", "02–03", … or "01", "02", … for frames.
pub fn folio_label(index: usize, total: usize, arrangement: Arrangement) -> String {
  let count = if arrangement == Arrangement::Spreads {
    total * 2
  } else {
    total
  };
  let width = count.to_string().len().max(2);
  spread_label(index, total, arrangement)
    .split('–')
    .map(|n| format!("{n:0>width$}"))
    .collect::<Vec<_>>()
    .join("–")
}

#[cfg(test)]
mod tests {
  use super::*;

  fn photo(id: &str, w: f64, h: f64) -> PhotoMeta {
    PhotoMeta {
      id: PhotoId::from(id),
      name: format!("{id}.jpg"),
      px_w: w,
      px_h: h,
      crop: None,
    }
  }

  const VIEW: Rect = Rect::new(0.0, 0.0, 20.0, 12.0);

  #[test]
  fn photos_go_to_pages_and_back() {
    let mut d = Project::empty();
    add_photos_to_pile(&mut d, vec![photo("a", 3000.0, 2000.0)], VIEW);
    assert_eq!(d.pile.len(), 1);
    let first = d.layout.all()[1].id.clone();
    let a = PhotoId::from("a");
    drop_photos(
      &mut d,
      &DropTarget::Page {
        spread: first.clone(),
        side: PageSide::Left,
      },
      std::slice::from_ref(&a),
      None,
      VIEW,
    );
    assert!(d.pile.is_empty());
    assert_eq!(locate(&d, &a).map(|l| l.0), Some(Location::Spread(first)));
    drop_photos(&mut d, &DropTarget::Strip, std::slice::from_ref(&a), None, VIEW);
    assert_eq!(locate(&d, &a).map(|l| l.0), Some(Location::Desk));
  }

  #[test]
  fn inserting_adds_a_spread() {
    let mut d = Project::empty();
    add_photos_to_pile(&mut d, vec![photo("a", 100.0, 100.0)], VIEW);
    drop_photos(&mut d, &DropTarget::Insert(1), &[PhotoId::from("a")], None, VIEW);
    assert_eq!(d.layout.all().len(), 5);
    assert_eq!(d.layout.all()[1].items.len(), 1);
  }

  #[test]
  fn labels() {
    assert_eq!(folio_label(0, 4, Arrangement::Spreads), "01");
    assert_eq!(folio_label(1, 4, Arrangement::Spreads), "02–03");
    assert_eq!(folio_label(3, 4, Arrangement::Spreads), "06");
    assert_eq!(folio_label(9, 10, Arrangement::Frames), "10");
    assert_eq!(copy_name("IMG.jpg"), "IMG copy.jpg");
    assert_eq!(copy_name(".hidden"), ".hidden copy");
  }

  #[test]
  fn moving_spreads_keeps_the_ends() {
    let mut d = Project::empty();
    let ids: Vec<SpreadId> = d.layout.all().iter().map(|s| s.id.clone()).collect();
    move_spreads(&mut d, &[ids[2].clone()], 1);
    let after: Vec<SpreadId> = d.layout.all().iter().map(|s| s.id.clone()).collect();
    assert_eq!(
      after,
      vec![ids[0].clone(), ids[2].clone(), ids[1].clone(), ids[3].clone()]
    );
  }

  #[test]
  fn deleting_frames_keeps_one() {
    let mut d = Project::empty();
    d.layout = Layout::Frames {
      frames: vec![Spread::empty(SpreadKind::Frame), Spread::empty(SpreadKind::Frame)],
    };
    let ids: Vec<SpreadId> = d.layout.all().iter().map(|s| s.id.clone()).collect();
    delete_spreads(&mut d, &ids, VIEW);
    assert_eq!(d.layout.all().len(), 1);
  }

  #[test]
  fn tidying_lines_up() {
    let mut d = Project::empty();
    add_photos_to_pile(
      &mut d,
      vec![photo("a", 1400.0, 1400.0), photo("b", 1400.0, 1400.0)],
      VIEW,
    );
    d.pile[1].x += 3.3;
    d.pile[1].y += 0.4;
    tidy_pile(&mut d, &[], Rect::new(0.0, 0.0, 200.0, 100.0));
    assert_eq!(d.pile[0].y, d.pile[1].y);
  }
}
