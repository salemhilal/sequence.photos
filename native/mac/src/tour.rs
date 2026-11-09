//! The product tour (`src/tour.ts`, `Tour.tsx`): a few steps that each point at part of
//! the app. While it runs, a sample project stands in for the user's, theirs to try
//! things on: nothing is saved, and their project comes back, history and all, when the
//! tour ends. Adding, opening, or saving their own work ends it first.

use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::geometry::{DESK_PPI, Rect};
use sequence_core::store::History;
use sequence_core::tour::{SAMPLES, frame_samples, sample_id, sample_project};

use crate::theme::Theme;
use crate::views::paint::boxed;
use crate::views::text_button;
use crate::workspace::{Page, Workspace};

/// What a step points at.
#[derive(Clone, Copy, PartialEq)]
enum Target {
  None,
  Desk,
  Sidebar,
  Editor,
  /// The page below the toolbar (Layout, Preview, Export).
  Main,
}

struct Step {
  title: &'static str,
  body: &'static str,
  target: Target,
  page: Page,
  editor: bool,
  layout: bool,
}

const fn step(title: &'static str, body: &'static str, target: Target) -> Step {
  Step {
    title,
    body,
    target,
    page: Page::Desk,
    editor: false,
    layout: false,
  }
}

const STEPS: [Step; 8] = [
  step(
    "Welcome to Sequence",
    "Here’s a quick look around, with a sample book. Try anything as you go: your own work is set aside, and comes back when the tour ends.",
    Target::None,
  ),
  step(
    "The desk",
    "Photos you add or drop in land here. Move them around like prints on a table, or Option-drag one to duplicate it. Scroll to pan, pinch to zoom, and tap Space to see a photo full size.",
    Target::Desk,
  ),
  step(
    "Spreads",
    "Drag a photo from the desk onto a page; it fits the page’s guides. Drag spreads to put them in order, or click + to add one.",
    Target::Sidebar,
  ),
  Step {
    editor: true,
    ..step(
      "Arrange a spread",
      "Double-click a spread to open it. Move and resize photos, and they snap to the page’s edges and guides, or type exact positions on the right. Drag one to the desk below to take it off the page.",
      Target::Editor,
    )
  },
  Step {
    layout: true,
    ..step(
      "Layout",
      "Choose spreads (for a book) or frames (for slides and carousels), inches or pixels, and the page size. On the Guides tab, set the margins photos fit to.",
      Target::Main,
    )
  },
  Step {
    page: Page::Preview,
    ..step(
      "Preview",
      "Page through the book as it will look. Press F for fullscreen.",
      Target::Main,
    )
  },
  Step {
    page: Page::Export,
    ..step(
      "Export",
      "Save a PDF to print or share, images, or an InDesign file with every photo placed, or post to Instagram. The preview shows exactly what you’ll get.",
      Target::Main,
    )
  },
  step(
    "Save your project",
    "File → Save keeps your project, photos and all, in one file. Double-click it to pick up where you left off. Hold ⌘ to see every shortcut.",
    Target::None,
  ),
];

/// The samples' pictures, kept in the app.
const SAMPLE_BYTES: [&[u8]; 6] = [
  include_bytes!("../../../src/tour/taxi.jpg"),
  include_bytes!("../../../src/tour/spire.jpg"),
  include_bytes!("../../../src/tour/reflections.jpg"),
  include_bytes!("../../../src/tour/door.jpg"),
  include_bytes!("../../../src/tour/leaves.jpg"),
  include_bytes!("../../../src/tour/lily.jpg"),
];

/// Space between the highlight and what it frames; between it, the card, and the window's edge.
const PAD: f64 = 6.0;
const GAP: f64 = 16.0;
const EDGE: f64 = 4.0;
const CARD_W: f64 = 340.0;
const CARD_H: f64 = 190.0;

/// The tour while it runs: its step, and the user's work set aside.
pub struct Tour {
  pub step: usize,
  history: History,
  view: sequence_core::desk::DeskView,
  sidebar_open: bool,
}

impl Workspace {
  pub fn touring(&self) -> bool {
    self.tour.is_some()
  }

  /// Start the tour, with the sample project standing in for the user's.
  pub fn start_tour(&mut self, cx: &mut Context<Self>) {
    if self.tour.is_some() || self.ui.busy.is_some() || self.is_importing() || self.posting() {
      return;
    }
    self.prefs.tour_seen = true;
    self.prefs.save();
    self.cancel_drag(cx);
    self.finish_crop(true, cx);
    // The samples, stored like added photos, so everything works on them.
    for (name, bytes) in SAMPLES.iter().zip(SAMPLE_BYTES) {
      let id = sample_id(name);
      let _ = std::fs::write(self.lib.image_path(&id), bytes);
      let _ = std::fs::write(self.lib.thumb_path(&id), bytes);
    }
    // Saved work first, while it's the user's.
    self.save_to_library();
    let history = std::mem::replace(&mut self.history, History::new(sample_project()));
    let d = self.frames.desk;
    let (zoom, pan_x, pan_y) = frame_samples(
      if d.w > 0.0 { d.w } else { 800.0 },
      if d.h > 0.0 { d.h } else { 600.0 },
      DESK_PPI,
    );
    self.tour = Some(Tour {
      step: 0,
      history,
      view: self.ui.view,
      sidebar_open: self.prefs.sidebar_open,
    });
    self.ui.selection.clear();
    self.ui.editing = None;
    self.ui.quick_look = None;
    self.ui.context_menu = None;
    self.ui.layout = None;
    self.ui.view.zoom = zoom;
    self.ui.view.pan_x = pan_x;
    self.ui.view.pan_y = pan_y;
    self.prefs.sidebar_open = true;
    self.go_to(Page::Desk, cx);
  }

  /// Go to a step (past the last ends the tour).
  pub fn tour_go(&mut self, index: usize, cx: &mut Context<Self>) {
    let Some(step) = STEPS.get(index) else {
      self.end_tour(cx);
      return;
    };
    let Some(t) = &mut self.tour else { return };
    t.step = index;
    self.ui.layout = None;
    self.frames.layout = None;
    self.go_to(step.page, cx);
    self.ui.editing = if step.editor {
      self.project().layout.all().get(1).map(|s| s.id.clone())
    } else {
      None
    };
    if step.layout {
      self.open_layout(cx);
    }
    cx.notify();
  }

  /// End the tour: the user's project comes back as it was.
  pub fn end_tour(&mut self, cx: &mut Context<Self>) {
    let Some(t) = self.tour.take() else { return };
    self.cancel_drag(cx);
    self.finish_crop(false, cx);
    self.ui.layout = None;
    self.frames.layout = None;
    self.ui.editing = None;
    self.ui.selection.clear();
    self.ui.quick_look = None;
    self.history = t.history;
    self.ui.view = t.view;
    self.prefs.sidebar_open = t.sidebar_open;
    self.go_to(Page::Desk, cx);
    self.changed(cx);
  }

  /// Before the user's own work is added, opened, or saved: end the tour first.
  pub fn leave_tour(&mut self, cx: &mut Context<Self>) {
    self.end_tour(cx);
  }

  /// The tour's overlay: the app dimmed but for the step's target, and the step's card.
  pub fn render_tour(&mut self, theme: &Theme, cx: &mut Context<Self>) -> Option<AnyElement> {
    let index = self.tour.as_ref()?.step;
    let step = &STEPS[index];
    let last = index + 1 == STEPS.len();
    let win = self.frames.window;
    let target = match step.target {
      Target::None => None,
      Target::Desk => Some(self.frames.desk),
      Target::Sidebar => self.frames.sidebar,
      Target::Editor => self.frames.editor.as_ref().map(|e| e.stage),
      Target::Main => Some(self.frames.main),
    }
    .filter(|r| r.w > 0.0 && r.h > 0.0);
    let hole = target.map(|t| {
      let l = EDGE.max(t.x - PAD);
      let tp = EDGE.max(t.y - PAD);
      let r = (win.w - EDGE).min(t.x + t.w + PAD);
      let b = (win.h - EDGE).min(t.y + t.h + PAD);
      Rect::new(l, tp, r - l, b - tp)
    });
    let card = place_card(hole, win);
    let shade: Hsla = rgba(0x00000073).into();
    let mut layer = div().absolute().size_full();
    match hole {
      Some(h) => {
        // Four panes around the hole, and its outline.
        layer = layer
          .child(boxed(Rect::new(0.0, 0.0, win.w, h.y)).bg(shade))
          .child(boxed(Rect::new(0.0, h.y + h.h, win.w, (win.h - h.y - h.h).max(0.0))).bg(shade))
          .child(boxed(Rect::new(0.0, h.y, h.x, h.h)).bg(shade))
          .child(boxed(Rect::new(h.x + h.w, h.y, (win.w - h.x - h.w).max(0.0), h.h)).bg(shade))
          .child(boxed(h).border_2().border_color(theme.accent).rounded(px(6.0)));
      }
      None => layer = layer.child(div().absolute().size_full().bg(shade)),
    }
    let card_el = boxed(Rect::new(card.0, card.1, CARD_W, CARD_H))
      .id("tour-card")
      .flex()
      .flex_col()
      .gap(px(8.0))
      .p(px(16.0))
      .rounded(px(8.0))
      .bg(theme.panel)
      .border_1()
      .border_color(theme.border)
      .shadow_lg()
      .occlude()
      .child(
        div()
          .text_size(px(11.0))
          .text_color(theme.muted)
          .font_family(crate::assets::MONO)
          .child(format!("{} of {}", index + 1, STEPS.len())),
      )
      .child(
        div()
          .text_size(px(15.0))
          .font_weight(FontWeight::SEMIBOLD)
          .child(step.title),
      )
      .child(div().flex_1().text_color(theme.text).child(step.body))
      .child(
        div()
          .flex()
          .items_center()
          .gap(px(6.0))
          .when(!last, |d| {
            d.child(text_button(
              "tour-skip",
              "Skip tour",
              theme,
              false,
              cx.listener(|ws, _, _, cx| ws.end_tour(cx)),
            ))
          })
          .child(div().flex_1())
          .when(index > 0, |d| {
            d.child(text_button(
              "tour-back",
              "Back",
              theme,
              false,
              cx.listener(move |ws, _, _, cx| ws.tour_go(index - 1, cx)),
            ))
          })
          .child(text_button(
            "tour-next",
            if last { "Start your book" } else { "Next" },
            theme,
            true,
            cx.listener(move |ws, _, _, cx| ws.tour_go(index + 1, cx)),
          )),
      );
    Some(layer.child(card_el).into_any_element())
  }
}

/// Put the card beside the highlight, on whichever side has room; inside it, near the
/// bottom, when it fills the window; centered, low, when there's nothing to highlight.
fn place_card(hole: Option<Rect>, win: Rect) -> (f64, f64) {
  let (vw, vh) = (win.w, win.h);
  let clamp_x = |v: f64| v.max(GAP).min(vw - CARD_W - GAP);
  let clamp_y = |v: f64| v.max(GAP).min(vh - CARD_H - GAP);
  let Some(h) = hole else {
    return ((vw - CARD_W) / 2.0, clamp_y(vh * 0.62 - CARD_H / 2.0));
  };
  let right = h.x + h.w;
  let bottom = h.y + h.h;
  if right + GAP + CARD_W + GAP <= vw {
    (right + GAP, clamp_y(h.y))
  } else if h.x - GAP - CARD_W >= GAP {
    (h.x - GAP - CARD_W, clamp_y(h.y))
  } else if bottom + GAP + CARD_H + GAP <= vh {
    (clamp_x(h.x), bottom + GAP)
  } else if h.y - GAP - CARD_H >= GAP {
    (clamp_x(h.x), h.y - GAP - CARD_H)
  } else {
    (
      clamp_x(h.x + (h.w - CARD_W) / 2.0),
      clamp_y(bottom - CARD_H - 2.0 * GAP),
    )
  }
}
