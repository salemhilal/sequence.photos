//! Cropping (`src/crop.ts`): a photo shows only part of its original, the same wherever it
//! is, like a trimmed print. The crop is a rectangle in fractions of the upright original;
//! the photo's frame (its placement) has the crop's shape. Crop mode drags the frame over the
//! whole photo (which stays put), or the photo behind the frame.

// min/max, not clamp: as the TypeScript does it, and clamp panics when the bounds cross.
#![allow(clippy::manual_clamp)]

pub use crate::geometry::Rect;
use crate::geometry::{GuideLines, SnapFeedback, snap_move, snap_points};
use crate::model::{Crop, PhotoMeta};
use crate::units::js_round;

/// The whole photo.
pub const WHOLE: Crop = Crop {
  x: 0.0,
  y: 0.0,
  w: 1.0,
  h: 1.0,
};

/// The smallest crop, as a share of each side, so a photo can't be cropped to nothing.
pub const MIN_CROP: f64 = 0.02;

pub fn crop_of(photo: &PhotoMeta) -> Crop {
  photo.crop.unwrap_or(WHOLE)
}

/// Whether the crop shows all of the photo.
pub fn is_whole(crop: Option<&Crop>) -> bool {
  crop.is_none_or(|c| c.x <= 0.0 && c.y <= 0.0 && c.w >= 1.0 && c.h >= 1.0)
}

/// The pixels of the original that show: what every layout and resolution works from.
pub fn visible_size(photo: &PhotoMeta) -> (f64, f64) {
  let c = crop_of(photo);
  (photo.px_w * c.w, photo.px_h * c.h)
}

/// The crop in the original's pixels.
pub fn crop_pixels(photo: &PhotoMeta) -> Rect {
  let c = crop_of(photo);
  Rect {
    x: c.x * photo.px_w,
    y: c.y * photo.px_h,
    w: c.w * photo.px_w,
    h: c.h * photo.px_h,
  }
}

/// A crop kept inside the photo and no smaller than MIN_CROP, rounded a little so tiny
/// drags don't leave long decimals in the file. None when it's the whole photo.
pub fn clean_crop(c: Crop) -> Option<Crop> {
  let round = |n: f64| js_round(n * 1e5) / 1e5;
  let w = c.w.max(MIN_CROP).min(1.0);
  let h = c.h.max(MIN_CROP).min(1.0);
  let x = c.x.max(0.0).min(1.0 - w);
  let y = c.y.max(0.0).min(1.0 - h);
  let crop = Crop {
    x: round(x),
    y: round(y),
    w: round(w),
    h: round(h),
  };
  if is_whole(Some(&crop)) { None } else { Some(crop) }
}

/// Where the whole photo goes, given its frame (showing the crop), in the frame's units.
pub fn whole_rect(frame: Rect, crop: Crop) -> Rect {
  let w = frame.w / crop.w;
  let h = frame.h / crop.h;
  Rect {
    x: frame.x - crop.x * w,
    y: frame.y - crop.y * h,
    w,
    h,
  }
}

/// The crop a frame makes of the whole photo placed at `whole` (both in the same units).
pub fn crop_from(frame: Rect, whole: Rect) -> Crop {
  Crop {
    x: (frame.x - whole.x) / whole.w,
    y: (frame.y - whole.y) / whole.h,
    w: frame.w / whole.w,
    h: frame.h / whole.h,
  }
}

/// The largest crop of shape `ratio` (width over height, in pixels) inside the photo,
/// centered on what shows now. For Crop to … in the photo's menu.
pub fn crop_to_ratio(photo: &PhotoMeta, ratio: f64) -> Option<Crop> {
  let now = crop_pixels(photo);
  let cx = now.x + now.w / 2.0;
  let cy = now.y + now.h / 2.0;
  let mut w = photo.px_w;
  let mut h = w / ratio;
  if h > photo.px_h {
    h = photo.px_h;
    w = h * ratio;
  }
  let x = (cx - w / 2.0).max(0.0).min(photo.px_w - w);
  let y = (cy - h / 2.0).max(0.0).min(photo.px_h - h);
  clean_crop(Crop {
    x: x / photo.px_w,
    y: y / photo.px_h,
    w: w / photo.px_w,
    h: h / photo.px_h,
  })
}

/// Move the photo behind its crop frame by (dx, dy), as far as the frame stays on it.
pub fn pan_crop(frame: Rect, whole: Rect, dx: f64, dy: f64) -> Rect {
  let x = (whole.x + dx).max(frame.x + frame.w - whole.w).min(frame.x);
  let y = (whole.y + dy).max(frame.y + frame.h - whole.h).min(frame.y);
  Rect { x, y, ..whole }
}

/// The largest frame of shape `ratio` on the whole photo, centered on the frame now.
pub fn frame_to_ratio(frame: Rect, whole: Rect, ratio: f64) -> Rect {
  let mut w = whole.w;
  let mut h = w / ratio;
  if h > whole.h {
    h = whole.h;
    w = h * ratio;
  }
  let cx = frame.x + frame.w / 2.0;
  let cy = frame.y + frame.h / 2.0;
  Rect {
    x: (cx - w / 2.0).max(whole.x).min(whole.x + whole.w - w),
    y: (cy - h / 2.0).max(whole.y).min(whole.y + whole.h - h),
    w,
    h,
  }
}

/// A crop frame's handles: its edges and corners.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CropHandle {
  N,
  S,
  E,
  W,
  NW,
  NE,
  SW,
  SE,
}

impl CropHandle {
  /// Every handle: the edges, then the corners.
  pub const ALL: [CropHandle; 8] = [
    CropHandle::N,
    CropHandle::S,
    CropHandle::E,
    CropHandle::W,
    CropHandle::NW,
    CropHandle::NE,
    CropHandle::SW,
    CropHandle::SE,
  ];

  /// Whether it holds the top edge.
  pub fn north(self) -> bool {
    matches!(self, Self::N | Self::NW | Self::NE)
  }
  /// Whether it holds the bottom edge.
  pub fn south(self) -> bool {
    matches!(self, Self::S | Self::SW | Self::SE)
  }
  /// Whether it holds the right edge.
  pub fn east(self) -> bool {
    matches!(self, Self::E | Self::NE | Self::SE)
  }
  /// Whether it holds the left edge.
  pub fn west(self) -> bool {
    matches!(self, Self::W | Self::NW | Self::SW)
  }
  /// Whether it's a corner.
  pub fn is_corner(self) -> bool {
    matches!(self, Self::NW | Self::NE | Self::SW | Self::SE)
  }
}

/// How a crop handle's drag behaves.
#[derive(Clone, Copy, Debug)]
pub struct CropDrag<'a> {
  /// Keep this shape (width over height), or none for any.
  pub ratio: Option<f64>,
  /// The smallest a side gets, in the frame's units.
  pub min: f64,
  /// Lines the moving edges snap to (the spread editor's guides), within `threshold`.
  pub lines: Option<&'a GuideLines>,
  pub threshold: f64,
}

/// Drag a crop frame's handle by (dx, dy): the edges it holds move, inside the whole photo
/// (which stays put), snapping to the lines. With a ratio, the frame keeps its shape: a
/// corner anchors the opposite one, an edge stays centered on its axis.
pub fn drag_crop_handle(
  start: Rect,
  whole: Rect,
  handle: CropHandle,
  dx: f64,
  dy: f64,
  o: CropDrag,
) -> (Rect, SnapFeedback) {
  let mut hit = SnapFeedback::default();
  let mut snap = |v: f64, across: bool| -> f64 {
    let Some(lines) = o.lines else { return v };
    let s = snap_points(&[v], if across { &lines.xs } else { &lines.ys }, o.threshold);
    if let Some(l) = s.line {
      if across { hit.xs.push(l) } else { hit.ys.push(l) }
    }
    v + s.delta
  };
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  let whole_right = whole.x + whole.w;
  let whole_bottom = whole.y + whole.h;
  let (mut x1, mut y1, mut x2, mut y2) = (start.x, start.y, right, bottom);
  if handle.west() {
    x1 = whole.x.max(snap(start.x + dx, true)).min(right - o.min);
  }
  if handle.east() {
    x2 = whole_right.min(snap(right + dx, true)).max(start.x + o.min);
  }
  if handle.north() {
    y1 = whole.y.max(snap(start.y + dy, false)).min(bottom - o.min);
  }
  if handle.south() {
    y2 = whole_bottom.min(snap(bottom + dy, false)).max(start.y + o.min);
  }
  let Some(ratio) = o.ratio else {
    return (Rect::new(x1, y1, x2 - x1, y2 - y1), hit);
  };

  // Keeping the shape: size from the dragged edges (a corner, whichever moved more).
  let mut w = x2 - x1;
  let mut h = y2 - y1;
  let horizontal = matches!(handle, CropHandle::E | CropHandle::W);
  let vertical = matches!(handle, CropHandle::N | CropHandle::S);
  if horizontal || (!vertical && (w - start.w).abs() / start.w >= (h - start.h).abs() / start.h) {
    h = w / ratio;
  } else {
    w = h * ratio;
  }
  // Where it grows from: the opposite corner, or for an edge, the middle of the other axis.
  let (ax, fx) = if handle.west() {
    (right, 1.0)
  } else if handle.east() {
    (start.x, 0.0)
  } else {
    (start.x + start.w / 2.0, 0.5)
  };
  let (ay, fy) = if handle.north() {
    (bottom, 1.0)
  } else if handle.south() {
    (start.y, 0.0)
  } else {
    (start.y + start.h / 2.0, 0.5)
  };
  // As large as asked, if the photo has room on each side of the anchor.
  let room = |near: f64, far: f64, size: f64, f: f64| -> f64 {
    let a = if f > 0.0 { near / (size * f) } else { f64::INFINITY };
    let b = if f < 1.0 {
      far / (size * (1.0 - f))
    } else {
      f64::INFINITY
    };
    a.min(b)
  };
  let k = room(ax - whole.x, whole_right - ax, w, fx)
    .min(room(ay - whole.y, whole_bottom - ay, h, fy))
    .min(1.0);
  w *= k;
  h *= k;
  (Rect::new(ax - w * fx, ay - h * fy, w, h), SnapFeedback::default())
}

/// Move the crop frame across the photo (which stays put) by (dx, dy), as far as the photo
/// goes, its edges and center snapping to `lines`.
pub fn move_crop(
  start: Rect,
  whole: Rect,
  dx: f64,
  dy: f64,
  lines: Option<&GuideLines>,
  threshold: f64,
) -> (Rect, SnapFeedback) {
  let clamp = |r: Rect| Rect {
    x: r.x.max(whole.x).min(whole.x + whole.w - r.w),
    y: r.y.max(whole.y).min(whole.y + whole.h - r.h),
    ..r
  };
  let moved = clamp(Rect {
    x: start.x + dx,
    y: start.y + dy,
    ..start
  });
  let Some(lines) = lines else {
    return (moved, SnapFeedback::default());
  };
  let (snapped, hit) = snap_move(moved, lines, threshold);
  let frame = clamp(snapped);
  // A snap the photo's edge undid isn't one.
  if frame.x == snapped.x && frame.y == snapped.y {
    (frame, hit)
  } else {
    (frame, SnapFeedback::default())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn clean_crop_keeps_it_inside_and_drops_whole() {
    assert_eq!(clean_crop(WHOLE), None);
    assert_eq!(
      clean_crop(Crop {
        x: -0.1,
        y: 0.0,
        w: 1.2,
        h: 1.0
      }),
      None
    );
    let c = clean_crop(Crop {
      x: 0.95,
      y: 0.5,
      w: 0.001,
      h: 0.25,
    })
    .unwrap();
    assert_eq!(
      c,
      Crop {
        x: 0.95,
        y: 0.5,
        w: 0.02,
        h: 0.25
      }
    );
    let c = clean_crop(Crop {
      x: 0.9,
      y: 0.0,
      w: 0.5,
      h: 1.0,
    })
    .unwrap();
    assert_eq!(c.x, 0.5);
  }

  #[test]
  fn whole_and_crop_from_round_trip() {
    let crop = Crop {
      x: 0.25,
      y: 0.1,
      w: 0.5,
      h: 0.8,
    };
    let frame = Rect {
      x: 1.0,
      y: 2.0,
      w: 3.0,
      h: 4.0,
    };
    let whole = whole_rect(frame, crop);
    let back = crop_from(frame, whole);
    assert!((back.x - crop.x).abs() < 1e-12 && (back.h - crop.h).abs() < 1e-12);
  }

  #[test]
  fn handles_stay_on_the_photo_and_keep_a_shape() {
    let whole = Rect::new(0.0, 0.0, 10.0, 10.0);
    let start = Rect::new(2.0, 2.0, 4.0, 4.0);
    let free = CropDrag {
      ratio: None,
      min: 0.5,
      lines: None,
      threshold: 0.0,
    };
    let (r, _) = drag_crop_handle(start, whole, CropHandle::SE, 10.0, 1.0, free);
    assert_eq!(r, Rect::new(2.0, 2.0, 8.0, 5.0));
    let (r, _) = drag_crop_handle(start, whole, CropHandle::W, 3.9, 0.0, free);
    assert_eq!(r.w, 0.5);
    let square = CropDrag {
      ratio: Some(1.0),
      ..free
    };
    let (r, _) = drag_crop_handle(start, whole, CropHandle::SE, 10.0, 0.0, square);
    assert_eq!(r, Rect::new(2.0, 2.0, 8.0, 8.0));
    let lines = GuideLines {
      xs: vec![7.0],
      ys: vec![],
    };
    let snapping = CropDrag {
      lines: Some(&lines),
      threshold: 0.3,
      ..free
    };
    let (r, hit) = drag_crop_handle(start, whole, CropHandle::E, 0.8, 0.0, snapping);
    assert_eq!((r.w, hit.xs), (5.0, vec![7.0]));
  }

  #[test]
  fn moving_the_crop_stops_at_the_photo() {
    let whole = Rect::new(0.0, 0.0, 10.0, 10.0);
    let (r, _) = move_crop(Rect::new(2.0, 2.0, 4.0, 4.0), whole, 20.0, -20.0, None, 0.0);
    assert_eq!(r, Rect::new(6.0, 0.0, 4.0, 4.0));
  }
}
