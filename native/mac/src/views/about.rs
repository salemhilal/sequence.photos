//! About Sequence (`AboutDialog.tsx`), in a small window of its own: the wordmark, the
//! version, and where to find out more.

use gpui_kit::*;

use crate::assets::{FONT, MONO, icon};
use crate::theme::Theme;
use crate::workspace::Workspace;

pub struct AboutWindow {
  ws: Entity<Workspace>,
}

impl AboutWindow {
  pub fn new(ws: Entity<Workspace>, window: &mut Window, cx: &mut Context<Self>) -> Self {
    cx.observe_window_appearance(window, |_, _, cx| cx.notify()).detach();
    Self { ws }
  }
}

fn link(id: &'static str, name: &'static str, label: &'static str, url: String, theme: &Theme) -> Stateful<Div> {
  div()
    .id(id)
    .flex()
    .items_center()
    .gap(px(6.0))
    .text_color(theme.accent_ink)
    .cursor_pointer()
    .child(svg().path(icon(name)).size(px(13.0)).text_color(theme.accent_ink))
    .child(label)
    .on_click(move |_, _, cx| cx.open_url(&url))
}

impl Render for AboutWindow {
  fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
    let theme = Theme::for_appearance(window.appearance(), self.ws.read(cx).prefs.theme);
    let year = &crate::commands::now_iso()[..4];
    div()
      .size_full()
      .flex()
      .flex_col()
      .items_center()
      .gap(px(10.0))
      .pt(px(36.0))
      .bg(theme.panel)
      .text_color(theme.text)
      .font_family(FONT)
      .text_size(px(12.0))
      .child(
        div()
          .text_size(px(26.0))
          .font_weight(FontWeight::BOLD)
          .child("SEQUENCE"),
      )
      .child(
        div()
          .font_family(MONO)
          .text_color(theme.muted)
          .child(format!("Version {}", env!("CARGO_PKG_VERSION"))),
      )
      .child(div().child("A tool for playing with photo sequences."))
      .child(
        div()
          .flex()
          .flex_col()
          .gap(px(6.0))
          .py(px(8.0))
          .child(link(
            "salem",
            "external-link",
            "salem.io",
            "https://salem.io".into(),
            &theme,
          ))
          .child(link(
            "mail",
            "mail",
            "hi@sequence.photos",
            "mailto:hi@sequence.photos".into(),
            &theme,
          ))
          .child(link(
            "source",
            "code-xml",
            "Source on GitHub",
            crate::config::repo_url().into(),
            &theme,
          ))
          .child(link(
            "privacy",
            "shield",
            "Privacy policy",
            format!("{}/privacy/", crate::config::site_url()),
            &theme,
          )),
      )
      .child(
        div()
          .font_family(MONO)
          .text_size(px(11.0))
          .text_color(theme.muted)
          .child(format!("© {year} Salem Hilal")),
      )
      .child(
        div()
          .font_family(MONO)
          .text_size(px(11.0))
          .text_color(theme.muted)
          .child("Sample photos © Salem Hilal"),
      )
  }
}
