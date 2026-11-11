//! Drawing photos and spreads: a placed photo shows its crop of the original, and a spread
//! is its pages with its photos (`PhotoImg`, `SpreadCanvas`).

use gpui_kit::*;
use sequence_core::crop::{crop_of, whole_rect};
use sequence_core::geometry::{Rect, page_rect, page_sides, spread_left, spread_width};
use sequence_core::render_plan::ink_rgb;
use sequence_core::{Ink, PageSide, Placement, Project, Sheet, Spread};

use crate::library::Library;
use crate::theme::Theme;

/// Pixels as GPUI takes them.
pub fn x(v: f64) -> Pixels {
  px(v as f32)
}

/// An absolutely placed box, relative to its parent.
pub fn boxed(r: Rect) -> Div {
  div().absolute().left(x(r.x)).top(x(r.y)).w(x(r.w)).h(x(r.h))
}

pub fn ink(i: Ink) -> Hsla {
  let [r, g, b] = ink_rgb(i);
  rgb((u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b)).into()
}

/// A placed photo at `r` (relative to its parent): its crop of the photo, decoded about as
/// large as the whole photo is drawn.
pub fn photo(lib: &mut Library, project: &Project, p: &Placement, r: Rect, theme: &Theme) -> Div {
  let frame = boxed(r).overflow_hidden();
  let Some(meta) = project.photos.get(&p.photo_id) else {
    return frame.bg(theme.inset);
  };
  let whole = whole_rect(Rect::new(0.0, 0.0, r.w, r.h), crop_of(meta));
  let Some(picture) = lib.picture(meta, whole.w, whole.h) else {
    return frame.bg(theme.inset);
  };
  frame.child(
    img(picture)
      .absolute()
      .left(x(whole.x))
      .top(x(whole.y))
      .w(x(whole.w))
      .h(x(whole.h))
      .object_fit(ObjectFit::Fill),
  )
}

/// A photo's border, drawn outside it, as exports draw it.
pub fn border(p: &Placement, r: Rect, scale: f64) -> Option<Div> {
  let b = p.border?;
  let w = b.width * scale;
  Some(boxed(Rect::new(r.x - w, r.y - w, r.w + 2.0 * w, r.h + 2.0 * w)).bg(ink(b.color)))
}

/// A spread at `scale` (pixels per unit), with its x = 0, y = 0 at `origin` (relative to
/// the parent): its pages, and its photos clipped to them when `clip`, else drawn whole.
pub struct SpreadPicture<'a> {
  pub spread: &'a Spread,
  pub sheet: &'a Sheet,
  pub scale: f64,
  pub origin: (f64, f64),
  pub clip: bool,
}

impl SpreadPicture<'_> {
  /// A rect in the spread's units, in the parent's pixels.
  pub fn at(&self, r: Rect) -> Rect {
    Rect::new(
      self.origin.0 + r.x * self.scale,
      self.origin.1 + r.y * self.scale,
      r.w * self.scale,
      r.h * self.scale,
    )
  }

  /// Each page, in the parent's pixels.
  pub fn pages(&self) -> Vec<(PageSide, Rect)> {
    page_sides(self.spread.kind)
      .iter()
      .map(|&side| (side, self.at(page_rect(side, self.sheet))))
      .collect()
  }

  /// The pages together.
  pub fn pages_box(&self) -> Rect {
    self.at(Rect::new(
      spread_left(self.spread.kind, self.sheet),
      0.0,
      spread_width(self.spread.kind, self.sheet),
      self.sheet.page_h,
    ))
  }

  /// The pages, each lit if it's the drop target.
  pub fn page_elements(&self, theme: &Theme, lit: Option<PageSide>) -> Vec<AnyElement> {
    // As exports draw it: pure white, or black.
    let bg = ink(self.spread.background.unwrap_or(Ink::White));
    self
      .pages()
      .into_iter()
      .map(|(side, r)| {
        let mut el = boxed(r).bg(bg);
        if lit == Some(side) {
          el = el.border_2().border_color(theme.accent);
        }
        el.into_any_element()
      })
      .collect()
  }

  /// The photos, back to front, each drawn by `item` (or plainly).
  pub fn photo_elements(&self, lib: &mut Library, project: &Project, theme: &Theme) -> AnyElement {
    let mut items: Vec<&Placement> = self.spread.items.iter().collect();
    items.sort_by(|a, b| a.z.total_cmp(&b.z));
    if self.clip {
      let pb = self.pages_box();
      let mut layer = boxed(pb).overflow_hidden();
      for p in items {
        let r = self.at(Rect::from(p));
        let r = Rect::new(r.x - pb.x, r.y - pb.y, r.w, r.h);
        if let Some(b) = border(p, r, self.scale) {
          layer = layer.child(b);
        }
        layer = layer.child(photo(lib, project, p, r, theme));
      }
      layer.into_any_element()
    } else {
      let mut layer = div().absolute().left_0().top_0().size_full();
      for p in items {
        let r = self.at(Rect::from(p));
        if let Some(b) = border(p, r, self.scale) {
          layer = layer.child(b);
        }
        layer = layer.child(photo(lib, project, p, r, theme));
      }
      layer.into_any_element()
    }
  }

  /// The pages' outline and the gutter.
  pub fn outline(&self, theme: &Theme) -> AnyElement {
    let pb = self.pages_box();
    let mut el = boxed(pb).border_1().border_color(theme.page_edge);
    if page_sides(self.spread.kind).len() == 2 {
      el = el.child(
        div()
          .absolute()
          .top_0()
          .bottom_0()
          .left(x(self.sheet.page_w * self.scale))
          .w(px(1.0))
          .bg(theme.page_edge),
      );
    }
    el.into_any_element()
  }
}

/// A mark on a photo with less detail than the page asks for, at its top right (`SoftBadge`).
pub fn soft_badge(r: Rect, theme: &Theme) -> Div {
  let size = 18f64.min(r.w * 0.4).min(r.h * 0.4).max(10.0);
  boxed(Rect::new(r.x + r.w - size - 4.0, r.y + 4.0, size, size))
    .rounded_full()
    .flex()
    .items_center()
    .justify_center()
    .bg(theme.warn)
    .child(
      svg()
        .path(crate::assets::icon("triangle-alert"))
        .size(x(size * 0.62))
        .text_color(gpui_kit::white()),
    )
}

/// A shortcut's badge just below its button, while ⌘ is held (`ShortcutBadges`). The button
/// must be `relative()`. Drawn after everything else, so the desk and sidebar (drawn after
/// the toolbar) don't cover it.
pub fn shortcut_badge(label: &'static str, theme: &Theme) -> impl IntoElement {
  div()
    .absolute()
    .top_full()
    .mt(px(4.0))
    .left_0()
    .right_0()
    .flex()
    .justify_center()
    .child(
      deferred(
        div()
          .px(px(5.0))
          .py(px(1.0))
          .rounded(px(3.0))
          .bg(theme.text)
          .text_color(theme.bg)
          .text_size(px(10.0))
          .font_family(crate::assets::MONO)
          .whitespace_nowrap()
          .shadow_md()
          .child(label),
      )
      .with_priority(10),
    )
}

/// A hint in the status bar while the pointer is over an element (`data-tip`, `hints.ts`).
pub trait Tip {
  fn tip(self, text: impl Into<String>, ws: WeakEntity<crate::workspace::Workspace>) -> Self;
}

impl Tip for Stateful<Div> {
  fn tip(self, text: impl Into<String>, ws: WeakEntity<crate::workspace::Workspace>) -> Self {
    let text = text.into();
    self.on_hover(move |hovered, _, cx| {
      let text = text.clone();
      let _ = ws.update(cx, |ws, cx| {
        if *hovered {
          ws.ui.hint = Some(text);
        } else if ws.ui.hint.as_deref() == Some(text.as_str()) {
          ws.ui.hint = None;
        }
        cx.notify();
      });
    })
  }
}
