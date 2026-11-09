//! Exporting images (`src/rasterExport.ts`): one JPEG or PNG per output page, named in
//! order and saved together as a ZIP. The platform draws each page from its plan; this
//! works out the plans, the names, the archive, and what to say afterwards.

use std::io::{self, Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::actions::folio_label;
use crate::model::{ImageFormat, Project, Unit};
use crate::pdf::MAX_PIXELS;
use crate::render_plan::{OutputPage, PagePlan, Part, fit_pixels, items_on, plan_page};

/// About how many pixels a size estimate renders and encodes, as a sample.
pub const SAMPLE_PIXELS: f64 = 500_000.0;

/// The extension an image format's files take.
pub fn extension(format: ImageFormat) -> &'static str {
  match format {
    ImageFormat::Jpeg => "jpg",
    ImageFormat::Png => "png",
  }
}

/// Each output page's file name: its page numbers, zero-padded, with spreads as "02-03".
pub fn image_names(project: &Project, pages: &[OutputPage], ext: &str) -> Vec<String> {
  let arrangement = project.layout.arrangement();
  let spreads = project.layout.all();
  if pages.iter().all(|p| p.part == Part::Spread) {
    return pages
      .iter()
      .map(|p| {
        let i = spreads.iter().position(|s| s.id == p.spread.id).unwrap_or(0);
        format!("{}.{ext}", folio_label(i, spreads.len(), arrangement).replace('–', "-"))
      })
      .collect();
  }
  let digits = pages.len().to_string().len().max(2);
  (1..=pages.len()).map(|i| format!("{i:0>digits$}.{ext}")).collect()
}

/// A page's plan at `px_per_unit` (or the page's), lowered to what fits in one image.
pub fn fitted_plan(project: &Project, page: &OutputPage, px_per_unit: Option<f64>) -> PagePlan {
  let sheet = project.sheet();
  let plan = plan_page(page, &sheet, &project.photos, px_per_unit);
  let fits = fit_pixels(&plan, MAX_PIXELS);
  if fits < plan.px_per_unit {
    plan_page(page, &sheet, &project.photos, Some(fits))
  } else {
    plan
  }
}

/// The page an estimate samples (the first with photos), and its plan made small.
pub fn sample_plan(project: &Project, pages: &[OutputPage], px_per_unit: f64) -> Option<PagePlan> {
  let sheet = project.sheet();
  let sample = pages
    .iter()
    .find(|p| !items_on(p, &sheet).is_empty())
    .or(pages.first())?;
  let full = plan_page(sample, &sheet, &project.photos, Some(px_per_unit));
  let k = full.px_per_unit * 1f64.min((SAMPLE_PIXELS / (full.px_w * full.px_h)).sqrt());
  Some(plan_page(sample, &sheet, &project.photos, Some(k)))
}

/// About how many bytes all the pages take, from a sample's bytes per pixel.
pub fn estimate_bytes(project: &Project, pages: &[OutputPage], px_per_unit: f64, sample: (&PagePlan, usize)) -> f64 {
  let sheet = project.sheet();
  let total: f64 = pages
    .iter()
    .map(|p| {
      let plan = plan_page(p, &sheet, &project.photos, Some(px_per_unit));
      (plan.px_w * plan.px_h).min(MAX_PIXELS)
    })
    .sum();
  let (plan, bytes) = sample;
  bytes as f64 / (plan.px_w * plan.px_h) * total
}

/// "980 KB", "12 MB", "1.4 GB".
pub fn format_bytes(n: f64) -> String {
  if n < 1e6 {
    format!("{} KB", (n / 1e3).round().max(1.0))
  } else if n < 1e9 {
    format!("{} MB", (n / 1e6).round())
  } else {
    format!("{:.1} GB", n / 1e9)
  }
}

/// What to say when some pages came out smaller than asked, to fit in one image.
pub fn lowered_notice(lowest: f64, unit: Unit) -> String {
  if unit == Unit::In {
    format!(
      "Some pages were exported at {} dpi, the most this app can make in one image.",
      lowest.floor()
    )
  } else {
    format!(
      "Some pages were exported at {}% of their size, the most this app can make in one image.",
      (lowest * 100.0).floor()
    )
  }
}

/// Files as a ZIP, compressed (PNGs shrink a little; JPEGs are stored as they are).
pub fn write_zip(files: &[(String, Vec<u8>)]) -> io::Result<Vec<u8>> {
  let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
  for (name, data) in files {
    let method = if name.ends_with(".jpg") {
      CompressionMethod::Stored
    } else {
      CompressionMethod::Deflated
    };
    zip
      .start_file(name, SimpleFileOptions::default().compression_method(method))
      .map_err(io::Error::other)?;
    zip.write_all(data)?;
  }
  Ok(zip.finish().map_err(io::Error::other)?.into_inner())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::render_plan::{Per, output_pages};

  fn book() -> Project {
    let json = serde_json::from_str(include_str!("../../../shared/fixtures/book.json")).expect("json");
    crate::schema::migrate_project(&json).expect("a project")
  }

  #[test]
  fn names() {
    let p = book();
    let spreads = output_pages(&p, Per::Spread);
    let names = image_names(&p, &spreads, "jpg");
    assert_eq!(names.first().map(String::as_str), Some("01.jpg"));
    assert!(names.get(1).is_some_and(|n| n.contains('-')), "{names:?}");
    let pages = output_pages(&p, Per::Page);
    let names = image_names(&p, &pages, "png");
    assert_eq!(names.first().map(String::as_str), Some("01.png"));
    assert_eq!(names.len(), pages.len());
  }

  #[test]
  fn zips() {
    let bytes = write_zip(&[("01.png".into(), vec![1, 2, 3]), ("02.jpg".into(), vec![4])]).expect("zips");
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).expect("reads");
    assert_eq!(zip.len(), 2);
    assert_eq!(zip.by_index(1).expect("a file").name().expect("a name"), "02.jpg");
  }

  #[test]
  fn sizes() {
    assert_eq!(format_bytes(980_000.0), "980 KB");
    assert_eq!(format_bytes(12_400_000.0), "12 MB");
    assert_eq!(format_bytes(1.44e9), "1.4 GB");
    assert_eq!(
      lowered_notice(212.7, Unit::In),
      "Some pages were exported at 212 dpi, the most this app can make in one image."
    );
  }
}
