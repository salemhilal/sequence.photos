//! The sidebar: the book's spreads (or the sequence's frames) in order, each a picture to
//! drop photos on, select, open, and drag to reorder (`Sidebar.tsx`).

use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::actions::{DropTarget, folio_label, is_movable};
use sequence_core::geometry::{Rect, sheet_extent};
use sequence_core::resolution::{placed_soft, soft_label};
use sequence_core::units::terms;
use sequence_core::{Arrangement, PageSide};

use super::paint::{SpreadPicture, Tip as _, boxed, x};
use super::{icon_button, paint};
use crate::assets::MONO;
use crate::theme::Theme;
use crate::workspace::{Cell, Source, Workspace};

const HEADER_H: f64 = 28.0;
const LIST_PAD: f64 = 10.0;
/// The well's padding around a spread's picture, and the row's.
const WELL_PAD: f64 = 8.0;
const ROW_PAD: f64 = 4.0;
const FOOT_H: f64 = 20.0;
/// The gap between rows, where dropping adds a spread.
const GAP_H: f64 = 12.0;
/// In a grid: the gutter between columns (where dropping adds a spread), the rows' gap,
/// and the side padding.
const GAP_X: f64 = 12.0;
const GRID_ROW_GAP: f64 = 10.0;
const GRID_PAD: f64 = 10.0;
/// Horizontal room in a cell beside its picture.
const CELL_PAD_X: f64 = 2.0 * ROW_PAD + 2.0 * WELL_PAD;
/// The most columns, and the narrowest a spread's (or frame's) picture gets.
pub const MAX_COLUMNS: usize = 4;
fn min_thumb(a: Arrangement) -> f64 {
  if a == Arrangement::Spreads { 120.0 } else { 60.0 }
}

/// How many columns fit in a sidebar `w` wide.
fn columns_that_fit(w: f64, a: Arrangement) -> usize {
  let in_grid = w - 2.0 * GRID_PAD;
  let n = ((in_grid + GAP_X) / (min_thumb(a) + CELL_PAD_X + GAP_X)).floor() as usize;
  n.clamp(1, MAX_COLUMNS)
}

impl Workspace {
  /// `r` is in window pixels; the sidebar is drawn in the page's (below the toolbar).
  pub fn render_sidebar(&mut self, r: Rect, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let main_y = self.frames.main.y;
    let project = self.history.project().clone();
    let sheet = project.sheet();
    let arrangement = project.layout.arrangement();
    let book = arrangement == Arrangement::Spreads;
    let terms = terms(arrangement);
    let all = project.layout.all();
    let total = all.len();
    let (extent_left, extent_w) = sheet_extent(arrangement, sheet.page_w);
    // The columns asked for, as many as fit.
    let fit = columns_that_fit(r.w, arrangement);
    let cols = self.prefs.sidebar_columns.clamp(1, fit);
    let grid = cols > 1;
    self.frames.sidebar_grid = grid;
    let cell_w = if grid {
      (r.w - 2.0 * GRID_PAD - GAP_X * (cols - 1) as f64) / cols as f64
    } else {
      r.w - 2.0 * LIST_PAD
    };
    let pic_w = (cell_w - CELL_PAD_X).max(min_thumb(arrangement).min(60.0));
    let scale = pic_w / extent_w;
    let pic_h = sheet.page_h * scale;
    let row_h = ROW_PAD + 2.0 * WELL_PAD + pic_h + FOOT_H + ROW_PAD;
    let list = Rect::new(r.x, r.y + HEADER_H, r.w, r.h - HEADER_H);
    self.frames.sidebar_list = list;
    let slots = total + usize::from(!book);
    let content_h = if grid {
      LIST_PAD * 2.0 + slots.div_ceil(cols) as f64 * (row_h + GRID_ROW_GAP)
    } else {
      LIST_PAD * 2.0 + total as f64 * (row_h + GAP_H) + if book { 0.0 } else { GAP_H }
    };
    let max_scroll = (content_h - list.h).max(0.0);
    self.ui.sidebar_scroll = self.ui.sidebar_scroll.min(max_scroll);
    let scroll = self.ui.sidebar_scroll;

    let mut list_el = div()
      .id("sidebar-list")
      .absolute()
      .left_0()
      .top(x(HEADER_H))
      .w(x(r.w))
      .h(x(list.h))
      .overflow_hidden()
      .on_scroll(cx.listener(|ws, ev, _, cx| ws.sidebar_scroll(ev, cx)))
      .on_mouse_down(
        MouseButton::Left,
        cx.listener(|ws, _, _, cx| {
          ws.ui.spread_selection.clear();
          cx.notify();
        }),
      )
      .on_drop(cx.listener(|ws, paths: &ExternalPaths, _, cx| ws.files_dropped(paths.paths().to_vec(), cx)));

    let editing = self.ui.editing.clone();
    let reorder = self.ui.reorder.clone();
    let weak = cx.entity().downgrade();
    let mut y = LIST_PAD - scroll;
    let mut cells = Vec::new();
    let mut gaps = Vec::new();
    // Where slot `i` (a spread's cell, or the end) is, and the gap before it, in the list.
    let slot = |i: usize, y: f64| -> (Rect, Rect) {
      if grid {
        let (col, line) = (i % cols, i / cols);
        let cx_ = GRID_PAD + col as f64 * (cell_w + GAP_X);
        let cy = LIST_PAD - scroll + line as f64 * (row_h + GRID_ROW_GAP);
        (
          Rect::new(cx_, cy, cell_w, row_h),
          Rect::new((cx_ - GAP_X).max(0.0), cy, GAP_X.min(cx_), row_h),
        )
      } else {
        (
          Rect::new(LIST_PAD, y + GAP_H, cell_w, row_h),
          Rect::new(LIST_PAD, y, cell_w, GAP_H),
        )
      }
    };
    // A gap lit for a drop: a line along it.
    let gap_line = |g: Rect| {
      if grid {
        boxed(Rect::new(g.x + g.w / 2.0 - 1.0, g.y, 2.0, g.h)).bg(theme.accent)
      } else {
        boxed(Rect::new(g.x, g.y + g.h / 2.0 - 1.0, g.w, 2.0)).bg(theme.accent)
      }
    };
    for (i, spread) in all.iter().enumerate() {
      let (row, gap) = slot(i, y);
      // The gap before this spread (a book's first stays first).
      if i > 0 || !book {
        gaps.push((i, Rect::new(list.x + gap.x, list.y + gap.y, gap.w, gap.h)));
        let lit = self.ui.hover == Some(DropTarget::Insert(i)) || reorder.as_ref().is_some_and(|(_, d)| *d == i);
        if lit {
          list_el = list_el.child(gap_line(gap));
        }
      }
      y += GAP_H;
      let selected = self.ui.spread_selection.contains(&spread.id);
      let dragging = reorder.as_ref().is_some_and(|(ids, _)| ids.contains(&spread.id));
      let is_editing = editing.as_ref() == Some(&spread.id);
      let id = spread.id.clone();
      let mut row_el = boxed(row)
        .id(SharedString::from(format!("row-{}", spread.id)))
        .rounded(px(3.0))
        .on_mouse_down(
          MouseButton::Left,
          cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            ws.spread_down(id.clone(), ev, cx);
          }),
        );
      if selected {
        row_el = row_el.bg(theme.control).border_1().border_color(theme.accent);
      } else if is_editing {
        row_el = row_el.bg(theme.accent_soft);
      }
      if dragging {
        row_el = row_el.opacity(0.4);
      }
      // The well, and the spread's picture in it.
      let well = Rect::new(ROW_PAD, ROW_PAD, row.w - 2.0 * ROW_PAD, pic_h + 2.0 * WELL_PAD);
      row_el = row_el.child(boxed(well).rounded(px(2.0)).bg(theme.inset));
      let origin_local = (ROW_PAD + WELL_PAD - extent_left * scale, ROW_PAD + WELL_PAD);
      let pic = SpreadPicture {
        spread,
        sheet: &sheet,
        scale,
        origin: origin_local,
        clip: true,
      };
      let lit = match &self.ui.hover {
        Some(DropTarget::Page { spread: s, side }) if s == &spread.id => Some(*side),
        _ => None,
      };
      for el in pic.page_elements(theme, None) {
        row_el = row_el.child(el);
      }
      row_el = row_el.child(pic.photo_elements(&mut self.lib, &project, theme));
      // Pressing a photo in the picture drags it out.
      let pb = pic.pages_box();
      for p in &spread.items {
        let pr = pic.at(Rect::from(p));
        let clipped = clip(pr, pb);
        if clipped.w <= 0.0 || clipped.h <= 0.0 {
          continue;
        }
        let pid = p.photo_id.clone();
        let pid2 = p.photo_id.clone();
        row_el = row_el.child(
          boxed(clipped)
            .on_mouse_down(
              MouseButton::Left,
              cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
                cx.stop_propagation();
                ws.photo_down(Source::Sidebar, pid.clone(), ev, cx);
              }),
            )
            .on_mouse_down(
              MouseButton::Right,
              cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
                cx.stop_propagation();
                ws.photo_menu(pid2.clone(), ev, cx);
              }),
            ),
        );
      }
      if let Some(side) = lit {
        for (s, pr) in pic.pages() {
          if s == side {
            row_el = row_el.child(boxed(pr).border_2().border_color(theme.accent));
          }
        }
      }
      // The foot: its folio, its soft photos, and (for a movable spread) delete.
      let label = folio_label(i, total, arrangement);
      let soft = spread
        .items
        .iter()
        .filter(|p| placed_soft(project.photos.get(&p.photo_id), p, sheet.px_per_unit))
        .count();
      let foot = div()
        .absolute()
        .left(x(ROW_PAD + 2.0))
        .right(x(ROW_PAD))
        .top(x(ROW_PAD + well.h))
        .h(x(FOOT_H))
        .flex()
        .items_center()
        .gap(px(6.0))
        .text_color(if selected { theme.text } else { theme.muted })
        .child(
          div()
            .font_family(MONO)
            .text_size(px(11.0))
            .font_weight(FontWeight::MEDIUM)
            .child(label),
        )
        .when(soft > 0, |d| {
          d.child(
            div()
              .flex()
              .items_center()
              .gap(px(3.0))
              .text_size(px(10.0))
              .text_color(theme.warn)
              .child(
                svg()
                  .path(crate::assets::icon("triangle-alert"))
                  .size(px(11.0))
                  .text_color(theme.warn),
              )
              .child(soft_label(soft, sheet.unit, sheet.px_per_unit)),
          )
        })
        .child(div().flex_1())
        .child({
          let id = spread.id.clone();
          icon_button(
            SharedString::from(format!("edit-{}", spread.id)),
            "pencil",
            theme,
            true,
            false,
            cx.listener(move |ws, _, _, cx| ws.open_editor(id.clone(), cx)),
          )
          .tip("Edit", weak.clone())
          .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        })
        .when(is_movable(spread.kind), |d| {
          let id = spread.id.clone();
          d.child(
            icon_button(
              SharedString::from(format!("delete-{}", spread.id)),
              "x",
              theme,
              true,
              false,
              cx.listener(move |ws, _, _, cx| {
                let visible = ws.visible();
                let ids = vec![id.clone()];
                ws.apply(cx, |d| sequence_core::actions::delete_spreads(d, &ids, visible));
              }),
            )
            .tip(
              format!(
                "Delete {} (photos return to the desk)",
                if spread.kind == sequence_core::SpreadKind::Frame {
                  "frame"
                } else {
                  "spread"
                }
              ),
              weak.clone(),
            )
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation()),
          )
        });
      row_el = row_el.child(foot);
      list_el = list_el.child(row_el);
      // Where this row and its pages are, in window pixels.
      let to_window = |q: Rect| Rect::new(list.x + row.x + q.x, list.y + row.y + q.y, q.w, q.h);
      cells.push(Cell {
        id: spread.id.clone(),
        index: i,
        row: Rect::new(list.x + row.x, list.y + row.y, row.w, row.h),
        pages: pic.pages().into_iter().map(|(s, q)| (s, to_window(q))).collect(),
        scale,
      });
      y += row_h;
    }
    if !book {
      let (_, gap) = slot(total, y);
      gaps.push((total, Rect::new(list.x + gap.x, list.y + gap.y, gap.w, gap.h)));
      if self.ui.hover == Some(DropTarget::Insert(total)) || reorder.as_ref().is_some_and(|(_, d)| *d == total) {
        list_el = list_el.child(gap_line(gap));
      }
    }
    // Only gaps and cells in view take drops.
    let in_view = |q: &Rect| q.y + q.h > list.y && q.y < list.y + list.h;
    self.frames.cells = cells.into_iter().filter(|c| in_view(&c.row)).collect();
    self.frames.gaps = gaps.into_iter().filter(|(_, g)| in_view(g)).collect();

    let add_at = if book { total - 1 } else { total };
    let header = div()
      .absolute()
      .left_0()
      .top_0()
      .w(x(r.w))
      .h(x(HEADER_H))
      .flex()
      .items_center()
      .gap(px(2.0))
      .pl(px(10.0))
      .pr(px(6.0))
      .bg(theme.header)
      .border_b_1()
      .border_color(theme.divider)
      .child(div().font_weight(FontWeight::SEMIBOLD).child(terms.spreads_title))
      .child(
        icon_button(
          "add-spread",
          "plus",
          theme,
          true,
          false,
          cx.listener(move |ws, _, _, cx| ws.apply(cx, |d| drop(sequence_core::actions::add_spread(d, add_at)))),
        )
        .tip(terms.add_at_end, cx.entity().downgrade()),
      )
      .child(div().flex_1())
      .when(fit > 1, |d| {
        // Only as many columns as fit: none to choose from when one is all that fits.
        let options: Vec<(usize, String)> = (1..=fit).map(|n| (n, n.to_string())).collect();
        let options: Vec<(usize, &str)> = options.iter().map(|(n, l)| (*n, l.as_str())).collect();
        let ws = cx.entity().downgrade();
        d.child(
          super::controls::segmented("sidebar-columns", &options, cols, theme, move |n, _, cx| {
            let _ = ws.update(cx, |ws, cx| {
              ws.prefs.sidebar_columns = n;
              ws.prefs.save();
              cx.notify();
            });
          })
          .mr(px(6.0)),
        )
      })
      .child(
        div()
          .text_color(theme.muted)
          .font_family(MONO)
          .text_size(px(11.0))
          .child(terms.count(total)),
      );

    let resize = div()
      .id("sidebar-resize")
      .absolute()
      .left(px(-3.0))
      .top_0()
      .bottom_0()
      .w(px(6.0))
      .cursor(CursorStyle::ResizeLeftRight)
      .tip("Drag to resize · double-click to reset", cx.entity().downgrade())
      .on_mouse_down(
        MouseButton::Left,
        cx.listener(|ws, ev: &MouseDownEvent, _, cx| {
          cx.stop_propagation();
          if ev.click_count == 2 {
            ws.prefs.sidebar_width = crate::prefs::SIDEBAR_DEFAULT_WIDTH;
            ws.prefs.save();
            cx.notify();
          } else {
            ws.sidebar_resize_down(ev);
          }
        }),
      );

    let _ = PageSide::Whole;
    let _ = paint::x;
    div()
      .absolute()
      .left(x(r.x))
      .top(x(r.y - main_y))
      .w(x(r.w))
      .h(x(r.h))
      .bg(theme.panel)
      .border_l_1()
      .border_color(theme.divider)
      .child(list_el)
      .child(header)
      .child(resize)
      .into_any_element()
  }
}

/// The part of `r` inside `bounds`.
fn clip(r: Rect, bounds: Rect) -> Rect {
  let x1 = r.x.max(bounds.x);
  let y1 = r.y.max(bounds.y);
  let x2 = (r.x + r.w).min(bounds.x + bounds.w);
  let y2 = (r.y + r.h).min(bounds.y + bounds.h);
  Rect::new(x1, y1, x2 - x1, y2 - y1)
}
