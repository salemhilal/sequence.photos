//! Crop mode's overlay (`CropFrame.tsx`): the whole photo over its place, dimmed outside the
//! crop, the crop's frame with its thirds and handles, and the bar of shapes under it.

use std::cell::Cell;
use std::rc::Rc;

use gpui_kit::*;
use sequence_core::crop::CropHandle;
use sequence_core::geometry::Rect;

use super::paint::{boxed, x};
use super::text_button;
use crate::assets::icon;
use crate::crop::CropGrip;
use crate::theme::Theme;
use crate::workspace::{Surface, Workspace};

/// A handle's size and its bars' thickness, in screen pixels.
const HS: f64 = 14.0;
const HT: f64 = 3.0;

fn white(a: f32) -> Hsla {
  hsla(0.0, 0.0, 1.0, a)
}

impl Workspace {
  /// The overlay, in window pixels, while a photo is being cropped.
  pub fn render_crop(&mut self, theme: &Theme, cx: &mut Context<Self>) -> Option<AnyElement> {
    let c = self.ui.cropping.clone()?;
    let frame = self.crop_frame()?;
    let clip = match c.surface {
      Surface::Desk => self.frames.desk,
      Surface::Editor => self.frames.editor.as_ref()?.stage,
    };
    let w = self.surface_to_window(c.surface, c.whole);
    let f = self.surface_to_window(c.surface, frame);
    self.frames.crop_zone = Some(intersection(w, clip));
    // In the clip's pixels.
    let l = |r: Rect| Rect::new(r.x - clip.x, r.y - clip.y, r.w, r.h);
    let (wl, fl) = (l(w), l(f));

    // The whole photo, drawn at `w`.
    let meta = self.project().photos.get(&c.photo).cloned();
    let photo = meta.and_then(|m| self.lib.picture(&m, w.w, w.h));
    let picture = |r: Rect| {
      let mut d = boxed(r);
      if let Some(t) = photo.clone() {
        d = d.child(img(t).size_full().object_fit(ObjectFit::Fill));
      }
      d
    };
    let mut layer = boxed(clip)
      .overflow_hidden()
      // Presses on the photo stay with crop mode.
      .child(
        div()
          .id("crop-whole")
          .absolute()
          .left(x(wl.x))
          .top(x(wl.y))
          .w(x(wl.w))
          .h(x(wl.h))
          .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
          .on_mouse_down(MouseButton::Right, |_, _, cx| cx.stop_propagation()),
      );
    if c.pinned {
      // Only what's in the crop shows.
      layer = layer.child(
        boxed(fl)
          .overflow_hidden()
          .child(picture(Rect::new(wl.x - fl.x, wl.y - fl.y, wl.w, wl.h))),
      );
    } else {
      layer = layer.child(picture(wl));
      let dim = rgba(0x0c0c0cb8);
      for r in [
        Rect::new(wl.x, wl.y, wl.w, fl.y - wl.y),
        Rect::new(wl.x, fl.y + fl.h, wl.w, wl.y + wl.h - fl.y - fl.h),
        Rect::new(wl.x, fl.y, fl.x - wl.x, fl.h),
        Rect::new(fl.x + fl.w, fl.y, wl.x + wl.w - fl.x - fl.w, fl.h),
      ] {
        if r.w > 0.0 && r.h > 0.0 {
          layer = layer.child(boxed(r).bg(dim));
        }
      }
    }
    // Thirds.
    for i in 1..3 {
      let t = f64::from(i) / 3.0;
      layer = layer
        .child(boxed(Rect::new(fl.x + fl.w * t, fl.y, 1.0, fl.h)).bg(white(0.35)))
        .child(boxed(Rect::new(fl.x, fl.y + fl.h * t, fl.w, 1.0)).bg(white(0.35)));
    }
    // The frame: dragging inside it moves the crop (or the photo).
    let move_cursor = if c.pinned || self.ui.cmd_held {
      CursorStyle::ClosedHand
    } else {
      CursorStyle::OpenHand
    };
    layer = layer.child(
      div()
        .id("crop-window")
        .absolute()
        .left(x(fl.x))
        .top(x(fl.y))
        .w(x(fl.w))
        .h(x(fl.h))
        .border_1()
        .border_color(white(if c.pinned { 0.6 } else { 1.0 }))
        .cursor(move_cursor)
        .on_mouse_down(
          MouseButton::Left,
          cx.listener(|ws, ev: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            ws.crop_down(CropGrip::Inside { move_photo: false }, ev);
          }),
        ),
    );
    if !c.pinned {
      for h in CropHandle::ALL {
        if c.ratio.is_some() && !h.is_corner() {
          continue;
        }
        for bar in handle_bars(fl, h) {
          layer = layer.child(boxed(bar).bg(white(1.0)));
        }
        layer = layer.child(
          div()
            .id(SharedString::from(format!("crop-{h:?}")))
            .absolute()
            .left(x(handle_target(fl, h).x))
            .top(x(handle_target(fl, h).y))
            .w(x(handle_target(fl, h).w))
            .h(x(handle_target(fl, h).h))
            .cursor(handle_cursor(h))
            .on_mouse_down(
              MouseButton::Left,
              cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
                cx.stop_propagation();
                ws.crop_down(CropGrip::Handle(h), ev);
              }),
            ),
        );
      }
    }

    // The bar of shapes, under the frame on screen.
    let bar_y = (f.y + f.h + 12.0).min(self.frames.window.h - 52.0);
    let ratio = c.ratio;
    let chosen = |r: Option<f64>| match (r, ratio) {
      (None, None) => true,
      (Some(a), Some(b)) => (a - b).abs() < 1e-6,
      _ => false,
    };
    let mut bar = div()
      .id("crop-bar")
      .relative()
      .flex()
      .items_center()
      .gap(px(2.0))
      .p(px(3.0))
      .rounded(px(6.0))
      .bg(theme.panel)
      .border_1()
      .border_color(theme.border)
      .shadow_lg()
      .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation());
    for s in self.crop_shapes() {
      let on = chosen(s.ratio);
      let r = s.ratio;
      let mut b = div()
        .id(SharedString::from(format!("crop-shape-{}", s.label)))
        .flex()
        .items_center()
        .h(px(24.0))
        .px(px(8.0))
        .rounded(px(3.0))
        .text_size(px(12.0))
        .text_color(if on { theme.text } else { theme.muted })
        .child(s.label);
      if on {
        b = b.bg(theme.control).shadow_xs();
      }
      if c.pinned {
        b = b.opacity(0.4);
      } else {
        b = b
          .hover(|st| st.text_color(theme.text))
          .on_click(cx.listener(move |ws, _, _, cx| ws.choose_crop_shape(r, cx)));
      }
      bar = bar.child(b);
    }
    bar = bar.child(div().w(px(1.0)).h(px(18.0)).mx(px(2.0)).bg(theme.border));
    let mut pin = div()
      .id("crop-pin")
      .flex()
      .items_center()
      .justify_center()
      .w(px(26.0))
      .h(px(24.0))
      .rounded(px(3.0))
      .child(
        svg()
          .path(icon("pin"))
          .size(px(14.0))
          .text_color(if c.pinned { theme.text } else { theme.muted }),
      )
      .on_click(cx.listener(|ws, _, _, cx| ws.toggle_crop_pin(cx)));
    if c.pinned {
      pin = pin.bg(theme.control).shadow_xs();
    }
    bar = bar.child(pin);
    let mut reset = div()
      .id("crop-reset")
      .flex()
      .items_center()
      .h(px(24.0))
      .px(px(8.0))
      .rounded(px(3.0))
      .text_size(px(12.0))
      .text_color(theme.muted)
      .child("Reset");
    if c.pinned {
      reset = reset.opacity(0.4);
    } else {
      reset = reset
        .hover(|st| st.text_color(theme.text))
        .on_click(cx.listener(|ws, _, _, cx| ws.reset_crop(cx)));
    }
    bar = bar.child(reset).child(div().ml(px(4.0)).child(text_button(
      "crop-done",
      "Done",
      theme,
      true,
      cx.listener(|ws, _, _, cx| ws.finish_crop(true, cx)),
    )));
    // Where the bar lands, for telling presses on it from presses elsewhere.
    let cell: Rc<Cell<Option<Rect>>> = self.frames.crop_bar.clone();
    bar = bar.child(
      canvas(
        move |b, _, _| {
          cell.set(Some(Rect::new(
            f64::from(b.origin.x),
            f64::from(b.origin.y),
            f64::from(b.size.width),
            f64::from(b.size.height),
          )))
        },
        |_, _, _, _| {},
      )
      .absolute()
      .size_full(),
    );
    let bar_row = div()
      .absolute()
      .left(x(f.x + f.w / 2.0 - 400.0))
      .top(x(bar_y))
      .w(px(800.0))
      .flex()
      .justify_center()
      .child(bar);

    Some(
      div()
        .absolute()
        .size_full()
        .child(layer)
        .child(bar_row)
        .into_any_element(),
    )
  }
}

/// Where two rects overlap (empty if they don't).
fn intersection(a: Rect, b: Rect) -> Rect {
  let x1 = a.x.max(b.x);
  let y1 = a.y.max(b.y);
  let x2 = (a.x + a.w).min(b.x + b.w);
  let y2 = (a.y + a.h).min(b.y + b.h);
  Rect::new(x1, y1, (x2 - x1).max(0.0), (y2 - y1).max(0.0))
}

/// A handle's white bars: an L at a corner, a short bar at an edge's middle.
fn handle_bars(f: Rect, h: CropHandle) -> Vec<Rect> {
  let (l, t, r, b) = (f.x - HT, f.y - HT, f.x + f.w + HT, f.y + f.h + HT);
  let mid_x = f.x + f.w / 2.0;
  let mid_y = f.y + f.h / 2.0;
  match h {
    CropHandle::NW => vec![Rect::new(l, t, HS, HT), Rect::new(l, t, HT, HS)],
    CropHandle::NE => vec![Rect::new(r - HS, t, HS, HT), Rect::new(r - HT, t, HT, HS)],
    CropHandle::SW => vec![Rect::new(l, b - HT, HS, HT), Rect::new(l, b - HS, HT, HS)],
    CropHandle::SE => vec![Rect::new(r - HS, b - HT, HS, HT), Rect::new(r - HT, b - HS, HT, HS)],
    CropHandle::N => vec![Rect::new(mid_x - HS, f.y - HT / 2.0, 2.0 * HS, HT)],
    CropHandle::S => vec![Rect::new(mid_x - HS, f.y + f.h - HT / 2.0, 2.0 * HS, HT)],
    CropHandle::W => vec![Rect::new(f.x - HT / 2.0, mid_y - HS, HT, 2.0 * HS)],
    CropHandle::E => vec![Rect::new(f.x + f.w - HT / 2.0, mid_y - HS, HT, 2.0 * HS)],
  }
}

/// Where a handle takes presses: a little larger than what's drawn.
fn handle_target(f: Rect, h: CropHandle) -> Rect {
  let g = HS + 6.0;
  let mid_x = f.x + f.w / 2.0;
  let mid_y = f.y + f.h / 2.0;
  let (cx, cy) = match h {
    CropHandle::NW => (f.x, f.y),
    CropHandle::NE => (f.x + f.w, f.y),
    CropHandle::SW => (f.x, f.y + f.h),
    CropHandle::SE => (f.x + f.w, f.y + f.h),
    CropHandle::N => (mid_x, f.y),
    CropHandle::S => (mid_x, f.y + f.h),
    CropHandle::W => (f.x, mid_y),
    CropHandle::E => (f.x + f.w, mid_y),
  };
  match h {
    CropHandle::N | CropHandle::S => Rect::new(cx - HS * 1.5, cy - g / 2.0, HS * 3.0, g),
    CropHandle::E | CropHandle::W => Rect::new(cx - g / 2.0, cy - HS * 1.5, g, HS * 3.0),
    _ => Rect::new(cx - g / 2.0, cy - g / 2.0, g, g),
  }
}

fn handle_cursor(h: CropHandle) -> CursorStyle {
  match h {
    CropHandle::N | CropHandle::S => CursorStyle::ResizeUpDown,
    CropHandle::E | CropHandle::W => CursorStyle::ResizeLeftRight,
    CropHandle::NW | CropHandle::SE => CursorStyle::ResizeUpLeftDownRight,
    CropHandle::NE | CropHandle::SW => CursorStyle::ResizeUpRightDownLeft,
  }
}
