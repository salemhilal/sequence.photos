//! Laying photos out on pages (`src/geometry.ts`): pages and their guides, fitting, snapping,
//! resizing, and keeping photos with the guides when the page changes size.

// min/max, not clamp: as the TypeScript does it, and clamp panics when the bounds cross.
#![allow(clippy::manual_clamp)]

use crate::crop::visible_size;
use crate::model::*;
use crate::units::{js_round, units};

/// A rectangle, in whatever units.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Rect {
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
}

impl Rect {
  pub const fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
    Self { x, y, w, h }
  }
}

impl From<&Placement> for Rect {
  fn from(p: &Placement) -> Self {
    Rect::new(p.x, p.y, p.w, p.h)
  }
}

/// Screen pixels per inch on the desk at zoom 1.
pub const DESK_PPI: f64 = 48.0;

/// A desk photo's longest side at 100% zoom, in screen pixels: the size of the preview kept
/// of each photo, so on the desk it's as large as it stays sharp.
pub const DESK_PHOTO_PX: f64 = 1400.0;

/// The pages of a spread of this kind.
pub fn page_sides(kind: SpreadKind) -> &'static [PageSide] {
  match kind {
    SpreadKind::Frame => &[PageSide::Whole],
    SpreadKind::First => &[PageSide::Right],
    SpreadKind::Last => &[PageSide::Left],
    SpreadKind::Middle => &[PageSide::Left, PageSide::Right],
  }
}

/// A page's rectangle in spread coordinates: gutter-relative in spreads, from the left edge in a frame.
pub fn page_rect(side: PageSide, s: &Sheet) -> Rect {
  Rect::new(
    if side == PageSide::Left { -s.page_w } else { 0.0 },
    0.0,
    s.page_w,
    s.page_h,
  )
}

/// The page a point (or a photo's center) is on.
pub fn side_at(s: &Sheet, x: f64) -> PageSide {
  match s.arrangement {
    Arrangement::Frames => PageSide::Whole,
    Arrangement::Spreads if x < 0.0 => PageSide::Left,
    Arrangement::Spreads => PageSide::Right,
  }
}

/// The width of a spread's pages together: two pages, or one.
pub fn spread_width(kind: SpreadKind, s: &Sheet) -> f64 {
  page_sides(kind).len() as f64 * s.page_w
}

/// Where a spread's pages start: the left page's outside edge, else the gutter (or a frame's left edge).
pub fn spread_left(kind: SpreadKind, s: &Sheet) -> f64 {
  if page_sides(kind)[0] == PageSide::Left {
    -s.page_w
  } else {
    0.0
  }
}

/// What a sheet's spreads are drawn on, around the canvas origin: (left, width).
pub fn sheet_extent(arrangement: Arrangement, page_w: f64) -> (f64, f64) {
  match arrangement {
    Arrangement::Spreads => (-page_w, 2.0 * page_w),
    Arrangement::Frames => (0.0, page_w),
  }
}

/// Whether a page is laid out like a left page: outside at its left edge.
fn outside_left(side: PageSide) -> bool {
  side != PageSide::Right
}

/// A border guide's distance from each edge, whichever kind it is.
pub fn edges_of(g: &BorderGuide) -> Edges {
  match g.shape {
    BorderShape::Even { inset } => Edges {
      top: inset,
      bottom: inset,
      inside: inset,
      outside: inset,
    },
    BorderShape::Edges(e) => e,
  }
}

/// How far a border guide is from a page's left and right edges.
fn side_insets(side: PageSide, e: &Edges) -> (f64, f64) {
  if outside_left(side) {
    (e.outside, e.inside)
  } else {
    (e.inside, e.outside)
  }
}

/// A border guide's box on one page.
pub fn border_box(side: PageSide, s: &Sheet, g: &BorderGuide) -> Rect {
  let p = page_rect(side, s);
  let e = edges_of(g);
  let (left, right) = side_insets(side, &e);
  Rect::new(
    p.x + left,
    e.top,
    (p.w - left - right).max(0.1),
    (p.h - e.top - e.bottom).max(0.1),
  )
}

/// The border guide photos fit inside when dropped on a page: the chosen one, or else the largest.
pub fn drop_guide(s: &Sheet) -> Option<&BorderGuide> {
  if let Some(chosen) = s.borders.iter().find(|g| Some(&g.id) == s.drop_border.as_ref()) {
    return Some(chosen);
  }
  let area = |g: &BorderGuide| {
    let e = edges_of(g);
    (s.page_w - e.inside - e.outside) * (s.page_h - e.top - e.bottom)
  };
  let mut best: Option<&BorderGuide> = None;
  for g in &s.borders {
    if best.is_none_or(|b| area(g) > area(b)) {
      best = Some(g);
    }
  }
  best
}

/// Keeps a border guide's box on the page (after an edit, or when the page shrinks).
pub fn clamp_border(g: &mut BorderGuide, unit: Unit, page_w: f64, page_h: f64) {
  let min = units(unit).min_box;
  match &mut g.shape {
    BorderShape::Even { inset } => *inset = inset.min((page_w.min(page_h) - min) / 2.0).max(0.0),
    BorderShape::Edges(e) => {
      e.top = e.top.min(page_h - e.bottom - min).max(0.0);
      e.bottom = e.bottom.min(page_h - e.top - min).max(0.0);
      e.inside = e.inside.min(page_w - e.outside - min).max(0.0);
      e.outside = e.outside.min(page_w - e.inside - min).max(0.0);
    }
  }
}

/// Where a photo dropped on a page is fitted: the drop guide's box, or the page.
pub fn drop_box(side: PageSide, s: &Sheet) -> Rect {
  drop_guide(s).map_or_else(|| page_rect(side, s), |g| border_box(side, s, g))
}

/// A line guide's position on a page, in spread coordinates: x for vertical guides, y for horizontal.
pub fn line_position(side: PageSide, s: &Sheet, l: &LineGuide) -> f64 {
  if l.axis == Axis::Horizontal {
    return l.at;
  }
  let p = page_rect(side, s);
  if outside_left(side) {
    p.x + l.at
  } else {
    p.x + p.w - l.at
  }
}

/// The inverse of line_position: the `at` for a guide through `v` on a page.
pub fn line_at(side: PageSide, s: &Sheet, axis: Axis, v: f64) -> f64 {
  if axis == Axis::Horizontal {
    return v;
  }
  let p = page_rect(side, s);
  if outside_left(side) { v - p.x } else { p.x + p.w - v }
}

/// Whether a line guide falls on the page (it can end up off it when the page shrinks).
pub fn line_on_page(s: &Sheet, l: &LineGuide) -> bool {
  l.at > 0.0 && l.at < if l.axis == Axis::Vertical { s.page_w } else { s.page_h }
}

/// The largest rect with the photo's shape (as cropped) that fits in `box_`, centered in `center`.
pub fn fit_centered(photo: &PhotoMeta, box_: Rect, center: Option<Rect>) -> Rect {
  let center = center.unwrap_or(box_);
  let (px_w, px_h) = visible_size(photo);
  let aspect = px_w / px_h;
  let mut w = box_.w;
  let mut h = w / aspect;
  if h > box_.h {
    h = box_.h;
    w = h * aspect;
  }
  Rect::new(center.x + (center.w - w) / 2.0, center.y + (center.h - h) / 2.0, w, h)
}

/// A photo's size on the desk, in desk inches: its own size (as cropped) if smaller than the preview.
pub fn pile_size(photo: &PhotoMeta) -> (f64, f64) {
  let (px_w, px_h) = visible_size(photo);
  let long = px_w.max(px_h).min(DESK_PHOTO_PX) / DESK_PPI;
  let aspect = px_w / px_h;
  if aspect >= 1.0 {
    (long, long / aspect)
  } else {
    (long * aspect, long)
  }
}

/// Lines to snap to, across (xs) and down (ys).
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GuideLines {
  pub xs: Vec<f64>,
  pub ys: Vec<f64>,
}

/// Visible guides for a spread: center lines, border boxes, and line guides, per page.
pub fn spread_guides(spread: &Spread, s: &Sheet) -> GuideLines {
  let mut xs = Vec::new();
  let mut ys = Vec::new();
  let lines: Vec<&LineGuide> = s.lines.iter().filter(|l| line_on_page(s, l)).collect();
  for &side in page_sides(spread.kind) {
    let p = page_rect(side, s);
    if s.center_v {
      xs.push(p.x + p.w / 2.0);
    }
    for g in &s.borders {
      let (left, right) = side_insets(side, &edges_of(g));
      xs.push(p.x + left);
      xs.push(p.x + p.w - right);
    }
    for l in &lines {
      if l.axis == Axis::Vertical {
        xs.push(line_position(side, s, l));
      }
    }
  }
  if s.center_h {
    ys.push(s.page_h / 2.0);
  }
  for e in s.borders.iter().map(edges_of) {
    ys.push(e.top);
    ys.push(s.page_h - e.bottom);
  }
  for l in &lines {
    if l.axis == Axis::Horizontal {
      ys.push(l.at);
    }
  }
  GuideLines { xs, ys }
}

/// Rounded to a millionth, each once, in order.
fn unique(v: Vec<f64>) -> Vec<f64> {
  let mut out: Vec<f64> = Vec::new();
  for n in v {
    let r = js_round(n * 1e6) / 1e6;
    // As a JavaScript Set of numbers: 0 and -0 are the same.
    if !out.contains(&r) {
      out.push(r);
    }
  }
  out
}

/// Everything a photo can snap to: guides plus page edges (including the gutter).
pub fn snap_lines(spread: &Spread, s: &Sheet) -> GuideLines {
  let g = spread_guides(spread, s);
  let mut xs = g.xs;
  for &side in page_sides(spread.kind) {
    let p = page_rect(side, s);
    xs.push(p.x);
    xs.push(p.x + p.w);
  }
  let mut ys = g.ys;
  ys.push(0.0);
  ys.push(s.page_h);
  GuideLines {
    xs: unique(xs),
    ys: unique(ys),
  }
}

/// The smallest adjustment that lands one of some points on a line, and the line.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Snap {
  pub delta: f64,
  pub line: Option<f64>,
}

/// Find the smallest adjustment that lands one of `points` on one of `lines`.
pub fn snap_points(points: &[f64], lines: &[f64], threshold: f64) -> Snap {
  let mut best = Snap { delta: 0.0, line: None };
  let mut best_dist = threshold;
  for &p in points {
    for &l in lines {
      let d = (l - p).abs();
      if d <= best_dist {
        best_dist = d;
        best = Snap {
          delta: l - p,
          line: Some(l),
        };
      }
    }
  }
  best
}

/// Which lines a snap landed on, to show.
pub type SnapFeedback = GuideLines;

/// Snap a moving rect's edges and center to guides.
pub fn snap_move(r: Rect, lines: &GuideLines, threshold: f64) -> (Rect, SnapFeedback) {
  let sx = snap_points(&[r.x, r.x + r.w / 2.0, r.x + r.w], &lines.xs, threshold);
  let sy = snap_points(&[r.y, r.y + r.h / 2.0, r.y + r.h], &lines.ys, threshold);
  (
    Rect {
      x: r.x + sx.delta,
      y: r.y + sy.delta,
      ..r
    },
    GuideLines {
      xs: sx.line.into_iter().collect(),
      ys: sy.line.into_iter().collect(),
    },
  )
}

/// A rectangle's corner, for resizing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Corner {
  Nw,
  Ne,
  Sw,
  Se,
}

/// Resize `start` by dragging `corner` by (dx, dy), anchored at the opposite corner. With
/// `lock_aspect`, its shape is kept. `min` is the smallest a side gets.
#[allow(clippy::too_many_arguments)]
pub fn resize_rect(
  start: Rect,
  corner: Corner,
  dx: f64,
  dy: f64,
  lock_aspect: bool,
  lines: Option<&GuideLines>,
  threshold: f64,
  min: f64,
) -> (Rect, SnapFeedback) {
  let west = matches!(corner, Corner::Nw | Corner::Sw);
  let north = matches!(corner, Corner::Nw | Corner::Ne);
  let ax = if west { start.x + start.w } else { start.x };
  let ay = if north { start.y + start.h } else { start.y };
  let mut mx = (if west { start.x } else { start.x + start.w }) + dx;
  let mut my = (if north { start.y } else { start.y + start.h }) + dy;
  let mut hit = GuideLines::default();
  let aspect = start.w / start.h;
  let none = Snap { delta: 0.0, line: None };
  let sx = lines.map_or(none, |l| snap_points(&[mx], &l.xs, threshold));
  let sy = lines.map_or(none, |l| snap_points(&[my], &l.ys, threshold));
  let (w, h);
  if !lock_aspect {
    mx += sx.delta;
    my += sy.delta;
    hit.xs.extend(sx.line);
    hit.ys.extend(sy.line);
    w = (if west { ax - mx } else { mx - ax }).max(min);
    h = (if north { ay - my } else { my - ay }).max(min);
  } else {
    // Size follows whichever axis the pointer moved further along, or the axis that snapped.
    let fw = (mx - ax).abs();
    let fh = (my - ay).abs();
    let use_x = if sx.line.is_some() && (sy.line.is_none() || sx.delta.abs() <= sy.delta.abs()) {
      true
    } else if sy.line.is_some() {
      false
    } else {
      fw / aspect >= fh
    };
    if use_x {
      if let Some(l) = sx.line {
        mx += sx.delta;
        hit.xs.push(l);
      }
      w = (mx - ax).abs().max(min);
      h = w / aspect;
    } else {
      if let Some(l) = sy.line {
        my += sy.delta;
        hit.ys.push(l);
      }
      h = (my - ay).abs().max(min);
      w = h * aspect;
    }
  }
  (
    Rect::new(if west { ax - w } else { ax }, if north { ay - h } else { ay }, w, h),
    hit,
  )
}

/// Whether two rectangles overlap (touching edges don't).
pub fn intersects(a: &Rect, b: &Rect) -> bool {
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

type Knots = Vec<(f64, f64)>;

/// Guide positions along one axis of one page, paired old → new: its edges and center
/// always, then each guide, kept only if it's on the page at both sizes and in the same
/// order among the others.
fn page_knots(knots: &mut Knots, o0: f64, n0: f64, old: f64, new: f64, from_start: &[f64], from_end: &[f64]) {
  let candidates: Knots = from_start
    .iter()
    .map(|d| (o0 + d, n0 + d))
    .chain(from_end.iter().map(|d| (o0 + old - d, n0 + new - d)))
    .collect();
  knots.push((o0, n0));
  knots.push((o0 + old / 2.0, n0 + new / 2.0));
  knots.push((o0 + old, n0 + new));
  for k in candidates {
    let on_page = k.0 > o0 && k.0 < o0 + old && k.1 > n0 && k.1 < n0 + new;
    if on_page && knots.iter().all(|(o, n)| (k.0 - o) * (k.1 - n) > 1e-12) {
      knots.push(k);
    }
  }
}

fn sorted(mut knots: Knots) -> Knots {
  knots.sort_by(|a, b| a.0.total_cmp(&b.0));
  let mut out: Knots = Vec::with_capacity(knots.len());
  for (i, k) in knots.iter().enumerate() {
    if i == 0 || k.0 - knots[i - 1].0 > 1e-9 {
      out.push(*k);
    }
  }
  out
}

/// Piecewise-linear map through the knots; beyond the outer edges, offsets are kept.
fn map_axis(v: f64, knots: &Knots) -> f64 {
  let (Some(first), Some(last)) = (knots.first(), knots.last()) else {
    return v;
  };
  if v <= first.0 {
    return first.1 + (v - first.0);
  }
  if v >= last.0 {
    return last.1 + (v - last.0);
  }
  for w in knots.windows(2) {
    let (a, b) = (w[0], w[1]);
    if v > b.0 {
      continue;
    }
    let t = (v - a.0) / (b.0 - a.0);
    return a.1 + t * (b.1 - a.1);
  }
  v
}

/// Move a spread item so it keeps its place among the page's guides after a page-size
/// change: its edges are mapped through the guides, and the photo is refit into that box,
/// keeping its proportions, around the box's center.
pub fn relayout_rect(r: Rect, from: &Sheet, to: &Sheet) -> Rect {
  let b: Vec<Edges> = from.borders.iter().map(edges_of).collect();
  let along = |axis: Axis| from.lines.iter().filter(move |l| l.axis == axis).map(|l| l.at);
  let outside: Vec<f64> = b.iter().map(|g| g.outside).chain(along(Axis::Vertical)).collect();
  let inside: Vec<f64> = b.iter().map(|g| g.inside).collect();
  let mut xs = Vec::new();
  if from.arrangement == Arrangement::Frames {
    page_knots(&mut xs, 0.0, 0.0, from.page_w, to.page_w, &outside, &inside);
  } else {
    page_knots(
      &mut xs,
      -from.page_w,
      -to.page_w,
      from.page_w,
      to.page_w,
      &outside,
      &inside,
    );
    page_knots(&mut xs, 0.0, 0.0, from.page_w, to.page_w, &inside, &outside);
  }
  let mut ys = Vec::new();
  let tops: Vec<f64> = b.iter().map(|g| g.top).chain(along(Axis::Horizontal)).collect();
  let bottoms: Vec<f64> = b.iter().map(|g| g.bottom).collect();
  page_knots(&mut ys, 0.0, 0.0, from.page_h, to.page_h, &tops, &bottoms);
  refit(r, &sorted(xs), &sorted(ys))
}

fn refit(r: Rect, xs: &Knots, ys: &Knots) -> Rect {
  let x1 = map_axis(r.x, xs);
  let x2 = map_axis(r.x + r.w, xs);
  let y1 = map_axis(r.y, ys);
  let y2 = map_axis(r.y + r.h, ys);
  let box_w = (x2 - x1).max(0.1);
  let box_h = (y2 - y1).max(0.1);
  let aspect = r.w / r.h;
  let w = box_w.min(box_h * aspect);
  let h = w / aspect;
  Rect::new((x1 + x2) / 2.0 - w / 2.0, (y1 + y2) / 2.0 - h / 2.0, w, h)
}
