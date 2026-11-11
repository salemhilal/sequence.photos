//! Preview: every spread (or frame) in order, large, as it will print, turned with the
//! arrow keys or the pager; fullscreen to present (`Preview.tsx`).

use gpui_kit::*;
use sequence_core::actions::folio_label;
use sequence_core::geometry::{Rect, page_rect, page_sides, sheet_extent};
use sequence_core::units::terms;
use sequence_core::{PageSide, SpreadKind};

use super::paint::{SpreadPicture, boxed};
use super::{icon_button, text_button};
use crate::assets::MONO;
use crate::theme::Theme;
use crate::workspace::Workspace;

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
    let pager_h = if self.ui.presenting { 0.0 } else { 52.0 };
    let margin = if self.ui.presenting { 0.0 } else { 32.0 };
    // A book shows both pages' width, so its single first and last pages sit on their
    // side at a page's size (not enlarged to fill); a frame, its own.
    let (extent_left, across) = sheet_extent(arrangement, sheet.page_w);
    let scale = ((main.w - 2.0 * margin) / across).min((main.h - 2.0 * margin - pager_h) / sheet.page_h);
    let w = across * scale;
    let h = sheet.page_h * scale;
    let left = (main.w - w) / 2.0;
    let top = (main.h - pager_h - h) / 2.0;
    let pic = SpreadPicture {
      spread,
      sheet: &sheet,
      scale,
      origin: (left - extent_left * scale, top),
      clip: true,
    };
    let bg: Hsla = if self.ui.presenting {
      rgb(0x000000).into()
    } else {
      rgb(self.prefs.desk_color).into()
    };
    let mut stage = div()
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
    // Presenting: how to use it, and the way out, while the pointer moves.
    if self.ui.presenting && self.ui.preview_moved.is_some_and(|t| t.elapsed() < IDLE) {
      stage = stage.child(
        div()
          .absolute()
          .top_0()
          .left_0()
          .right_0()
          .flex()
          .items_center()
          .justify_end()
          .gap(px(12.0))
          .p(px(12.0))
          .text_color(rgb(0xbbbbbb))
          .font_family(MONO)
          .text_size(px(11.0))
          .child(format!("← → to {} · Esc to leave fullscreen", terms(arrangement).turn))
          .child(text_button(
            "exit-present",
            "Exit fullscreen",
            theme,
            false,
            cx.listener(|ws, _, window, cx| {
              cx.stop_propagation();
              ws.present(false, window, cx);
            }),
          )),
      );
    }
    if !self.ui.presenting {
      let noun = terms(arrangement).spread;
      stage = stage.child(
        div()
          .absolute()
          .left_0()
          .right_0()
          .bottom(px(12.0))
          .flex()
          .justify_center()
          .gap(px(8.0))
          .child(
            div()
              .flex()
              .items_center()
              .gap(px(4.0))
              .px(px(4.0))
              .rounded(px(5.0))
              .bg(theme.panel)
              .border_1()
              .border_color(theme.border)
              .child(icon_button(
                "preview-prev",
                "chevron-left",
                theme,
                index > 0,
                false,
                cx.listener(|ws, _, _, cx| ws.preview_go(-1, cx)),
              ))
              .child(div().font_family(MONO).text_size(px(11.0)).child(format!(
                "{} · {} of {total} {}",
                folio_label(index, total, arrangement),
                index + 1,
                if total == 1 { noun } else { terms(arrangement).spreads }
              )))
              .child(icon_button(
                "preview-next",
                "chevron-right",
                theme,
                index + 1 < total,
                false,
                cx.listener(|ws, _, _, cx| ws.preview_go(1, cx)),
              )),
          )
          .child(text_button(
            "present",
            "Fullscreen",
            theme,
            false,
            cx.listener(|ws, _, window, cx| ws.present(true, window, cx)),
          )),
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
