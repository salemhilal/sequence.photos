//! The Layout view (`LayoutEditor.tsx`, `LayoutPanel.tsx`, `PageSettings.tsx`, `Ruler.tsx`):
//! an empty spread (or frame) with rulers along the top and left and its guides on it, and
//! the settings beside it in two tabs. While the Page tab is open (or has changes waiting),
//! the stage previews the project as Apply would leave it.

use std::rc::Rc;

use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::geometry::{
  Rect, edges_of, line_on_page, line_position, page_rect, page_sides, spread_left, spread_width,
};
use sequence_core::page_setup::{Anchor, Content, PageDraft, resizes};
use sequence_core::resolution::{placed_soft, soft_photos, soft_sentence};
use sequence_core::units::{PRESETS, terms, units};
use sequence_core::{Arrangement, Axis, BorderShape, PageSide, Spread, SpreadKind, Unit};

use super::controls::{self, check, field_row, help, radio};
use super::paint::{SpreadPicture, boxed, x};
use super::{icon_button, text_button};
use crate::assets::{MONO, icon};
use crate::fields::Field;
use crate::layout::{GuideSel, LayoutFrame, LayoutState, LayoutTab};
use crate::theme::Theme;
use crate::workspace::Workspace;

const MARGIN: f64 = 24.0;
const HEADER_H: f64 = 36.0;
const PANEL_W: f64 = 280.0;
const RULER: f64 = 20.0;
/// Room around the pages, as a share of a page's width.
const PAD_SHARE: f64 = 0.05;
/// A guide's grab band, in pixels.
const BAND: f64 = 7.0;

type Handler<T> = Rc<dyn Fn(&mut Workspace, T, &mut Window, &mut Context<Workspace>)>;

/// A row of choices, one on, whose handler gets the workspace.
fn segmented<T: Copy + PartialEq + 'static>(
  id: &'static str,
  options: &[(T, &'static str)],
  value: T,
  theme: &Theme,
  on: Handler<T>,
  cx: &mut Context<Workspace>,
) -> Div {
  let ws = cx.entity().downgrade();
  controls::segmented(id, options, value, theme, move |v, window, cx| {
    let _ = ws.update(cx, |ws, cx| on(ws, v, window, cx));
  })
}

/// A ruler's markings: the finest ticks that stay a few pixels apart, numbered at the
/// smallest interval that leaves room.
fn ruler_steps(unit: Unit, scale: f64) -> (f64, f64) {
  let (ticks, numbers, room): (&[f64], &[f64], f64) = match unit {
    Unit::In => (&[0.125, 0.25, 0.5, 1.0], &[1.0, 2.0, 5.0], 16.0),
    Unit::Px => (
      &[10.0, 25.0, 50.0, 100.0, 250.0],
      &[50.0, 100.0, 250.0, 500.0, 1000.0],
      36.0,
    ),
  };
  let every = numbers
    .iter()
    .copied()
    .find(|n| n * scale >= room)
    .unwrap_or(numbers[numbers.len() - 1]);
  let minor = ticks
    .iter()
    .copied()
    .find(|t| t * scale >= 6.0 && (every % t) < 1e-9)
    .unwrap_or(every);
  (minor, every)
}

/// Whether `d` is a whole number of `step`s.
fn on_step(d: f64, step: f64) -> bool {
  (d / step - (d / step).round()).abs() < 1e-9
}

impl Workspace {
  pub fn render_layout(&mut self, theme: &Theme, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
    let mut st = self.ui.layout.clone()?;
    // A change to the page some other way (undo) starts the draft over.
    let current = PageDraft::of(self.project());
    if current != st.draft_for {
      st.draft = current;
      st.draft_for = current;
    }
    let main = self.frames.main;
    let panel = Rect::new(MARGIN, MARGIN, main.w - 2.0 * MARGIN, main.h - 2.0 * MARGIN);
    let stage_local = Rect::new(0.0, HEADER_H, panel.w - PANEL_W, panel.h - HEADER_H);
    let stage = Rect::new(
      panel.x + stage_local.x,
      main.y + panel.y + stage_local.y,
      stage_local.w,
      stage_local.h,
    );
    let pending = !st.draft.same(&current);
    let previewing = st.tab == LayoutTab::Page || pending;

    let stage_el = if previewing {
      self.frames.layout = None;
      self.render_layout_preview(&mut st, stage, theme, cx)
    } else {
      self.render_guides_stage(&st, stage, theme, cx)
    };
    let inspector = match st.tab {
      LayoutTab::Page => self.render_page_tab(&st, pending, theme, window, cx),
      LayoutTab::Guides => self.render_guides_tab(&st, theme, window, cx),
    };
    self.ui.layout = Some(st);

    let header = div()
      .flex()
      .items_center()
      .h(x(HEADER_H))
      .px(px(12.0))
      .border_b_1()
      .border_color(theme.divider)
      .child(div().font_weight(FontWeight::SEMIBOLD).child("Layout"))
      .child(div().flex_1())
      .child(icon_button("layout-close", "x", theme, true, false, {
        let t = cx.entity().downgrade();
        move |_, window, cx| {
          let _ = t.update(cx, |ws, cx| ws.close_layout(window, cx, |_, _| {}));
        }
      }));
    let body = div()
      .absolute()
      .left_0()
      .top(x(HEADER_H))
      .w_full()
      .h(x(panel.h - HEADER_H))
      .child(
        div()
          .absolute()
          .left_0()
          .top_0()
          .w(x(stage_local.w))
          .h_full()
          .overflow_hidden()
          .child(stage_el),
      )
      .child(
        div()
          .id("layout-panel")
          .absolute()
          .right_0()
          .top_0()
          .w(x(PANEL_W))
          .h_full()
          .border_l_1()
          .border_color(theme.divider)
          .overflow_y_scroll()
          .child(inspector),
      );
    let modal = boxed(panel)
      .id("layout")
      .bg(theme.panel)
      .border_1()
      .border_color(theme.border_strong)
      .rounded(px(8.0))
      .shadow_lg()
      .overflow_hidden()
      .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
      .child(header)
      .child(body);
    Some(
      div()
        .id("layout-backdrop")
        .absolute()
        .size_full()
        .bg(hsla(0.0, 0.0, 0.0, 0.25))
        .on_mouse_down(
          MouseButton::Left,
          cx.listener(|ws, _, window, cx| ws.close_layout(window, cx, |_, _| {})),
        )
        .child(modal)
        .into_any_element(),
    )
  }

  /// The project as Apply would leave it: a spread at a time, with its photos.
  fn render_layout_preview(
    &mut self,
    st: &mut LayoutState,
    stage: Rect,
    theme: &Theme,
    cx: &mut Context<Self>,
  ) -> AnyElement {
    let project = self.page_run.preview(self.history.project(), &st.draft);
    let sheet = project.sheet();
    let all = project.layout.all();
    let total = all.len();
    st.preview_index = st.preview_index.min(total.saturating_sub(1));
    let Some(spread) = all.get(st.preview_index).copied() else {
      return div().into_any_element();
    };
    let pager_h = 44.0;
    let margin = 28.0;
    let pw = spread_width(spread.kind, &sheet);
    let scale = ((stage.w - 2.0 * margin) / pw).min((stage.h - 2.0 * margin - pager_h) / sheet.page_h);
    let (w, h) = (pw * scale, sheet.page_h * scale);
    let left = (stage.w - w) / 2.0;
    let top = (stage.h - pager_h - h) / 2.0;
    let pic = SpreadPicture {
      spread,
      sheet: &sheet,
      scale,
      origin: (left - spread_left(spread.kind, &sheet) * scale, top),
      clip: true,
    };
    let mut el = div().absolute().size_full().bg(Hsla::from(rgb(self.prefs.desk_color)));
    for p in pic.page_elements(theme, None) {
      el = el.child(p);
    }
    el = el.child(pic.photo_elements(&mut self.lib, &project, theme));
    for p in &spread.items {
      if placed_soft(project.photos.get(&p.photo_id), p, sheet.px_per_unit) {
        el = el.child(super::paint::soft_badge(pic.at(Rect::from(p)), theme));
      }
    }
    el = el.child(pic.outline(theme));
    let noun = terms(sheet.arrangement).spread;
    let i = st.preview_index;
    let light = self.desk_light();
    // With no changes waiting, this is the project as it is: photos are soft, not would be.
    let soft = soft_photos(&project, None).len();
    if soft > 0 {
      let changed = st.draft != sequence_core::page_setup::PageDraft::of(self.project());
      el = el.child(
        div()
          .absolute()
          .left_0()
          .right_0()
          .bottom(px(48.0))
          .flex()
          .justify_center()
          .text_size(px(11.0))
          .text_color(theme.warn)
          .child(soft_sentence(soft, sheet.unit, sheet.px_per_unit, changed)),
      );
    }
    el.child(
      div()
        .absolute()
        .left_0()
        .right_0()
        .bottom(px(12.0))
        .flex()
        .justify_center()
        .items_center()
        .gap(px(6.0))
        .text_color(if light { theme.text } else { rgb(0xeeeeee).into() })
        .child(icon_button("layout-prev", "chevron-left", theme, i > 0, false, {
          let t = cx.entity().downgrade();
          move |_, _, cx| {
            let _ = t.update(cx, |ws, cx| ws.layout_go(-1, cx));
          }
        }))
        .child(format!("{} {} of {total}", capitalize(noun), i + 1))
        .child(icon_button(
          "layout-next",
          "chevron-right",
          theme,
          i + 1 < total,
          false,
          {
            let t = cx.entity().downgrade();
            move |_, _, cx| {
              let _ = t.update(cx, |ws, cx| ws.layout_go(1, cx));
            }
          },
        )),
    )
    .into_any_element()
  }

  /// The empty pages with their guides, and the rulers to drag new ones from.
  fn render_guides_stage(
    &mut self,
    st: &LayoutState,
    stage: Rect,
    theme: &Theme,
    cx: &mut Context<Self>,
  ) -> AnyElement {
    let s = self.project().sheet();
    let sample = Spread::empty(if s.arrangement == Arrangement::Spreads {
      SpreadKind::Middle
    } else {
      SpreadKind::Frame
    });
    let sides = page_sides(sample.kind);
    let pad = s.page_w * PAD_SHARE;
    let extent_left = spread_left(sample.kind, &s);
    let across = spread_width(sample.kind, &s);
    let scale = ((stage.w - RULER) / (across + 2.0 * pad)).min((stage.h - RULER) / (s.page_h + 2.0 * pad));
    let left = RULER + ((stage.w - RULER - (across + 2.0 * pad) * scale) / 2.0).max(0.0);
    let top = RULER + ((stage.h - RULER - (s.page_h + 2.0 * pad) * scale) / 2.0).max(0.0);
    let gutter_x = left + (pad - extent_left) * scale;
    let page_top = top + pad * scale;
    self.frames.layout = Some(LayoutFrame {
      scale,
      origin: (stage.x + gutter_x, stage.y + page_top),
      ruler_top: Rect::new(stage.x, stage.y, stage.w, RULER),
      ruler_left: Rect::new(stage.x, stage.y, RULER, stage.h),
    });

    let mut el = div()
      .id("layout-stage")
      .absolute()
      .size_full()
      .bg(Hsla::from(rgb(self.prefs.desk_color)))
      .on_mouse_down(MouseButton::Left, cx.listener(|ws, _, _, cx| ws.select_guide(None, cx)));
    let pic = SpreadPicture {
      spread: &sample,
      sheet: &s,
      scale,
      origin: (gutter_x, page_top),
      clip: false,
    };
    for p in pic.page_elements(theme, None) {
      el = el.child(p);
    }
    el = el.child(pic.outline(theme));

    // Every guide: center lines, border guides, and guides from the rulers.
    let selected = st.selected.clone();
    let mut guides: Vec<(String, Axis, f64, GuideSel, Option<PageSide>)> = Vec::new();
    if s.center_v {
      for &side in sides {
        let p = page_rect(side, &s);
        guides.push((
          format!("cv-{side:?}"),
          Axis::Vertical,
          p.x + p.w / 2.0,
          GuideSel::Center(Axis::Vertical),
          Some(side),
        ));
      }
    }
    if s.center_h {
      guides.push((
        "ch".into(),
        Axis::Horizontal,
        s.page_h / 2.0,
        GuideSel::Center(Axis::Horizontal),
        None,
      ));
    }
    for b in &s.borders {
      let e = edges_of(b);
      for &side in sides {
        let p = page_rect(side, &s);
        let (l, r) = if side == PageSide::Right {
          (e.inside, e.outside)
        } else {
          (e.outside, e.inside)
        };
        let sel = GuideSel::Border(b.id.clone());
        guides.push((
          format!("{}-{side:?}-l", b.id),
          Axis::Vertical,
          p.x + l,
          sel.clone(),
          Some(side),
        ));
        guides.push((
          format!("{}-{side:?}-r", b.id),
          Axis::Vertical,
          p.x + p.w - r,
          sel.clone(),
          Some(side),
        ));
        guides.push((
          format!("{}-{side:?}-t", b.id),
          Axis::Horizontal,
          e.top,
          sel.clone(),
          Some(side),
        ));
        guides.push((
          format!("{}-{side:?}-b", b.id),
          Axis::Horizontal,
          s.page_h - e.bottom,
          sel,
          Some(side),
        ));
      }
    }
    for l in s.lines.iter().filter(|l| line_on_page(&s, l)) {
      let sel = GuideSel::Line(l.id.clone());
      if l.axis == Axis::Horizontal {
        guides.push((l.id.to_string(), Axis::Horizontal, l.at, sel, None));
      } else {
        for &side in sides {
          guides.push((
            format!("{}-{side:?}", l.id),
            Axis::Vertical,
            line_position(side, &s, l),
            sel.clone(),
            Some(side),
          ));
        }
      }
    }
    for (key, axis, at, sel, side) in guides {
      let (px0, pw) = match side {
        Some(sd) => {
          let p = page_rect(sd, &s);
          (p.x, p.w)
        }
        None => (extent_left, across),
      };
      let on = selected.as_ref() == Some(&sel);
      let color = if on {
        theme.accent
      } else if matches!(sel, GuideSel::Center(_)) {
        theme.guide_center
      } else {
        theme.guide
      };
      let (line, band) = match axis {
        Axis::Horizontal => {
          let y = page_top + at * scale;
          let r = Rect::new(gutter_x + px0 * scale, y, pw * scale, 1.0);
          (r, Rect::new(r.x, y - BAND / 2.0, r.w, BAND))
        }
        Axis::Vertical => {
          let xx = gutter_x + at * scale;
          let r = Rect::new(xx, page_top, 1.0, s.page_h * scale);
          (r, Rect::new(xx - BAND / 2.0, r.y, BAND, r.h))
        }
      };
      el = el.child(boxed(line).bg(color).when(on, |d| match axis {
        Axis::Horizontal => d.h(px(2.0)),
        Axis::Vertical => d.w(px(2.0)),
      }));
      let cursor = match (&sel, axis) {
        (GuideSel::Line(_), Axis::Horizontal) => CursorStyle::ResizeUpDown,
        (GuideSel::Line(_), Axis::Vertical) => CursorStyle::ResizeLeftRight,
        _ => CursorStyle::PointingHand,
      };
      el = el.child(
        div()
          .id(SharedString::from(format!("guide-{key}")))
          .absolute()
          .left(x(band.x))
          .top(x(band.y))
          .w(x(band.w))
          .h(x(band.h))
          .cursor(cursor)
          .on_mouse_down(
            MouseButton::Left,
            cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
              cx.stop_propagation();
              match &sel {
                GuideSel::Line(id) => ws.guide_down(axis, Some(id.clone()), ev, cx),
                other => ws.select_guide(Some(other.clone()), cx),
              }
            }),
          ),
      );
    }

    // The rulers: each page measured from its outside edge (meeting at the gutter) along
    // the top, from the top down the left.
    let (minor, every) = ruler_steps(s.unit, scale);
    let tick = theme.muted;
    let mut top_ruler = div()
      .id("ruler-top")
      .absolute()
      .left_0()
      .top_0()
      .w(x(stage.w))
      .h(x(RULER))
      .bg(theme.header)
      .border_b_1()
      .border_color(theme.divider)
      .cursor(CursorStyle::ResizeUpDown)
      .on_mouse_down(
        MouseButton::Left,
        cx.listener(|ws, ev: &MouseDownEvent, _, cx| {
          cx.stop_propagation();
          ws.guide_down(Axis::Horizontal, None, ev, cx);
        }),
      );
    let mirrored = s.arrangement == Arrangement::Spreads;
    let zeros: Vec<(f64, f64)> = if mirrored {
      vec![(gutter_x - s.page_w * scale, 1.0), (gutter_x + s.page_w * scale, -1.0)]
    } else {
      vec![(gutter_x, 1.0)]
    };
    for (zero, dir) in zeros {
      let mut i = 0;
      while f64::from(i) * minor <= s.page_w + 1e-9 {
        let d = f64::from(i) * minor;
        let at = zero + dir * d * scale;
        let numbered = on_step(d, every);
        let len = if numbered {
          RULER * 0.55
        } else if on_step(d, every / 2.0) {
          RULER * 0.35
        } else {
          RULER * 0.2
        };
        top_ruler = top_ruler.child(boxed(Rect::new(at, RULER - len, 1.0, len)).bg(tick));
        if numbered && !(mirrored && (d - s.page_w).abs() < 1e-9) {
          let label = format_tick(d);
          let lx = if dir > 0.0 {
            at + 3.0
          } else {
            at - 3.0 - 7.0 * label.len() as f64
          };
          top_ruler = top_ruler.child(
            div()
              .absolute()
              .left(x(lx))
              .top(px(1.0))
              .text_size(px(9.0))
              .font_family(MONO)
              .text_color(tick)
              .child(label),
          );
        }
        i += 1;
      }
    }
    let mut left_ruler = div()
      .id("ruler-left")
      .absolute()
      .left_0()
      .top_0()
      .w(x(RULER))
      .h(x(stage.h))
      .bg(theme.header)
      .border_r_1()
      .border_color(theme.divider)
      .cursor(CursorStyle::ResizeLeftRight)
      .on_mouse_down(
        MouseButton::Left,
        cx.listener(|ws, ev: &MouseDownEvent, _, cx| {
          cx.stop_propagation();
          ws.guide_down(Axis::Vertical, None, ev, cx);
        }),
      );
    let mut i = 0;
    while f64::from(i) * minor <= s.page_h + 1e-9 {
      let d = f64::from(i) * minor;
      let at = page_top + d * scale;
      let numbered = on_step(d, every);
      let len = if numbered {
        RULER * 0.55
      } else if on_step(d, every / 2.0) {
        RULER * 0.35
      } else {
        RULER * 0.2
      };
      left_ruler = left_ruler.child(boxed(Rect::new(RULER - len, at, len, 1.0)).bg(tick));
      if numbered {
        left_ruler = left_ruler.child(
          div()
            .absolute()
            .left(px(2.0))
            .top(x(at + 1.0))
            .text_size(px(9.0))
            .font_family(MONO)
            .text_color(tick)
            .child(format_tick(d)),
        );
      }
      i += 1;
    }
    el = el.child(top_ruler).child(left_ruler).child(
      boxed(Rect::new(0.0, 0.0, RULER, RULER))
        .bg(theme.header)
        .border_r_1()
        .border_b_1()
        .border_color(theme.divider),
    );
    if let Some((text, gx, gy)) = self.ui.guide_label.clone() {
      el = el.child(
        div()
          .absolute()
          .left(x(gx - stage.x + 14.0))
          .top(x(gy - stage.y + 14.0))
          .px(px(6.0))
          .py(px(2.0))
          .rounded(px(3.0))
          .bg(theme.panel)
          .border_1()
          .border_color(theme.border)
          .font_family(MONO)
          .text_size(px(11.0))
          .child(text),
      );
    }
    el.into_any_element()
  }

  fn render_tabs(&mut self, st: &LayoutState, theme: &Theme, cx: &mut Context<Self>) -> Div {
    segmented(
      "layout-tab",
      &[(LayoutTab::Page, "Page"), (LayoutTab::Guides, "Guides")],
      st.tab,
      theme,
      Rc::new(|ws: &mut Workspace, t, window: &mut Window, cx: &mut Context<Workspace>| ws.layout_tab(t, window, cx)),
      cx,
    )
  }

  fn render_page_tab(
    &mut self,
    st: &LayoutState,
    pending: bool,
    theme: &Theme,
    window: &mut Window,
    cx: &mut Context<Self>,
  ) -> AnyElement {
    let d = st.draft;
    let project = self.history.shared();
    let base = self.page_run.base(&project).clone();
    let u = units(d.page.unit);
    let mut col = div()
      .flex()
      .flex_col()
      .gap(px(14.0))
      .p(px(12.0))
      .child(self.render_tabs(st, theme, cx));

    let note = (d.arrangement != project.layout.arrangement()).then(|| {
      if d.arrangement == Arrangement::Frames {
        "Each page becomes a frame."
      } else {
        "Frames pair up into spreads."
      }
    });
    col = col.child(field_row(
      "Pages",
      theme,
      div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(segmented(
          "pages",
          &[(Arrangement::Spreads, "Spreads"), (Arrangement::Frames, "Frames")],
          d.arrangement,
          theme,
          Rc::new(|ws: &mut Workspace, a, _: &mut Window, cx: &mut Context<Workspace>| {
            ws.set_draft(cx, |d, _| d.arrangement = a)
          }),
          cx,
        ))
        .when_some(note, |c, n| c.child(help(n, theme))),
    ));

    // Presets, as a list that opens under its button.
    let preset = d.preset();
    let fmt = |w: f64, h: f64, unit: Unit| {
      let u = units(unit);
      format!("{} × {} {}", u.format(w), u.format(h), u.suffix)
    };
    let mut presets = div().flex().flex_col().gap(px(2.0)).child(
      div()
        .id("preset")
        .flex()
        .items_center()
        .h(px(26.0))
        .px(px(8.0))
        .rounded(px(4.0))
        .bg(theme.control)
        .border_1()
        .border_color(theme.border_strong)
        .child(div().flex_1().child(preset.map_or("Custom", |p| p.label)))
        .child(svg().path(icon("chevron-down")).size(px(14.0)).text_color(theme.muted))
        .on_click(cx.listener(|ws, _, _, cx| {
          if let Some(l) = &mut ws.ui.layout {
            l.presets_open = !l.presets_open;
          }
          cx.notify();
        })),
    );
    if st.presets_open {
      let mut list = div()
        .flex()
        .flex_col()
        .p(px(3.0))
        .rounded(px(4.0))
        .bg(theme.panel)
        .border_1()
        .border_color(theme.border)
        .shadow_md();
      for (i, p) in PRESETS.iter().enumerate() {
        let on = preset.is_some_and(|q| q.label == p.label);
        list = list.child(
          div()
            .id(("preset-item", i))
            .flex()
            .flex_col()
            .px(px(8.0))
            .py(px(4.0))
            .rounded(px(3.0))
            .when(on, |d| d.bg(theme.track))
            .hover(|s| s.bg(theme.hover))
            .child(p.label)
            .child(help(fmt(p.w, p.h, p.unit), theme))
            .on_click(cx.listener(move |ws, _, _, cx| ws.set_draft(cx, |d, _| *d = d.with_preset(p)))),
        );
      }
      presets = presets.child(list);
    }
    col = col.child(field_row("Preset", theme, presets));

    col = col.child(field_row(
      "Unit",
      theme,
      segmented(
        "unit",
        &[(Unit::In, "Inches"), (Unit::Px, "Pixels")],
        d.page.unit,
        theme,
        Rc::new(|ws: &mut Workspace, u, _: &mut Window, cx: &mut Context<Workspace>| ws.set_draft_unit(u, cx)),
        cx,
      ),
    ));

    let w_field = self.number_field(Field::PageW, Some("W"), u.format(d.page.w), true, theme, window, cx);
    let h_field = self.number_field(Field::PageH, Some("H"), u.format(d.page.h), true, theme, window, cx);
    col = col.child(field_row(
      "Size",
      theme,
      div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(w_field)
        .child(h_field)
        .child(div().child(text_button(
          "swap",
          "Swap width and height",
          theme,
          false,
          cx.listener(|ws, _, _, cx| {
            ws.set_draft(cx, |d, _| std::mem::swap(&mut d.page.w, &mut d.page.h));
          }),
        ))),
    ));

    let dpi = if d.page.unit == Unit::In {
      self.number_field(
        Field::Dpi,
        None,
        format!("{}", d.page.px_per_unit),
        true,
        theme,
        window,
        cx,
      )
    } else {
      div()
        .pt(px(4.0))
        .font_family(MONO)
        .child(format!("{}×", d.page.px_per_unit))
        .into_any_element()
    };
    let dpi_label = if d.page.unit == Unit::In {
      format!("{} (dpi)", self.dpi_label())
    } else {
      "Density".to_string()
    };
    col = col.child(field_row(dpi_label, theme, dpi));

    // What photos do when the size changes.
    let matters = pending && resizes(&base, &d);
    let mut content = div().flex().flex_col().gap(px(4.0));
    for (i, (c, label)) in [
      (Content::Rescale, "Rescale with layout"),
      (Content::Fixed, "Keep fixed"),
    ]
    .into_iter()
    .enumerate()
    {
      let mut row = radio(("content", i), label, d.content == c, theme);
      if matters {
        row = row.on_click(cx.listener(move |ws, _, _, cx| ws.set_draft(cx, |d, _| d.content = c)));
      } else {
        row = row.opacity(0.5);
      }
      content = content.child(row);
    }
    if matters && d.content == Content::Fixed {
      let mut anchors = vec![(Anchor::Center, "Center"), (Anchor::TopLeft, "Top left")];
      if d.arrangement == Arrangement::Spreads {
        anchors.push((Anchor::Inside, "Inside edge"));
      }
      content = content.child(help("Relative to", theme)).child(segmented(
        "anchor",
        &anchors,
        d.anchor(),
        theme,
        Rc::new(|ws: &mut Workspace, a, _: &mut Window, cx: &mut Context<Workspace>| {
          ws.set_draft(cx, |d, _| d.anchor = a)
        }),
        cx,
      ));
    }
    content = content.child(help(
      if !matters {
        "Matters when the size changes."
      } else if d.content == Content::Rescale {
        "Photos move and scale with the guides."
      } else {
        "Photos keep their size and place, so their resolution stays the same."
      },
      theme,
    ));
    col = col.child(field_row("Content", theme, content));

    let mut actions = div().flex().gap(px(6.0)).child(
      text_button(
        "apply-page",
        "Apply",
        theme,
        pending,
        cx.listener(|ws, _, _, cx| ws.apply_page(cx)),
      )
      .when(!pending, |b| b.opacity(0.5)),
    );
    if pending {
      actions = actions.child(text_button(
        "revert-page",
        "Revert",
        theme,
        false,
        cx.listener(|ws, _, _, cx| ws.revert_page(cx)),
      ));
    }
    col.child(actions).into_any_element()
  }

  fn render_guides_tab(
    &mut self,
    st: &LayoutState,
    theme: &Theme,
    window: &mut Window,
    cx: &mut Context<Self>,
  ) -> AnyElement {
    let s = self.project().sheet();
    let u = units(s.unit);
    let t = terms(s.arrangement);
    let drop = sequence_core::geometry::drop_guide(&s).map(|g| g.id.clone());
    let selected = st.selected.clone();
    // Forget the fields of guides that are gone.
    let borders: Vec<_> = s.borders.iter().map(|b| b.id.clone()).collect();
    let lines: Vec<_> = s.lines.iter().map(|l| l.id.clone()).collect();
    self.fields.retain(|f| match f {
      Field::Border(id, _) => borders.contains(id),
      Field::Line(id) => lines.contains(id),
      _ => true,
    });

    let section = |title: &'static str, theme: &Theme| {
      div()
        .flex()
        .items_center()
        .gap(px(2.0))
        .child(div().flex_1().font_weight(FontWeight::SEMIBOLD).child(title))
        .text_color(theme.text)
    };
    let pick = |on: bool, theme: &Theme, d: Stateful<Div>| -> Stateful<Div> {
      d.rounded(px(4.0)).p(px(4.0)).when(on, |d| d.bg(theme.accent_soft))
    };

    let mut col = div()
      .flex()
      .flex_col()
      .gap(px(10.0))
      .p(px(12.0))
      .child(self.render_tabs(st, theme, cx));

    // Center lines.
    let mut centers = div().flex().gap(px(8.0));
    for (axis, label, on) in [
      (Axis::Vertical, "Vertical", s.center_v),
      (Axis::Horizontal, "Horizontal", s.center_h),
    ] {
      let sel = GuideSel::Center(axis);
      let picked = selected.as_ref() == Some(&sel);
      centers = centers.child(pick(
        picked,
        theme,
        check(SharedString::from(format!("center-{label}")), label, on, theme).on_click(cx.listener(
          move |ws, _, _, cx| {
            ws.set_center(axis, !on, cx);
            ws.select_guide(Some(GuideSel::Center(axis)), cx);
          },
        )),
      ));
    }
    col = col.child(section("Center lines", theme)).child(centers);

    // Border guides.
    col = col.child(
      section("Border guides", theme).child(icon_button("add-border", "plus", theme, true, false, {
        let w = cx.entity().downgrade();
        move |_, _, cx| {
          let _ = w.update(cx, |ws, cx| ws.add_border(cx));
        }
      })),
    );
    if s.borders.is_empty() {
      col = col.child(help("None. Dropped photos fill the page.", theme));
    }
    // A frame's left before its right.
    let order: [usize; 4] = if s.arrangement == Arrangement::Frames {
      [0, 1, 3, 2]
    } else {
      [0, 1, 2, 3]
    };
    for b in &s.borders {
      let e = edges_of(b);
      let values = [e.top, e.bottom, e.inside, e.outside];
      let linked = matches!(b.shape, BorderShape::Even { .. });
      let picked = selected.as_ref() == Some(&GuideSel::Border(b.id.clone()));
      let mut grid = div().flex().flex_col().gap(px(4.0));
      for i in order {
        grid = grid.child(self.number_field(
          Field::Border(b.id.clone(), i),
          Some(t.edges[i]),
          u.format(values[i]),
          !linked || i == 0,
          theme,
          window,
          cx,
        ));
      }
      let is_drop = drop.as_ref() == Some(&b.id);
      let (id1, id2, id3, id4) = (b.id.clone(), b.id.clone(), b.id.clone(), b.id.clone());
      let tools = div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .child(
          div()
            .id(SharedString::from(format!("drop-{}", b.id)))
            .px(px(8.0))
            .h(px(22.0))
            .flex()
            .items_center()
            .rounded(px(11.0))
            .border_1()
            .border_color(if is_drop { theme.accent } else { theme.border_strong })
            .when(is_drop, |d| d.bg(theme.accent).text_color(theme.on_accent))
            .child("On drop")
            .on_click(cx.listener(move |ws, _, _, cx| ws.set_drop_border(&id1, cx))),
        )
        .child(div().flex_1())
        .child(icon_button(
          SharedString::from(format!("link-{}", b.id)),
          if linked { "link-2" } else { "link-2-off" },
          theme,
          true,
          linked,
          {
            let w = cx.entity().downgrade();
            move |_, _, cx| {
              let _ = w.update(cx, |ws, cx| ws.toggle_linked(&id2, cx));
            }
          },
        ))
        .child(icon_button(
          SharedString::from(format!("remove-{}", b.id)),
          "x",
          theme,
          true,
          false,
          {
            let w = cx.entity().downgrade();
            move |_, _, cx| {
              let _ = w.update(cx, |ws, cx| ws.remove_guide(&GuideSel::Border(id3.clone()), cx));
            }
          },
        ));
      col = col.child(
        pick(
          picked,
          theme,
          div()
            .id(SharedString::from(format!("border-{}", b.id)))
            .flex()
            .flex_col()
            .gap(px(6.0))
            .border_1()
            .border_color(theme.border)
            .child(grid)
            .child(tools),
        )
        .on_mouse_down(
          MouseButton::Left,
          cx.listener(move |ws, _, _, cx| ws.select_guide(Some(GuideSel::Border(id4.clone())), cx)),
        ),
      );
    }

    // Guides from the rulers.
    col = col.child(
      section("Guides", theme)
        .child(icon_button("add-h", "separator-horizontal", theme, true, false, {
          let w = cx.entity().downgrade();
          move |_, _, cx| {
            let _ = w.update(cx, |ws, cx| ws.add_line(Axis::Horizontal, cx));
          }
        }))
        .child(icon_button("add-v", "separator-vertical", theme, true, false, {
          let w = cx.entity().downgrade();
          move |_, _, cx| {
            let _ = w.update(cx, |ws, cx| ws.add_line(Axis::Vertical, cx));
          }
        })),
    );
    if s.lines.is_empty() {
      col = col.child(help("Drag from a ruler to add one.", theme));
    }
    for l in &s.lines {
      let picked = selected.as_ref() == Some(&GuideSel::Line(l.id.clone()));
      let (id1, id2) = (l.id.clone(), l.id.clone());
      let field = self.number_field(
        Field::Line(l.id.clone()),
        Some(if l.axis == Axis::Horizontal {
          "Horizontal"
        } else {
          "Vertical"
        }),
        u.format(l.at),
        true,
        theme,
        window,
        cx,
      );
      col = col.child(
        pick(
          picked,
          theme,
          div()
            .id(SharedString::from(format!("line-{}", l.id)))
            .flex()
            .items_center()
            .gap(px(4.0))
            .child(div().flex_1().min_w_0().child(field))
            .child(icon_button(
              SharedString::from(format!("remove-{}", l.id)),
              "x",
              theme,
              true,
              false,
              {
                let w = cx.entity().downgrade();
                move |_, _, cx| {
                  let _ = w.update(cx, |ws, cx| ws.remove_guide(&GuideSel::Line(id1.clone()), cx));
                }
              },
            )),
        )
        .on_mouse_down(
          MouseButton::Left,
          cx.listener(move |ws, _, _, cx| ws.select_guide(Some(GuideSel::Line(id2.clone())), cx)),
        ),
      );
    }
    col = col.child(help(
      format!(
        "{} Distances in {}. Shift snaps a dragged guide to {}. Drag a guide off the {} to remove it.",
        t.guides_note, u.name, u.snap_label, t.page
      ),
      theme,
    ));
    col.into_any_element()
  }
}

/// A ruler's number, without trailing zeros.
fn format_tick(d: f64) -> String {
  let r = (d * 1000.0).round() / 1000.0;
  if r.fract() == 0.0 {
    format!("{r:.0}")
  } else {
    format!("{r}")
  }
}

fn capitalize(s: &str) -> String {
  let mut c = s.chars();
  c.next()
    .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
    .unwrap_or_default()
}
