//! Photos decoded for drawing, each only as large as it's drawn. A photo is decoded at one
//! of a few sizes (`Level`): the smaller ones from its display copy, the larger ones from
//! its original. Decodes run in the background; until one lands, the nearest size already
//! decoded is drawn. What's decoded is kept within a memory budget, letting go of what
//! hasn't been drawn for longest.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gpui_kit::RenderImage;
use sequence_core::PhotoId;
use sequence_core::geometry::DESK_PHOTO_PX;

/// The longest sides photos are decoded at, in pixels. Up to the display copy's size
/// (`DESK_PHOTO_PX`) they're read from it; past it, from the original.
const SIDES: [f64; 6] = [175.0, 350.0, 700.0, DESK_PHOTO_PX, 2800.0, 5600.0];

/// About how much decoded photos may take, in bytes (4 a pixel).
pub const BUDGET: usize = 512 * 1024 * 1024;

/// A size a photo is decoded at: one of `SIDES`, or past them its full size. Never past
/// the photo's own size.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Level(u8);

impl Level {
  /// The photo at its own size (drawn larger than the largest of `SIDES`).
  pub const FULL: Level = Level(SIDES.len() as u8);

  /// Every level, smallest first.
  fn all() -> impl DoubleEndedIterator<Item = Level> {
    (0..=SIDES.len() as u8).map(Level)
  }

  /// The longest side it's decoded at, for a photo `photo` px on its longest side.
  pub fn side(self, photo: f64) -> f64 {
    let photo = known(photo);
    SIDES.get(usize::from(self.0)).map_or(photo, |&s| s.min(photo))
  }

  /// Whether it's read from the original (else from the display copy).
  pub fn is_original(self) -> bool {
    SIDES.get(usize::from(self.0)).is_none_or(|&s| s > DESK_PHOTO_PX)
  }
}

/// A photo's longest side, or the display copy's when it isn't known (then the original
/// is never read).
fn known(photo: f64) -> f64 {
  if photo > 0.0 { photo } else { DESK_PHOTO_PX }
}

/// The smallest level that covers a photo drawn `drawn` device pixels on its longest side,
/// for a photo `photo` px on its longest side: no larger than the photo itself.
pub fn level_for(drawn: f64, photo: f64) -> Level {
  let photo = known(photo);
  Level::all()
    .find(|l| SIDES.get(usize::from(l.0)).is_none_or(|&s| s >= drawn || s >= photo))
    .unwrap_or(Level::FULL)
}

/// A photo at a level: what's decoded, and what's asked for.
pub type Key = (PhotoId, Level);

/// A decode to start: the photo (whose files to read), its level, and its longest side.
#[derive(Clone, Debug, PartialEq)]
pub struct Decode {
  pub key: Key,
  pub side: f64,
  /// Which request this is, so a decode that lands after its photo was let go is dropped.
  pub ticket: u64,
}

struct Entry<T> {
  image: T,
  bytes: usize,
  /// The frame it was last drawn in.
  last: u64,
}

/// Decoded photos, by photo and level, within a budget (`T` is the decoded image; plain
/// values in tests). Each frame, what's drawn is asked for with `get`; `end_frame` then
/// gives the decodes to start and lets go of what's over the budget, which `take_evicted`
/// hands over for the window to drop.
pub struct PhotoCache<T> {
  entries: HashMap<Key, Entry<T>>,
  /// Decodes under way, by their tickets.
  in_flight: HashMap<Key, u64>,
  /// Decodes asked for this frame, not yet started.
  wanted: Vec<Decode>,
  /// What couldn't be read (a missing file): not tried again until the photo changes.
  failed: HashSet<Key>,
  /// Photos drawn with another's pictures (a copy before its files are made, or after).
  aliases: HashMap<PhotoId, PhotoId>,
  evicted: Vec<T>,
  frame: u64,
  next_ticket: u64,
  used: usize,
  budget: usize,
}

impl<T: Clone> PhotoCache<T> {
  /// An empty cache that keeps about `budget` bytes.
  pub fn new(budget: usize) -> Self {
    Self {
      entries: HashMap::new(),
      in_flight: HashMap::new(),
      wanted: Vec::new(),
      failed: HashSet::new(),
      aliases: HashMap::new(),
      evicted: Vec::new(),
      frame: 0,
      next_ticket: 0,
      used: 0,
      budget,
    }
  }

  /// The photo whose pictures `id` is drawn with (its own, unless it's an alias).
  pub fn source(&self, id: &PhotoId) -> PhotoId {
    self.aliases.get(id).unwrap_or(id).clone()
  }

  /// The picture to draw a photo with, drawn `drawn` device pixels on its longest side
  /// (the whole photo's, not just its crop), `photo` px on its own longest side. When the
  /// level it needs isn't decoded, its decode is asked for, and the nearest level that is
  /// is given meanwhile (larger first), or None.
  pub fn get(&mut self, id: &PhotoId, drawn: f64, photo: f64) -> Option<T> {
    let id = self.source(id);
    let mut want = level_for(drawn, photo);
    // A level that couldn't be read: the next smaller one (an original that's missing: the
    // display copy).
    while self.failed.contains(&(id.clone(), want)) && want.0 > 0 {
      want = Level(want.0 - 1);
    }
    let key = (id.clone(), want);
    if let Some(e) = self.entries.get_mut(&key) {
      e.last = self.frame;
      return Some(e.image.clone());
    }
    if !self.failed.contains(&key) && !self.in_flight.contains_key(&key) {
      let ticket = self.next_ticket;
      self.next_ticket += 1;
      self.in_flight.insert(key.clone(), ticket);
      self.wanted.push(Decode {
        key,
        side: want.side(photo),
        ticket,
      });
    }
    let larger = Level::all().filter(|l| *l > want);
    let smaller = Level::all().rev().filter(|l| *l < want);
    for l in larger.chain(smaller) {
      if let Some(e) = self.entries.get_mut(&(id.clone(), l)) {
        e.last = self.frame;
        return Some(e.image.clone());
      }
    }
    None
  }

  /// A decode finished: its image and its size in bytes, or None if it couldn't be read.
  /// Dropped if its photo was let go since it was asked for.
  pub fn landed(&mut self, d: &Decode, image: Option<(T, usize)>) {
    if self.in_flight.get(&d.key) != Some(&d.ticket) {
      return;
    }
    self.in_flight.remove(&d.key);
    match image {
      Some((image, bytes)) => {
        self.used += bytes;
        let was = self.entries.insert(
          d.key.clone(),
          Entry {
            image,
            bytes,
            last: self.frame,
          },
        );
        if let Some(was) = was {
          self.used -= was.bytes;
          self.evicted.push(was.image);
        }
      }
      None => {
        // Its file is missing or unreadable: so for every level read from that file.
        let original = d.key.1.is_original();
        for l in Level::all().filter(|l| l.is_original() == original) {
          self.failed.insert((d.key.0.clone(), l));
        }
      }
    }
  }

  /// The end of a frame: the decodes it asked for, to start; and over the budget, what
  /// was drawn longest ago is let go (never what this frame drew).
  pub fn end_frame(&mut self) -> Vec<Decode> {
    if self.used > self.budget {
      let mut old: Vec<(u64, Key)> = self
        .entries
        .iter()
        .filter(|(_, e)| e.last < self.frame)
        .map(|(k, e)| (e.last, k.clone()))
        .collect();
      old.sort_by_key(|(last, _)| *last);
      for (_, k) in old {
        if self.used <= self.budget {
          break;
        }
        self.evict(&k);
      }
    }
    self.frame += 1;
    std::mem::take(&mut self.wanted)
  }

  fn evict(&mut self, key: &Key) {
    if let Some(e) = self.entries.remove(key) {
      self.used -= e.bytes;
      self.evicted.push(e.image);
    }
  }

  /// What's been let go since the last call, for the window to drop.
  pub fn take_evicted(&mut self) -> Vec<T> {
    std::mem::take(&mut self.evicted)
  }

  /// Draw `to` with `from`'s pictures (a copy, until it's drawn from its own files).
  pub fn alias(&mut self, from: &PhotoId, to: &PhotoId) {
    let from = self.source(from);
    if from != *to {
      self.forget(to);
      self.aliases.insert(to.clone(), from);
    }
  }

  /// Let go of a photo whose files changed or went: its pictures, its decodes under way,
  /// and what couldn't be read. Copies drawn with its pictures go back to their own.
  pub fn forget(&mut self, id: &PhotoId) {
    let keys: Vec<Key> = Level::all().map(|l| (id.clone(), l)).collect();
    for k in &keys {
      self.evict(k);
      self.in_flight.remove(k);
      self.failed.remove(k);
    }
    self.wanted.retain(|d| d.key.0 != *id);
    self.aliases.remove(id);
    self.aliases.retain(|_, from| from != id);
  }

  /// Let go of everything (another project).
  pub fn clear(&mut self) {
    self.evicted.extend(self.entries.drain().map(|(_, e)| e.image));
    self.used = 0;
    self.in_flight.clear();
    self.wanted.clear();
    self.failed.clear();
    self.aliases.clear();
  }

  /// The bytes kept.
  #[cfg(test)]
  fn used(&self) -> usize {
    self.used
  }
}

/// A decoded photo as the window draws it, from its pixels (`imageio::bgra`), with its
/// size in bytes.
pub fn render_image(w: u32, h: u32, bgra: Vec<u8>) -> Option<(Arc<RenderImage>, usize)> {
  let bytes = bgra.len();
  let buffer = image::RgbaImage::from_raw(w, h, bgra)?;
  Some((Arc::new(RenderImage::new(vec![image::Frame::new(buffer)])), bytes))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn levels_cover_what_is_drawn() {
    let big = 6000.0;
    assert_eq!(level_for(100.0, big), Level(0));
    assert_eq!(level_for(175.0, big), Level(0));
    assert_eq!(level_for(176.0, big), Level(1));
    assert_eq!(level_for(1400.0, big), Level(3));
    assert_eq!(level_for(1401.0, big), Level(4));
    assert_eq!(level_for(5000.0, big), Level(5));
    assert_eq!(level_for(5601.0, big), Level::FULL);
    assert_eq!(Level::FULL.side(big), big);
    assert!(!Level(3).is_original() && Level(4).is_original() && Level::FULL.is_original());
  }

  #[test]
  fn levels_stop_at_the_photo() {
    // Smaller than the display copy: never read from the original.
    assert_eq!(level_for(3000.0, 1000.0), Level(3));
    assert_eq!(Level(3).side(1000.0), 1000.0);
    assert_eq!(level_for(300.0, 200.0), Level(1));
    // A little larger: the first original level, at the photo's size.
    assert_eq!(level_for(9000.0, 1500.0), Level(4));
    assert_eq!(Level(4).side(1500.0), 1500.0);
    // Its size unknown: the display copy at most.
    assert_eq!(level_for(9000.0, 0.0), Level(3));
  }

  fn id(s: &str) -> PhotoId {
    PhotoId::from(s)
  }

  #[test]
  fn a_miss_asks_once_and_draws_what_is_there() {
    let mut c: PhotoCache<u32> = PhotoCache::new(1000);
    let a = id("a");
    assert_eq!(c.get(&a, 100.0, 4000.0), None);
    assert_eq!(c.get(&a, 120.0, 4000.0), None);
    let asked = c.end_frame();
    assert_eq!(asked.len(), 1, "one decode for the same level");
    assert_eq!(asked[0].key, (a.clone(), Level(0)));
    assert_eq!(asked[0].side, 175.0);
    c.landed(&asked[0], Some((1, 10)));
    assert_eq!(c.get(&a, 100.0, 4000.0), Some(1));
    // Drawn larger: the smaller one meanwhile.
    assert_eq!(c.get(&a, 600.0, 4000.0), Some(1));
    let asked = c.end_frame();
    assert_eq!(asked[0].key.1, Level(2));
    c.landed(&asked[0], Some((3, 10)));
    // Drawn small again: the larger one is nearer than none, but the small one is there.
    assert_eq!(c.get(&a, 100.0, 4000.0), Some(1));
    // A level between: the nearest larger.
    assert_eq!(c.get(&a, 300.0, 4000.0), Some(3));
    assert!(c.end_frame().iter().all(|d| d.key.1 == Level(1)));
  }

  #[test]
  fn a_missing_original_falls_back_to_the_display_copy() {
    let mut c: PhotoCache<u32> = PhotoCache::new(1000);
    let a = id("a");
    c.get(&a, 2500.0, 4000.0);
    let asked = c.end_frame();
    assert_eq!(asked[0].key.1, Level(4));
    c.landed(&asked[0], None);
    c.get(&a, 2500.0, 4000.0);
    let asked = c.end_frame();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].key.1, Level(3), "the display copy, without trying 2800 again");
  }

  #[test]
  fn over_the_budget_what_was_drawn_longest_ago_goes() {
    let mut c: PhotoCache<u32> = PhotoCache::new(25);
    let (a, b, d) = (id("a"), id("b"), id("d"));
    for (n, p) in [&a, &b, &d].into_iter().enumerate() {
      c.get(p, 100.0, 4000.0);
      let asked = c.end_frame();
      c.landed(&asked[0], Some((n as u32, 10)));
    }
    assert_eq!(c.used(), 30);
    // All three drawn this frame: none goes, though it's over.
    for p in [&a, &b, &d] {
      c.get(p, 100.0, 4000.0);
    }
    c.end_frame();
    assert_eq!(c.used(), 30);
    assert!(c.take_evicted().is_empty());
    // Then only b and d: a goes.
    c.get(&b, 100.0, 4000.0);
    c.get(&d, 100.0, 4000.0);
    c.end_frame();
    assert_eq!(c.used(), 20);
    assert_eq!(c.take_evicted(), vec![0]);
    assert_eq!(c.get(&b, 100.0, 4000.0), Some(1));
  }

  #[test]
  fn a_copy_draws_its_originals_pictures() {
    let mut c: PhotoCache<u32> = PhotoCache::new(1000);
    let (a, b) = (id("a"), id("b"));
    c.get(&a, 100.0, 4000.0);
    let asked = c.end_frame();
    c.landed(&asked[0], Some((7, 10)));
    c.alias(&a, &b);
    assert_eq!(c.get(&b, 100.0, 4000.0), Some(7));
    assert!(c.end_frame().is_empty());
    // The original goes: the copy is drawn from its own files.
    c.forget(&a);
    assert_eq!(c.take_evicted(), vec![7]);
    assert_eq!(c.get(&b, 100.0, 4000.0), None);
    assert_eq!(c.end_frame()[0].key.0, b);
  }

  #[test]
  fn decodes_landing_after_their_photo_went_are_dropped() {
    let mut c: PhotoCache<u32> = PhotoCache::new(1000);
    let a = id("a");
    c.get(&a, 100.0, 4000.0);
    let old = c.end_frame();
    c.forget(&a);
    c.get(&a, 100.0, 4000.0);
    let new = c.end_frame();
    c.landed(&old[0], Some((1, 10)));
    assert_eq!(c.used(), 0);
    c.landed(&new[0], Some((2, 10)));
    assert_eq!(c.get(&a, 100.0, 4000.0), Some(2));
    // Another project: everything goes.
    c.clear();
    assert_eq!(c.take_evicted(), vec![2]);
    assert_eq!(c.used(), 0);
  }
}
