//! Scrolling, pinching, and moving between spreads in the editor.

use gpui_kit::*;
use sequence_core::SpreadId;

use super::{FITTED, Page, Workspace};

/// The editor's zoom range, from fitting the spread.
pub const EDITOR_MIN_ZOOM: f64 = 0.5;
pub const EDITOR_MAX_ZOOM: f64 = 8.0;

impl Workspace {
  // Scrolling and pinching.

  pub fn desk_scroll(&mut self, ev: &ScrollEvent, cx: &mut Context<Self>) {
    let d = ev.delta.pixel_delta(px(16.0));
    let (sx, sy) = (
      f64::from(ev.position.x) - self.frames.desk.x,
      f64::from(ev.position.y) - self.frames.desk.y,
    );
    self.ui.view = self.ui.view.wheeled(
      -f64::from(d.x),
      -f64::from(d.y),
      ev.modifiers.platform || ev.modifiers.control,
      sx,
      sy,
      sequence_core::desk::MIN_ZOOM,
      sequence_core::desk::MAX_ZOOM,
    );
    cx.notify();
  }

  pub fn desk_pinch(&mut self, ev: &PinchEvent, cx: &mut Context<Self>) {
    let (sx, sy) = (
      f64::from(ev.position.x) - self.frames.desk.x,
      f64::from(ev.position.y) - self.frames.desk.y,
    );
    self.ui.view = self.ui.view.pinched(1.0 + f64::from(ev.delta), sx, sy);
    cx.notify();
  }

  /// The editor's stage: from where the spread's center sits before panning.
  fn stage_point(&self, ev: Point<Pixels>) -> (f64, f64) {
    let Some(e) = &self.frames.editor else {
      return (0.0, 0.0);
    };
    (
      f64::from(ev.x) - e.stage.x - e.stage.w / 2.0,
      f64::from(ev.y) - e.stage.y - (e.stage.h - crate::views::editor::PAGER_PX) / 2.0,
    )
  }

  pub fn editor_scroll(&mut self, ev: &ScrollEvent, cx: &mut Context<Self>) {
    let d = ev.delta.pixel_delta(px(16.0));
    let (sx, sy) = self.stage_point(ev.position);
    self.ui.editor_view = self.ui.editor_view.wheeled(
      -f64::from(d.x),
      -f64::from(d.y),
      ev.modifiers.platform || ev.modifiers.control,
      sx,
      sy,
      EDITOR_MIN_ZOOM,
      EDITOR_MAX_ZOOM,
    );
    cx.notify();
  }

  pub fn editor_pinch(&mut self, ev: &PinchEvent, cx: &mut Context<Self>) {
    let (sx, sy) = self.stage_point(ev.position);
    let v = self.ui.editor_view;
    let z = sequence_core::desk::clamp(v.zoom * (1.0 + f64::from(ev.delta)), EDITOR_MIN_ZOOM, EDITOR_MAX_ZOOM);
    self.ui.editor_view = v.zoomed_around(z, sx, sy);
    cx.notify();
  }

  pub fn sidebar_scroll(&mut self, ev: &ScrollEvent, cx: &mut Context<Self>) {
    let d = ev.delta.pixel_delta(px(16.0));
    self.ui.sidebar_scroll = (self.ui.sidebar_scroll - f64::from(d.y)).max(0.0);
    // The count shows while scrolling, and goes a moment after.
    self.ui.sidebar_scrolled = Some(std::time::Instant::now());
    cx.spawn(async move |this, cx| {
      cx.background_executor().timer(crate::views::sidebar::COUNT_SHOWN).await;
      let _ = this.update(cx, |_, cx| cx.notify());
    })
    .detach();
    cx.notify();
  }

  /// The sidebar's columns, as chosen (saved once the slider's let go).
  pub fn set_columns(&mut self, n: usize, cx: &mut Context<Self>) {
    if self.prefs.sidebar_columns != n {
      self.prefs.sidebar_columns = n;
      cx.notify();
    }
  }

  // Pages and modes.

  pub fn open_editor(&mut self, id: SpreadId, cx: &mut Context<Self>) {
    self.ui.editing = Some(id);
    self.ui.editor_selected = None;
    self.ui.editor_view = FITTED;
    self.ui.page = Page::Desk;
    cx.notify();
  }

  pub fn close_editor(&mut self, cx: &mut Context<Self>) {
    self.ui.editing = None;
    self.ui.editor_selected = None;
    cx.notify();
  }

  /// Move the editor to the spread `delta` along.
  pub fn editor_go(&mut self, delta: isize, cx: &mut Context<Self>) {
    let Some(cur) = self.ui.editing.clone() else { return };
    let all: Vec<SpreadId> = self.project().layout.all().iter().map(|s| s.id.clone()).collect();
    let Some(i) = all.iter().position(|s| s == &cur) else {
      return;
    };
    let j = i as isize + delta;
    if j >= 0 && (j as usize) < all.len() {
      self.open_editor(all[j as usize].clone(), cx);
    }
  }
}
