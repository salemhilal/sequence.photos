//! Cropping (`src/crop.ts`): a photo shows only part of its original, the same wherever it
//! is, like a trimmed print. The crop is a rectangle in fractions of the upright original;
//! the photo's frame (its placement) has the crop's shape. The drag functions, which snap to
//! guides, come with the geometry.

// min/max, not clamp: as the TypeScript does it, and clamp panics when the bounds cross.
#![allow(clippy::manual_clamp)]

pub use crate::geometry::Rect;
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
}
