//! The Settings window (`SettingsDialog.tsx`'s `SettingsWindow`): the app's own preferences,
//! in a window of their own. It edits the workspace's prefs, so the main window follows as
//! they change.

use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::test_images::MAX_TEST_IMAGES;

use super::controls::{check, help, segmented};
use super::text_button;
use crate::assets::FONT;
use crate::fields::parse_number;
use crate::theme::{DESK_COLORS, Theme, ThemePref};
use crate::workspace::Workspace;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tab {
  General,
  Instagram,
  Advanced,
}

const TABS: &[(Tab, &str)] = &[
  (Tab::General, "General"),
  (Tab::Instagram, "Instagram"),
  (Tab::Advanced, "Advanced"),
];

/// Which server posts to Instagram.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Server {
  Default,
  Dev,
  Local,
}

const SERVERS: &[(Server, &str)] = &[
  (Server::Default, "Sequence"),
  (Server::Dev, "Development"),
  (Server::Local, "Local"),
];
const LOCAL_DEFAULT: &str = "http://localhost:8787";
const THEMES: &[(ThemePref, &str)] = &[
  (ThemePref::System, "System"),
  (ThemePref::Light, "Light"),
  (ThemePref::Dark, "Dark"),
];

/// The Settings window's view.
pub struct SettingsWindow {
  ws: Entity<Workspace>,
  tab: Tab,
  /// How many test images to add.
  test_count: Entity<InputState>,
  /// A server on this computer, as typed.
  local_server: Entity<InputState>,
}

impl SettingsWindow {
  pub fn new(ws: Entity<Workspace>, window: &mut Window, cx: &mut Context<Self>) -> Self {
    // The main window's changes (a desk color picked from its menu) show here too.
    cx.observe(&ws, |_, _, cx| cx.notify()).detach();
    cx.observe_window_appearance(window, |_, _, cx| cx.notify()).detach();

    let test_count = cx.new(|cx| InputState::new(window, cx).default_value("6"));
    cx.subscribe_in(&test_count, window, |this, _, ev: &InputEvent, _, cx| match ev {
      InputEvent::PressEnter { .. } => this.add_test_images(cx),
      InputEvent::Change => cx.notify(),
      _ => {}
    })
    .detach();

    let chosen = ws.read(cx).prefs.server_url.clone();
    let local = if server_choice(&chosen) == Server::Local && !chosen.is_empty() {
      chosen
    } else {
      LOCAL_DEFAULT.to_string()
    };
    let local_server = cx.new(|cx| InputState::new(window, cx).default_value(local));
    cx.subscribe_in(&local_server, window, |this, state, ev: &InputEvent, _, cx| match ev {
      InputEvent::PressEnter { .. } => {
        if let Some(url) = crate::instagram::normalize_server(&state.read(cx).value()) {
          this.ws.update(cx, |ws, cx| ws.set_server_url(url, cx));
        }
      }
      InputEvent::Change => cx.notify(),
      _ => {}
    })
    .detach();

    Self {
      ws,
      tab: Tab::General,
      test_count,
      local_server,
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

  fn general(&mut self, theme: &Theme, _window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
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
    // Any other color: the system's color panel (with its eyedropper), shown filled with
    // the color when it's one of those.
    let ws = self.ws.downgrade();
    let c = prefs.desk_color;
    let start = [(c >> 16) as u8, (c >> 8) as u8, c as u8];
    swatches = swatches.child(
      div()
        .id("desk-custom")
        .size(px(22.0))
        .rounded_full()
        .flex()
        .items_center()
        .justify_center()
        .border_1()
        .border_color(theme.border_strong)
        .map(|d| {
          if preset {
            d.bg(theme.control).child(
              svg()
                .path(crate::assets::icon("pipette"))
                .size(px(12.0))
                .text_color(theme.muted),
            )
          } else {
            d.bg(rgb(c)).border_2().border_color(theme.accent)
          }
        })
        .on_click(move |_, _, cx| {
          let ws = ws.clone();
          crate::colorpanel::pick(start, cx, move |[r, g, b], cx| {
            let c = (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b);
            let _ = ws.update(cx, |ws, cx| ws.set_desk_color(c, cx));
          });
        }),
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
          "Or any color, from the eyedropper. Also in the desk’s right-click menu.",
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

  fn instagram(&mut self, theme: &Theme, cx: &mut Context<Self>) -> Vec<AnyElement> {
    let ws = self.ws.read(cx);
    let connection = ws.ig.connection.clone();
    let message = ws.ig.message.clone();
    let now = crate::instagram::now_s();
    let expired = connection
      .as_ref()
      .is_some_and(|c| c.needs_reconnect || c.expires_at <= now);
    let mut col = div().flex().flex_col().gap(px(6.0));
    match &connection {
      Some(c) if !expired => {
        let w = self.ws.downgrade();
        col = col
          .child(
            div()
              .flex()
              .items_center()
              .gap(px(8.0))
              .child(format!("Connected as @{}", c.username))
              .child(text_button("ig-disconnect", "Disconnect", theme, false, move |_, _, cx| {
                let _ = w.update(cx, |ws, cx| ws.disconnect_instagram(cx));
              })),
          )
          .child(help(
            "Disconnecting forgets the account here. To remove Sequence’s access entirely, remove it in Instagram’s settings (Website permissions → Apps and websites).",
            theme,
          ));
      }
      _ => {
        let w = self.ws.downgrade();
        col = col.child(div().child(text_button(
          "ig-connect",
          if expired {
            "Reconnect Instagram"
          } else {
            "Connect Instagram"
          },
          theme,
          false,
          move |_, _, cx| {
            let _ = w.update(cx, |ws, cx| ws.connect_instagram(false, cx));
          },
        )));
        col = col.child(match (&message, &connection) {
          (Some((text, warn)), _) => help(text.clone(), theme).when(*warn, |d| d.text_color(theme.warn)),
          (None, Some(c)) if c.needs_reconnect => {
            help(format!("Instagram needs you to connect @{} again.", c.username), theme)
          }
          (None, Some(c)) => help(
            format!(
              "The connection to @{} expired. Connect again to keep posting.",
              c.username
            ),
            theme,
          ),
          (None, None) => help(
            "Post frames to Instagram from Export. Needs a Business or Creator account.",
            theme,
          ),
        });
      }
    }
    vec![setting("Instagram", theme, col)]
  }

  fn server(&mut self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let chosen = self.ws.read(cx).prefs.server_url.clone();
    let choice = server_choice(&chosen);
    let typed = self.local_server.read(cx).value().to_string();
    let local = crate::instagram::normalize_server(&typed);
    let ws = self.ws.downgrade();
    let local_for_pick = local.clone();
    let picker = segmented("server", SERVERS, choice, theme, move |c, _, cx| {
      let url = match c {
        Server::Default => String::new(),
        Server::Dev => crate::config::dev_server_url().to_string(),
        Server::Local => local_for_pick.clone().unwrap_or_else(|| LOCAL_DEFAULT.to_string()),
      };
      let _ = ws.update(cx, |ws, cx| ws.set_server_url(url, cx));
    })
    .w(px(300.0));
    let mut col = div().flex().flex_col().gap(px(6.0)).child(picker);
    if choice == Server::Local {
      let ws = self.ws.downgrade();
      let save_to = local.clone();
      let mut save = text_button("server-save", "Save", theme, false, move |_, _, cx| {
        if let Some(url) = save_to.clone() {
          let _ = ws.update(cx, |ws, cx| ws.set_server_url(url, cx));
        }
      });
      if local.is_none() || local.as_deref() == Some(chosen.as_str()) {
        save = save.opacity(0.5);
      }
      col = col.child(
        div()
          .flex()
          .items_center()
          .gap(px(6.0))
          .child(div().w(px(200.0)).child(Input::new(&self.local_server)))
          .child(save),
      );
      if local.is_none() {
        col = col.child(help("Use an http://localhost address.", theme).text_color(theme.warn));
      }
    } else {
      col = col.child(help(
        if choice == Server::Dev {
          crate::config::dev_server_url()
        } else {
          crate::config::server_url()
        },
        theme,
      ));
    }
    col = col.child(help(
      "Posts to Instagram go through this server. Change it only for development; it applies the next time you connect Instagram.",
      theme,
    ));
    setting("Server", theme, col)
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
    let server = self.server(theme, cx);
    vec![
      server,
      setting(
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
      ),
    ]
  }
}

/// Which server a stored choice is ("" is Sequence's).
fn server_choice(url: &str) -> Server {
  if url.is_empty() || url == crate::config::server_url() {
    Server::Default
  } else if url == crate::config::dev_server_url() {
    Server::Dev
  } else {
    Server::Local
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
    .w(px(300.0));
    let rows = match self.tab {
      Tab::General => self.general(&theme, window, cx),
      Tab::Instagram => self.instagram(&theme, cx),
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
