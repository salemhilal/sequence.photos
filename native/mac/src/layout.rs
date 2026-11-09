//! The Layout view's state and what it does (`LayoutEditor.tsx`, `LayoutPanel.tsx`,
//! `PageSettings.tsx`): the Page tab edits a draft of the page's settings, applied as one
//! step; the Guides tab's changes apply at once. Guides are dragged out of the rulers, moved,
//! or dragged off the page to remove them.

use gpui_kit::*;
use sequence_core::geometry::{Rect, clamp_border, edges_of, line_at, side_at};
use sequence_core::page_setup::{PageDraft, prints_at};
use sequence_core::units::units;
use sequence_core::{Axis, BorderGuide, BorderShape, GuideId, LineGuide, Unit};

use crate::fields::{Field, parse_number};
use crate::workspace::{Drag, Workspace};

/// The Layout view's tabs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LayoutTab {
  Page,
  Guides,
}

/// A guide picked on the page or in the panel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GuideSel {
  Line(GuideId),
  Border(GuideId),
  Center(Axis),
}

/// The Layout view, while it's open.
#[derive(Clone, Debug)]
pub struct LayoutState {
  pub tab: LayoutTab,
  /// The Page tab's draft, and the project's settings it started from (a change to those
  /// some other way, like undo, starts it over).
  pub draft: PageDraft,
  pub draft_for: PageDraft,
  pub selected: Option<GuideSel>,
  /// The spread previewed while the Page tab shows the pages as Apply would leave them.
  pub preview_index: usize,
  /// The preset list, open.
  pub presets_open: bool,
}

/// Where the Layout view's stage drew the pages, for dragging guides.
#[derive(Clone, Copy, Debug)]
pub struct LayoutFrame {
  /// Pixels per unit, and the spread's x = 0, y = 0, in window pixels.
  pub scale: f64,
  pub origin: (f64, f64),
  pub ruler_top: Rect,
  pub ruler_left: Rect,
}

/// A guide being dragged: out of a ruler (new), or one already there.
#[derive(Clone, Debug)]
pub struct GuideDrag {
  pub axis: Axis,
  pub id: GuideId,
  pub existing: bool,
  pub start: (f64, f64),
  pub moved: bool,
}

impl Workspace {
  pub fn open_layout(&mut self, cx: &mut Context<Self>) {
    self.finish_crop(true, cx);
    let d = PageDraft::of(self.project());
    self.ui.layout = Some(LayoutState {
      tab: LayoutTab::Page,
      draft: d,
      draft_for: d,
      selected: None,
      preview_index: 0,
      presets_open: false,
    });
    cx.notify();
  }

  /// Whether the Page tab has changes waiting for Apply.
  pub fn layout_pending(&self) -> bool {
    self
      .ui
      .layout
      .as_ref()
      .is_some_and(|l| !l.draft.same(&PageDraft::of(self.project())))
  }

  /// Close Layout, asking first about page changes waiting for Apply; then `then`.
  pub fn close_layout(
    &mut self,
    window: &mut Window,
    cx: &mut Context<Self>,
    then: impl FnOnce(&mut Self, &mut Context<Self>) + 'static,
  ) {
    self.settle_page(window, cx, move |ws, cx| {
      ws.ui.layout = None;
      ws.frames.layout = None;
      then(ws, cx);
      cx.notify();
    });
  }

  /// Page changes waiting for Apply: ask whether to apply or discard them, then go on (or
  /// not, on Cancel).
  pub fn settle_page(
    &mut self,
    window: &mut Window,
    cx: &mut Context<Self>,
    then: impl FnOnce(&mut Self, &mut Context<Self>) + 'static,
  ) {
    if !self.layout_pending() {
      then(self, cx);
      return;
    }
    let answer = window.prompt(
      PromptLevel::Info,
      "Apply the page changes?",
      Some("Your changes on the Page tab haven’t been applied yet."),
      &["Apply", "Discard", "Cancel"],
      cx,
    );
    cx.spawn(async move |this, cx| {
      let Ok(choice) = answer.await else { return };
      let _ = this.update(cx, |ws, cx| match choice {
        0 => {
          ws.apply_page(cx);
          then(ws, cx);
        }
        1 => {
          ws.revert_page(cx);
          then(ws, cx);
        }
        _ => {}
      });
    })
    .detach();
  }

  /// Change the Page tab's draft.
  pub fn set_draft(&mut self, cx: &mut Context<Self>, f: impl FnOnce(&mut PageDraft, &sequence_core::Project)) {
    let project = self.history.project().clone();
    if let Some(l) = &mut self.ui.layout {
      f(&mut l.draft, &project);
      l.presets_open = false;
    }
    cx.notify();
  }

  /// Apply the Page tab's draft as one step.
  pub fn apply_page(&mut self, cx: &mut Context<Self>) {
    let Some(draft) = self.ui.layout.as_ref().map(|l| l.draft) else {
      return;
    };
    let before = self.project().clone();
    let Some(next) = self.page_run.apply(&before, &draft) else {
      return;
    };
    self.history.replace(next);
    let after = self.project().clone();
    self.page_run.recorded(&before, &after);
    if let Some(l) = &mut self.ui.layout {
      l.draft_for = PageDraft::of(&after);
      l.draft = l.draft_for;
    }
    self.changed(cx);
  }

  pub fn revert_page(&mut self, cx: &mut Context<Self>) {
    let d = PageDraft::of(self.project());
    if let Some(l) = &mut self.ui.layout {
      l.draft = d;
      l.draft_for = d;
    }
    cx.notify();
  }

  /// Switch tabs; going to Guides asks about page changes first.
  pub fn layout_tab(&mut self, tab: LayoutTab, window: &mut Window, cx: &mut Context<Self>) {
    let go = move |ws: &mut Self, cx: &mut Context<Self>| {
      if let Some(l) = &mut ws.ui.layout {
        l.tab = tab;
        l.selected = None;
      }
      cx.notify();
    };
    if tab == LayoutTab::Page {
      go(self, cx);
    } else {
      self.settle_page(window, cx, go);
    }
  }

  pub fn select_guide(&mut self, sel: Option<GuideSel>, cx: &mut Context<Self>) {
    if let Some(l) = &mut self.ui.layout {
      l.selected = sel;
    }
    cx.notify();
  }

  /// Esc in Layout: deselect a guide, then close.
  pub fn layout_escape(&mut self, window: &mut Window, cx: &mut Context<Self>) {
    if self.cancel_drag(cx) {
      return;
    }
    if let Some(l) = &mut self.ui.layout {
      if l.presets_open {
        l.presets_open = false;
        cx.notify();
        return;
      }
      if l.selected.take().is_some() {
        cx.notify();
        return;
      }
    }
    self.close_layout(window, cx, |_, _| {});
  }

  /// Remove a guide (center lines are switched off in the panel instead).
  pub fn remove_guide(&mut self, sel: &GuideSel, cx: &mut Context<Self>) {
    match sel {
      GuideSel::Center(_) => return,
      GuideSel::Line(id) => self.apply(cx, |d| d.settings.lines.retain(|l| &l.id != id)),
      GuideSel::Border(id) => self.apply(cx, |d| {
        d.settings.borders.retain(|b| &b.id != id);
        // Photos fit the largest remaining guide instead.
        if d.settings.drop_border.as_ref() == Some(id) {
          d.settings.drop_border = None;
        }
      }),
    }
    self.select_guide(None, cx);
  }

  pub fn remove_selected_guide(&mut self, cx: &mut Context<Self>) {
    if let Some(sel) = self.ui.layout.as_ref().and_then(|l| l.selected.clone()) {
      self.remove_guide(&sel, cx);
    }
  }

  /// A new line guide, a third of the way across (or down) the page.
  pub fn add_line(&mut self, axis: Axis, cx: &mut Context<Self>) {
    let s = self.project().sheet();
    let u = units(s.unit);
    let size = if axis == Axis::Vertical { s.page_w } else { s.page_h };
    let id = GuideId::new();
    let at = (size / 3.0 / u.snap).round() * u.snap;
    let g = LineGuide {
      id: id.clone(),
      axis,
      at,
    };
    self.apply(cx, |d| d.settings.lines.push(g));
    self.select_guide(Some(GuideSel::Line(id)), cx);
  }

  /// A new border guide, a step inside the last one.
  pub fn add_border(&mut self, cx: &mut Context<Self>) {
    let s = self.project().sheet();
    let u = units(s.unit);
    let id = GuideId::new();
    let inset = s.borders.last().map_or(u.guide_step, |b| edges_of(b).top) + u.guide_step;
    let mut b = BorderGuide {
      id: id.clone(),
      shape: BorderShape::Even { inset },
    };
    clamp_border(&mut b, s.unit, s.page_w, s.page_h);
    self.apply(cx, |d| d.settings.borders.push(b));
    self.select_guide(Some(GuideSel::Border(id)), cx);
  }

  pub fn set_center(&mut self, axis: Axis, on: bool, cx: &mut Context<Self>) {
    self.apply(cx, |d| match axis {
      Axis::Vertical => d.settings.center_v = on,
      Axis::Horizontal => d.settings.center_h = on,
    });
  }

  /// Change a border guide, kept on the page.
  fn update_border(
    &mut self,
    id: &GuideId,
    key: Option<String>,
    cx: &mut Context<Self>,
    f: impl FnOnce(&mut BorderGuide),
  ) {
    let s = self.project().sheet();
    let recipe = |d: &mut sequence_core::Project| {
      if let Some(b) = d.settings.borders.iter_mut().find(|b| &b.id == id) {
        f(b);
        clamp_border(b, s.unit, s.page_w, s.page_h);
      }
    };
    match key {
      Some(k) => self.apply_coalesced(&k, cx, recipe),
      None => self.apply(cx, recipe),
    }
  }

  /// Unlinking keeps the distance on every edge; linking gives all four the top's.
  pub fn toggle_linked(&mut self, id: &GuideId, cx: &mut Context<Self>) {
    self.update_border(id, None, cx, |b| {
      b.shape = match b.shape {
        BorderShape::Even { .. } => BorderShape::Edges(edges_of(b)),
        BorderShape::Edges(e) => BorderShape::Even { inset: e.top },
      };
    });
  }

  pub fn set_drop_border(&mut self, id: &GuideId, cx: &mut Context<Self>) {
    let id = id.clone();
    self.apply(cx, |d| d.settings.drop_border = Some(id));
  }

  /// A number field's value, typed and committed.
  pub fn field_committed(&mut self, field: Field, text: &str, _window: &mut Window, cx: &mut Context<Self>) {
    let Some(n) = parse_number(text) else {
      cx.notify();
      return;
    };
    match field {
      Field::PageW | Field::PageH => self.set_draft(cx, |d, _| {
        let u = units(d.page.unit);
        let v = u.round(n).max(u.min_size);
        if field == Field::PageW {
          d.page.w = v;
        } else {
          d.page.h = v;
        }
      }),
      Field::Dpi => {
        let base = self.page_run.base(self.history.project()).clone();
        self.set_draft(cx, |d, project| *d = d.with_dpi(&base, project, n.round().max(1.0)));
      }
      Field::Border(id, edge) => {
        let u = units(self.project().page.unit);
        let v = u.round(n).max(0.0);
        let key = format!("border:{id}:{edge}");
        self.update_border(&id, Some(key), cx, |b| match &mut b.shape {
          BorderShape::Even { inset } => *inset = v,
          BorderShape::Edges(e) => match edge {
            0 => e.top = v,
            1 => e.bottom = v,
            2 => e.inside = v,
            _ => e.outside = v,
          },
        });
      }
      Field::ExportDpi | Field::PrintAt => self.export_field(&field, n, cx),
      Field::Line(id) => {
        let s = self.project().sheet();
        let u = units(s.unit);
        let key = format!("line:{id}");
        self.apply_coalesced(&key, cx, |d| {
          if let Some(l) = d.settings.lines.iter_mut().find(|l| l.id == id) {
            let size = if l.axis == Axis::Vertical { s.page_w } else { s.page_h };
            l.at = u.round(n).max(0.0).min(size - u.nudge);
          }
        });
      }
    }
  }

  /// The draft in another unit.
  pub fn set_draft_unit(&mut self, unit: Unit, cx: &mut Context<Self>) {
    let base = self.page_run.base(self.history.project()).clone();
    self.set_draft(cx, |d, _| *d = d.with_unit(&base, unit));
  }

  /// The dpi field's label: what the dpi does.
  pub fn dpi_label(&self) -> &'static str {
    match &self.ui.layout {
      Some(l) if prints_at(self.project(), &l.draft) => "Print at",
      _ => "Resolution",
    }
  }

  /// Flip through the previewed spreads.
  pub fn layout_go(&mut self, delta: isize, cx: &mut Context<Self>) {
    if let Some(l) = &mut self.ui.layout {
      l.preview_index = l.preview_index.saturating_add_signed(delta);
    }
    cx.notify();
  }

  // Dragging guides.

  /// A press on a ruler (a new guide) or a guide from the rulers.
  pub fn guide_down(&mut self, axis: Axis, existing: Option<GuideId>, ev: &MouseDownEvent, cx: &mut Context<Self>) {
    if ev.button != MouseButton::Left {
      return;
    }
    let is_existing = existing.is_some();
    self.drag = Some(Drag::Guide(GuideDrag {
      axis,
      id: existing.unwrap_or_default(),
      existing: is_existing,
      start: (f64::from(ev.position.x), f64::from(ev.position.y)),
      moved: false,
    }));
    cx.notify();
  }

  /// The guide where the pointer is, or none over a ruler or off the page (to remove it).
  fn guide_at(&self, g: &GuideDrag, at: (f64, f64), shift: bool) -> Option<LineGuide> {
    let f = self.frames.layout?;
    let s = self.project().sheet();
    let u = units(s.unit);
    let x = (at.0 - f.origin.0) / f.scale;
    let y = (at.1 - f.origin.1) / f.scale;
    let mut v = match g.axis {
      Axis::Horizontal => y,
      Axis::Vertical => line_at(side_at(&s, x), &s, Axis::Vertical, x),
    };
    if shift {
      v = (v / u.snap).round() * u.snap;
    }
    let over_ruler = match g.axis {
      Axis::Horizontal => at.1 < f.ruler_top.y + f.ruler_top.h,
      Axis::Vertical => at.0 < f.ruler_left.x + f.ruler_left.w,
    };
    let size = if g.axis == Axis::Horizontal { s.page_h } else { s.page_w };
    (!over_ruler && v > 0.0 && v < size).then(|| LineGuide {
      id: g.id.clone(),
      axis: g.axis,
      at: u.round(v),
    })
  }

  /// A guide drag moved to `at`.
  pub fn guide_drag(&mut self, g: &mut GuideDrag, at: (f64, f64), mods: Modifiers) {
    if !g.moved {
      if (at.0 - g.start.0).hypot(at.1 - g.start.1) < 3.0 {
        return;
      }
      g.moved = true;
      self.history.begin();
    }
    let line = self.guide_at(g, at, mods.shift);
    let s = self.project().sheet();
    let u = units(s.unit);
    let from = match g.axis {
      Axis::Horizontal => "top".to_string(),
      Axis::Vertical => sequence_core::units::terms(s.arrangement).edges[3].to_lowercase(),
    };
    self.ui.guide_label = Some((
      match &line {
        Some(l) => format!("{} {} from {from}", u.format(l.at), u.suffix),
        None => "Remove".into(),
      },
      at.0,
      at.1,
    ));
    let (id, existing) = (g.id.clone(), g.existing);
    self.history.preview(|d| {
      let lines = &mut d.settings.lines;
      if existing {
        match line {
          Some(l) => {
            if let Some(x) = lines.iter_mut().find(|x| x.id == id) {
              *x = l;
            }
          }
          None => lines.retain(|x| x.id != id),
        }
      } else if let Some(l) = line {
        lines.push(l);
      }
    });
  }

  /// A guide drag let go at `at`.
  pub fn guide_up(&mut self, g: GuideDrag, at: (f64, f64), mods: Modifiers, cx: &mut Context<Self>) {
    self.ui.guide_label = None;
    if !g.moved {
      if g.existing {
        self.select_guide(Some(GuideSel::Line(g.id)), cx);
      }
      return;
    }
    let placed = self.guide_at(&g, at, mods.shift).is_some();
    self.history.end();
    self.select_guide(placed.then_some(GuideSel::Line(g.id)), cx);
    self.changed(cx);
  }
}
