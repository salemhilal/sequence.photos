//! What the window draws: the toolbar (also the title bar), the page under it, the status
//! bar, and what floats over them. Each region also records where it drew things
//! (`Frames`) for the pointer's gestures.

pub mod crop;
pub mod desk;
pub mod editor;
pub mod layout;
pub mod paint;
pub mod preview;
pub mod sidebar;

use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::geometry::Rect;
use sequence_core::units::terms;

use crate::assets::{FONT, MONO, icon};
use crate::commands::*;
use crate::theme::Theme;
use crate::workspace::{ContextMenu, Page, Workspace};
use paint::{boxed, x};

pub const TOOLBAR_H: f64 = 42.0;
pub const STATUS_H: f64 = 24.0;
/// Where the toolbar's content starts, after the traffic lights.
const LIGHTS_W: f64 = 94.0;

/// A toolbar or status bar button with an icon.
pub fn icon_button(
  id: impl Into<ElementId>,
  name: &str,
  theme: &Theme,
  enabled: bool,
  on: bool,
  click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
  let color = if enabled { theme.text } else { theme.muted.opacity(0.5) };
  let mut b = div()
    .id(id)
    .flex()
    .items_center()
    .justify_center()
    .w(px(28.0))
    .h(px(26.0))
    .rounded(px(3.0))
    .child(svg().path(icon(name)).size(px(16.0)).text_color(color));
  if on {
    b = b.bg(theme.track);
  }
  if enabled {
    b = b.hover(|s| s.bg(theme.hover)).on_click(click);
  }
  b
}

/// A text button, plain or primary.
pub fn text_button(
  id: impl Into<ElementId>,
  label: impl Into<SharedString>,
  theme: &Theme,
  primary: bool,
  click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
  let b = div()
    .id(id)
    .flex()
    .items_center()
    .h(px(24.0))
    .px(px(10.0))
    .rounded(px(3.0))
    .text_size(px(12.0))
    .child(label.into());
  let b = if primary {
    b.bg(theme.accent).text_color(theme.on_accent)
  } else {
    b.bg(theme.control)
      .text_color(theme.text)
      .border_1()
      .border_color(theme.border_strong)
  };
  b.on_click(click)
}

impl Render for Workspace {
  fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
    let theme = self.theme(window);
    let size = window.viewport_size();
    let (w, h) = (f64::from(size.width), f64::from(size.height));
    let presenting = self.ui.presenting && self.ui.page == Page::Preview;
    let toolbar_h = if presenting { 0.0 } else { TOOLBAR_H };
    let status_h = if presenting || !self.prefs.status_bar {
      0.0
    } else {
      STATUS_H
    };
    self.frames.window = Rect::new(0.0, 0.0, w, h);
    self.frames.main = Rect::new(0.0, toolbar_h, w, (h - toolbar_h - status_h).max(0.0));
    self.frames.editor = None;
    self.frames.sidebar = None;
    self.frames.cells.clear();
    self.frames.gaps.clear();
    self.frames.crop_zone = None;

    let main = match self.ui.page {
      Page::Desk => self.render_desk_page(&theme, cx),
      Page::Preview => self.render_preview(&theme, cx),
      Page::Export => self.render_export(&theme, cx),
    };

    let this = cx.entity().downgrade();
    let tracker = canvas(
      |_, _, _| {},
      move |_, _, window, _| {
        let t = this.clone();
        window.on_mouse_event(move |ev: &MouseMoveEvent, phase, _, cx| {
          if phase == DispatchPhase::Bubble {
            let _ = t.update(cx, |ws, cx| ws.pointer_move(ev, cx));
          }
        });
        // A press anywhere but the photo being cropped or its bar keeps the crop (and goes
        // on to what was pressed).
        let t = this.clone();
        window.on_mouse_event(move |ev: &MouseDownEvent, phase, _, cx| {
          if phase == DispatchPhase::Capture {
            let _ = t.update(cx, |ws, cx| ws.crop_press(ev, cx));
          }
        });
        let t = this.clone();
        window.on_mouse_event(move |ev: &MouseUpEvent, phase, _, cx| {
          if phase == DispatchPhase::Bubble {
            let _ = t.update(cx, |ws, cx| ws.pointer_up(ev, cx));
          }
        });
      },
    )
    .absolute()
    .size_full();

    let mut root = div()
      .id("workspace")
      .key_context("Workspace")
      .track_focus(&self.focus)
      .relative()
      .size_full()
      .flex()
      .flex_col()
      .bg(theme.bg)
      .text_color(theme.text)
      .font_family(FONT)
      .text_size(px(12.0))
      .on_modifiers_changed(cx.listener(|ws, ev: &ModifiersChangedEvent, _, cx| {
        ws.ui.cmd_held = ev.modifiers.platform;
        cx.notify();
      }));
    root = if self.ui.cropping.is_some() {
      self.bind_crop_commands(root, cx)
    } else if self.ui.layout.is_some() && self.ui.page == Page::Desk {
      self.bind_layout_commands(root, cx)
    } else {
      self.bind_commands(root, cx)
    };
    if !presenting {
      root = root.child(self.render_toolbar(&theme, window, cx));
    }
    root = root.child(
      div()
        .relative()
        .w_full()
        .h(x(self.frames.main.h))
        .overflow_hidden()
        .child(main),
    );
    if status_h > 0.0 {
      root = root.child(self.render_status(&theme, cx));
    }
    if self.ui.page == Page::Desk
      && let Some(layout) = self.render_layout(&theme, window, cx)
    {
      root = root.child(
        div()
          .absolute()
          .left_0()
          .top(x(self.frames.main.y))
          .w_full()
          .h(x(self.frames.main.h))
          .child(layout),
      );
    } else {
      self.frames.layout = None;
    }
    if let Some(overlay) = self.render_crop(&theme, cx) {
      root = root.child(overlay);
    }
    root = root.child(tracker);
    if let Some(g) = &self.ui.ghost
      && let Some(meta) = self.project().photos.get(&g.photo).cloned()
    {
      let r = Rect::new(g.x - g.w / 2.0, g.y - g.h / 2.0, g.w, g.h);
      let mut ghost = boxed(r).opacity(0.85).shadow_lg();
      if let Some(t) = self.lib.thumb(&meta.id) {
        ghost = ghost.child(img(t).size_full().object_fit(ObjectFit::Cover));
      }
      if g.count > 1 {
        ghost = ghost.child(
          div()
            .absolute()
            .top(px(-8.0))
            .right(px(-8.0))
            .px(px(6.0))
            .rounded(px(9.0))
            .bg(theme.accent)
            .text_color(theme.on_accent)
            .font_family(MONO)
            .text_size(px(11.0))
            .child(g.count.to_string()),
        );
      }
      root = root.child(ghost);
    }
    if let Some(n) = self.ui.notice.clone() {
      root = root.child(
        div()
          .absolute()
          .bottom(x(status_h + 16.0))
          .left_0()
          .right_0()
          .flex()
          .justify_center()
          .child(
            div()
              .id("notice")
              .flex()
              .items_center()
              .gap(px(8.0))
              .max_w(px(560.0))
              .px(px(12.0))
              .py(px(8.0))
              .rounded(px(5.0))
              .bg(theme.panel)
              .border_1()
              .border_color(theme.border_strong)
              .shadow_md()
              .child(n)
              .child(icon_button("dismiss-notice", "x", &theme, true, false, {
                let t = cx.entity().downgrade();
                move |_, _, cx| {
                  let _ = t.update(cx, |ws, cx| {
                    ws.ui.notice = None;
                    cx.notify();
                  });
                }
              })),
          ),
      );
    }
    if let Some(menu) = self.ui.context_menu.clone() {
      root = root.child(self.render_context_menu(menu, &theme, cx));
    }
    if self.ui.quick_look.is_some() {
      root = root.child(self.render_quick_look(&theme, cx));
    }
    root
  }
}

impl Workspace {
  fn render_toolbar(&mut self, theme: &Theme, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
    let terms = terms(self.project().layout.arrangement());
    let name = self
      .doc
      .path
      .as_ref()
      .and_then(|p| p.file_stem())
      .map(|s| s.to_string_lossy().into_owned())
      .unwrap_or_else(|| "Untitled".into());
    let edited = self.edited();
    window.set_window_title(&name);
    window.set_window_edited(edited);
    let page = self.ui.page;
    let tab = |id: &'static str, label: &'static str, which: Page, theme: &Theme, cx: &mut Context<Self>| {
      let on = page == which;
      let mut t = div()
        .id(id)
        .flex()
        .items_center()
        .h(px(22.0))
        .px(px(12.0))
        .rounded(px(3.0))
        .text_color(if on { theme.text } else { theme.muted })
        .child(label)
        .on_click(cx.listener(move |ws, _, _, cx| ws.go_to(which, cx)));
      if on {
        t = t.bg(theme.control).shadow_xs();
      } else {
        t = t.hover(|s| s.text_color(theme.text));
      }
      t
    };
    let sidebar_open = self.prefs.sidebar_open;
    div()
      .id("toolbar")
      .relative()
      .flex()
      .flex_none()
      .items_center()
      .gap(px(6.0))
      .h(x(TOOLBAR_H))
      .pl(x(LIGHTS_W))
      .pr(px(12.0))
      .bg(theme.bg)
      .border_b_1()
      .border_color(theme.divider)
      .window_control_area(WindowControlArea::Drag)
      .on_click(|ev, window, _| {
        if ev.click_count() == 2 {
          window.titlebar_double_click();
        }
      })
      .child(
        div()
          .flex()
          .max_w(relative(0.28))
          .overflow_hidden()
          .whitespace_nowrap()
          .font_weight(FontWeight::MEDIUM)
          .child(name)
          .when(edited, |d| {
            d.child(
              div()
                .text_color(theme.muted)
                .font_weight(FontWeight::NORMAL)
                .child("\u{a0}— Edited"),
            )
          }),
      )
      .child(
        div()
          .absolute()
          .left_0()
          .right_0()
          .top_0()
          .bottom_0()
          .flex()
          .justify_center()
          .items_center()
          .child(
            div()
              .flex()
              .gap(px(2.0))
              .p(px(2.0))
              .rounded(px(4.0))
              .bg(theme.track)
              .child(tab("page-desk", "Desk", Page::Desk, theme, cx))
              .child(tab("page-preview", "Preview", Page::Preview, theme, cx))
              .child(tab("page-export", "Export", Page::Export, theme, cx)),
          ),
      )
      .child(div().flex_1())
      .when(page == Page::Desk, |d| {
        d.child(icon_button(
          "toggle-sidebar",
          if sidebar_open {
            "panel-right-close"
          } else {
            "panel-right-open"
          },
          theme,
          true,
          !sidebar_open,
          cx.listener(|ws, _, _, cx| ws.toggle_sidebar(cx)),
        ))
      })
      .child(icon_button(
        "layout",
        "ruler",
        theme,
        true,
        false,
        cx.listener(|ws, _, _, cx| ws.open_layout(cx)),
      ))
      .child(icon_button(
        "settings",
        "settings",
        theme,
        true,
        false,
        cx.listener(|ws, _, _, cx| ws.cycle_theme(cx)),
      ))
      .child(div().hidden().child(terms.spreads))
  }

  fn render_status(&mut self, theme: &Theme, cx: &mut Context<Self>) -> impl IntoElement {
    let text = self
      .ui
      .busy
      .clone()
      .or_else(|| self.crop_hint())
      .or_else(|| self.ui.hint.clone())
      .unwrap_or_else(|| self.status_text());
    let on_desk = self.ui.page == Page::Desk && self.ui.editing.is_none();
    let zoom = format!("{}%", (self.ui.view.zoom * 100.0).round());
    div()
      .flex()
      .flex_none()
      .items_center()
      .gap(px(14.0))
      .h(x(STATUS_H))
      .pl(px(10.0))
      .pr(px(4.0))
      .border_t_1()
      .border_color(theme.divider)
      .bg(theme.bg)
      .text_color(theme.muted)
      .font_family(MONO)
      .text_size(px(11.0))
      .child(div().flex_1().overflow_hidden().whitespace_nowrap().child(text))
      .when(on_desk, |d| {
        d.child(
          div()
            .flex()
            .items_center()
            .child(icon_button(
              "zoom-out",
              "minus",
              theme,
              true,
              false,
              cx.listener(|ws, _, _, cx| {
                ws.zoom_desk(1.0 / 1.25);
                cx.notify();
              }),
            ))
            .child(
              div()
                .id("zoom-fit")
                .px(px(6.0))
                .child(zoom)
                .on_click(cx.listener(|ws, _, _, cx| {
                  ws.fit_desk();
                  cx.notify();
                })),
            )
            .child(icon_button(
              "zoom-in",
              "plus",
              theme,
              true,
              false,
              cx.listener(|ws, _, _, cx| {
                ws.zoom_desk(1.25);
                cx.notify();
              }),
            )),
        )
      })
  }

  /// What the status bar says (`statusText`).
  fn status_text(&self) -> String {
    let project = self.project();
    let terms = terms(project.layout.arrangement());
    if self.ui.page == Page::Preview {
      return String::new();
    }
    if self.ui.editing.is_some() {
      return "Shift: free resize · Option: no snapping, or drag a copy · Arrows nudge".into();
    }
    let n = self.ui.selection.len();
    if n > 0 {
      return format!("{n} {} selected", if n == 1 { "photo" } else { "photos" });
    }
    let s = self.ui.spread_selection.len();
    if s > 0 {
      return format!("{s} {} selected", if s == 1 { terms.spread } else { terms.spreads });
    }
    let placed: std::collections::HashSet<_> = project
      .layout
      .all()
      .iter()
      .flat_map(|sp| sp.items.iter().map(|i| i.photo_id.clone()))
      .collect();
    format!("{} on desk, {} placed", project.pile.len(), placed.len())
  }

  fn render_context_menu(&mut self, menu: ContextMenu, theme: &Theme, cx: &mut Context<Self>) -> impl IntoElement {
    let (mx, my, items): (f64, f64, Vec<(&'static str, MenuAction)>) = match &menu {
      ContextMenu::Desk { x, y } => (
        *x,
        *y,
        vec![
          ("Add photos…", MenuAction::AddPhotos),
          ("Tidy up", MenuAction::Tidy),
          ("Zoom to fit", MenuAction::Fit),
          ("Select all", MenuAction::SelectAll),
          ("Desk color", MenuAction::DeskColor),
        ],
      ),
      ContextMenu::Photo { x, y, .. } => (
        *x,
        *y,
        vec![
          ("Quick Look", MenuAction::QuickLook),
          ("Duplicate", MenuAction::Duplicate),
          ("Put on the desk", MenuAction::ToDesk),
          ("Delete", MenuAction::Delete),
        ],
      ),
    };
    let mut list = div()
      .absolute()
      .left(x(mx))
      .top(x(my))
      .min_w(px(180.0))
      .py(px(4.0))
      .rounded(px(5.0))
      .bg(theme.panel)
      .border_1()
      .border_color(theme.border_strong)
      .shadow_lg();
    for (i, (label, action)) in items.into_iter().enumerate() {
      let menu = menu.clone();
      list = list.child(
        div()
          .id(("menu-item", i))
          .px(px(12.0))
          .py(px(4.0))
          .hover(|s| s.bg(theme.accent).text_color(theme.on_accent))
          .child(label)
          .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
          .on_click(cx.listener(move |ws, _, _, cx| ws.run_menu(&menu, action, cx))),
      );
    }
    div()
      .id("menu-backdrop")
      .absolute()
      .size_full()
      .on_mouse_down(
        MouseButton::Left,
        cx.listener(|ws, _, _, cx| {
          ws.ui.context_menu = None;
          cx.notify();
        }),
      )
      .child(list)
  }

  fn render_quick_look(&mut self, theme: &Theme, cx: &mut Context<Self>) -> impl IntoElement {
    let Some((ids, i)) = self.ui.quick_look.clone() else {
      return div();
    };
    let id = ids.get(i).cloned();
    let name = id
      .as_ref()
      .and_then(|id| self.project().photos.get(id))
      .map(|m| m.name.clone())
      .unwrap_or_default();
    let thumb = id.as_ref().and_then(|id| self.lib.thumb(id));
    let count = if ids.len() > 1 {
      format!("{} of {}", i + 1, ids.len())
    } else {
      String::new()
    };
    div()
      .absolute()
      .size_full()
      .flex()
      .flex_col()
      .bg(rgba(0x000000e6))
      .text_color(rgb(0xe6e6e6))
      .child(
        div()
          .flex()
          .items_center()
          .gap(px(12.0))
          .h(x(TOOLBAR_H))
          .pl(x(LIGHTS_W))
          .pr(px(12.0))
          .child(name)
          .child(div().text_color(theme.muted).child(count))
          .child(div().flex_1())
          .child(icon_button(
            "close-quick-look",
            "x",
            &Theme::dark(),
            true,
            false,
            cx.listener(|ws, _, _, cx| {
              ws.ui.quick_look = None;
              cx.notify();
            }),
          )),
      )
      .child(
        div()
          .flex_1()
          .p(px(24.0))
          .when_some(thumb, |d, t| d.child(img(t).size_full().object_fit(ObjectFit::Contain))),
      )
  }
}
