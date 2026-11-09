//! The desk: photos on a free canvas, panned and zoomed (`Desk.tsx`), with the sidebar
//! beside it and the spread editor over both when it's open.

use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::geometry::{Corner, Rect};

use super::paint::{boxed, photo, x};
use super::text_button;
use crate::prefs::SIDEBAR_MIN_WIDTH;
use crate::theme::Theme;
use crate::workspace::{ContextMenu, Source, Surface, Workspace};

/// Screen pixels between a photo and its selection frame.
const FRAME_GAP: f64 = 5.0;
const HANDLE: f64 = 9.0;
const CORNERS: [Corner; 4] = [Corner::Nw, Corner::Ne, Corner::Sw, Corner::Se];

fn corner_at(r: Rect, c: Corner) -> (f64, f64) {
  match c {
    Corner::Nw => (r.x, r.y),
    Corner::Ne => (r.x + r.w, r.y),
    Corner::Sw => (r.x, r.y + r.h),
    Corner::Se => (r.x + r.w, r.y + r.h),
  }
}

/// A selected photo's frame, and its corner handles if it can be resized.
pub fn selection_frame(r: Rect, theme: &Theme, handles: bool) -> Div {
  let f = Rect::new(
    r.x - FRAME_GAP,
    r.y - FRAME_GAP,
    r.w + 2.0 * FRAME_GAP,
    r.h + 2.0 * FRAME_GAP,
  );
  let mut el = div().child(boxed(f).border_2().border_color(theme.accent).rounded(px(2.0)));
  if handles {
    for c in CORNERS {
      let (cx, cy) = corner_at(f, c);
      el = el.child(
        boxed(Rect::new(cx - HANDLE / 2.0, cy - HANDLE / 2.0, HANDLE, HANDLE))
          .bg(theme.accent)
          .border_1()
          .border_color(theme.page),
      );
    }
  }
  el
}

/// Invisible corner targets for resizing, a bit larger than the handles drawn.
pub fn handle_targets(
  r: Rect,
  surface: Surface,
  photo: sequence_core::PhotoId,
  cx: &mut Context<Workspace>,
) -> Vec<AnyElement> {
  let f = Rect::new(
    r.x - FRAME_GAP,
    r.y - FRAME_GAP,
    r.w + 2.0 * FRAME_GAP,
    r.h + 2.0 * FRAME_GAP,
  );
  CORNERS
    .iter()
    .map(|&c| {
      let (hx, hy) = corner_at(f, c);
      let id = photo.clone();
      let cursor = match c {
        Corner::Nw | Corner::Se => CursorStyle::ResizeUpLeftDownRight,
        Corner::Ne | Corner::Sw => CursorStyle::ResizeUpRightDownLeft,
      };
      boxed(Rect::new(hx - 8.0, hy - 8.0, 16.0, 16.0))
        .cursor(cursor)
        .on_mouse_down(
          MouseButton::Left,
          cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            ws.handle_down(surface, id.clone(), c, ev);
          }),
        )
        .into_any_element()
    })
    .collect()
}

impl Workspace {
  pub fn render_desk_page(&mut self, theme: &Theme, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
    let main = self.frames.main;
    let sidebar_w = if self.prefs.sidebar_open {
      self
        .prefs
        .sidebar_width
        .min(main.w - 160.0)
        .max(SIDEBAR_MIN_WIDTH)
        .min(main.w)
    } else {
      0.0
    };
    self.frames.desk = Rect::new(0.0, main.y, (main.w - sidebar_w).max(0.0), main.h);
    if !self.ui.fitted_once && self.frames.desk.w > 0.0 {
      self.ui.fitted_once = true;
      self.fit_desk();
    }
    let mut page = div().relative().size_full().child(self.render_desk(theme, cx));
    if sidebar_w > 0.0 {
      let r = Rect::new(main.w - sidebar_w, main.y, sidebar_w, main.h);
      self.frames.sidebar = Some(r);
      page = page.child(self.render_sidebar(r, theme, cx));
    }
    if self.ui.editing.is_some() {
      page = page.child(self.render_editor(theme, window, cx));
    }
    page.into_any_element()
  }

  fn render_desk(&mut self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let d = self.frames.desk;
    let view = self.ui.view;
    let project = self.history.project().clone();
    let mut items: Vec<_> = project.pile.iter().collect();
    items.sort_by(|a, b| a.z.total_cmp(&b.z));
    let desk_color: Hsla = rgb(self.prefs.desk_color).into();
    let drop_hover = self.ui.hover == Some(sequence_core::actions::DropTarget::Desk);
    let mut desk = div()
      .id("desk")
      .absolute()
      .left_0()
      .top_0()
      .w(x(d.w))
      .h(x(d.h))
      .overflow_hidden()
      .bg(desk_color)
      .on_mouse_down(MouseButton::Left, cx.listener(|ws, ev, _, cx| ws.desk_down(ev, cx)))
      .on_mouse_down(MouseButton::Middle, cx.listener(|ws, ev, _, cx| ws.desk_down(ev, cx)))
      .on_mouse_down(
        MouseButton::Right,
        cx.listener(|ws, ev: &MouseDownEvent, _, cx| {
          ws.ui.context_menu = Some(ContextMenu::Desk {
            x: f64::from(ev.position.x),
            y: f64::from(ev.position.y),
          });
          cx.notify();
        }),
      )
      .on_scroll(cx.listener(|ws, ev, _, cx| ws.desk_scroll(ev, cx)))
      .on_pinch(cx.listener(|ws, ev, _, cx| ws.desk_pinch(ev, cx)))
      .on_drop(cx.listener(|ws, paths: &ExternalPaths, _, cx| ws.files_dropped(paths.paths().to_vec(), cx)));

    let single = (self.ui.selection.len() == 1).then(|| self.ui.selection[0].clone());
    for p in &items {
      let r = view.to_screen(Rect::from(*p));
      // Skip what's far off screen.
      if r.x > d.w + 50.0 || r.y > d.h + 50.0 || r.x + r.w < -50.0 || r.y + r.h < -50.0 {
        continue;
      }
      let id = p.photo_id.clone();
      let id2 = id.clone();
      let hover_id = id.clone();
      desk = desk.child(
        photo(&mut self.lib, &project, p, r, theme)
          .id(SharedString::from(format!("desk-{id}")))
          .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
              cx.stop_propagation();
              ws.photo_down(Source::Desk, id.clone(), ev, cx);
            }),
          )
          .on_mouse_down(
            MouseButton::Right,
            cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
              cx.stop_propagation();
              if !ws.ui.selection.contains(&id2) {
                ws.ui.selection = vec![id2.clone()];
              }
              ws.ui.context_menu = Some(ContextMenu::Photo {
                x: f64::from(ev.position.x),
                y: f64::from(ev.position.y),
                photo: id2.clone(),
              });
              cx.notify();
            }),
          )
          .on_hover(cx.listener(move |ws, hovered: &bool, _, cx| {
            let was = ws.ui.hover_photo.clone();
            ws.ui.hover_photo = if *hovered {
              Some(hover_id.clone())
            } else if was.as_ref() == Some(&hover_id) {
              None
            } else {
              was.clone()
            };
            if ws.ui.hover_photo != was {
              cx.notify();
            }
          })),
      );
    }
    // Selection frames over the photos, in screen pixels.
    let resizing = matches!(
      &self.drag,
      Some(crate::workspace::Drag::Resize {
        surface: Surface::Desk,
        ..
      })
    );
    let cropping = self.ui.cropping.as_ref().map(|c| c.photo.clone());
    for p in items
      .iter()
      .filter(|p| self.ui.selection.contains(&p.photo_id) && cropping.as_ref() != Some(&p.photo_id))
    {
      let r = view.to_screen(Rect::from(*p));
      let handles =
        single.as_ref() == Some(&p.photo_id) && (self.ui.hover_photo.as_ref() == single.as_ref() || resizing);
      desk = desk.child(selection_frame(r, theme, handles));
      if single.as_ref() == Some(&p.photo_id) {
        for t in handle_targets(r, Surface::Desk, p.photo_id.clone(), cx) {
          desk = desk.child(t);
        }
      }
    }
    if let Some(m) = self.ui.marquee {
      desk = desk.child(
        boxed(Rect::new(m.x - d.x, m.y - d.y, m.w, m.h))
          .border_1()
          .border_color(theme.accent)
          .bg(theme.accent_soft),
      );
    }
    if drop_hover {
      desk = desk.child(div().absolute().size_full().border_2().border_color(theme.accent));
    }
    if project.pile.is_empty() {
      desk = desk.child(self.render_desk_empty(theme, cx));
    }
    desk.into_any_element()
  }

  fn render_desk_empty(&mut self, theme: &Theme, cx: &mut Context<Self>) -> impl IntoElement {
    let text = if self.desk_light() {
      theme.text
    } else {
      rgb(0xeeeeee).into()
    };
    let any = !self.project().photos.is_empty();
    let hints = self.ui.hints;
    div()
      .absolute()
      .size_full()
      .flex()
      .flex_col()
      .items_center()
      .justify_center()
      .gap(px(10.0))
      .text_color(text)
      .text_size(px(13.0))
      .when(any, |d| d.child("Every photo is placed."))
      .child(
        div()
          .flex()
          .items_center()
          .gap(px(8.0))
          .child("Drop photos here, or")
          .child(
            text_button(
              "add-photos-empty",
              "Add photos…",
              theme,
              true,
              cx.listener(|ws, _, window, cx| ws.pick_photos(window, cx)),
            )
            .relative()
            .when(hints, |d| d.child(super::paint::shortcut_badge("⌘I", theme)))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation()),
          ),
      )
  }
}
