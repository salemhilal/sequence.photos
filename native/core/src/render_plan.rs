//! What exports draw, worked out apart from drawing it (`src/renderPlan.ts`). A plan says,
//! for one output image, which part of each photo shows and where it goes, in output
//! pixels: the page's units times its pxPerUnit. Every export draws from a plan, so they
//! agree, and none needs to know the page's unit.

use indexmap::IndexMap;
use serde::Serialize;

use crate::crop::crop_pixels;
use crate::geometry::{Rect, intersects, page_rect, page_sides, spread_left, spread_width};
use crate::model::*;
use crate::units::js_round;
use crate::{PhotoId, SpreadId};

/// How an ink is drawn, as RGB.
pub fn ink_rgb(ink: Ink) -> [u8; 3] {
  match ink {
    Ink::White => [255, 255, 255],
    Ink::Black => [0, 0, 0],
  }
}

/// Which part of a spread an output image is: all its pages side by side, or one page.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Part {
  Spread,
  Left,
  Right,
  Whole,
}

impl From<PageSide> for Part {
  fn from(side: PageSide) -> Self {
    match side {
      PageSide::Left => Part::Left,
      PageSide::Right => Part::Right,
      PageSide::Whole => Part::Whole,
    }
  }
}

impl Part {
  fn name(self) -> &'static str {
    match self {
      Part::Spread => "spread",
      Part::Left => "left",
      Part::Right => "right",
      Part::Whole => "whole",
    }
  }
}

/// One image an export makes: a whole spread, one page of it, or a frame.
#[derive(Clone, Copy, Debug)]
pub struct OutputPage<'a> {
  pub spread: &'a Spread,
  pub part: Part,
}

/// One per spread, or one per page (a frame is both).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Per {
  Spread,
  Page,
}

/// The pages an export makes, in order.
pub fn output_pages(project: &Project, per: Per) -> Vec<OutputPage<'_>> {
  project
    .layout
    .all()
    .into_iter()
    .flat_map(|spread| {
      if per == Per::Spread && spread.kind != SpreadKind::Frame {
        vec![OutputPage {
          spread,
          part: Part::Spread,
        }]
      } else {
        page_sides(spread.kind)
          .iter()
          .map(|&side| OutputPage {
            spread,
            part: side.into(),
          })
          .collect()
      }
    })
    .collect()
}

/// A name for an output page, unique within its spread's pages.
pub fn slide_key(p: &OutputPage) -> String {
  format!("{}:{}", p.spread.id, p.part.name())
}

/// An output page's area, in its spread's coordinates.
pub fn page_region(p: &OutputPage, sheet: &Sheet) -> Rect {
  match p.part {
    Part::Spread => Rect::new(
      spread_left(p.spread.kind, sheet),
      0.0,
      spread_width(p.spread.kind, sheet),
      sheet.page_h,
    ),
    Part::Left => page_rect(PageSide::Left, sheet),
    Part::Right => page_rect(PageSide::Right, sheet),
    Part::Whole => page_rect(PageSide::Whole, sheet),
  }
}

/// The photos that show on an output page (any part of them).
pub fn items_on<'a>(p: &OutputPage<'a>, sheet: &Sheet) -> Vec<&'a Placement> {
  let region = page_region(p, sheet);
  p.spread
    .items
    .iter()
    .filter(|i| intersects(&Rect::from(*i), &region))
    .collect()
}

/// The first `n` pages with photos on them, by key, in order.
pub fn first_non_empty(pages: &[OutputPage], sheet: &Sheet, n: usize) -> Vec<String> {
  pages
    .iter()
    .filter(|p| !items_on(p, sheet).is_empty())
    .take(n)
    .map(slide_key)
    .collect()
}

/// A photo drawn onto an output page.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draw {
  pub photo_id: PhotoId,
  /// The part of the photo that shows (within its crop), in its own upright pixels.
  pub src: Rect,
  /// Where that part goes, in output pixels.
  pub dst: Rect,
  /// The whole placed photo, in output pixels, including what's off the image.
  pub placed: Rect,
  pub z: f64,
  /// Its border, around `placed`, in output pixels.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub border: Option<PhotoBorder>,
}

/// What to draw for one output image.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagePlan {
  /// The image's size, in whole pixels.
  #[serde(rename = "pxW")]
  pub px_w: f64,
  #[serde(rename = "pxH")]
  pub px_h: f64,
  pub background: Ink,
  /// Output pixels per unit: the page's, or less.
  pub px_per_unit: f64,
  /// Back to front. Photos entirely off the image are left out.
  pub draws: Vec<Draw>,
}

/// What to draw for an output page, in output pixels. `px_per_unit` lowers the page's
/// resolution (a smaller image); it never raises it, since that would only enlarge the photos.
pub fn plan_page(
  page: &OutputPage,
  sheet: &Sheet,
  photos: &IndexMap<PhotoId, PhotoMeta>,
  px_per_unit: Option<f64>,
) -> PagePlan {
  let k = sheet.px_per_unit.min(px_per_unit.unwrap_or(f64::INFINITY));
  let region = page_region(page, sheet);
  let px_w = js_round(region.w * k).max(1.0);
  let px_h = js_round(region.h * k).max(1.0);
  // Scaled to the whole pixels, so a photo at the page's edge reaches the image's edge.
  let kx = px_w / region.w;
  let ky = px_h / region.h;
  let mut items: Vec<&Placement> = page.spread.items.iter().collect();
  items.sort_by(|a, b| a.z.total_cmp(&b.z));
  let mut draws = Vec::new();
  for item in items {
    let Some(photo) = photos.get(&item.photo_id) else {
      continue;
    };
    let placed = Rect::new(
      (item.x - region.x) * kx,
      (item.y - region.y) * ky,
      item.w * kx,
      item.h * ky,
    );
    let border = item.border.map(|b| PhotoBorder {
      width: b.width * kx,
      ..b
    });
    let x1 = placed.x.max(0.0);
    let y1 = placed.y.max(0.0);
    let x2 = px_w.min(placed.x + placed.w);
    let y2 = px_h.min(placed.y + placed.h);
    if x2 <= x1 || y2 <= y1 {
      continue;
    }
    let dst = Rect::new(x1, y1, x2 - x1, y2 - y1);
    // The frame shows the crop: its pixels, offset into the original.
    let crop = crop_pixels(photo);
    let sx = crop.w / placed.w;
    let sy = crop.h / placed.h;
    let src = Rect::new(
      crop.x + (x1 - placed.x) * sx,
      crop.y + (y1 - placed.y) * sy,
      dst.w * sx,
      dst.h * sy,
    );
    draws.push(Draw {
      photo_id: item.photo_id.clone(),
      src,
      dst,
      placed,
      z: item.z,
      border,
    });
  }
  PagePlan {
    px_w,
    px_h,
    background: page.spread.background.unwrap_or(Ink::White),
    px_per_unit: k,
    draws,
  }
}

/// The largest pxPerUnit, no more than the plan's, whose image has at most `max_pixels`.
pub fn fit_pixels(plan: &PagePlan, max_pixels: f64) -> f64 {
  let area = plan.px_w * plan.px_h;
  if area <= max_pixels {
    plan.px_per_unit
  } else {
    plan.px_per_unit * (max_pixels / area).sqrt() * 0.999
  }
}

/// The spread an output page is from, by id (for callers holding keys).
pub fn spread_of<'a>(pages: &[OutputPage<'a>], id: &SpreadId) -> Option<&'a Spread> {
  pages.iter().find(|p| &p.spread.id == id).map(|p| p.spread)
}
