//! The Settings window (`SettingsDialog.tsx`'s `SettingsWindow`): the app's own preferences,
//! in a window of their own. It edits the workspace's prefs, so the main window follows as
//! they change. Instagram's settings come with the Instagram export.

use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::test_images::MAX_TEST_IMAGES;

use super::controls::{check, help, segmented};
use super::text_button;
use crate::assets::FONT;
use crate::fields::parse_number;
use crate::theme::{DESK_COLORS, Theme, ThemePref, hex_color, parse_hex_color};
use crate::workspace::Workspace;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
  General,
  Advanced,
}

const TABS: &[(Tab, &str)] = &[(Tab::General, "General"), (Tab::Advanced, "Advanced")];
const THEMES: &[(ThemePref, &str)] = &[
  (ThemePref::System, "System"),
  (ThemePref::Light, "Light"),
  (ThemePref::Dark, "Dark"),
];

/// The Settings window's view.
pub struct SettingsWindow {
  ws: Entity<Workspace>,
  tab: Tab,
  /// The desk's custom color, as hex.
  custom_desk: Entity<InputState>,
  /// How many test images to add.
  test_count: Entity<InputState>,
}

impl SettingsWindow {
  pub fn new(ws: Entity<Workspace>, window: &mut Window, cx: &mut Context<Self>) -> Self {
    // The main window's changes (a desk color picked from its menu) show here too.
    cx.observe(&ws, |_, _, cx| cx.notify()).detach();
    cx.observe_window_appearance(window, |_, _, cx| cx.notify()).detach();

    let desk = ws.read(cx).prefs.desk_color;
    let custom_desk = cx.new(|cx| InputState::new(window, cx).default_value(hex_color(desk)));
    cx.subscribe_in(&custom_desk, window, |this, state, ev: &InputEvent, _, cx| {
      if matches!(ev, InputEvent::PressEnter { .. } | InputEvent::Blur)
        && let Some(c) = parse_hex_color(&state.read(cx).value())
      {
        this.ws.update(cx, |ws, cx| ws.set_desk_color(c, cx));
      }
    })
    .detach();

    let test_count = cx.new(|cx| InputState::new(window, cx).default_value("6"));
    cx.subscribe_in(&test_count, window, |this, _, ev: &InputEvent, _, cx| match ev {
      InputEvent::PressEnter { .. } => this.add_test_images(cx),
      InputEvent::Change => cx.notify(),
      _ => {}
    })
    .detach();

    Self {
      ws,
      tab: Tab::General,
      custom_desk,
      test_count,
    }
  }

  /// The count typed, if it's a whole number from 1 to the most allowed.
  fn count(&self, cx: &App) -> Option<usize> {
    let n = parse_number(&self.test_count.read(cx).value())?;
    (n.fract() == 0.0 && (1.0..=MAX_TEST_IMAGES as f64).contains(&n)).then_some(n as usize)
  }

  #[cfg(target_os = "macos")]
  fn add_test_images(&mut self, cx: &mut Context<Self>) {
    let Some(n) = self.count(cx) else { return };
    self.ws.update(cx, |ws, cx| ws.add_test_images(n, cx));
  }

  #[cfg(not(target_os = "macos"))]
  fn add_test_images(&mut self, _: &mut Context<Self>) {}

  fn general(&mut self, theme: &Theme, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
    let prefs = self.ws.read(cx).prefs.clone();
    let ws = self.ws.downgrade();
    let themes = segmented("theme", THEMES, prefs.theme, theme, move |t, _, cx| {
      let _ = ws.update(cx, |ws, cx| ws.set_theme(t, cx));
    })
    .w(px(240.0));

    // The desk's swatches, then a custom color as hex.
    let mut swatches = div().flex().items_center().gap(px(6.0));
    let preset = DESK_COLORS.iter().any(|c| c.1 == prefs.desk_color);
    for (i, &(name, color)) in DESK_COLORS.iter().enumerate() {
      let on = color == prefs.desk_color;
      let ws = self.ws.downgrade();
      swatches = swatches.child(
        div()
          .id(("swatch", i))
          .size(px(22.0))
          .rounded_full()
          .bg(rgb(color))
          .border_1()
          .border_color(theme.border_strong)
          .when(on, |d| d.border_2().border_color(theme.accent))
          .tooltip({
            let theme = *theme;
            move |_, cx| cx.new(|_| Tip(name, theme)).into()
          })
          .on_click(move |_, _, cx| {
            let _ = ws.update(cx, |ws, cx| ws.set_desk_color(color, cx));
          }),
      );
    }
    // Follow the color while it isn't being typed in.
    let hex = hex_color(prefs.desk_color);
    let focused = self.custom_desk.read(cx).focus_handle(cx).is_focused(window);
    if !focused && self.custom_desk.read(cx).value().as_ref() != hex {
      self.custom_desk.update(cx, |s, cx| s.set_value(hex, window, cx));
    }
    swatches = swatches.child(
      div()
        .flex()
        .items_center()
        .gap(px(6.0))
        .ml(px(6.0))
        .child(
          div()
            .size(px(22.0))
            .rounded_full()
            .bg(rgb(prefs.desk_color))
            .border_1()
            .border_color(theme.border_strong)
            .when(!preset, |d| d.border_2().border_color(theme.accent)),
        )
        .child(div().w(px(84.0)).child(Input::new(&self.custom_desk))),
    );

    let ws = self.ws.downgrade();
    let status = check("status-bar", "Show the status bar", prefs.status_bar, theme).on_click(move |_, _, cx| {
      let _ = ws.update(cx, |ws, cx| ws.set_status_bar(!ws.prefs.status_bar, cx));
    });
    let ws = self.ws.downgrade();
    let badges =
      check("badges", "Show shortcuts while ⌘ is held", prefs.shortcut_badges, theme).on_click(move |_, _, cx| {
        let _ = ws.update(cx, |ws, cx| ws.set_shortcut_badges(!ws.prefs.shortcut_badges, cx));
      });

    vec![
      setting("Theme", theme, div().child(themes)),
      setting(
        "Desk color",
        theme,
        div().flex().flex_col().gap(px(6.0)).child(swatches).child(help(
          "A hex color, like #787878. Also in the desk’s right-click menu.",
          theme,
        )),
      ),
      setting(
        "Status bar",
        theme,
        div().flex().flex_col().gap(px(6.0)).child(status).child(help(
          "Along the window’s foot: hints, what’s selected, progress, and zoom.",
          theme,
        )),
      ),
      setting("Shortcuts", theme, div().child(badges)),
    ]
  }

  fn advanced(&mut self, theme: &Theme, cx: &mut Context<Self>) -> Vec<AnyElement> {
    let valid = self.count(cx).is_some();
    let working = self.ws.read(cx).is_importing();
    let this = cx.entity().downgrade();
    let mut button = text_button("add-test-images", "Add test images", theme, false, move |_, _, cx| {
      let _ = this.update(cx, |s, cx| s.add_test_images(cx));
    });
    if !valid || working {
      button = button.opacity(0.5);
    }
    let note = if valid {
      "Gradients in film colors, 3000 × 2000 px or so, added to the desk like any photos.".to_string()
    } else {
      format!("Choose from 1 to {MAX_TEST_IMAGES}.")
    };
    vec![setting(
      "Test images",
      theme,
      div()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
          div()
            .flex()
            .items_center()
            .gap(px(6.0))
            .child(div().w(px(64.0)).child(Input::new(&self.test_count)))
            .child(button),
        )
        .child(help(note, theme).when(!valid, |d| d.text_color(theme.warn))),
    )]
  }
}

/// A setting: its title on the left, its controls on the right.
fn setting(title: &'static str, theme: &Theme, controls: impl IntoElement) -> AnyElement {
  div()
    .flex()
    .items_start()
    .gap(px(16.0))
    .py(px(12.0))
    .border_b_1()
    .border_color(theme.divider)
    .child(
      div()
        .w(px(96.0))
        .flex_none()
        .pt(px(3.0))
        .text_color(theme.muted)
        .child(title),
    )
    .child(div().flex_1().min_w_0().child(controls))
    .into_any_element()
}

/// A swatch's name, as a tooltip.
struct Tip(&'static str, Theme);

impl Render for Tip {
  fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
    let theme = &self.1;
    div()
      .px(px(6.0))
      .py(px(2.0))
      .rounded(px(3.0))
      .bg(theme.control)
      .border_1()
      .border_color(theme.border)
      .text_size(px(11.0))
      .text_color(theme.text)
      .font_family(FONT)
      .child(self.0)
  }
}

impl Render for SettingsWindow {
  fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
    let theme = Theme::for_appearance(window.appearance(), self.ws.read(cx).prefs.theme);
    let this = cx.entity().downgrade();
    let tabs = segmented("settings-tab", TABS, self.tab, &theme, move |t, _, cx| {
      let _ = this.update(cx, |s, cx| {
        s.tab = t;
        cx.notify();
      });
    })
    .w(px(220.0));
    let rows = match self.tab {
      Tab::General => self.general(&theme, window, cx),
      Tab::Advanced => self.advanced(&theme, cx),
    };
    div()
      .size_full()
      .flex()
      .flex_col()
      .bg(theme.panel)
      .text_color(theme.text)
      .font_family(FONT)
      .text_size(px(12.0))
      // The title bar's room, with the tabs centered under the title.
      .child(div().h(px(28.0)).flex_none())
      .child(div().flex().justify_center().pb(px(8.0)).child(tabs))
      .child(
        div()
          .id("settings-body")
          .flex_1()
          .min_h_0()
          .overflow_y_scroll()
          .px(px(20.0))
          .pb(px(16.0))
          .border_t_1()
          .border_color(theme.divider)
          .children(rows),
      )
  }
}
