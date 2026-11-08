//! The desk's view: pan and zoom, and converting between the screen and desk inches
//! (`src/deskGeometry.ts`, `src/deskZoom.ts`).

#![allow(clippy::manual_clamp)] // min/max as the TypeScript does, for NaN parity

use serde::{Deserialize, Serialize};

use crate::geometry::{DESK_PPI, Rect};

/// The desk's zoom range. Out far enough for rows of full-size photos.
pub const MIN_ZOOM: f64 = 0.02;
pub const MAX_ZOOM: f64 = 5.0;

/// Where the desk is looking: screen pixels of desk inch 0 (pan) and the zoom (1 is 100%).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskView {
  pub pan_x: f64,
  pub pan_y: f64,
  pub zoom: f64,
}

impl Default for DeskView {
  fn default() -> Self {
    Self {
      pan_x: 40.0,
      pan_y: 40.0,
      zoom: 1.0,
    }
  }
}

impl DeskView {
  /// Screen pixels per desk inch.
  pub fn scale(&self) -> f64 {
    DESK_PPI * self.zoom
  }

  /// A point on screen (from the desk's origin, in pixels) in desk inches.
  pub fn to_desk(&self, sx: f64, sy: f64) -> (f64, f64) {
    let k = self.scale();
    ((sx - self.pan_x) / k, (sy - self.pan_y) / k)
  }

  /// A desk rect on screen, in pixels from the desk's origin.
  pub fn to_screen(&self, r: Rect) -> Rect {
    let k = self.scale();
    Rect::new(self.pan_x + r.x * k, self.pan_y + r.y * k, r.w * k, r.h * k)
  }

  /// The desk inches showing in a desk of `w` × `h` pixels.
  pub fn visible(&self, w: f64, h: f64) -> Rect {
    let (x, y) = self.to_desk(0.0, 0.0);
    let k = self.scale();
    Rect::new(x, y, w / k, h / k)
  }

  /// This view zoomed to `zoom`, keeping the point at (sx, sy) still.
  pub fn zoomed_around(&self, zoom: f64, sx: f64, sy: f64) -> Self {
    let f = zoom / self.zoom;
    Self {
      zoom,
      pan_x: sx - (sx - self.pan_x) * f,
      pan_y: sy - (sy - self.pan_y) * f,
    }
  }

  /// After a scroll: a pinch or ⌘-scroll zooms around the pointer (between `min` and
  /// `max`); plain scrolling pans. `dx`/`dy` are the scroll's pixels, as the browser gives
  /// them (positive is down and right).
  #[allow(clippy::too_many_arguments)]
  pub fn wheeled(&self, dx: f64, dy: f64, zoom: bool, sx: f64, sy: f64, min: f64, max: f64) -> Self {
    if !zoom {
      return Self {
        pan_x: self.pan_x - dx,
        pan_y: self.pan_y - dy,
        ..*self
      };
    }
    self.zoomed_around(clamp(self.zoom * (-dy * 0.01).exp(), min, max), sx, sy)
  }

  /// This view, pinched by a factor (1 is no change) around (sx, sy).
  pub fn pinched(&self, factor: f64, sx: f64, sy: f64) -> Self {
    self.zoomed_around(clamp(self.zoom * factor, MIN_ZOOM, MAX_ZOOM), sx, sy)
  }
}

/// `n`, held between `lo` and `hi`.
pub fn clamp(n: f64, lo: f64, hi: f64) -> f64 {
  hi.min(lo.max(n))
}

/// The view that shows `bounds` (desk inches) comfortably in a desk of `w` × `h` pixels:
/// centered, with a margin, zoomed no further in than 100%.
pub fn view_to_fit(bounds: Rect, w: f64, h: f64) -> DeskView {
  let margin = 0.08;
  let fit =
    ((w * (1.0 - 2.0 * margin)) / (bounds.w * DESK_PPI)).min((h * (1.0 - 2.0 * margin)) / (bounds.h * DESK_PPI));
  let zoom = 1.0f64.min(MAX_ZOOM).min(MIN_ZOOM.max(fit));
  let k = DESK_PPI * zoom;
  DeskView {
    zoom,
    pan_x: (w - bounds.w * k) / 2.0 - bounds.x * k,
    pan_y: (h - bounds.h * k) / 2.0 - bounds.y * k,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn screen_and_desk_round_trip() {
    let v = DeskView {
      pan_x: 10.0,
      pan_y: 20.0,
      zoom: 0.5,
    };
    let (x, y) = v.to_desk(34.0, 44.0);
    assert_eq!((x, y), (1.0, 1.0));
    let r = v.to_screen(Rect::new(1.0, 1.0, 2.0, 2.0));
    assert_eq!(r, Rect::new(34.0, 44.0, 48.0, 48.0));
  }

  #[test]
  fn zooming_keeps_the_point_still() {
    let v = DeskView::default();
    let z = v.zoomed_around(2.0, 100.0, 100.0);
    assert_eq!(v.to_desk(100.0, 100.0), z.to_desk(100.0, 100.0));
  }

  #[test]
  fn fit_never_zooms_past_100() {
    let v = view_to_fit(Rect::new(0.0, 0.0, 1.0, 1.0), 1000.0, 1000.0);
    assert_eq!(v.zoom, 1.0);
  }
}
