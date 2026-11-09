//! Preview: every spread (or frame) in order, large, as it will print, turned with the
//! arrow keys or the pager; fullscreen to present (`Preview.tsx`).

use gpui_kit::*;
use sequence_core::actions::folio_label;
use sequence_core::geometry::{spread_left, spread_width};
use sequence_core::units::terms;

use super::paint::SpreadPicture;
use super::{icon_button, text_button};
use crate::assets::MONO;
use crate::theme::Theme;
use crate::workspace::Workspace;

impl Workspace {
  pub fn render_preview(&mut self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let main = self.frames.main;
    let project = self.history.project().clone();
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
    let pw = spread_width(spread.kind, &sheet);
    let scale = ((main.w - 2.0 * margin) / pw).min((main.h - 2.0 * margin - pager_h) / sheet.page_h);
    let w = pw * scale;
    let h = sheet.page_h * scale;
    let left = (main.w - w) / 2.0;
    let top = (main.h - pager_h - h) / 2.0;
    let pic = SpreadPicture {
      spread,
      sheet: &sheet,
      scale,
      origin: (left - spread_left(spread.kind, &sheet) * scale, top),
      clip: true,
    };
    let bg: Hsla = if self.ui.presenting {
      rgb(0x000000).into()
    } else {
      rgb(self.prefs.desk_color).into()
    };
    let mut stage =
      div()
        .id("preview")
        .absolute()
        .size_full()
        .bg(bg)
        .on_click(cx.listener(|ws, ev: &ClickEvent, _, cx| {
          if ws.ui.presenting {
            let back = ev.modifiers().shift;
            ws.preview_go(if back { -1 } else { 1 }, cx);
          }
        }));
    for el in pic.page_elements(theme, None) {
      stage = stage.child(el);
    }
    stage = stage.child(pic.photo_elements(&mut self.lib, &project, theme));
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
    if window.is_fullscreen() != on {
      window.toggle_fullscreen();
    }
    cx.notify();
  }
}
