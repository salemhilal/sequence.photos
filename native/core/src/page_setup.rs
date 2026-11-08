//! Changing a project's page: its arrangement, unit, and size (`src/convertLayout.ts`), and
//! the Layout view's Page tab, a draft of those applied together as one step
//! (`src/pageSetup.ts`). Each step is pure.

use crate::geometry::{Rect, clamp_border, page_rect, page_sides, relayout_rect, side_at};
use crate::model::{
  Arrangement, BorderShape, Layout, PageSetup, PageSide, Placement, Project, Spread, SpreadKind, Unit,
};
use crate::units::{DEFAULT_DPI, PRESETS, Preset};
use crate::{Sheet, SpreadId};

/// Every placement on every page, changed by `f`.
fn map_items(layout: &mut Layout, mut f: impl FnMut(&mut Placement)) {
  for s in layout.all_mut() {
    for p in &mut s.items {
      f(p);
    }
  }
}

/// Re-paginate, keeping the page size and unit.
///
/// Spreads → frames: each page becomes a frame, in book order. Each photo goes to the page
/// holding its center (a single page takes all of its spread's), and may hang off its edge.
///
/// Frames → spreads: the first frame becomes the first (right) page, the rest pair up into
/// spreads, and one left over becomes the last (left) page. A book turned into frames and
/// back comes back with the same spreads.
pub fn rearrange(project: &Project, arrangement: Arrangement) -> Project {
  let mut out = project.clone();
  if project.layout.arrangement() == arrangement {
    return out;
  }
  let from = project.sheet();
  // A page's photos onto their new page: measured from the old page's left edge (`shift`),
  // placed on the new layout's page (a book's left page sits left of the gutter).
  let fit = |items: &[Placement], shift: f64, to_left_page: bool| -> Vec<Placement> {
    items
      .iter()
      .map(|p| Placement {
        x: p.x - shift - if to_left_page { from.page_w } else { 0.0 },
        ..p.clone()
      })
      .collect()
  };
  match (&project.layout, arrangement) {
    (Layout::Spreads { .. }, Arrangement::Frames) => {
      let mut frames = Vec::new();
      for spread in project.layout.all() {
        let sides = page_sides(spread.kind);
        for (i, &side) in sides.iter().enumerate() {
          let mine: Vec<Placement> = spread
            .items
            .iter()
            .filter(|p| sides.len() == 1 || side_at(&from, p.x + p.w / 2.0) == side)
            .cloned()
            .collect();
          let shift = if side == PageSide::Left {
            page_rect(PageSide::Left, &from).x
          } else {
            0.0
          };
          frames.push(Spread {
            kind: SpreadKind::Frame,
            id: if i == 0 { spread.id.clone() } else { SpreadId::new() },
            items: fit(&mine, shift, false),
            background: spread.background,
          });
        }
      }
      if frames.is_empty() {
        return out;
      }
      out.layout = Layout::Frames { frames };
    }
    (Layout::Frames { frames }, Arrangement::Spreads) => {
      let Some((first, others)) = frames.split_first() else {
        return out;
      };
      let mut spreads = Vec::new();
      let mut last = Spread::empty(SpreadKind::Last);
      let mut i = 0;
      while i < others.len() {
        let left = &others[i];
        let Some(right) = others.get(i + 1) else {
          last = Spread {
            kind: SpreadKind::Last,
            id: left.id.clone(),
            items: fit(&left.items, 0.0, true),
            background: None,
          };
          break;
        };
        let mut items = fit(&left.items, 0.0, true);
        items.extend(fit(&right.items, 0.0, false));
        spreads.push(Spread {
          kind: SpreadKind::Middle,
          id: left.id.clone(),
          items,
          background: None,
        });
        i += 2;
      }
      out.layout = Layout::Spreads {
        first_spread: Spread {
          kind: SpreadKind::First,
          id: first.id.clone(),
          items: fit(&first.items, 0.0, false),
          background: None,
        },
        spreads,
        last_spread: last,
      };
    }
    _ => {}
  }
  out
}

/// Every stored size and position on the pages (the page, its photos, and its guides)
/// multiplied by `f`, now in `unit`. The desk isn't touched: it's always inches.
pub fn scale_project(project: &Project, f: f64, unit: Unit, px_per_unit: f64) -> Project {
  let mut p = project.clone();
  for g in &mut p.settings.borders {
    match &mut g.shape {
      BorderShape::Even { inset } => *inset *= f,
      BorderShape::Edges(e) => {
        e.top *= f;
        e.bottom *= f;
        e.inside *= f;
        e.outside *= f;
      }
    }
  }
  for l in &mut p.settings.lines {
    l.at *= f;
  }
  map_items(&mut p.layout, |i| {
    i.x *= f;
    i.y *= f;
    i.w *= f;
    i.h *= f;
    if let Some(b) = &mut i.border {
      b.width *= f;
    }
  });
  p.page = PageSetup {
    w: project.page.w * f,
    h: project.page.h * f,
    unit,
    px_per_unit,
  };
  p
}

/// The project in another unit, at the same physical size: multiplied by the dpi (inches →
/// pixels) or divided by it. Not rounded, so a round trip comes back.
pub fn convert_units(project: &Project, unit: Unit, dpi: f64) -> Project {
  if project.page.unit == unit {
    return project.clone();
  }
  match unit {
    Unit::Px => scale_project(project, dpi, Unit::Px, 1.0),
    Unit::In => scale_project(project, 1.0 / dpi, Unit::In, dpi),
  }
}

/// What photos kept fixed on a resized page stay put relative to: each page's top-left
/// corner, its center, or (spreads) its inside edge, at the gutter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Anchor {
  TopLeft,
  Center,
  Inside,
}

/// How far a photo kept fixed moves when its page changes size by (dw, dh). A left page
/// grows leftward from the gutter.
pub fn anchor_shift(anchor: Anchor, side: PageSide, dw: f64, dh: f64) -> (f64, f64) {
  let left = side == PageSide::Left;
  match anchor {
    Anchor::Center => (if left { -dw / 2.0 } else { dw / 2.0 }, dh / 2.0),
    Anchor::TopLeft if left => (-dw, 0.0),
    _ => (0.0, 0.0),
  }
}

/// The page at a new size: border guides stay on the page, and photos keep their place
/// relative to the guides (`relative`) or stay fixed relative to `anchor`.
pub fn resize_page(project: &Project, w: f64, h: f64, relative: bool, anchor: Anchor) -> Project {
  let from = project.sheet();
  let mut p = project.clone();
  if from.page_w == w && from.page_h == h {
    return p;
  }
  let to = Sheet {
    page_w: w,
    page_h: h,
    ..from.clone()
  };
  for g in &mut p.settings.borders {
    clamp_border(g, to.unit, w, h);
  }
  let (dw, dh) = (w - from.page_w, h - from.page_h);
  map_items(&mut p.layout, |i| {
    if relative {
      let r = relayout_rect(Rect::new(i.x, i.y, i.w, i.h), &from, &to);
      (i.x, i.y, i.w, i.h) = (r.x, r.y, r.w, r.h);
    } else {
      let (dx, dy) = anchor_shift(anchor, side_at(&from, i.x + i.w / 2.0), dw, dh);
      i.x += dx;
      i.y += dy;
    }
  });
  p.page.w = w;
  p.page.h = h;
  p
}

/// What photos do when the page size changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Content {
  /// Move and scale with the guides.
  Rescale,
  /// Keep their size and place.
  Fixed,
}

/// The page's settings, edited together and applied as one step.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageDraft {
  pub arrangement: Arrangement,
  /// The size in `page.unit`; `page.px_per_unit` is the dpi (inches) or density (pixels).
  pub page: PageSetup,
  pub content: Content,
  /// Kept fixed, what photos stay put relative to (not saved).
  pub anchor: Anchor,
}

impl PageDraft {
  /// The project's page settings as a draft.
  pub fn of(p: &Project) -> Self {
    let arrangement = p.layout.arrangement();
    Self {
      arrangement,
      page: p.page,
      content: if p.settings.keep_relative {
        Content::Rescale
      } else {
        Content::Fixed
      },
      anchor: if arrangement == Arrangement::Spreads {
        Anchor::Inside
      } else {
        Anchor::TopLeft
      },
    }
  }

  /// Whether two drafts make the same project (the anchor aside).
  pub fn same(&self, other: &Self) -> bool {
    self.arrangement == other.arrangement && self.content == other.content && self.page == other.page
  }

  /// What `fixed` photos stay put relative to: frames have no inside edge.
  pub fn anchor(&self) -> Anchor {
    if self.arrangement == Arrangement::Frames && self.anchor == Anchor::Inside {
      Anchor::TopLeft
    } else {
      self.anchor
    }
  }

  /// The preset this matches, if any.
  pub fn preset(&self) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| {
      p.arrangement == self.arrangement && p.unit == self.page.unit && p.w == self.page.w && p.h == self.page.h
    })
  }

  /// This taking a preset's arrangement, unit, and size; inches keep the draft's dpi.
  pub fn with_preset(&self, preset: &Preset) -> Self {
    let px_per_unit = match (preset.unit, self.page.unit) {
      (Unit::Px, _) => 1.0,
      (Unit::In, Unit::In) => self.page.px_per_unit,
      (Unit::In, Unit::Px) => DEFAULT_DPI,
    };
    Self {
      arrangement: preset.arrangement,
      page: PageSetup {
        w: preset.w,
        h: preset.h,
        unit: preset.unit,
        px_per_unit,
      },
      ..*self
    }
  }

  /// This in another unit: its size converted from `base`'s page, at that page's dpi (or
  /// the default, to print at, going from pixels to inches).
  pub fn with_unit(&self, base: &Project, unit: Unit) -> Self {
    if unit == self.page.unit {
      return *self;
    }
    let px_per_unit = match (unit, base.page.unit) {
      (Unit::Px, _) => 1.0,
      (Unit::In, Unit::In) => base.page.px_per_unit,
      (Unit::In, Unit::Px) => DEFAULT_DPI,
    };
    let mut next = *self;
    next.page.unit = unit;
    next.page.px_per_unit = px_per_unit;
    let (w, h) = if unit == base.page.unit {
      (base.page.w, base.page.h)
    } else {
      converted_size(&base.page, unit, conversion_dpi(base, &next))
    };
    next.page.w = w;
    next.page.h = h;
    next
  }

  /// This at another dpi. Printing pixels at it, the size follows (unless it's been edited);
  /// otherwise only the resolution changes.
  pub fn with_dpi(&self, base: &Project, project: &Project, dpi: f64) -> Self {
    let mut next = *self;
    let was = converted_size(&base.page, Unit::In, self.page.px_per_unit);
    if prints_at(project, self) && was == (self.page.w, self.page.h) {
      (next.page.w, next.page.h) = converted_size(&base.page, Unit::In, dpi);
    }
    next.page.px_per_unit = dpi;
    next
  }
}

/// A page's size in another unit, at the same physical size.
pub fn converted_size(page: &PageSetup, unit: Unit, dpi: f64) -> (f64, f64) {
  if page.unit == unit {
    return (page.w, page.h);
  }
  let f = if unit == Unit::Px { dpi } else { 1.0 / dpi };
  (page.w * f, page.h * f)
}

/// The dpi a draft converts at: the project's going to pixels, the draft's going to inches.
fn conversion_dpi(project: &Project, draft: &PageDraft) -> f64 {
  if draft.page.unit == Unit::In {
    draft.page.px_per_unit
  } else {
    project.page.px_per_unit
  }
}

/// Whether applying the draft changes the page's size beyond converting its unit (so what
/// photos do matters).
pub fn resizes(project: &Project, draft: &PageDraft) -> bool {
  converted_size(&project.page, draft.page.unit, conversion_dpi(project, draft)) != (draft.page.w, draft.page.h)
}

/// Whether the draft's dpi is the one to print pixels at (going from a pixel page to inches,
/// where it sets the size), rather than only the page's resolution.
pub fn prints_at(project: &Project, draft: &PageDraft) -> bool {
  project.page.unit == Unit::Px && draft.page.unit == Unit::In
}

/// The project as it'd be with `draft` applied: the unit (Rescale scales by the page's
/// width; Keep fixed converts at the dpi), then the arrangement, then the size.
pub fn with_page_setup(project: &Project, draft: &PageDraft) -> Project {
  let rescale = draft.content == Content::Rescale;
  let unit = draft.page.unit;
  let mut p = project.clone();
  if p.page.unit != unit {
    p = if rescale {
      scale_project(&p, draft.page.w / p.page.w, unit, draft.page.px_per_unit)
    } else {
      convert_units(&p, unit, conversion_dpi(project, draft))
    };
  }
  p = rearrange(&p, draft.arrangement);
  p = resize_page(&p, draft.page.w, draft.page.h, rescale, draft.anchor());
  p.page.px_per_unit = draft.page.px_per_unit;
  p.settings.keep_relative = rescale;
  p
}

/// A run of Applies, computed from a fixed start rather than each previous result, so it's
/// order-independent and exactly reversible (10 → 8 → 10 puts every photo back; switching
/// back to spreads restores the book). It ends when anything else changes the project.
#[derive(Clone, Debug, Default)]
pub struct PageRun {
  run: Option<(Project, Project)>,
}

impl PageRun {
  /// The run, if `now` is still the project it last made.
  fn live(&self, now: &Project) -> Option<&(Project, Project)> {
    self.run.as_ref().filter(|(_, out)| out == now)
  }

  /// The project the next Apply converts and resizes from.
  pub fn base<'a>(&'a self, now: &'a Project) -> &'a Project {
    match self.live(now) {
      Some((base, _)) if base.page.unit == now.page.unit => base,
      _ => now,
    }
  }

  fn project_for(&self, now: &Project, draft: &PageDraft) -> Project {
    if let Some((base, _)) = self.live(now)
      && PageDraft::of(base).same(draft)
    {
      return base.clone();
    }
    let base = self.base(now);
    if PageDraft::of(base).same(draft) {
      base.clone()
    } else {
      with_page_setup(base, draft)
    }
  }

  /// The project after Apply, as the preview shows it.
  pub fn preview(&self, now: &Project, draft: &PageDraft) -> Project {
    if PageDraft::of(now).same(draft) {
      now.clone()
    } else {
      self.project_for(now, draft)
    }
  }

  /// The project Apply makes (none if it changes nothing); `recorded` must be called with
  /// the project as the history keeps it after.
  pub fn apply(&self, now: &Project, draft: &PageDraft) -> Option<Project> {
    (!PageDraft::of(now).same(draft)).then(|| self.project_for(now, draft))
  }

  /// After an Apply from `before` made `after`: the run goes on, or a new one starts where
  /// this one can no longer be computed from.
  pub fn recorded(&mut self, before: &Project, after: &Project) {
    let live = self.live(before).cloned();
    let base = match &live {
      Some((b, _)) if b.page.unit == before.page.unit => b.clone(),
      _ => before.clone(),
    };
    let start = match live {
      Some((b, _)) if base == b || *after == b => b,
      _ => base,
    };
    self.run = Some((start, after.clone()));
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::model::Placement;
  use crate::{PhotoId, PhotoMeta};

  fn with_photo() -> Project {
    let mut p = Project::empty();
    let id = PhotoId::from("a");
    p.photos.insert(
      id.clone(),
      PhotoMeta {
        id: id.clone(),
        name: "a.jpg".into(),
        px_w: 3000.0,
        px_h: 2000.0,
        crop: None,
      },
    );
    if let Layout::Spreads { spreads, .. } = &mut p.layout {
      spreads[0].items.push(Placement {
        photo_id: id,
        x: 1.0,
        y: 1.0,
        w: 3.0,
        h: 2.0,
        z: 1.0,
        border: None,
      });
    }
    p
  }

  #[test]
  fn book_to_frames_and_back() {
    let p = with_photo();
    let frames = rearrange(&p, Arrangement::Frames);
    assert_eq!(frames.layout.all().len(), 6);
    let back = rearrange(&frames, Arrangement::Spreads);
    assert_eq!(back.layout.all().len(), 4);
    let ids = |p: &Project| p.layout.all().iter().map(|s| s.id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&back), ids(&p));
    assert_eq!(back.layout.all()[1].items, p.layout.all()[1].items);
  }

  #[test]
  fn units_round_trip() {
    let p = with_photo();
    let px = convert_units(&p, Unit::Px, 300.0);
    assert_eq!(px.page.w, 3000.0);
    let back = convert_units(&px, Unit::In, 300.0);
    assert_eq!(back.page, p.page);
    assert!((back.layout.all()[1].items[0].x - 1.0).abs() < 1e-12);
  }

  #[test]
  fn a_run_of_applies_is_reversible() {
    let p = with_photo();
    let mut run = PageRun::default();
    let mut d = PageDraft::of(&p);
    d.page.w = 8.0;
    let smaller = run.apply(&p, &d).expect("changes");
    run.recorded(&p, &smaller);
    d.page.w = 10.0;
    let back = run.apply(&smaller, &d).expect("changes");
    assert_eq!(back, p);
  }

  #[test]
  fn kept_fixed_photos_stay_by_the_gutter() {
    let p = with_photo();
    let mut d = PageDraft::of(&p);
    d.content = Content::Fixed;
    d.page.w = 12.0;
    let q = with_page_setup(&p, &d);
    assert_eq!(q.layout.all()[1].items[0].x, 1.0);
    d.anchor = Anchor::Center;
    let q = with_page_setup(&p, &d);
    assert_eq!(q.layout.all()[1].items[0].x, 2.0);
  }
}
