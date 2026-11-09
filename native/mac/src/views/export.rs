//! The Export page (`ExportView.tsx`): the pages an export makes, one at a time, beside
//! where it goes and that destination's choices. A PDF works so far; images, InDesign and
//! Instagram come next.

use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::export_options::{DESTINATIONS, converts, export_px_per_unit, per_of};
use sequence_core::geometry::{Rect, sheet_extent};
use sequence_core::model::{ExportDestination as Destination, Unit};
use sequence_core::render_plan::{OutputPage, Part, Per, output_pages, page_region};
use sequence_core::units::{terms, units};

use super::controls::{help, segmented};
use super::paint::{SpreadPicture, boxed, x};
use super::{icon_button, text_button};
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
    Destination::Instagram => ("Instagram", "upload"),
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
      d.child(div().font_weight(FontWeight::SEMIBOLD).text_color(theme.text).child(t))
    })
}

impl Workspace {
  pub fn render_export(&mut self, theme: &Theme, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
    let main = self.frames.main;
    let project = self.project().clone();
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
    if let Some(page) = pages.get(index) {
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
      stage = stage.child(
        div()
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
                "export-prev",
                "chevron-left",
                theme,
                index > 0,
                false,
                cx.listener(move |ws, _, _, cx| ws.export_go(-1, total, cx)),
              ))
              .child(
                div()
                  .font_family(MONO)
                  .text_size(px(11.0))
                  .child(format!("Page {} of {total} · {size}", index + 1)),
              )
              .child(icon_button(
                "export-next",
                "chevron-right",
                theme,
                index + 1 < total,
                false,
                cx.listener(move |ws, _, _, cx| ws.export_go(1, total, cx)),
              )),
          ),
      );
    }

    // The panel: where it goes, then its choices.
    let mut picker = div().flex().flex_wrap().gap(px(6.0));
    for (i, d) in DESTINATIONS.into_iter().enumerate() {
      let (label, name) = look(d);
      let on = d == to;
      picker = picker.child(
        div()
          .id(("destination", i))
          .flex()
          .items_center()
          .gap(px(6.0))
          .w(px(122.0))
          .h(px(30.0))
          .px(px(8.0))
          .rounded(px(4.0))
          .border_1()
          .border_color(if on { theme.accent } else { theme.border_strong })
          .bg(if on { theme.accent_soft } else { theme.control })
          .child(svg().path(icon(name)).size(px(14.0)).text_color(theme.text))
          .child(label)
          .when(busy.is_none(), |b| {
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

    match to {
      Destination::Pdf => {
        let spreads = sheet.arrangement == sequence_core::Arrangement::Spreads;
        if converts(to, sheet.unit) {
          let field = self.number_field(
            Field::PrintAt,
            Some("Print at"),
            format!("{} dpi", o.print_at),
            busy.is_none(),
            theme,
            window,
            cx,
          );
          panel = panel.child(
            section(None, theme)
              .child(div().text_color(theme.muted).child(format!(
                "{} are measured in pixels, so they’re given a printed size: {} × {} in.",
                capitalize(terms(sheet.arrangement).spreads),
                round2(sheet.page_w / o.print_at),
                round2(sheet.page_h / o.print_at)
              )))
              .child(field),
          );
        }
        if spreads {
          panel = panel.child(section(Some("One PDF page per"), theme).child(segmented(
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
          )));
        }
        if sheet.unit == Unit::In {
          let field = self.number_field(
            Field::ExportDpi,
            Some("Photos at"),
            format!("{} dpi", px_per_unit),
            busy.is_none(),
            theme,
            window,
            cx,
          );
          panel = panel.child(section(Some("Resolution"), theme).child(field).child(help(
            format!(
              "Up to the page’s {} dpi. Lower makes a smaller file, for a proof.",
              sheet.px_per_unit
            ),
            theme,
          )));
        }
        let label = busy.clone().unwrap_or_else(|| "Export PDF".into());
        let mut button = text_button(
          "export-run",
          label,
          theme,
          true,
          cx.listener(|ws, _, _, cx| ws.save_pdf(cx)),
        )
        .justify_center();
        if busy.is_some() {
          button = button.opacity(0.6);
        }
        panel = panel.child(section(None, theme).child(button));
      }
      _ => {
        panel = panel.child(section(None, theme).child(help(
          format!("Exporting to {} isn’t in this version yet.", look(to).0),
          theme,
        )));
      }
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
    let project = self.project().clone();
    let sheet = project.sheet();
    let region = page_region(page, &sheet);
    let pad = sheet.page_w * PAD_SHARE;
    let across = if page.part == Part::Spread {
      sheet_extent(sheet.arrangement, sheet.page_w).0
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

fn capitalize(s: &str) -> String {
  let mut c = s.chars();
  c.next()
    .map_or_else(String::new, |f| f.to_uppercase().chain(c).collect())
}
