//! The spread editor: one spread, large, with its guides; photos move and resize with
//! snapping; a strip of the desk's photos below to drag in (`SpreadEditor.tsx`).

use gpui_kit::*;
use sequence_core::actions::{DropTarget, folio_label, placement_mut};
use sequence_core::geometry::{
  Rect, border_box, fit_centered, page_rect, page_sides, pile_size, sheet_extent, side_at, spread_guides,
};
use sequence_core::units::{terms, units};
use sequence_core::{PageSide, PhotoMeta};

use super::desk::{handle_targets, selection_frame};
use super::paint::{SpreadPicture, boxed, photo, x};
use super::{icon_button, text_button};
use crate::assets::MONO;
use crate::theme::Theme;
use crate::workspace::{EditorFrame, Source, Surface, Workspace};

/// Room under the spread for its pager.
pub const PAGER_PX: f64 = 52.0;
/// Room around the spread, as a share of a page's width.
const PAD_SHARE: f64 = 0.075;
const HEADER_H: f64 = 36.0;
const INSPECTOR_W: f64 = 230.0;
const STRIP_H: f64 = 96.0;
const MARGIN: f64 = 24.0;

impl Workspace {
  pub fn render_editor(&mut self, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let main = self.frames.main;
    let project = self.history.project().clone();
    let Some(id) = self.ui.editing.clone() else {
      return div().into_any_element();
    };
    let all = project.layout.all();
    let Some(index) = all.iter().position(|s| s.id == id) else {
      return div().into_any_element();
    };
    let spread = all[index];
    let sheet = project.sheet();
    let arrangement = project.layout.arrangement();
    let u = units(sheet.unit);

    // The panel, in the page's pixels (main's top is 0), and its parts in window pixels.
    let panel = Rect::new(MARGIN, MARGIN, main.w - 2.0 * MARGIN, main.h - 2.0 * MARGIN);
    let stage_local = Rect::new(0.0, HEADER_H, panel.w - INSPECTOR_W, panel.h - HEADER_H - STRIP_H);
    let to_window = |r: Rect| Rect::new(r.x + panel.x, r.y + panel.y + main.y, r.w, r.h);
    let stage = to_window(stage_local);
    let strip = to_window(Rect::new(0.0, panel.h - STRIP_H, panel.w, STRIP_H));

    let pad = sheet.page_w * PAD_SHARE;
    let (extent_left, extent_w) = sheet_extent(arrangement, sheet.page_w);
    let fit = ((stage.w) / (extent_w + 2.0 * pad)).min((stage.h - PAGER_PX) / (sheet.page_h + 2.0 * pad));
    let view = self.ui.editor_view;
    let scale = fit * view.zoom;
    let canvas_w = (extent_w + 2.0 * pad) * scale;
    let canvas_h = (sheet.page_h + 2.0 * pad) * scale;
    let left = stage.w / 2.0 - canvas_w / 2.0 + view.pan_x;
    let top = (stage.h - PAGER_PX) / 2.0 - canvas_h / 2.0 + view.pan_y;
    // The spread's x = 0, y = 0, in the stage's pixels.
    let origin = (left + (pad - extent_left) * scale, top + pad * scale);
    let pic = SpreadPicture {
      spread,
      sheet: &sheet,
      scale,
      origin,
      clip: false,
    };
    self.frames.editor = Some(EditorFrame {
      stage,
      scale,
      origin: (stage.x + origin.0, stage.y + origin.1),
      pages: pic
        .pages()
        .into_iter()
        .map(|(s, r)| (s, Rect::new(r.x + stage.x, r.y + stage.y, r.w, r.h)))
        .collect(),
      strip,
    });

    let desk_color: Hsla = rgb(self.prefs.desk_color).into();
    let lit = match &self.ui.hover {
      Some(DropTarget::Page { spread: s, side }) if s == &spread.id => Some(*side),
      _ => None,
    };
    let mut stage_el = div()
      .id("editor-stage")
      .absolute()
      .left(x(stage_local.x))
      .top(x(stage_local.y))
      .w(x(stage_local.w))
      .h(x(stage_local.h))
      .overflow_hidden()
      .bg(desk_color)
      .on_mouse_down(MouseButton::Left, cx.listener(|ws, ev, _, cx| ws.stage_down(ev, cx)))
      .on_mouse_down(MouseButton::Middle, cx.listener(|ws, ev, _, cx| ws.stage_down(ev, cx)))
      .on_scroll(cx.listener(|ws, ev, _, cx| ws.editor_scroll(ev, cx)))
      .on_pinch(cx.listener(|ws, ev, _, cx| ws.editor_pinch(ev, cx)));
    for el in pic.page_elements(theme, lit) {
      stage_el = stage_el.child(el);
    }
    let mut items: Vec<_> = spread.items.iter().collect();
    items.sort_by(|a, b| a.z.total_cmp(&b.z));
    let selected = self.ui.editor_selected.clone();
    for p in &items {
      let r = pic.at(Rect::from(*p));
      if let Some(b) = super::paint::border(p, r, scale) {
        stage_el = stage_el.child(b);
      }
      let pid = p.photo_id.clone();
      stage_el = stage_el.child(photo(&mut self.lib, &project, p, r, theme).on_mouse_down(
        MouseButton::Left,
        cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
          cx.stop_propagation();
          ws.photo_down(Source::Editor, pid.clone(), ev, cx);
        }),
      ));
    }
    // Off the pages, photos are dimmed by the desk around them.
    let pb = pic.pages_box();
    let veil = desk_color.opacity(0.7);
    let far = 10000.0;
    for r in [
      Rect::new(pb.x - far, pb.y - far, 2.0 * far + pb.w, far),
      Rect::new(pb.x - far, pb.y + pb.h, 2.0 * far + pb.w, far),
      Rect::new(pb.x - far, pb.y, far, pb.h),
      Rect::new(pb.x + pb.w, pb.y, far, pb.h),
    ] {
      stage_el = stage_el.child(boxed(r).bg(veil));
    }
    stage_el = stage_el.child(pic.outline(theme));
    // Guides, then the lines a snap landed on.
    if !self.ui.guides_hidden {
      let mut plain = sheet.clone();
      plain.center_h = false;
      plain.center_v = false;
      let g = spread_guides(spread, &plain);
      let hit = self.ui.snap_hit.clone().unwrap_or_default();
      let near = |v: f64, list: &[f64]| list.iter().any(|h| (h - v).abs() < 1e-6);
      for &gx in &g.xs {
        let c = if near(gx, &hit.xs) {
          theme.guide_hit
        } else {
          theme.guide
        };
        stage_el = stage_el.child(boxed(Rect::new(origin.0 + gx * scale, origin.1, 1.0, sheet.page_h * scale)).bg(c));
      }
      for &side in page_sides(spread.kind) {
        let pr = page_rect(side, &sheet);
        for &gy in &g.ys {
          let c = if near(gy, &hit.ys) {
            theme.guide_hit
          } else {
            theme.guide
          };
          stage_el = stage_el.child(
            boxed(Rect::new(
              origin.0 + pr.x * scale,
              origin.1 + gy * scale,
              pr.w * scale,
              1.0,
            ))
            .bg(c),
          );
        }
        if sheet.center_v {
          let cxp = pr.x + pr.w / 2.0;
          stage_el = stage_el.child(
            boxed(Rect::new(origin.0 + cxp * scale, origin.1, 1.0, sheet.page_h * scale)).bg(theme.guide_center),
          );
        }
        if sheet.center_h {
          stage_el = stage_el.child(
            boxed(Rect::new(
              origin.0 + pr.x * scale,
              origin.1 + sheet.page_h / 2.0 * scale,
              pr.w * scale,
              1.0,
            ))
            .bg(theme.guide_center),
          );
        }
      }
    }
    if let Some(hit) = &self.ui.snap_hit {
      for &hx in &hit.xs {
        stage_el = stage_el.child(boxed(Rect::new(origin.0 + hx * scale, 0.0, 1.0, stage.h)).bg(theme.guide_hit));
      }
      for &hy in &hit.ys {
        stage_el = stage_el.child(boxed(Rect::new(0.0, origin.1 + hy * scale, stage.w, 1.0)).bg(theme.guide_hit));
      }
    }
    if let Some(sel) = &selected
      && self.ui.cropping.as_ref().is_none_or(|c| &c.photo != sel)
      && let Some(p) = spread.items.iter().find(|i| &i.photo_id == sel)
    {
      let r = pic.at(Rect::from(p));
      stage_el = stage_el.child(selection_frame(r, theme, true));
      for t in handle_targets(r, Surface::Editor, sel.clone(), cx) {
        stage_el = stage_el.child(t);
      }
    }
    // Which spread of how many, below it.
    let total = all.len();
    let noun = terms(arrangement).spread;
    let pager = div()
      .absolute()
      .left_0()
      .right_0()
      .bottom(px(12.0))
      .flex()
      .justify_center()
      .child(
        div()
          .flex()
          .items_center()
          .gap(px(4.0))
          .px(px(4.0))
          .rounded(px(5.0))
          .bg(theme.panel)
          .border_1()
          .border_color(theme.border)
          .child(icon_button(
            "editor-prev",
            "chevron-left",
            theme,
            index > 0,
            false,
            cx.listener(|ws, _, _, cx| ws.editor_go(-1, cx)),
          ))
          .child(div().font_family(MONO).text_size(px(11.0)).child(format!(
            "{} · {} of {total}",
            folio_label(index, total, arrangement),
            index + 1
          )))
          .child(icon_button(
            "editor-next",
            "chevron-right",
            theme,
            index + 1 < total,
            false,
            cx.listener(|ws, _, _, cx| ws.editor_go(1, cx)),
          )),
      );
    stage_el = stage_el.child(pager);

    let header = div()
      .absolute()
      .left_0()
      .top_0()
      .w(x(panel.w))
      .h(x(HEADER_H))
      .flex()
      .items_center()
      .gap(px(4.0))
      .px(px(10.0))
      .bg(theme.header)
      .border_b_1()
      .border_color(theme.divider)
      .child(div().font_weight(FontWeight::SEMIBOLD).child(format!(
        "{} {}",
        capitalize(noun),
        folio_label(index, total, arrangement)
      )))
      .child(div().flex_1())
      .child(icon_button(
        "toggle-guides",
        if self.ui.guides_hidden { "eye-off" } else { "eye" },
        theme,
        true,
        self.ui.guides_hidden,
        cx.listener(|ws, _, _, cx| {
          ws.ui.guides_hidden = !ws.ui.guides_hidden;
          cx.notify();
        }),
      ))
      .child(icon_button(
        "close-editor",
        "x",
        theme,
        true,
        false,
        cx.listener(|ws, _, _, cx| ws.close_editor(cx)),
      ));

    let inspector = self.render_inspector(
      Rect::new(
        panel.w - INSPECTOR_W,
        HEADER_H,
        INSPECTOR_W,
        panel.h - HEADER_H - STRIP_H,
      ),
      theme,
      cx,
    );
    let strip_el = self.render_strip(Rect::new(0.0, panel.h - STRIP_H, panel.w, STRIP_H), theme, cx);
    let _ = u;

    div()
      .id("editor-backdrop")
      .absolute()
      .left_0()
      .top_0()
      .size_full()
      .bg(rgba(0x00000047))
      .on_mouse_down(MouseButton::Left, cx.listener(|ws, _, _, cx| ws.close_editor(cx)))
      .child(
        boxed(panel)
          .id("editor")
          .overflow_hidden()
          .rounded(px(8.0))
          .bg(theme.panel)
          .border_1()
          .border_color(theme.border_strong)
          .shadow_lg()
          .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
          .child(stage_el)
          .child(inspector)
          .child(header)
          .child(strip_el),
      )
      .into_any_element()
  }

  /// The selected photo's place, size, and fitting; or how to use the editor.
  fn render_inspector(&mut self, r: Rect, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let project = self.project().clone();
    let sheet = project.sheet();
    let u = units(sheet.unit);
    let mut el = boxed(r)
      .flex()
      .flex_col()
      .gap(px(10.0))
      .p(px(14.0))
      .border_l_1()
      .border_color(theme.divider);
    let item = self.ui.editor_selected.as_ref().and_then(|id| act_locate(&project, id));
    let Some(item) = item else {
      return el
        .text_color(theme.muted)
        .child("Select a photo to adjust its position and size.")
        .child("Drag photos in from the desk strip below, or drag one onto the strip to send it back.")
        .into_any_element();
    };
    let name = project
      .photos
      .get(&item.photo_id)
      .map(|m| m.name.clone())
      .unwrap_or_default();
    let side = side_at(&sheet, item.x + item.w / 2.0);
    let page = page_rect(side, &sheet);
    let where_ = if side == PageSide::Whole { "frame" } else { "page" };
    let f = |n: f64| format!("{} {}", u.format(n), u.suffix);
    let row = |label: &'static str, value: String| {
      div()
        .flex()
        .gap(px(8.0))
        .child(div().w(px(20.0)).text_color(theme.muted).child(label))
        .child(div().font_family(MONO).child(value))
    };
    el = el
      .child(
        div()
          .font_weight(FontWeight::MEDIUM)
          .overflow_hidden()
          .whitespace_nowrap()
          .child(name),
      )
      .child(div().text_color(theme.muted).text_size(px(11.0)).child(match side {
        PageSide::Whole => "Frame · measured from its top-left corner",
        PageSide::Left => "Left page · measured from its top-left corner",
        PageSide::Right => "Right page · measured from its top-left corner",
      }))
      .child(row("X", f(item.x - page.x)))
      .child(row("Y", f(item.y)))
      .child(row("W", f(item.w)))
      .child(row("H", f(item.h)));
    let id = item.photo_id.clone();
    let it = item.clone();
    el = el.child(text_button(
      "center",
      format!("Center on {where_}"),
      theme,
      false,
      cx.listener(move |ws, _, _, cx| {
        let id = id.clone();
        ws.apply(cx, |d| {
          if let Some(p) = placement_mut(d, &id) {
            p.x = page.x + (page.w - it.w) / 2.0;
            p.y = (page.h - it.h) / 2.0;
          }
        });
      }),
    ));
    let mut boxes: Vec<(String, Rect)> = vec![(format!("Fit {where_}"), page)];
    let mut guides: Vec<_> = sheet.borders.iter().map(|g| (g, border_box(side, &sheet, g))).collect();
    guides.sort_by(|a, b| (b.1.w * b.1.h).total_cmp(&(a.1.w * a.1.h)));
    for (g, b) in guides {
      let label = match g.shape {
        sequence_core::BorderShape::Even { inset } => format!("Fit {} {} guide", u.format(inset), u.suffix),
        sequence_core::BorderShape::Edges(e) => {
          let d = [e.top, e.bottom, e.inside, e.outside];
          let lo = d.iter().copied().fold(f64::INFINITY, f64::min);
          let hi = d.iter().copied().fold(f64::NEG_INFINITY, f64::max);
          format!("Fit {}–{} {} guide", u.format(lo), u.format(hi), u.suffix)
        }
      };
      boxes.push((label, b));
    }
    for (i, (label, b)) in boxes.into_iter().enumerate() {
      let id = item.photo_id.clone();
      let (w, h) = (item.w, item.h);
      el = el.child(text_button(
        ("fit", i),
        label,
        theme,
        false,
        cx.listener(move |ws, _, _, cx| {
          let id = id.clone();
          let shape = PhotoMeta {
            id: id.clone(),
            name: String::new(),
            px_w: w,
            px_h: h,
            crop: None,
          };
          let r = fit_centered(&shape, b, Some(page));
          ws.apply(cx, |d| {
            if let Some(p) = placement_mut(d, &id) {
              p.x = r.x;
              p.y = r.y;
              p.w = r.w;
              p.h = r.h;
            }
          });
        }),
      ));
    }
    let id = item.photo_id.clone();
    el = el.child(div().flex_1()).child(text_button(
      "to-desk",
      "Return to desk",
      theme,
      false,
      cx.listener(move |ws, _, _, cx| {
        let visible = ws.visible();
        let id = id.clone();
        ws.ui.editor_selected = None;
        ws.apply(cx, |d| sequence_core::actions::put_in_pile(d, &id, None, visible));
      }),
    ));
    el.into_any_element()
  }

  /// The desk's photos in a row, to drag onto the spread; dropping one here sends it back.
  fn render_strip(&mut self, r: Rect, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let project = self.project().clone();
    let lit = self.ui.hover == Some(DropTarget::Strip);
    let mut row = div().flex().items_center().gap(px(8.0)).h_full().px(px(12.0));
    let h = r.h - 24.0;
    let mut pile: Vec<_> = project.pile.iter().collect();
    pile.sort_by(|a, b| a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x)));
    for p in pile {
      let Some(meta) = project.photos.get(&p.photo_id) else {
        continue;
      };
      let (pw, ph) = pile_size(meta);
      let w = h * pw / ph;
      let id = p.photo_id.clone();
      let mut cell = div()
        .id(SharedString::from(format!("strip-{id}")))
        .relative()
        .flex_none()
        .w(x(w))
        .h(x(h))
        .on_mouse_down(
          MouseButton::Left,
          cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            ws.photo_down(Source::Strip, id.clone(), ev, cx);
          }),
        );
      cell = cell.child(photo(&mut self.lib, &project, p, Rect::new(0.0, 0.0, w, h), theme));
      row = row.child(cell);
    }
    if project.pile.is_empty() {
      row = row.child(div().text_color(theme.muted).child("The desk is empty."));
    }
    let mut el = boxed(r)
      .id("strip")
      .overflow_hidden()
      .bg(theme.inset)
      .border_t_1()
      .border_color(theme.divider)
      .on_scroll(cx.listener(|ws, ev: &ScrollEvent, _, cx| {
        let d = ev.delta.pixel_delta(px(16.0));
        ws.ui.strip_scroll = (ws.ui.strip_scroll - f64::from(d.x) - f64::from(d.y)).max(0.0);
        cx.notify();
      }))
      .child(
        div()
          .absolute()
          .left(x(-self.ui.strip_scroll))
          .top_0()
          .h_full()
          .child(row),
      );
    if lit {
      el = el.child(div().absolute().size_full().border_2().border_color(theme.accent));
    }
    el.into_any_element()
  }
}

fn act_locate(project: &sequence_core::Project, id: &sequence_core::PhotoId) -> Option<sequence_core::Placement> {
  sequence_core::actions::locate(project, id).map(|l| l.1)
}

fn capitalize(s: &str) -> String {
  let mut c = s.chars();
  c.next()
    .map(|f| f.to_uppercase().chain(c).collect())
    .unwrap_or_default()
}
