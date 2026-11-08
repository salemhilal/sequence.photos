//! Where the last frame drew things, in window pixels, and what's under a point: the
//! web app's `hitTest` against the DOM.

use gpui_kit::*;
use sequence_core::actions::DropTarget;
use sequence_core::geometry::Rect;
use sequence_core::{PageSide, SpreadId};

use super::Workspace;

/// A spread's picture in the sidebar, as last drawn.
#[derive(Clone, Debug)]
pub struct Cell {
  pub id: SpreadId,
  pub index: usize,
  /// The row (picture and label), in window pixels.
  pub row: Rect,
  /// Each page, in window pixels.
  pub pages: Vec<(PageSide, Rect)>,
  /// Pixels per unit.
  pub scale: f64,
}

/// The spread editor's stage, as last drawn.
#[derive(Clone, Debug)]
pub struct EditorFrame {
  pub stage: Rect,
  pub scale: f64,
  /// The spread's x = 0, y = 0, in window pixels.
  pub origin: (f64, f64),
  pub pages: Vec<(PageSide, Rect)>,
  pub strip: Rect,
}

/// Where things were drawn, in window pixels, for the pointer's gestures.
#[derive(Clone, Debug, Default)]
pub struct Frames {
  pub window: Rect,
  pub main: Rect,
  pub desk: Rect,
  pub sidebar: Option<Rect>,
  pub sidebar_list: Rect,
  pub cells: Vec<Cell>,
  pub gaps: Vec<(usize, Rect)>,
  pub editor: Option<EditorFrame>,
  /// While cropping: the whole photo on screen (as clipped), and where the crop bar landed.
  pub crop_zone: Option<Rect>,
  pub crop_bar: std::rc::Rc<std::cell::Cell<Option<Rect>>>,
}

/// A GPUI point as (x, y).
pub(super) fn p(point: Point<Pixels>) -> (f64, f64) {
  (f64::from(point.x), f64::from(point.y))
}

/// Whether a point is in a rect.
pub(super) fn inside(r: &Rect, (x, y): (f64, f64)) -> bool {
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

impl Workspace {
  /// What a point in the window is over, for dropping photos.
  pub fn target_at(&self, at: (f64, f64)) -> Option<DropTarget> {
    if let Some(e) = &self.frames.editor {
      if inside(&e.strip, at) {
        return Some(DropTarget::Strip);
      }
      let spread = self.ui.editing.clone()?;
      for (side, r) in &e.pages {
        if inside(r, at) {
          return Some(DropTarget::Page { spread, side: *side });
        }
      }
      return None;
    }
    if self.frames.sidebar.as_ref().is_some_and(|s| inside(s, at)) {
      if !inside(&self.frames.sidebar_list, at) {
        return None;
      }
      for (i, r) in &self.frames.gaps {
        if inside(r, at) {
          return Some(DropTarget::Insert(*i));
        }
      }
      for c in &self.frames.cells {
        for (side, r) in &c.pages {
          if inside(r, at) {
            return Some(DropTarget::Page {
              spread: c.id.clone(),
              side: *side,
            });
          }
        }
      }
      return None;
    }
    inside(&self.frames.desk, at).then_some(DropTarget::Desk)
  }

  /// A window point on the desk, in desk inches.
  pub fn to_desk(&self, (x, y): (f64, f64)) -> (f64, f64) {
    self.ui.view.to_desk(x - self.frames.desk.x, y - self.frames.desk.y)
  }
}
