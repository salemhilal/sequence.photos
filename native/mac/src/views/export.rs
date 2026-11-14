//! The Export page (`ExportView.tsx`): the pages an export makes, one at a time, beside
//! where it goes and that destination's choices. A PDF works so far; images, InDesign and
//! Instagram come next.

use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::export_options::{DESTINATIONS, converts, export_px_per_unit, per_of};
use sequence_core::geometry::{Rect, sheet_extent};
use sequence_core::model::{ExportDestination as Destination, ImageFormat, Unit};
use sequence_core::raster::{extension, format_bytes, image_names};
use sequence_core::render_plan::{OutputPage, Part, Per, output_pages, page_region};
use sequence_core::resolution::{Located, soft_photos, soft_sentence};
use sequence_core::units::{terms, units};

use super::controls::{help, segmented};
use super::paint::{SpreadPicture, boxed, x};
use super::text_button;
use crate::assets::{MONO, icon};
use crate::fields::Field;
use crate::theme::Theme;
use crate::workspace::Workspace;

const PANEL_W: f64 = 280.0;
/// Room around the preview, as a share of a page's width.
const PAD_SHARE: f64 = 0.05;
const PAGER_H: f64 = 56.0;

fn look(d: Destination) -> (&'static str, &'static str) {
  match d {
    Destination::Pdf => ("PDF", "file-text"),
    Destination::Images => ("Images", "images"),
    Destination::Indesign => ("InDesign", "package"),
    Destination::Instagram => ("Instagram", "instagram"),
  }
}

fn round2(n: f64) -> f64 {
  (n * 100.0).round() / 100.0
}

fn section(title: Option<&'static str>, theme: &Theme) -> Div {
  div()
    .flex()
    .flex_col()
    .gap(px(8.0))
    .p(px(12.0))
    .border_b_1()
    .border_color(theme.divider)
    .when_some(title, |d, t| {
      d.child(div().font_weight(FontWeight::MEDIUM).text_color(theme.text).child(t))
    })
}

impl Workspace {
  pub fn render_export(&mut self, theme: &Theme, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
    let main = self.frames.main;
    let project = self.history.shared();
    let sheet = project.sheet();
    let to = self.export_to();
    let o = self.export_options();
    // InDesign keeps a book's spreads.
    let per = if to == Destination::Indesign {
      Per::Spread
    } else {
      per_of(&project, o.per)
    };
    let pages = output_pages(&project, per);
    let px_per_unit = export_px_per_unit(to, &sheet, o.dpi);
    self.ui.export.index = self.ui.export.index.min(pages.len().saturating_sub(1));
    let index = self.ui.export.index;
    let busy = self.ui.busy.clone();
    let posting = self.posting();

    // The preview.
    let stage_w = main.w - PANEL_W;
    let mut stage = div()
      .absolute()
      .left_0()
      .top_0()
      .w(x(stage_w))
      .h(x(main.h))
      .bg(rgb(self.prefs.desk_color))
      .overflow_hidden();
    if to == Destination::Instagram {
      stage = div()
        .absolute()
        .left_0()
        .top_0()
        .child(self.instagram_stage(stage_w, main.h, theme, cx));
    } else if let Some(page) = pages.get(index) {
      stage = stage.child(self.output_preview(page, stage_w, main.h, theme));
      let size = if to == Destination::Images {
        let r = page_region(page, &sheet);
        format!("{} × {} px", (r.w * px_per_unit).round(), (r.h * px_per_unit).round())
      } else {
        let r = page_region(page, &sheet);
        let u = units(sheet.unit);
        format!("{} × {} {}", u.format(r.w), u.format(r.h), u.suffix)
      };
      let total = pages.len();
      let ws = cx.entity().downgrade();
      stage = stage.child(super::controls::pager(
        "export-pager",
        index,
        total,
        format!(" · {size}"),
        theme,
        move |d, _, cx| {
          let _ = ws.update(cx, |ws, cx| ws.export_go(d, total, cx));
        },
      ));
    }

    // The panel: where it goes, then its choices.
    // Two by two; the one picked is raised, and its highlight slides to a new pick.
    let (cell_w, cell_h, gap): (f64, f64, f64) = (124.0, 30.0, 6.0);
    let at = DESTINATIONS.iter().position(|d| *d == to).unwrap_or(0);
    let slide = crate::motion::slide("export-destination", at);
    let cell = |i: usize| ((i % 2) as f64 * (cell_w + gap), (i / 2) as f64 * (cell_h + gap));
    let (fx, fy) = cell(slide.from);
    let (tx, ty) = cell(slide.to);
    let mut picker = div().relative().flex().flex_wrap().gap(x(gap)).child(
      div()
        .absolute()
        .w(x(cell_w))
        .h(x(cell_h))
        .rounded(px(3.0))
        .bg(theme.control)
        .shadow_sm()
        .left(x(tx))
        .top(x(ty))
        .with_animation(
          SharedString::from(format!("destination-{}", slide.n)),
          crate::motion::ease(crate::motion::TOGGLE),
          move |el, t| {
            let t = f64::from(t);
            el.left(x(fx + (tx - fx) * t)).top(x(fy + (ty - fy) * t))
          },
        ),
    );
    for (i, d) in DESTINATIONS.into_iter().enumerate() {
      let (label, name) = look(d);
      let on = d == to;
      picker = picker.child(
        div()
          .id(("destination", i))
          .flex()
          .items_center()
          .gap(px(6.0))
          .relative()
          .w(x(cell_w))
          .h(x(cell_h))
          .px(px(8.0))
          .rounded(px(3.0))
          .border_1()
          .border_color(if on {
            gpui_kit::transparent_black()
          } else {
            theme.border
          })
          .when(!on, |d| d.hover(|s| s.bg(theme.fill)))
          .child(svg().path(icon(name)).size(px(14.0)).text_color(theme.text))
          .child(label)
          .when(busy.is_none() && !posting, |b| {
            b.on_click(cx.listener(move |ws, _, _, cx| ws.pick_destination(d, cx)))
          }),
      );
    }
    let mut panel = div()
      .id("export-panel")
      .absolute()
      .top_0()
      .right_0()
      .w(x(PANEL_W))
      .h(x(main.h))
      .flex()
      .flex_col()
      .overflow_y_scroll()
      .bg(theme.panel)
      .border_l_1()
      .border_color(theme.divider)
      .child(section(Some("Destination"), theme).child(picker));

    let spreads = sheet.arrangement == sequence_core::Arrangement::Spreads;
    let max_dpi = if sheet.unit == Unit::In { sheet.px_per_unit } else { 1.0 };
    let enabled = busy.is_none();
    let per_choice = |title: &'static str, cx: &mut Context<Self>| {
      section(Some(title), theme).child(segmented(
        "export-per",
        &[(Per::Spread, "Spread"), (Per::Page, "Page")],
        per,
        theme,
        {
          let ws = cx.entity().downgrade();
          move |p, _, cx| {
            let _ = ws.update(cx, |ws, cx| ws.set_export_options(cx, |o| o.per = p));
          }
        },
      ))
    };

    match to {
      Destination::Pdf => {
        if converts(to, sheet.unit) {
          let field = self.number_field(
            Field::PrintAt,
            Some("Print at"),
            format!("{} dpi", o.print_at),
            enabled,
            theme,
            window,
            cx,
          );
          panel = panel.child(
            section(None, theme)
              .child(note(
                format!(
                  "{} are measured in pixels, so they’re given a printed size: {} × {} in.",
                  capitalize(terms(sheet.arrangement).spreads),
                  round2(sheet.page_w / o.print_at),
                  round2(sheet.page_h / o.print_at)
                ),
                theme,
              ))
              .child(field),
          );
        }
        if spreads {
          panel = panel.child(per_choice("One PDF page per", cx));
        }
        if sheet.unit == Unit::In {
          let field = self.number_field(
            Field::ExportDpi,
            Some("Photos at"),
            format!("{} dpi", px_per_unit),
            enabled,
            theme,
            window,
            cx,
          );
          panel = panel.child(section(Some("Resolution"), theme).child(field).child(help(
            format!("Up to the page’s {max_dpi} dpi. Lower makes a smaller file, for a proof."),
            theme,
          )));
        }
      }
      Destination::Images => {
        if converts(to, sheet.unit) {
          let field = self.number_field(
            Field::ExportDpi,
            Some("Resolution"),
            format!("{} dpi", px_per_unit),
            enabled,
            theme,
            window,
            cx,
          );
          let mut sec = section(None, theme)
            .child(note(
              format!(
                "Pages are measured in inches, so they’re turned into pixels: {} × {} px a page.",
                (sheet.page_w * px_per_unit).round(),
                (sheet.page_h * px_per_unit).round()
              ),
              theme,
            ))
            .child(field);
          if px_per_unit >= max_dpi {
            sec = sec.child(help(format!("Up to the page’s {max_dpi} dpi."), theme));
          }
          panel = panel.child(sec);
        }
        if spreads {
          panel = panel.child(per_choice("One image per", cx));
        }
        let mut sec = section(Some("Format"), theme).child(segmented(
          "export-format",
          &[(ImageFormat::Jpeg, "JPEG"), (ImageFormat::Png, "PNG")],
          o.format,
          theme,
          {
            let ws = cx.entity().downgrade();
            move |f, _, cx| {
              let _ = ws.update(cx, |ws, cx| ws.set_export_options(cx, |o| o.format = f));
            }
          },
        ));
        if o.format == ImageFormat::Jpeg {
          let slider = self.quality_slider(o.quality, enabled, theme, cx);
          sec = sec.child(
            div()
              .flex()
              .items_center()
              .gap(px(8.0))
              .child(div().w(px(56.0)).text_color(theme.muted).child("Quality"))
              .child(div().flex_1().child(slider))
              .child(
                div()
                  .w(px(36.0))
                  .font_family(MONO)
                  .text_size(px(11.0))
                  .child(format!("{}%", (o.quality * 100.0).round())),
              ),
          );
        } else {
          sec = sec.child(help("Lossless, so larger.", theme));
        }
        let names = image_names(&project, &pages, extension(o.format));
        let shown: Vec<&str> = names.iter().take(2).map(String::as_str).collect();
        sec = sec.child(help(
          format!(
            "Saved as a ZIP: {}{}",
            shown.join(", "),
            if pages.len() > 2 { ", …" } else { "" }
          ),
          theme,
        ));
        let estimate = self.images_estimate(cx);
        sec = sec.child(
          div()
            .font_family(MONO)
            .text_size(px(11.0))
            .text_color(theme.muted)
            .child(format!(
              "{} {}{}",
              pages.len(),
              if pages.len() == 1 { "image" } else { "images" },
              estimate.map_or(String::new(), |b| format!(", ~{} total", format_bytes(b)))
            )),
        );
        panel = panel.child(sec);
      }
      Destination::Indesign => {
        let mut text =
          "An InDesign file with every photo linked at full size, and the guides as InDesign guides.".to_string();
        if !spreads {
          text.push_str(" Frames become single pages, without facing pages.");
        }
        if sheet.unit == Unit::Px {
          text.push_str(&format!(
            " InDesign counts a pixel as a point, so pages open at {} × {} px.",
            sheet.page_w, sheet.page_h
          ));
        }
        panel = panel.child(section(None, theme).child(help(text, theme)));
      }
      Destination::Instagram => {
        panel = self.instagram_panel(panel, theme, window, cx);
      }
    }

    if to != Destination::Instagram {
      let soft = soft_photos(&project, Some(px_per_unit));
      let mut actions = section(None, theme);
      if let Some(first) = soft.first().cloned() {
        let sentence = soft_sentence(soft.len(), sheet.unit, px_per_unit, false);
        actions = actions.child(
          div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(6.0))
            .text_color(theme.warn)
            .child(svg().path(icon("triangle-alert")).size(px(13.0)).text_color(theme.warn))
            .child(sentence)
            .child(
              div()
                .id("show-soft")
                .text_color(theme.accent)
                .cursor_pointer()
                .child("Show me")
                .on_click(cx.listener(move |ws, _, _, cx| ws.show_photo(first.clone(), cx))),
            ),
        );
      }
      let action = match to {
        Destination::Pdf => "Export PDF".to_string(),
        Destination::Images => format!(
          "Export {} {}",
          pages.len(),
          if pages.len() == 1 { "image" } else { "images" }
        ),
        _ => "Export for InDesign".to_string(),
      };
      let label = busy.clone().unwrap_or(action);
      let mut button = text_button(
        "export-run",
        label,
        theme,
        true,
        cx.listener(move |ws, _, _, cx| match to {
          Destination::Pdf => ws.save_pdf(cx),
          Destination::Images => ws.save_images(cx),
          _ => ws.save_indesign(cx),
        }),
      )
      .justify_center();
      if busy.is_some() {
        button = button.opacity(0.6);
      }
      // Kept at the panel's foot, as on the web.
      panel = panel
        .child(div().flex_1().min_h(px(8.0)))
        .child(actions.child(button).border_b_0().border_t_1());
    }

    div()
      .absolute()
      .size_full()
      .child(stage)
      .child(panel)
      .into_any_element()
  }

  /// One output page, fitted to the stage above the pager: a book's spreads all at one
  /// scale, a whole spread's, so a single first or last page shows at a page's size.
  fn output_preview(&mut self, page: &OutputPage, stage_w: f64, stage_h: f64, theme: &Theme) -> AnyElement {
    let project = self.history.shared();
    let sheet = project.sheet();
    let region = page_region(page, &sheet);
    let pad = sheet.page_w * PAD_SHARE;
    let across = if page.part == Part::Spread {
      sheet_extent(sheet.arrangement, sheet.page_w).1
    } else {
      region.w
    };
    let scale = (stage_w / (across + 2.0 * pad))
      .min((stage_h - PAGER_H) / (sheet.page_h + 2.0 * pad))
      .max(0.0);
    let w = region.w * scale;
    let h = region.h * scale;
    let left = (stage_w - w) / 2.0;
    let top = (stage_h - PAGER_H - h) / 2.0;
    let pic = SpreadPicture {
      spread: page.spread,
      sheet: &sheet,
      scale,
      origin: (-region.x * scale, -region.y * scale),
      clip: true,
    };
    let mut frame = boxed(Rect::new(left, top, w, h)).overflow_hidden().shadow_md();
    for el in pic.page_elements(theme, None) {
      frame = frame.child(el);
    }
    frame
      .child(pic.photo_elements(&mut self.lib, &project, theme))
      .into_any_element()
  }

  /// The JPEG quality slider, from 50 to 100% (as the web's range inputs: a thin track and a
  /// small knob). Pressed or dragged; saved when it's let go.
  fn quality_slider(&mut self, quality: f64, enabled: bool, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let bounds = self.ui.export.quality_track.clone();
    let measured = bounds.clone();
    let f = ((quality - 0.5) / 0.5).clamp(0.0, 1.0) as f32;
    div()
      .id("quality")
      .relative()
      .h(px(16.0))
      .flex()
      .items_center()
      .when(!enabled, |d| d.opacity(0.5))
      // Where the track is, for presses and drags.
      .child(
        canvas(move |b, _, _| measured.set(Some(b)), |_, _, _, _| {})
          .absolute()
          .size_full(),
      )
      .child(div().w_full().h(px(2.0)).rounded(px(1.0)).bg(theme.border_strong))
      .child(
        div()
          .absolute()
          .left(relative(f))
          .ml(px(-5.0))
          .size(px(10.0))
          .rounded_full()
          .bg(theme.knob)
          .border_1()
          .border_color(hsla(0.0, 0.0, 0.0, 0.35))
          .shadow_sm(),
      )
      .when(enabled, |d| {
        d.on_mouse_down(
          MouseButton::Left,
          cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            ws.drag = Some(crate::workspace::Drag::Quality);
            ws.quality_at(f64::from(ev.position.x), cx);
          }),
        )
      })
      .into_any_element()
  }

  /// The quality for a press or drag at window x on its track (shown, not saved yet).
  pub fn quality_at(&mut self, x_: f64, cx: &mut Context<Self>) {
    let Some(b) = self.ui.export.quality_track.get() else {
      return;
    };
    let (left, w) = (f64::from(b.origin.x), f64::from(b.size.width).max(1.0));
    let f = ((x_ - left) / w).clamp(0.0, 1.0);
    self.ui.export.live_quality = Some((50.0 + 50.0 * f).round() / 100.0);
    cx.notify();
  }

  /// The slider let go: keep the quality.
  pub fn quality_done(&mut self, cx: &mut Context<Self>) {
    if let Some(q) = self.ui.export.live_quality.take() {
      self.set_export_options(cx, |o| o.quality = q);
    }
  }

  /// Open a placed photo in the spread editor, selected.
  pub fn show_photo(&mut self, at: Located, cx: &mut Context<Self>) {
    self.go_to(crate::workspace::Page::Desk, cx);
    self.open_editor(at.spread_id, cx);
    self.ui.editor_selected = Some(at.photo_id);
    cx.notify();
  }

  /// A dpi typed on the Export page.
  pub fn export_field(&mut self, field: &Field, n: f64, cx: &mut Context<Self>) {
    let sheet = self.project().sheet();
    match field {
      Field::ExportDpi => {
        let max = if sheet.unit == Unit::In { sheet.px_per_unit } else { 1.0 };
        self.set_export_options(cx, |o| o.dpi = Some(n.round().clamp(1.0, max)));
      }
      Field::PrintAt => self.set_export_options(cx, |o| o.print_at = n.round().max(1.0)),
      _ => {}
    }
  }
}

/// A note on how the destination converts the project's measurements.
fn note(text: String, theme: &Theme) -> Div {
  div()
    .w_full()
    .min_w_0()
    .flex()
    .gap(px(6.0))
    .text_color(theme.muted)
    .child(
      svg()
        .path(icon("info"))
        .flex_none()
        .mt(px(2.0))
        .size(px(13.0))
        .text_color(theme.muted),
    )
    .child(div().flex_1().min_w_0().child(text))
}

fn capitalize(s: &str) -> String {
  let mut c = s.chars();
  c.next()
    .map_or_else(String::new, |f| f.to_uppercase().chain(c).collect())
}
