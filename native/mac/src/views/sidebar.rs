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
use crate::workspace::{Cell, Workspace};

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
const GAP_X: f64 = 16.0;
const GRID_ROW_GAP: f64 = 10.0;
const GRID_PAD: f64 = 16.0;
/// Horizontal room in a cell beside its picture.
const CELL_PAD_X: f64 = 2.0 * ROW_PAD + 2.0 * WELL_PAD;
/// The columns slider's size and place in the header (`.columns-slider`), and its knob's.
const SLIDER_W: f64 = 52.0;
const SLIDER_RIGHT: f64 = 10.0;
const KNOB_W: f64 = 16.0;
/// How long the count stays after scrolling stops.
pub const COUNT_SHOWN: std::time::Duration = std::time::Duration::from_millis(1000);

/// Columns for a press or drag at window x on the slider `track` (its x and width).
pub fn columns_at(x_: f64, track: Rect, fit: usize) -> usize {
  let room = track.w - 2.0 - KNOB_W;
  let f = ((x_ - track.x - 1.0 - KNOB_W / 2.0) / room).clamp(0.0, 1.0);
  1 + (f * (fit - 1) as f64).round() as usize
}

/// The header's columns slider: a pill with a knob, pressed or dragged to a column count.
fn columns_slider(cols: usize, fit: usize, track: Rect, theme: &Theme, cx: &mut Context<Workspace>) -> Stateful<Div> {
  let room = SLIDER_W - 2.0 - KNOB_W;
  let at = 1.0 + room * (cols - 1) as f64 / (fit - 1).max(1) as f64;
  div()
    .id("sidebar-columns")
    .absolute()
    .right(x(SLIDER_RIGHT))
    .w(x(SLIDER_W))
    .h(px(12.0))
    .rounded_full()
    .bg(theme.track)
    .border_1()
    .border_color(theme.border)
    .tip(
      format!("{cols} {}", if cols == 1 { "column" } else { "columns" }),
      cx.entity().downgrade(),
    )
    .on_mouse_down(
      MouseButton::Left,
      cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
        cx.stop_propagation();
        ws.set_columns(columns_at(f64::from(ev.position.x), track, fit), cx);
        ws.drag = Some(crate::workspace::gestures::Drag::Columns { track, fit });
      }),
    )
    .child(
      div()
        .absolute()
        .top(px(1.0))
        .left(x(at - 1.0))
        .w(x(KNOB_W))
        .h(px(8.0))
        .rounded_full()
        .bg(theme.knob)
        .border_1()
        .border_color(hsla(0.0, 0.0, 0.0, 0.35))
        .shadow(vec![BoxShadow {
          color: hsla(0.0, 0.0, 0.0, 0.35),
          offset: point(px(0.0), px(1.0)),
          blur_radius: px(2.0),
          spread_radius: px(0.0),
          inset: false,
        }]),
    )
}

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
    let project = self.history.shared();
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
    // While something's dragged, the gaps show only where it would go.
    let dragging_any = self.drag.is_some();
    let noun = terms.spread;
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
    // When the columns or the order change, spreads glide from where they were.
    let order: Vec<sequence_core::SpreadId> = all.iter().map(|s| s.id.clone()).collect();
    let glide = self.ui.sidebar_glide.begin(cols, &order);
    let mut placed = std::collections::HashMap::new();
    for (i, spread) in all.iter().enumerate() {
      let (row, gap) = slot(i, y);
      // Rows out of view aren't drawn (a long book has hundreds).
      if row.y + row.h < -2.0 * GAP_H || row.y > list.h + 2.0 * GAP_H {
        y += GAP_H + row_h;
        continue;
      }
      // The gap before this spread (a book's first stays first).
      if i > 0 || !book {
        gaps.push((i, Rect::new(list.x + gap.x, list.y + gap.y, gap.w, gap.h)));
        let lit = self.ui.hover == Some(DropTarget::Insert(i)) || reorder.as_ref().is_some_and(|(_, d)| *d == i);
        if lit {
          list_el = list_el.child(gap_line(gap));
          // Photos dragged over it: what dropping does.
          if !grid && reorder.is_none() {
            list_el = list_el.child(
              boxed(gap).flex().items_center().justify_center().child(
                div()
                  .px(px(6.0))
                  .rounded(px(3.0))
                  .bg(theme.accent)
                  .text_color(theme.on_accent)
                  .text_size(px(10.0))
                  .child(format!("Drop to add a {noun}")),
              ),
            );
          }
        } else if !dragging_any {
          list_el = list_el.child(insert_button(
            i,
            gap,
            grid,
            noun,
            self.ui.insert_hover == Some(i),
            theme,
            cx,
          ));
        }
      }
      y += GAP_H;
      let selected = self.ui.spread_selection.contains(&spread.id);
      let dragging = reorder.as_ref().is_some_and(|(ids, _)| ids.contains(&spread.id));
      let is_editing = editing.as_ref() == Some(&spread.id);
      let id = spread.id.clone();
      // Its edit and delete buttons show while it's hovered.
      let group = SharedString::from(format!("row-{}", spread.id));
      let mut row_el = boxed(row)
        .id(group.clone())
        .group(group.clone())
        .rounded(px(3.0))
        .on_mouse_down(
          MouseButton::Left,
          cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            ws.spread_down(id.clone(), ev, cx);
          }),
        );
      if !is_movable(spread.kind) {
        row_el = row_el.tip("The first and last pages stay in place", weak.clone());
      }
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
        let pid2 = p.photo_id.clone();
        row_el = row_el.child(
          // A press here is the spread's (it drags to reorder, or opens on a double-click);
          // a right-click is the photo's.
          boxed(clipped).on_mouse_down(
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
        // Just the mark; what it means is its hint.
        .when(soft > 0, |d| {
          d.child(
            div()
              .id(SharedString::from(format!("soft-{}", spread.id)))
              .size(px(18.0))
              .flex()
              .items_center()
              .justify_center()
              .rounded(px(3.0))
              .bg(theme.panel)
              .shadow_sm()
              .child(
                svg()
                  .path(crate::assets::icon("triangle-alert"))
                  .size(px(12.0))
                  .text_color(theme.warn),
              )
              .tip(soft_label(soft, sheet.unit, sheet.px_per_unit), weak.clone()),
          )
        })
        .child(div().flex_1())
        .child({
          let id = spread.id.clone();
          row_icon(
            SharedString::from(format!("edit-{}", spread.id)),
            "pencil",
            13.0,
            theme,
            cx.listener(move |ws, _, _, cx| ws.open_editor(id.clone(), cx)),
          )
          .tip("Edit", weak.clone())
          .opacity(0.0)
          .group_hover(group.clone(), |s| s.opacity(1.0))
          .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        })
        // A book's middle spreads, and any frame but a sequence's only one.
        .when(is_movable(spread.kind) && (book || total > 1), |d| {
          let id = spread.id.clone();
          d.child(
            row_icon(
              SharedString::from(format!("delete-{}", spread.id)),
              "x",
              15.0,
              theme,
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
            .opacity(0.0)
            .group_hover(group.clone(), |s| s.opacity(1.0))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation()),
          )
        });
      row_el = row_el.child(foot);
      // Where it is in the list (scrolling aside), and where it glides from.
      placed.insert(spread.id.clone(), (row.x, row.y + scroll));
      match glide
        .as_ref()
        .and_then(|(from, n)| from.get(&spread.id).map(|f| (*f, *n)))
      {
        Some(((fx, fy), n)) if (fx, fy - scroll) != (row.x, row.y) => {
          let (tx, ty) = (row.x, row.y);
          let fy = fy - scroll;
          list_el = list_el.child(row_el.with_animation(
            SharedString::from(format!("glide-{n}-{}", spread.id)),
            crate::motion::ease(crate::motion::GLIDE),
            move |el, t| {
              let t = f64::from(t);
              el.left(x(fx + (tx - fx) * t)).top(x(fy + (ty - fy) * t))
            },
          ));
        }
        _ => list_el = list_el.child(row_el),
      }
      // Where this row and its pages are, in window pixels.
      let to_window = |q: Rect| Rect::new(list.x + row.x + q.x, list.y + row.y + q.y, q.w, q.h);
      cells.push(Cell {
        id: spread.id.clone(),
        index: i,
        row: Rect::new(list.x + row.x, list.y + row.y, row.w, row.h),
        pages: pic.pages().into_iter().map(|(s, q)| (s, to_window(q))).collect(),
      });
      y += row_h;
    }
    if !book {
      let (_, gap) = slot(total, y);
      gaps.push((total, Rect::new(list.x + gap.x, list.y + gap.y, gap.w, gap.h)));
      if self.ui.hover == Some(DropTarget::Insert(total)) || reorder.as_ref().is_some_and(|(_, d)| *d == total) {
        list_el = list_el.child(gap_line(gap));
      } else if !dragging_any {
        list_el = list_el.child(insert_button(
          total,
          gap,
          grid,
          noun,
          self.ui.insert_hover == Some(total),
          theme,
          cx,
        ));
      }
    }
    self.ui.sidebar_glide.drawn(placed);
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
      .child(div().font_weight(FontWeight::MEDIUM).child(terms.spreads_title))
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
      // Only as many columns as fit: none to choose from when one is all that fits.
      .when(fit > 1, |d| {
        let track = Rect::new(r.x + r.w - SLIDER_RIGHT - SLIDER_W, 0.0, SLIDER_W, 0.0);
        d.child(columns_slider(cols, fit, track, theme, cx))
      });

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
      // How many there are, at the foot while scrolling (and a moment after).
      .when(
        self.ui.sidebar_scrolled.is_some_and(|t| t.elapsed() < COUNT_SHOWN),
        |d| {
          d.child(
            div()
              .absolute()
              .bottom(px(14.0))
              .left_0()
              .right_0()
              .flex()
              .justify_center()
              .child(
                div()
                  .px(px(10.0))
                  .py(px(4.0))
                  .rounded_full()
                  .bg(theme.text.opacity(0.9))
                  .text_color(theme.bg)
                  .font_family(MONO)
                  .text_size(px(11.0))
                  .child(terms.count(total)),
              ),
          )
        },
      )
      .into_any_element()
  }
}

/// A gap between spreads, hovered: a button to add one there ("+" in a grid's narrow gutters).
fn insert_button(
  index: usize,
  gap: Rect,
  grid: bool,
  noun: &'static str,
  hovered: bool,
  theme: &Theme,
  cx: &mut Context<Workspace>,
) -> Stateful<Div> {
  // In a grid, a round "+"; in a column, a pill that says what it adds. Drawn above the
  // list (as a tooltip is), so the sidebar's edges never clip it.
  let chip = div()
    .flex()
    .items_center()
    .justify_center()
    .bg(theme.accent)
    .text_color(theme.on_accent)
    .shadow_sm();
  let chip = if grid {
    chip.size(px(18.0)).rounded_full().child(
      svg()
        .path(crate::assets::icon("plus"))
        .size(px(12.0))
        .text_color(theme.on_accent),
    )
  } else {
    chip
      .h(px(18.0))
      .px(px(8.0))
      .rounded_full()
      .text_size(px(11.0))
      .child(format!("+ Add {noun}"))
  };
  let tip = format!("Add a {noun} here");
  boxed(gap)
    .id(("insert", index))
    .flex()
    .items_center()
    .justify_center()
    .on_hover(cx.listener(move |ws, h: &bool, _, cx| {
      if *h {
        ws.ui.insert_hover = Some(index);
        ws.ui.hint = Some(tip.clone());
      } else if ws.ui.insert_hover == Some(index) {
        ws.ui.insert_hover = None;
        ws.ui.hint = None;
      }
      cx.notify();
    }))
    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
    .on_click(cx.listener(move |ws, _, _, cx| {
      ws.apply(cx, |d| drop(sequence_core::actions::add_spread(d, index)));
    }))
    .when(hovered, |d| d.child(deferred(chip).with_priority(5)))
}

/// A spread's edit or delete button (`.row-edit`, `.row-delete`): a small icon, muted until
/// hovered, with no fill behind it.
fn row_icon(
  id: SharedString,
  name: &'static str,
  size: f64,
  theme: &Theme,
  click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
  let hover = theme.text;
  div()
    .id(id)
    .flex()
    .items_center()
    .justify_center()
    .w(px(20.0))
    .h(px(20.0))
    .text_color(theme.muted)
    .hover(move |s| s.text_color(hover))
    .child(
      svg()
        .path(crate::assets::icon(name))
        .size(x(size))
        .text_color(theme.muted),
    )
    .on_click(click)
}

/// The part of `r` inside `bounds`.
fn clip(r: Rect, bounds: Rect) -> Rect {
  let x1 = r.x.max(bounds.x);
  let y1 = r.y.max(bounds.y);
  let x2 = (r.x + r.w).min(bounds.x + bounds.w);
  let y2 = (r.y + r.h).min(bounds.y + bounds.h);
  Rect::new(x1, y1, x2 - x1, y2 - y1)
}
