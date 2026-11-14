//! What the window draws: the toolbar (also the title bar), the page under it, the status
//! bar, and what floats over them. Each region also records where it drew things
//! (`Frames`) for the pointer's gestures.

pub mod about;
pub mod controls;
pub mod crop;
pub mod desk;
pub mod editor;
pub mod export;
pub mod instagram;
pub mod layout;
pub mod paint;
pub mod preview;
pub mod settings;
pub mod sidebar;

use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::geometry::Rect;
use sequence_core::units::terms;

use crate::assets::{FONT, MONO, icon};
use crate::commands::*;
use crate::theme::Theme;
use crate::workspace::{ContextMenu, Page, Workspace};
use paint::Tip as _;
use paint::{boxed, x};

pub const TOOLBAR_H: f64 = 42.0;
pub const STATUS_H: f64 = 24.0;
/// Where the toolbar's content starts, after the traffic lights.
const LIGHTS_W: f64 = 94.0;
/// Each of the toolbar's page tabs, all one width so the highlight slides between them.
const PAGE_TAB_W: f64 = 72.0;

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

/// A raised control's edge (`--raise`): a hairline and a soft drop in light; in dark, a
/// faint light top edge.
fn raised(b: Stateful<Div>, theme: &Theme) -> Stateful<Div> {
  if theme.is_dark() {
    b.shadow(vec![BoxShadow {
      color: hsla(0.0, 0.0, 1.0, 0.05),
      offset: point(px(0.0), px(1.0)),
      blur_radius: px(0.0),
      spread_radius: px(0.0),
      inset: true,
    }])
  } else {
    b.shadow(vec![
      BoxShadow {
        color: hsla(0.0, 0.0, 0.0, 0.18),
        offset: point(px(0.0), px(0.0)),
        blur_radius: px(0.0),
        spread_radius: px(0.5),
        inset: false,
      },
      BoxShadow {
        color: hsla(0.0, 0.0, 0.0, 0.06),
        offset: point(px(0.0), px(1.0)),
        blur_radius: px(1.0),
        spread_radius: px(0.0),
        inset: false,
      },
    ])
  }
}

/// A text button, plain or primary (`.btn`): raised, and darkening while pressed.
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
    .justify_center()
    .gap(px(6.0))
    .h(px(24.0))
    .px(px(10.0))
    .rounded(px(3.0))
    .text_size(px(12.0))
    .whitespace_nowrap()
    .cursor_pointer()
    .child(label.into());
  let pressed = theme.border_strong;
  let b = if primary {
    raised(b, theme)
      .bg(theme.accent)
      .text_color(theme.on_accent)
      .font_weight(FontWeight::MEDIUM)
      .active(|s| s.opacity(0.85))
  } else {
    raised(b, theme)
      .bg(theme.control)
      .text_color(theme.text)
      .active(move |s| s.bg(pressed))
  };
  b.on_click(click)
}

/// A context menu item's icon, as the web's menus have them.
fn menu_icon(a: MenuAction) -> Option<&'static str> {
  Some(match a {
    MenuAction::Tidy => "layout-grid",
    MenuAction::QuickLook => "eye",
    MenuAction::Copy => "copy",
    MenuAction::Duplicate => "copy-plus",
    MenuAction::ToDesk => "undo-2",
    MenuAction::Crop => "crop",
    MenuAction::Delete => "trash-2",
    _ => return None,
  })
}

impl Render for Workspace {
  fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
    // Photos let go since the last frame: their textures go too (GPUI keeps them until told).
    for picture in self.lib.begin_frame(f64::from(window.scale_factor())) {
      cx.drop_image(picture, Some(window));
    }
    let el = self.render_window(window, cx);
    self.start_decodes(cx);
    el
  }
}

impl Workspace {
  /// The window's contents, asking the library for each photo at the size it's drawn.
  fn render_window(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
    // The menu bar's wording follows the sidebar, the guides, and the arrangement.
    let menu = crate::commands::MenuState {
      sidebar_open: self.prefs.sidebar_open,
      guides_shown: !self.ui.guides_hidden,
      arrangement: self.project().layout.arrangement(),
      fullscreen: window.is_fullscreen(),
    };
    if self.menu_state != Some(menu) {
      self.menu_state = Some(menu);
      cx.set_menus(crate::commands::menus(menu));
    }
    let theme = self.theme(window);
    // Text fields and the like follow the app's light or dark.
    if self.component_theme != Some(theme.is_dark()) {
      self.component_theme = Some(theme.is_dark());
      cx.defer(move |cx| theme.apply_to_components(cx));
    }
    if self.outdated {
      return div()
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(10.0))
        .bg(theme.bg)
        .text_color(theme.text)
        .font_family(FONT)
        .child(
          div()
            .text_size(px(18.0))
            .font_weight(FontWeight::SEMIBOLD)
            .child("This project was saved by a newer version of Sequence."),
        )
        .child(
          div()
            .text_color(theme.muted)
            .child("Update Sequence from the App Store to open it. Your saved project hasn’t been changed."),
        )
        .into_any_element();
    }
    // Fullscreen left another way (the green button, the menu): presenting ends too; and
    // presenting ended by leaving Preview leaves fullscreen.
    let full = window.is_fullscreen();
    if self.ui.presenting {
      if full {
        self.ui.presented_full = true;
      } else if self.ui.presented_full {
        self.ui.presenting = false;
        self.ui.presented_full = false;
      }
    } else if self.ui.presented_full {
      self.ui.presented_full = false;
      if full {
        window.toggle_fullscreen();
      }
    }
    self.ui.scale_factor = f64::from(window.scale_factor());
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
      Page::Desk => self.render_desk_page(&theme, window, cx),
      Page::Preview => self.render_preview(&theme, cx),
      Page::Export => self.render_export(&theme, window, cx),
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
      // A press anywhere gives the workspace the keyboard back (a text field pressed takes it after).
      .capture_any_mouse_down(cx.listener(|ws, _, window, cx| window.focus(&ws.focus, cx)))
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
        ws.modifiers_changed(ev.modifiers, cx);
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
      // Covering the ghost, the whole photo is drawn at least as large as it on both sides.
      let k = (g.w / meta.px_w.max(1.0)).max(g.h / meta.px_h.max(1.0));
      if let Some(t) = self.lib.picture(&meta, meta.px_w * k, meta.px_h * k) {
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
    // Notices go after a few seconds.
    if self.ui.notice != self.ui.notice_timed {
      self.ui.notice_timed = self.ui.notice.clone();
      if let Some(n) = self.ui.notice.clone() {
        cx.spawn(async move |this, cx| {
          cx.background_executor().timer(std::time::Duration::from_secs(6)).await;
          let _ = this.update(cx, |ws, cx| {
            if ws.ui.notice.as_ref() == Some(&n) {
              ws.ui.notice = None;
              cx.notify();
            }
          });
        })
        .detach();
      }
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
    if self.ui.save_failed {
      root = root.child(
        div()
          .absolute()
          .top(x(TOOLBAR_H + 8.0))
          .left_0()
          .right_0()
          .flex()
          .justify_center()
          .child(
            div()
              .flex()
              .items_center()
              .gap(px(10.0))
              .px(px(12.0))
              .py(px(6.0))
              .rounded(px(6.0))
              .bg(theme.panel)
              .border_1()
              .border_color(theme.danger)
              .shadow_md()
              .child("Couldn’t keep a copy of your work in the app’s storage.")
              .child(text_button(
                "save-to-file",
                "Save to a file",
                &theme,
                true,
                cx.listener(|ws, _, window, cx| ws.save(false, window, cx)),
              )),
          ),
      );
    }
    if let Some(tour) = self.render_tour(&theme, cx) {
      root = root.child(tour);
    }
    root.into_any_element()
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
    // Mid-tour, the sample project isn't the user's.
    let name = if self.touring() { "Sequence".to_string() } else { name };
    let edited = self.edited() && !self.touring();
    window.set_window_title(&name);
    window.set_window_edited(edited);
    let page = self.ui.page;
    let hints = self.ui.hints;
    let tab = |id: &'static str, label: &'static str, which: Page, theme: &Theme, cx: &mut Context<Self>| {
      let on = page == which;
      let key = match which {
        Page::Desk => "⌥⌘1",
        Page::Preview => "⌥⌘2",
        Page::Export => "⌥⌘3",
      };
      let tip = match which {
        Page::Desk => "Arrange photos and sequence them",
        Page::Preview => "See it as it will look",
        Page::Export => "Make a PDF, images, an InDesign file, or a post",
      };
      let mut t = div()
        .id(id)
        .relative()
        .tip(format!("{tip} ({key})"), cx.entity().downgrade())
        .when(hints, |d| d.child(paint::shortcut_badge(key, theme)))
        .flex()
        .items_center()
        .justify_center()
        .w(x(PAGE_TAB_W))
        .h(px(22.0))
        .rounded(px(3.0))
        .text_color(if on { theme.text } else { theme.muted })
        .child(label)
        .on_click(cx.listener(move |ws, _, _, cx| ws.go_to(which, cx)));
      if !on {
        t = t.hover(|s| s.text_color(theme.text));
      }
      t
    };
    // The page's highlight, sliding from the last page to this one.
    let slide = crate::motion::slide(
      "page-tabs",
      match page {
        Page::Desk => 0,
        Page::Preview => 1,
        Page::Export => 2,
      },
    );
    let step = PAGE_TAB_W + 2.0;
    let pill = div()
      .absolute()
      .top(px(2.0))
      .w(x(PAGE_TAB_W))
      .h(px(22.0))
      .rounded(px(3.0))
      .bg(theme.control)
      .shadow_xs()
      .left(x(2.0 + slide.to as f64 * step))
      .with_animation(
        SharedString::from(format!("page-tabs-{}", slide.n)),
        crate::motion::ease(crate::motion::TOGGLE),
        move |el, t| el.left(x(2.0 + f64::from(slide.at(t)) * step)),
      );
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
              .relative()
              .flex()
              .gap(px(2.0))
              .p(px(2.0))
              .rounded(px(4.0))
              .bg(theme.track)
              .child(pill)
              .child(tab("page-desk", "Desk", Page::Desk, theme, cx))
              .child(tab("page-preview", "Preview", Page::Preview, theme, cx))
              .child(tab("page-export", "Export", Page::Export, theme, cx)),
          ),
      )
      .child(div().flex_1())
      .when(page == Page::Desk, |d| {
        d.child(
          icon_button(
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
          )
          .relative()
          .tip(
            format!("{} {} (⌘B)", if sidebar_open { "Hide" } else { "Show" }, terms.spreads),
            cx.entity().downgrade(),
          )
          .when(hints, |d| d.child(paint::shortcut_badge("⌘B", theme))),
        )
      })
      .child(
        icon_button(
          "layout",
          "ruler",
          theme,
          true,
          false,
          cx.listener(|ws, _, _, cx| {
            if !ws.posting() {
              ws.go_to(Page::Desk, cx);
              ws.open_layout(cx);
            }
          }),
        )
        .relative()
        .tip("Layout: the page size and guides (⌥⌘P)", cx.entity().downgrade())
        .when(hints, |d| d.child(paint::shortcut_badge("⌥⌘P", theme))),
      )
      .child(
        icon_button("settings", "settings", theme, true, false, |_, window, cx| {
          window.dispatch_action(Box::new(OpenSettings), cx)
        })
        .relative()
        .tip("Settings (⌘,)", cx.entity().downgrade())
        .when(hints, |d| d.child(paint::shortcut_badge("⌘,", theme))),
      )
      .child(div().hidden().child(terms.spreads))
  }

  fn render_status(&mut self, theme: &Theme, cx: &mut Context<Self>) -> impl IntoElement {
    let text = self
      .crop_hint()
      .or_else(|| self.ui.hint.clone())
      .unwrap_or_else(|| self.status_text());
    // Progress: photos being added (counted), or what else is under way.
    let progress = match self.ui.import_progress {
      Some((done, total)) if total > 0 => Some((
        format!("Adding photos {done}/{total}"),
        Some(done as f32 / total as f32),
      )),
      Some(_) => Some(("Adding photos…".to_string(), None)),
      None => self.ui.busy.clone().map(|b| (b, None)),
    };
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
      .when_some(progress, |d, (label, frac)| {
        d.child(
          div()
            .flex()
            .items_center()
            .gap(px(6.0))
            .text_color(theme.text)
            .whitespace_nowrap()
            .child(label)
            .when_some(frac, |d, f| {
              d.child(
                div()
                  .w(px(80.0))
                  .h(px(4.0))
                  .rounded(px(2.0))
                  .bg(theme.track)
                  .child(div().h_full().rounded(px(2.0)).bg(theme.accent).w(relative(f))),
              )
            }),
        )
      })
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
                .id("zoom-menu")
                .relative()
                .px(px(6.0))
                .child(zoom)
                .tip("Zoom", cx.entity().downgrade())
                .on_click(cx.listener(|ws, _, _, cx| {
                  ws.ui.zoom_menu = !ws.ui.zoom_menu;
                  cx.notify();
                }))
                .when(self.ui.zoom_menu, |d| {
                  let mut list = div()
                    .absolute()
                    .bottom(px(20.0))
                    .right_0()
                    .w(px(140.0))
                    .py(px(4.0))
                    .rounded(px(5.0))
                    .bg(theme.panel)
                    .text_color(theme.text)
                    .border_1()
                    .border_color(theme.border_strong)
                    .shadow_lg();
                  let entries: [(&str, Option<f64>); 4] = [
                    ("Show all photos", None),
                    ("50%", Some(0.5)),
                    ("100%", Some(1.0)),
                    ("200%", Some(2.0)),
                  ];
                  for (i, (label, z)) in entries.into_iter().enumerate() {
                    list = list.child(
                      div()
                        .id(("zoom-item", i))
                        .px(px(10.0))
                        .py(px(3.0))
                        .when(i == 1, |d| d.border_t_1().border_color(theme.divider))
                        .hover(|s| s.bg(theme.accent).text_color(theme.on_accent))
                        .child(label)
                        .on_click(cx.listener(move |ws, _, _, cx| {
                          cx.stop_propagation();
                          match z {
                            Some(z) => ws.zoom_desk(z / ws.ui.view.zoom),
                            None => ws.fit_desk(),
                          }
                          ws.ui.zoom_menu = false;
                          cx.notify();
                        })),
                    );
                  }
                  d.child(list)
                }),
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
    let sheet = project.sheet();
    let u = sequence_core::units::units(sheet.unit);
    let size = format!("{} × {} {}", u.format(sheet.page_w), u.format(sheet.page_h), u.suffix);
    match self.ui.page {
      Page::Preview => return format!("← → to {} · F for fullscreen", terms.turn),
      Page::Export => {
        return format!(
          "{size} {}{}",
          terms.spreads,
          if sheet.unit == sequence_core::Unit::In {
            format!(" · {} dpi", sheet.px_per_unit)
          } else {
            String::new()
          }
        );
      }
      Page::Desk => {}
    }
    if let Some(l) = &self.ui.layout {
      let previewing = l.tab == crate::layout::LayoutTab::Page || self.layout_pending();
      if !previewing {
        return size;
      }
      return format!(
        "{size}{} · ← → to flip through",
        if self.layout_pending() {
          " · Preview of the changes"
        } else {
          ""
        }
      );
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
    /// A row: a label, a shortcut, what it does (None: disabled), and whether it's checked.
    enum Row {
      Caption(String),
      Section(String),
      Item(String, &'static str, MenuAction, bool, bool),
      Sub,
      Separator,
      Swatches,
    }
    let project = self.history.shared();
    let (mx, my) = match &menu {
      ContextMenu::Desk { x, y } | ContextMenu::Photo { x, y, .. } => (*x, *y),
    };
    let mut rows = Vec::new();
    let mut shapes: Vec<(String, &'static str, f64)> = Vec::new();
    let mut now_ratio = 0.0;
    match &menu {
      ContextMenu::Desk { .. } => {
        let sel = self.ui.selection.len();
        let can = sel > 1 || project.pile.len() > 1;
        rows.push(Row::Item(
          if sel > 1 {
            format!("Tidy up {sel} photos")
          } else {
            "Tidy up desk".into()
          },
          "",
          MenuAction::Tidy,
          can,
          false,
        ));
        rows.push(Row::Separator);
        rows.push(Row::Section("Desk color".into()));
        rows.push(Row::Swatches);
      }
      ContextMenu::Photo { photo, .. } => {
        let meta = project.photos.get(photo).cloned();
        let on_page = matches!(
          sequence_core::actions::locate(&project, photo),
          Some((sequence_core::actions::Location::Spread(_), _))
        );
        rows.push(Row::Caption(meta.as_ref().map_or("Photo".into(), |m| m.name.clone())));
        rows.push(Row::Item(
          "Quick Look".into(),
          if on_page { "" } else { "Space" },
          MenuAction::QuickLook,
          true,
          false,
        ));
        rows.push(Row::Item("Copy image".into(), "⌘C", MenuAction::Copy, true, false));
        rows.push(Row::Item("Duplicate".into(), "⌘D", MenuAction::Duplicate, true, false));
        if on_page {
          rows.push(Row::Item("Return to desk".into(), "", MenuAction::ToDesk, true, false));
        }
        rows.push(Row::Separator);
        rows.push(Row::Item("Crop…".into(), "C", MenuAction::Crop, true, false));
        if let Some(m) = &meta {
          let sheet = project.sheet();
          let page = if sheet.arrangement == sequence_core::Arrangement::Spreads {
            "page"
          } else {
            "frame"
          };
          shapes = vec![
            ("Square".into(), "1:1", 1.0),
            ("4:5".into(), "", 4.0 / 5.0),
            ("3:2".into(), "", 3.0 / 2.0),
            ("16:9".into(), "", 16.0 / 9.0),
            (format!("The {page}"), "", sheet.page_w / sheet.page_h),
          ];
          let (w, h) = sequence_core::crop::visible_size(m);
          now_ratio = w / h;
          rows.push(Row::Sub);
          if !sequence_core::crop::is_whole(m.crop.as_ref()) {
            rows.push(Row::Item("Reset crop".into(), "", MenuAction::ResetCrop, true, false));
          }
        }
        rows.push(Row::Separator);
        rows.push(Row::Item("Delete".into(), "", MenuAction::Delete, true, false));
      }
    }
    // Kept on screen.
    let row_h = 24.0;
    const SEPARATOR_H: f64 = 9.0;
    let height = rows
      .iter()
      .map(|r| match r {
        Row::Separator => SEPARATOR_H,
        Row::Swatches => 36.0,
        _ => row_h,
      })
      .sum::<f64>()
      + 8.0;
    let width = 220.0;
    let win = self.frames.window;
    let left = mx.min(win.w - width - 8.0).max(4.0);
    let top = my.min(win.h - height - 8.0).max(4.0);
    let item = |id: (&'static str, usize),
                label: String,
                key: &'static str,
                action: MenuAction,
                enabled: bool,
                checked: bool,
                menu: ContextMenu,
                cx: &mut Context<Self>| {
      // Its own row (not the submenu's) closes the submenu when hovered.
      let closes_sub = id.0 == "menu-item";
      div()
        .id(id)
        .when(closes_sub, |d| {
          d.on_hover(cx.listener(|ws, h: &bool, _, cx| {
            if *h && ws.ui.menu_sub {
              ws.ui.menu_sub = false;
              cx.notify();
            }
          }))
        })
        .flex()
        .items_center()
        .gap(px(6.0))
        .h(x(row_h))
        .px(px(10.0))
        .when(!enabled, |d| d.text_color(theme.muted.opacity(0.6)))
        .when(enabled, |d| d.hover(|s| s.bg(theme.accent).text_color(theme.on_accent)))
        // A check for the shape chosen, else the item's icon.
        .child(div().w(px(16.0)).flex().items_center().map(|d| {
          if checked {
            d.child(svg().path(icon("check")).size(px(14.0)).text_color(theme.text))
          } else if let Some(name) = menu_icon(action) {
            let c = if enabled { theme.muted } else { theme.muted.opacity(0.6) };
            d.child(svg().path(icon(name)).size(px(14.0)).text_color(c))
          } else {
            d
          }
        }))
        .child(div().flex_1().child(label))
        .child(
          div()
            .text_color(theme.muted)
            .font_family(MONO)
            .text_size(px(10.0))
            .child(key),
        )
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .when(enabled, |d| {
          d.on_click(cx.listener(move |ws, _, window, cx| ws.run_menu(&menu, action, window, cx)))
        })
    };
    let mut list = div()
      .absolute()
      .left(x(left))
      .top(x(top))
      .w(x(width))
      .py(px(4.0))
      .rounded(px(5.0))
      .bg(theme.panel)
      .border_1()
      .border_color(theme.border_strong)
      .shadow_lg();
    let sub_open = self.ui.menu_sub;
    for (i, row) in rows.into_iter().enumerate() {
      list = list.child(match row {
        // A section's label, in the menu's own type.
        Row::Section(t) => div()
          .h(x(row_h))
          .px(px(10.0))
          .flex()
          .items_center()
          .text_color(theme.muted)
          .text_size(px(12.0))
          .child(t)
          .into_any_element(),
        Row::Caption(t) => div()
          .h(x(row_h))
          .px(px(10.0))
          .flex()
          .items_center()
          .overflow_hidden()
          .whitespace_nowrap()
          .text_color(theme.muted)
          .font_family(MONO)
          .text_size(px(11.0))
          .child(t)
          .into_any_element(),
        Row::Separator => div()
          .h(x(SEPARATOR_H))
          .flex()
          .items_center()
          .child(div().h(px(1.0)).w_full().bg(theme.divider))
          .into_any_element(),
        Row::Item(label, key, action, enabled, checked) => {
          item(("menu-item", i), label, key, action, enabled, checked, menu.clone(), cx).into_any_element()
        }
        Row::Swatches => {
          let mut row = div().h(px(36.0)).px(px(10.0)).flex().items_center().gap(px(8.0));
          for (k, &(_, c)) in crate::theme::DESK_COLORS.iter().enumerate() {
            let on = c == self.prefs.desk_color;
            let m = menu.clone();
            row = row.child(
              div()
                .id(("menu-swatch", k))
                .size(px(24.0))
                .rounded_full()
                .bg(rgb(c))
                .border_1()
                .border_color(theme.border_strong)
                .when(on, |d| d.border_2().border_color(theme.accent))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(cx.listener(move |ws, _, window, cx| ws.run_menu(&m, MenuAction::DeskColor(c), window, cx))),
            );
          }
          // Any other color: the system's color panel, with its eyedropper.
          let m = menu.clone();
          row = row.child(
            div()
              .id("menu-custom-color")
              .size(px(24.0))
              .rounded_full()
              .flex()
              .items_center()
              .justify_center()
              .bg(theme.control)
              .border_1()
              .border_color(theme.border_strong)
              .child(svg().path(icon("pipette")).size(px(12.0)).text_color(theme.muted))
              .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
              .on_click(cx.listener(move |ws, _, window, cx| ws.run_menu(&m, MenuAction::CustomColor, window, cx))),
          );
          row.into_any_element()
        }
        Row::Sub => {
          let mut el = div()
            .id("menu-crop-to")
            .relative()
            .flex()
            .items_center()
            .gap(px(6.0))
            .h(x(row_h))
            .px(px(10.0))
            .when(sub_open, |d| d.bg(theme.accent).text_color(theme.on_accent))
            .child(div().w(px(16.0)))
            .child(div().flex_1().child("Crop to"))
            .child(svg().path(icon("chevron-right")).size(px(12.0)).text_color(theme.muted))
            .on_hover(cx.listener(|ws, h: &bool, _, cx| {
              if *h {
                ws.ui.menu_sub = true;
                cx.notify();
              }
            }))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(cx.listener(|ws, _, _, cx| {
              ws.ui.menu_sub = true;
              cx.notify();
            }));
          if sub_open {
            // To the right, or the left where there's no room.
            let flip = left + width + 180.0 > win.w;
            let mut sub = div()
              .absolute()
              .top(px(-4.0))
              .w(px(180.0))
              .py(px(4.0))
              .rounded(px(5.0))
              .bg(theme.panel)
              .text_color(theme.text)
              .border_1()
              .border_color(theme.border_strong)
              .shadow_lg();
            sub = if flip {
              sub.right(x(width))
            } else {
              sub.left(x(width - 2.0))
            };
            for (k, (label, note, ratio)) in shapes.iter().enumerate() {
              let checked = (ratio - now_ratio).abs() < 0.005;
              sub = sub.child(item(
                ("menu-shape", k),
                label.clone(),
                note,
                MenuAction::CropTo(*ratio),
                true,
                checked,
                menu.clone(),
                cx,
              ));
            }
            el = el.child(sub);
          }
          el.into_any_element()
        }
      });
    }
    div()
      .id("menu-backdrop")
      .absolute()
      .size_full()
      .on_any_mouse_down(cx.listener(|ws, _, _, cx| {
        ws.ui.context_menu = None;
        ws.ui.menu_sub = false;
        cx.notify();
      }))
      // It fades in, settling a few points into place.
      .child(list.on_any_mouse_down(|_, _, cx| cx.stop_propagation()).with_animation(
        SharedString::from(format!("menu-{left}-{top}")),
        crate::motion::ease(crate::motion::POP),
        move |el, t| el.opacity(t).top(x(top - 4.0 * f64::from(1.0 - t))),
      ))
  }

  /// Quick Look (`QuickLook.tsx`): the photo at full size over everything. ← → browse
  /// several; click the image to see actual pixels (drag to look around), again to fit;
  /// click off it, Space, or Esc to close.
  fn render_quick_look(&mut self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let Some((ids, i)) = self.ui.quick_look.clone() else {
      return div().into_any_element();
    };
    let Some(id) = ids.get(i).cloned() else {
      return div().into_any_element();
    };
    let Some(meta) = self.project().photos.get(&id).cloned() else {
      return div().into_any_element();
    };
    let n = ids.len();
    let win = self.frames.window;
    let dark = Theme::dark();
    // The image's place: fitted, or at actual pixels with the view's pan.
    let area = Rect::new(
      24.0,
      TOOLBAR_H + 8.0,
      (win.w - 48.0).max(1.0),
      (win.h - TOOLBAR_H - 32.0).max(1.0),
    );
    let (w, h) = (meta.px_w, meta.px_h);
    let fit = (area.w / w).min(area.h / h).min(1.0);
    let ql = self.ui.ql;
    let scale = if ql.zoomed {
      (1.0 / self.ui.scale_factor).max(fit * 2.0)
    } else {
      fit
    };
    let (iw, ih) = (w * scale, h * scale);
    let clamp = |pan: f64, size: f64, room: f64| {
      if size <= room {
        0.0
      } else {
        pan.clamp(-(size - room) / 2.0, (size - room) / 2.0)
      }
    };
    let pan = (clamp(ql.pan.0, iw, area.w), clamp(ql.pan.1, ih, area.h));
    let r = Rect::new(
      area.x + (area.w - iw) / 2.0 + pan.0,
      area.y + (area.h - ih) / 2.0 + pan.1,
      iw,
      ih,
    );
    // At actual pixels it's drawn from the original, at its full size.
    let image = self.lib.picture(&meta, r.w, r.h);
    let header = div()
      .flex()
      .items_center()
      .gap(px(12.0))
      .h(x(TOOLBAR_H))
      .pl(x(LIGHTS_W))
      .pr(px(12.0))
      .child(div().font_weight(FontWeight::MEDIUM).child(meta.name.clone()))
      .child(
        div()
          .text_color(dark.muted)
          .font_family(MONO)
          .text_size(px(11.0))
          .child(format!(
            "{} × {} px{}",
            w,
            h,
            if n > 1 {
              format!(" · {} of {n}", i + 1)
            } else {
              String::new()
            }
          )),
      )
      .child(div().flex_1())
      .child(
        div()
          .text_color(dark.muted)
          .font_family(MONO)
          .text_size(px(11.0))
          .child(if n > 1 {
            "← → to browse · Space to close"
          } else {
            "Space to close"
          }),
      )
      .child(icon_button(
        "close-quick-look",
        "x",
        &dark,
        true,
        false,
        cx.listener(|ws, _, _, cx| {
          ws.ui.quick_look = None;
          cx.notify();
        }),
      ));
    let turn = |id: &'static str, icon_name: &'static str, delta: isize, at: Rect, cx: &mut Context<Self>| {
      boxed(at).child(icon_button(
        id,
        icon_name,
        &dark,
        true,
        false,
        cx.listener(move |ws, _, _, cx| {
          if let Some((ids, i)) = &mut ws.ui.quick_look {
            *i = (*i as isize + delta).clamp(0, ids.len() as isize - 1) as usize;
          }
          ws.ui.ql = Default::default();
          cx.notify();
        }),
      ))
    };
    let mut el = div()
      .id("quick-look")
      .absolute()
      .size_full()
      .bg(rgba(0x000000e6))
      .text_color(rgb(0xe6e6e6))
      .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
      // A click off the image closes it.
      .on_mouse_down(
        MouseButton::Left,
        cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
          let at = (f64::from(ev.position.x), f64::from(ev.position.y));
          if at.0 >= r.x && at.0 < r.x + r.w && at.1 >= r.y && at.1 < r.y + r.h {
            ws.ui.ql.drag = Some((at, ws.ui.ql.pan, false));
          } else if at.1 > TOOLBAR_H {
            ws.ui.quick_look = None;
            ws.ui.ql = Default::default();
          }
          cx.notify();
        }),
      )
      .on_mouse_move(cx.listener(move |ws, ev: &MouseMoveEvent, _, cx| {
        let Some((start, pan0, moved)) = ws.ui.ql.drag else {
          return;
        };
        let at = (f64::from(ev.position.x), f64::from(ev.position.y));
        let (dx, dy) = (at.0 - start.0, at.1 - start.1);
        if moved || dx.hypot(dy) > 3.0 {
          ws.ui.ql.drag = Some((start, pan0, true));
          if ws.ui.ql.zoomed {
            ws.ui.ql.pan = (pan0.0 + dx, pan0.1 + dy);
          }
          cx.notify();
        }
      }))
      .on_mouse_up(
        MouseButton::Left,
        cx.listener(move |ws, ev: &MouseUpEvent, _, cx| {
          let Some((start, _, moved)) = ws.ui.ql.drag.take() else {
            return;
          };
          if !moved {
            // Zoom in keeping the point clicked under the pointer; out to fit.
            if ws.ui.ql.zoomed {
              ws.ui.ql = Default::default();
            } else {
              let zoom = (1.0 / ws.ui.scale_factor).max(fit * 2.0) / fit;
              let (cx_, cy_) = (area.x + area.w / 2.0, area.y + area.h / 2.0);
              let _ = ev;
              // The point clicked, from the image's center, scaled, then moved back under the pointer.
              let (ox, oy) = (r.x + r.w / 2.0, r.y + r.h / 2.0);
              ws.ui.ql.zoomed = true;
              ws.ui.ql.pan = (
                (ox - start.0) * zoom + (start.0 - cx_),
                (oy - start.1) * zoom + (start.1 - cy_),
              );
            }
          }
          cx.notify();
        }),
      )
      .child(header)
      .child(
        boxed(r)
          .overflow_hidden()
          .cursor(if ql.zoomed {
            CursorStyle::ClosedHand
          } else {
            CursorStyle::PointingHand
          })
          .when_some(image, |d, im| d.child(img(im).size_full().object_fit(ObjectFit::Fill))),
      );
    if n > 1 {
      if i > 0 {
        el = el.child(turn(
          "ql-prev",
          "chevron-left",
          -1,
          Rect::new(12.0, win.h / 2.0 - 14.0, 28.0, 28.0),
          cx,
        ));
      }
      if i + 1 < n {
        el = el.child(turn(
          "ql-next",
          "chevron-right",
          1,
          Rect::new(win.w - 40.0, win.h / 2.0 - 14.0, 28.0, 28.0),
          cx,
        ));
      }
    }
    let _ = theme;
    // It fades in as it opens.
    el.with_animation("quick-look-in", crate::motion::ease(crate::motion::POP), |el, t| {
      el.opacity(t)
    })
    .into_any_element()
  }

  /// Start the photo decodes the frame just drawn asked for, each in the background;
  /// the window is drawn again as each lands.
  fn start_decodes(&mut self, cx: &mut Context<Self>) {
    for d in self.lib.end_frame() {
      let path = self.lib.decode_path(&d);
      let side = d.side;
      let task = cx.background_executor().spawn(async move {
        // ImageIO's temporaries are let go after each photo.
        objc2::rc::autoreleasepool(|_| crate::imageio::bgra(&path, side))
          .and_then(|(w, h, px)| crate::photo_cache::render_image(w, h, px))
      });
      cx.spawn(async move |this, cx| {
        let image = task.await;
        let _ = this.update(cx, |ws, cx| {
          ws.lib.landed(&d, image);
          cx.notify();
        });
      })
      .detach();
    }
  }
}
