//! Preview: every spread (or frame) in order, large, as it will print, turned with the
//! arrow keys or the pager; fullscreen to present (`Preview.tsx`).

use gpui_kit::*;
use sequence_core::geometry::{Rect, page_rect, page_sides, sheet_extent};
use sequence_core::units::terms;
use sequence_core::{PageSide, SpreadKind};

use gpui_kit::prelude::FluentBuilder as _;

use super::paint::{SpreadPicture, boxed, x};
use crate::assets::MONO;
use crate::theme::Theme;
use crate::workspace::Workspace;

/// Preview's buttons on its dark stage (`.preview .btn`): light text on a faint fill.
fn dark_button(
  id: &'static str,
  icon_name: &'static str,
  label: &'static str,
  click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
  div()
    .id(id)
    .flex()
    .items_center()
    .gap(px(6.0))
    .h(px(26.0))
    .px(px(10.0))
    .rounded(px(3.0))
    .bg(hsla(0.0, 0.0, 1.0, 0.08))
    .hover(|s| s.bg(hsla(0.0, 0.0, 1.0, 0.14)))
    .text_color(rgb(0xe9e6df))
    .child(
      svg()
        .path(crate::assets::icon(icon_name))
        .size(px(14.0))
        .text_color(rgb(0xe9e6df)),
    )
    .child(label)
    .on_click(click)
}

/// A turn button at the stage's side (`.turn`).
fn turn(
  id: &'static str,
  icon_name: &'static str,
  enabled: bool,
  r: Rect,
  click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
  let b = boxed(r)
    .id(id)
    .flex()
    .items_center()
    .justify_center()
    .rounded(px(8.0))
    .bg(hsla(0.0, 0.0, 1.0, 0.08))
    .child(
      svg()
        .path(crate::assets::icon(icon_name))
        .size(px(28.0))
        .text_color(rgb(0xeeeeee)),
    );
  if enabled { b.on_click(click) } else { b.opacity(0.2) }
}

/// How long the presentation's controls stay after the pointer stops.
const IDLE: std::time::Duration = std::time::Duration::from_millis(1000);

impl Workspace {
  pub fn render_preview(&mut self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let main = self.frames.main;
    let project = self.history.shared();
    let sheet = project.sheet();
    let arrangement = project.layout.arrangement();
    let all = project.layout.all();
    let total = all.len();
    self.ui.preview_index = self.ui.preview_index.min(total.saturating_sub(1));
    let index = self.ui.preview_index;
    let Some(spread) = all.get(index).copied() else {
      return div().into_any_element();
    };
    // As the web's: a header for Fullscreen, the spread between the turn buttons, and its
    // count just below it. A book shows both pages' width, so its single first and last
    // pages sit on their side at a page's size (not enlarged to fill); a frame, its own.
    let (head_h, side, foot, count_h) = (44.0, 64.0, 32.0, 24.0);
    let (extent_left, across) = sheet_extent(arrangement, sheet.page_w);
    let room_w = (main.w - 2.0 * side).max(1.0);
    let room_h = (main.h - head_h - foot - count_h).max(1.0);
    let scale = (room_w / across).min(room_h / sheet.page_h);
    let w = across * scale;
    let h = sheet.page_h * scale;
    let left = (main.w - w) / 2.0;
    let top = head_h + (room_h - h) / 2.0;
    // The controls fade while presenting, once the pointer rests.
    let shown = !self.ui.presenting || self.ui.preview_moved.is_some_and(|t| t.elapsed() < IDLE);
    let pic = SpreadPicture {
      spread,
      sheet: &sheet,
      scale,
      origin: (left - extent_left * scale, top),
      clip: true,
    };
    let bg: Hsla = rgb(0x0f0f0e).into();
    let stage = div()
      .id("preview")
      .absolute()
      .size_full()
      .bg(bg)
      .on_click(cx.listener(|ws, ev: &ClickEvent, _, cx| {
        if ws.ui.presenting {
          let back = ev.modifiers().shift;
          ws.preview_go(if back { -1 } else { 1 }, cx);
        }
      }))
      .on_mouse_move(cx.listener(|ws, _: &MouseMoveEvent, _, cx| {
        if !ws.ui.presenting {
          return;
        }
        let was = ws.ui.preview_moved.is_some_and(|t| t.elapsed() < IDLE);
        ws.ui.preview_moved = Some(std::time::Instant::now());
        if !was {
          cx.notify();
        }
        // Hide the controls once the pointer rests: one timer, which waits again for as long
        // as the pointer moved meanwhile (not a timer per move).
        if !was {
          cx.spawn(async move |this, cx| {
            let mut wait = IDLE;
            loop {
              cx.background_executor().timer(wait).await;
              let rest = this.update(cx, |ws, cx| {
                let since = ws.ui.preview_moved.map_or(IDLE, |t| t.elapsed());
                if since >= IDLE {
                  cx.notify();
                  None
                } else {
                  Some(IDLE - since)
                }
              });
              match rest {
                Ok(Some(more)) => wait = more,
                _ => break,
              }
            }
          })
          .detach();
        }
      }));
    // The spread, drawn in a layer of its own that slides in from the side it was turned to.
    let outer = stage;
    let mut stage = div().absolute().size_full();
    // The book's pages cast a shadow.
    for (_, r) in pic.pages() {
      stage = stage.child(boxed(r).shadow(vec![BoxShadow {
        color: hsla(0.0, 0.0, 0.0, 0.45),
        offset: point(px(0.0), px(6.0)),
        blur_radius: px(30.0),
        spread_radius: px(0.0),
        inset: false,
      }]));
    }
    for el in pic.page_elements(theme, None) {
      stage = stage.child(el);
    }
    // The gutter's shade on each page of a book (white pages only: it's lost on black).
    if spread.background.is_none() && spread.kind != SpreadKind::Frame {
      for &side in page_sides(spread.kind) {
        let r = pic.at(page_rect(side, &sheet));
        let shade = r.w * 0.06;
        let (dark, clear) = (hsla(0.0, 0.0, 0.0, 0.1), hsla(0.0, 0.0, 0.0, 0.0));
        let (strip, from, to) = if side == PageSide::Left {
          (Rect::new(r.x + r.w - shade, r.y, shade, r.h), clear, dark)
        } else {
          (Rect::new(r.x, r.y, shade, r.h), dark, clear)
        };
        stage = stage.child(boxed(strip).bg(linear_gradient(
          90.0,
          linear_color_stop(from, 0.0),
          linear_color_stop(to, 1.0),
        )));
      }
    }
    stage = stage.child(pic.photo_elements(&mut self.lib, &project, theme));
    let turned = crate::motion::slide("preview-turn", index);
    let dir = (turned.to as f64 - turned.from as f64).signum();
    let mut stage = outer.child(stage.with_animation(
      SharedString::from(format!("turn-{}", turned.n)),
      crate::motion::ease(crate::motion::TURN),
      move |el, t| {
        let t = f64::from(t);
        el.opacity(if dir == 0.0 { 1.0 } else { t as f32 })
          .left(x(24.0 * dir * (1.0 - t)))
      },
    ));
    if shown {
      let soft: Hsla = rgb(0x8d8a83).into();
      // The header: in fullscreen, how to use it; Fullscreen, or the way out.
      let presenting = self.ui.presenting;
      stage = stage.child(
        div()
          .absolute()
          .top_0()
          .left_0()
          .right_0()
          .h(x(head_h))
          .flex()
          .items_center()
          .justify_end()
          .gap(px(12.0))
          .px(px(16.0))
          .text_color(soft)
          .when(presenting, |d| {
            d.child(format!("← → to {} · Esc to leave fullscreen", terms(arrangement).turn))
          })
          .child(dark_button(
            "present",
            if presenting { "minimize-2" } else { "maximize-2" },
            if presenting { "Exit fullscreen" } else { "Fullscreen" },
            cx.listener(move |ws, _, window, cx| {
              cx.stop_propagation();
              ws.present(!presenting, window, cx);
            }),
          )),
      );
      // The turn buttons at the sides, and the count just below the spread.
      let turn_y = top + h / 2.0 - 32.0;
      stage = stage
        .child(turn(
          "turn-prev",
          "chevron-left",
          index > 0,
          Rect::new(12.0, turn_y, 44.0, 64.0),
          {
            cx.listener(|ws, _, _, cx| {
              cx.stop_propagation();
              ws.preview_go(-1, cx)
            })
          },
        ))
        .child(turn(
          "turn-next",
          "chevron-right",
          index + 1 < total,
          Rect::new(main.w - 56.0, turn_y, 44.0, 64.0),
          cx.listener(|ws, _, _, cx| {
            cx.stop_propagation();
            ws.preview_go(1, cx)
          }),
        ))
        .child(
          boxed(Rect::new(0.0, top + h + 8.0, main.w, 16.0))
            .flex()
            .justify_center()
            .font_family(MONO)
            .text_size(px(11.0))
            .text_color(soft)
            .child(format!("{} / {total}", index + 1)),
        );
    }
    stage.into_any_element()
  }

  pub fn preview_go(&mut self, delta: isize, cx: &mut Context<Self>) {
    let total = self.project().layout.all().len() as isize;
    let next = (self.ui.preview_index as isize + delta).clamp(0, (total - 1).max(0));
    self.ui.preview_index = next as usize;
    cx.notify();
  }

  /// Present the preview fullscreen (the toolbar and status bar hide), or stop.
  pub fn present(&mut self, on: bool, window: &mut Window, cx: &mut Context<Self>) {
    if self.ui.presenting == on {
      return;
    }
    self.ui.presenting = on;
    self.ui.presented_full = false;
    if window.is_fullscreen() != on {
      window.toggle_fullscreen();
    }
    cx.notify();
  }
}
