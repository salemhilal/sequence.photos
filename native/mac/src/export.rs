//! The Export page's state and what it runs (`ExportView.tsx`, `pdf.ts`'s `savePdf`): where
//! the project goes, the choices for it (kept with the project, outside undo), and saving
//! a PDF, rendered in the background from the app's own copies of the photos.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use gpui_kit::component::slider::SliderState;
use gpui_kit::*;
use sequence_core::PhotoId;
use sequence_core::export_options::{Options, default_destination, export_px_per_unit, per_of};
use sequence_core::geometry::Rect;
use sequence_core::idml::{LinkedImage, build_idml, read_image_info, zip_stored};
use sequence_core::model::{ExportDestination as Destination, ExportState, ImageFormat};
use sequence_core::pdf::{Part, PhotoSource, render_pdf};
use sequence_core::project_file::unique_name;
use sequence_core::raster::{ZipOut, estimate_bytes, extension, fitted_plan, image_names, lowered_notice, sample_plan};
use sequence_core::render_plan::output_pages;
use sequence_core::units::terms;

use crate::commands::now_iso;
use crate::workspace::Workspace;

/// The Export page's own state: the page of the preview showing.
#[derive(Default)]
pub struct ExportUi {
  pub index: usize,
  /// Inches projects' dpi for this session (not saved, as on the web).
  pub dpi: Option<f64>,
  /// The JPEG quality slider, made with the page.
  pub quality: Option<Entity<SliderState>>,
  /// The quality while the slider's dragged, before it's saved.
  pub live_quality: Option<f64>,
  /// The images' estimated size in bytes, for the choices it was made with.
  pub estimate: Option<(String, f64)>,
  /// The choices an estimate is being made for.
  pub estimating: Option<String>,
}

/// What an export made, to save, and what it ran into.
pub struct Made {
  /// Photos with no image at all, left out.
  pub missing: usize,
  /// Photos drawn from their display copies.
  pub previews: usize,
  /// Said when nothing else is: e.g. pages made smaller to fit.
  pub notice: Option<String>,
}

/// An export's work, run in the background: written to the file at the path given,
/// hearing its progress (done, total).
type Job = Box<dyn FnOnce(&Path, &mut dyn FnMut(usize, usize)) -> Option<Made> + Send>;

/// A file to write an export into, buffered.
fn create(path: &Path) -> Option<std::io::BufWriter<std::fs::File>> {
  std::fs::File::create(path).ok().map(std::io::BufWriter::new)
}

/// JPEG quality of the parts of photos made for a PDF.
const PDF_QUALITY: f64 = 0.92;

pub const PREVIEWS_NOTICE: &str = "Some photos couldn’t be read at full size, so their previews were used.";

/// The app's copies of photos: originals in `images/`, display copies in `thumbs/`.
#[derive(Clone)]
pub struct LibrarySource {
  dir: PathBuf,
}

impl LibrarySource {
  fn image(&self, id: &PhotoId) -> PathBuf {
    self.dir.join("images").join(id.to_string())
  }

  fn thumb(&self, id: &PhotoId) -> PathBuf {
    self.dir.join("thumbs").join(format!("{id}.jpg"))
  }

  /// Where a photo can be read from, best first.
  pub fn paths(&self, id: &PhotoId) -> [PathBuf; 2] {
    [self.image(id), self.thumb(id)]
  }
}

impl PhotoSource for LibrarySource {
  fn jpeg_orientation(&mut self, id: &PhotoId) -> Option<u32> {
    crate::imageio::jpeg_orientation(&self.image(id))
  }

  fn original(&mut self, id: &PhotoId) -> Option<Vec<u8>> {
    std::fs::read(self.image(id)).ok()
  }

  fn part(&mut self, id: &PhotoId, whole: (u32, u32), src: Rect, out: (u32, u32)) -> Option<Part> {
    if let Some(jpeg) = crate::imageio::part_jpeg(&self.image(id), whole, src, out, PDF_QUALITY) {
      return Some(Part { jpeg, preview: false });
    }
    // The original won't decode: the display copy, at what it has.
    let jpeg = crate::imageio::part_jpeg(&self.thumb(id), whole, src, out, PDF_QUALITY)?;
    Some(Part { jpeg, preview: true })
  }
}

impl Workspace {
  /// Where Export sends the project: as picked, or the default for its page.
  pub fn export_to(&self) -> Destination {
    let p = self.project();
    p.export
      .as_ref()
      .and_then(|e| e.to)
      .unwrap_or_else(|| default_destination(&p.sheet()))
  }

  /// The choices, as saved with the project, with this session's dpi.
  pub fn export_options(&self) -> Options {
    let mut o = Options::for_project(self.project());
    o.dpi = self.ui.export.dpi;
    if let Some(q) = self.ui.export.live_quality {
      o.quality = q;
    }
    o
  }

  /// Keep the Export page's choices with the project (the library's copy, and the file
  /// when it's next saved), outside undo. Nothing changes when they're as they were.
  pub fn save_export_state(&mut self, cx: &mut Context<Self>, change: impl FnOnce(&mut ExportState)) {
    let was = self.project().export.clone().unwrap_or_default();
    let mut next = was.clone();
    change(&mut next);
    if next == was {
      return;
    }
    self.history.silent(|d| d.export = Some(next));
    // Kept with the library's next save, a moment from now (not on every keystroke).
    self.schedule_save(cx);
  }

  pub fn pick_destination(&mut self, to: Destination, cx: &mut Context<Self>) {
    self.save_export_state(cx, |s| s.to = Some(to));
    cx.notify();
  }

  /// Change the choices (the dpi stays with this session; the rest is saved).
  pub fn set_export_options(&mut self, cx: &mut Context<Self>, change: impl FnOnce(&mut Options)) {
    let mut o = self.export_options();
    change(&mut o);
    self.ui.export.dpi = o.dpi;
    let saved = o.saved();
    self.save_export_state(cx, |s| s.options = Some(saved));
    cx.notify();
  }

  /// ← →: the Export page's preview, a page along.
  pub fn page_export(&mut self, delta: isize, cx: &mut Context<Self>) {
    let to = self.export_to();
    if to == Destination::Instagram {
      let n = self.chosen_slides().len();
      self.ig.index = (self.ig.index as isize + delta).clamp(0, n.saturating_sub(1) as isize) as usize;
      cx.notify();
      return;
    }
    let per = if to == Destination::Indesign {
      sequence_core::render_plan::Per::Spread
    } else {
      per_of(self.project(), self.export_options().per)
    };
    let total = output_pages(self.project(), per).len();
    self.export_go(delta, total, cx);
  }

  pub fn export_go(&mut self, delta: isize, total: usize, cx: &mut Context<Self>) {
    let next = (self.ui.export.index as isize + delta).clamp(0, total.saturating_sub(1) as isize);
    self.ui.export.index = next as usize;
    cx.notify();
  }

  pub fn source(&self) -> LibrarySource {
    LibrarySource {
      dir: self.lib.dir.clone(),
    }
  }

  /// Ask where, then render and save the PDF, with progress in the status bar. Back to the
  /// desk once it's saved.
  pub fn save_pdf(&mut self, cx: &mut Context<Self>) {
    let project = self.project().clone();
    let o = self.export_options();
    let mut source = self.source();
    let job: Job = Box::new(move |path, progress| {
      let r = render_pdf(&project, o.per, o.dpi, o.print_at, &mut source, progress);
      std::fs::write(path, &r.bytes).ok()?;
      Some(Made {
        missing: r.missing,
        previews: r.previews,
        notice: None,
      })
    });
    self.export_file(
      ("", "pdf"),
      "Rendering PDF…",
      |d, t| format!("Rendering PDF {d} of {t}…"),
      "Couldn’t make the PDF.",
      job,
      cx,
    );
  }

  /// Ask where, then render each page as an image and save them as a ZIP.
  pub fn save_images(&mut self, cx: &mut Context<Self>) {
    let project = self.project().clone();
    let o = self.export_options();
    let source = self.source();
    let job: Job = Box::new(move |path, progress| {
      let sheet = project.sheet();
      let mut zip = ZipOut::new(create(path)?);
      let pages = output_pages(&project, per_of(&project, o.per));
      let target = export_px_per_unit(Destination::Images, &sheet, o.dpi);
      let png = o.format == ImageFormat::Png;
      let names = image_names(&project, &pages, extension(o.format));
      let (mut missing, mut previews) = (0, 0);
      let mut lowest = sheet.px_per_unit.min(target);
      for (i, page) in pages.iter().enumerate() {
        let plan = fitted_plan(&project, page, Some(target));
        lowest = lowest.min(plan.px_per_unit);
        let r = crate::imageio::render_page(&plan, &project.photos, |id| source.paths(id), png, o.quality)?;
        missing += r.missing;
        previews += r.previews;
        zip.add(&names[i], &r.bytes).ok()?;
        progress(i + 1, pages.len());
      }
      zip.finish().ok()?.into_inner().ok()?.sync_all().ok()?;
      Some(Made {
        missing,
        previews,
        notice: (lowest < target).then(|| lowered_notice(lowest, sheet.unit)),
      })
    });
    self.export_file(
      ("", "zip"),
      "Rendering images…",
      |d, t| format!("Rendering image {d} of {t}…"),
      "Couldn’t export the images.",
      job,
      cx,
    );
  }

  /// Ask where, then save an InDesign file and its photos together as a ZIP: the originals
  /// where InDesign can place them as they are, else upright JPEGs (`indesign.ts`).
  pub fn save_indesign(&mut self, cx: &mut Context<Self>) {
    let project = self.project().clone();
    let source = self.source();
    let stem = terms(project.layout.arrangement()).file_stem;
    let idml_name = format!("{stem}-{}.idml", &now_iso()[..10]);
    let job: Job = Box::new(move |out, progress| {
      let mut placed: Vec<PhotoId> = Vec::new();
      for s in project.layout.all() {
        for i in &s.items {
          if !placed.contains(&i.photo_id) {
            placed.push(i.photo_id.clone());
          }
        }
      }
      let mut links = HashMap::new();
      let mut files = Vec::new();
      let mut used = HashSet::new();
      for (i, id) in placed.iter().enumerate() {
        progress(i + 1, placed.len());
        let Some(meta) = project.photos.get(id) else { continue };
        let [image, thumb] = source.paths(id);
        let Some((data, format, ppi, size)) = linkable(&image, &thumb) else {
          continue;
        };
        let base = match meta.name.rfind('.') {
          Some(dot) => &meta.name[..dot],
          None => meta.name.as_str(),
        };
        let base = if base.is_empty() {
          id.to_string()
        } else {
          base.to_string()
        };
        let ext = if format == ImageFormat::Png { "png" } else { "jpg" };
        let path = format!(
          "Links/{}",
          unique_name(&format!("{base}.{ext}"), &id.to_string(), &mut used)
        );
        let (px_w, px_h) = size.unwrap_or((meta.px_w, meta.px_h));
        links.insert(
          id.clone(),
          LinkedImage {
            path: path.clone(),
            format,
            ppi,
            px_w,
            px_h,
          },
        );
        files.push((path, data));
      }
      let missing = placed.len() - links.len();
      let idml: Vec<(String, Vec<u8>)> = build_idml(&project, &links)
        .into_iter()
        .map(|(n, text)| (n, text.into_bytes()))
        .collect();
      // The IDML first, then each photo, copied in as it's read.
      let mut zip = ZipOut::new(create(out)?);
      zip.add(&idml_name, &zip_stored(&idml).ok()?).ok()?;
      for (name, data) in files {
        match data {
          Linked::File(p) => zip.add_reader(&name, &mut std::fs::File::open(p).ok()?).ok()?,
          Linked::Bytes(b) => zip.add(&name, &b).ok()?,
        }
      }
      zip.finish().ok()?.into_inner().ok()?.sync_all().ok()?;
      Some(Made {
        missing: 0,
        previews: 0,
        notice: (missing > 0).then(|| "Some photos’ images were missing, so their frames are empty.".into()),
      })
    });
    self.export_file(
      ("-indesign", "zip"),
      "Preparing photos…",
      |d, t| format!("Preparing photo {d} of {t}…"),
      "Couldn’t export for InDesign.",
      job,
      cx,
    );
  }

  /// Ask where to save `{stem}-{date}{suffix}.{ext}`, then run the job in the background with
  /// its progress in the status bar, save what it made, say what it ran into, and go back to
  /// the desk.
  fn export_file(
    &mut self,
    (suffix, ext): (&'static str, &'static str),
    busy: &'static str,
    label: fn(usize, usize) -> String,
    failed: &'static str,
    job: Job,
    cx: &mut Context<Self>,
  ) {
    if self.ui.busy.is_some() || self.is_importing() {
      return;
    }
    let dir = self
      .doc
      .path
      .as_ref()
      .and_then(|p| p.parent().map(|d| d.to_path_buf()))
      .or_else(|| std::env::home_dir().map(|h| h.join("Documents")))
      .unwrap_or_default();
    let stem = terms(self.project().layout.arrangement()).file_stem;
    // After the document, as Mac apps do; dated for an untitled one.
    let name = match self.doc.path.as_ref().and_then(|p| p.file_stem()) {
      Some(named) => {
        let named = named.to_string_lossy();
        match (suffix, ext) {
          ("-indesign", _) => format!("{named} (InDesign).zip"),
          (_, "zip") => format!("{named} (images).zip"),
          _ => format!("{named}.{ext}"),
        }
      }
      None => format!("{stem}-{}{suffix}.{ext}", &now_iso()[..10]),
    };
    let picked = cx.prompt_for_new_path(&dir, Some(&name));
    cx.spawn(async move |this, cx| {
      if let Ok(Ok(Some(path))) = picked.await {
        let path = if path.extension().is_none() {
          path.with_extension(ext)
        } else {
          path
        };
        let _ = this.update(cx, |ws, cx| ws.run_export(path, busy, label, failed, job, cx));
      }
    })
    .detach();
  }

  fn run_export(
    &mut self,
    path: PathBuf,
    busy: &'static str,
    label: fn(usize, usize) -> String,
    failed: &'static str,
    job: Job,
    cx: &mut Context<Self>,
  ) {
    if self.ui.busy.is_some() {
      return;
    }
    self.ui.busy = Some(busy.into());
    cx.notify();
    let (tx, mut rx) = futures::channel::mpsc::unbounded::<(usize, usize)>();
    let task = cx.background_executor().spawn(async move {
      job(&path, &mut |done, total| {
        let _ = tx.unbounded_send((done, total));
      })
    });
    cx.spawn(async move |this, cx| {
      use futures::StreamExt;
      while let Some((done, total)) = rx.next().await {
        let _ = this.update(cx, |ws, cx| {
          ws.ui.busy = Some(label(done, total));
          cx.notify();
        });
      }
      let made = task.await;
      let _ = this.update(cx, |ws, cx| {
        ws.ui.busy = None;
        match made {
          Some(m) => {
            if m.missing > 0 {
              ws.ui.notice = Some("Some photos’ images were missing, so they’re left out.".into());
            } else if m.previews > 0 {
              ws.ui.notice = Some(PREVIEWS_NOTICE.into());
            } else if let Some(n) = m.notice {
              ws.ui.notice = Some(n);
            }
            ws.go_to(crate::workspace::Page::Desk, cx);
          }
          None => ws.ui.notice = Some(failed.into()),
        }
        cx.notify();
      });
    })
    .detach();
  }

  /// The images' estimated size for these choices, or None while it's being worked out
  /// (which this starts, a moment after the choices settle).
  pub fn images_estimate(&mut self, cx: &mut Context<Self>) -> Option<f64> {
    let o = self.export_options();
    let sheet = self.project().sheet();
    let target = export_px_per_unit(Destination::Images, &sheet, o.dpi);
    let key = format!(
      "{:?} {:?} {} {} {}",
      o.per,
      o.format,
      o.quality,
      target,
      self.history.revision()
    );
    if let Some((k, bytes)) = &self.ui.export.estimate
      && *k == key
    {
      return Some(*bytes);
    }
    if self.ui.export.estimating.as_ref() == Some(&key) {
      return None;
    }
    self.ui.export.estimating = Some(key.clone());
    let project = self.project().clone();
    let source = self.source();
    cx.spawn(async move |this, cx| {
      cx.background_executor()
        .timer(std::time::Duration::from_millis(400))
        .await;
      let still = this
        .update(cx, |ws, _| ws.ui.export.estimating.as_ref() == Some(&key))
        .unwrap_or(false);
      if !still {
        return;
      }
      let bytes = cx
        .background_executor()
        .spawn(async move {
          let pages = output_pages(&project, per_of(&project, o.per));
          let plan = sample_plan(&project, &pages, target)?;
          let png = o.format == ImageFormat::Png;
          let r = crate::imageio::render_page(&plan, &project.photos, |id| source.paths(id), png, o.quality)?;
          Some(estimate_bytes(&project, &pages, target, (&plan, r.bytes.len())))
        })
        .await;
      let _ = this.update(cx, |ws, cx| {
        if ws.ui.export.estimating.as_ref() == Some(&key) {
          ws.ui.export.estimating = None;
          if let Some(b) = bytes {
            ws.ui.export.estimate = Some((key, b));
          }
          cx.notify();
        }
      });
    })
    .detach();
    None
  }
}

/// A photo for InDesign: its original as it is (copied straight from the library), or a
/// JPEG made for it.
enum Linked {
  File(PathBuf),
  Bytes(Vec<u8>),
}

/// Enough of a file to cover its metadata segments.
const HEADER_BYTES: u64 = 512 * 1024;
const REENCODE_QUALITY: f64 = 0.95;

/// The file to link for InDesign: the original when InDesign can place it as it is, else an
/// upright JPEG (from the display copy if the original won't decode). With its format, its
/// resolution, and its size when that's not the photo's.
#[allow(clippy::type_complexity)]
fn linkable(image: &Path, thumb: &Path) -> Option<(Linked, ImageFormat, f64, Option<(f64, f64)>)> {
  use std::io::Read;
  let mut head = Vec::new();
  std::fs::File::open(image)
    .ok()?
    .take(HEADER_BYTES)
    .read_to_end(&mut head)
    .ok()?;
  let info = read_image_info(&head);
  if info.format == Some(ImageFormat::Png) || (info.format == Some(ImageFormat::Jpeg) && info.orientation == 1) {
    return Some((Linked::File(image.to_path_buf()), info.format?, info.ppi, None));
  }
  let (data, w, h) = crate::imageio::upright_jpeg(image, REENCODE_QUALITY)
    .or_else(|| crate::imageio::upright_jpeg(thumb, REENCODE_QUALITY))?;
  // Written without a resolution, which InDesign reads as 72 ppi.
  Some((
    Linked::Bytes(data),
    ImageFormat::Jpeg,
    72.0,
    Some((f64::from(w), f64::from(h))),
  ))
}

#[cfg(test)]
mod tests {
  // Not `super::*`: GPUI's glob brings its own `test` attribute.
  use super::LibrarySource;
  use objc2_core_foundation::CFData;
  use objc2_core_graphics::{CGDataProvider, CGPDFDocument};
  use sequence_core::pdf::render_pdf;
  use sequence_core::render_plan::Per;

  const TOUR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/tour/");

  /// The shared book fixture, with the tour's photos as its "a" and "b" (and their real
  /// sizes) in a library folder named `name`. None without the tour's photos.
  fn library(name: &str) -> Option<(sequence_core::Project, std::path::PathBuf)> {
    let dir = std::env::temp_dir().join(format!("sequence-{name}-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("images")).expect("a folder");
    std::fs::create_dir_all(dir.join("thumbs")).expect("a folder");
    let json = serde_json::from_str(include_str!("../../../shared/fixtures/book.json")).expect("json");
    let mut project = sequence_core::schema::migrate_project(&json).expect("a project");
    for (id, file) in [("a", "taxi.jpg"), ("b", "door.jpg")] {
      let bytes = std::fs::read(format!("{TOUR}{file}")).ok()?;
      std::fs::write(dir.join("images").join(id), &bytes).expect("writes");
      let p = project
        .photos
        .values_mut()
        .find(|p| p.id.to_string() == id)
        .expect("the photo");
      (p.px_w, p.px_h) = (795.0, 1200.0);
    }
    Some((project, dir))
  }

  /// Each page as an image, at the size its plan says, with both photos read.
  #[test]
  fn renders_images_from_the_library() {
    use sequence_core::raster::fitted_plan;
    use sequence_core::render_plan::output_pages;
    let Some((project, dir)) = library("images") else {
      return;
    };
    let source = LibrarySource { dir: dir.clone() };
    for (i, page) in output_pages(&project, Per::Spread).iter().enumerate() {
      let plan = fitted_plan(&project, page, Some(30.0));
      let r = crate::imageio::render_page(&plan, &project.photos, |id| source.paths(id), false, 0.9).expect("renders");
      // To look at them: SEQUENCE_IMAGES_OUT=/some/folder cargo test renders_images
      if let Some(out) = std::env::var_os("SEQUENCE_IMAGES_OUT") {
        std::fs::write(std::path::Path::new(&out).join(format!("{i}.jpg")), &r.bytes).expect("writes");
      }
      assert_eq!((r.missing, r.previews), (0, 0));
      let d = crate::imageio::decode(&r.bytes, 10.0).expect("reads back");
      assert_eq!((d.px_w, d.px_h), (plan.px_w, plan.px_h));
    }
    std::fs::remove_dir_all(&dir).ok();
  }

  /// Each slide as Instagram gets it: the post's size, under its limit.
  #[test]
  fn makes_post_images() {
    use sequence_core::instagram::{post_image_layout, slide_size};
    use sequence_core::render_plan::{output_pages, plan_page};
    use sequence_core::{PostFit, PostKind};
    let Some((project, dir)) = library("post") else { return };
    let source = LibrarySource { dir: dir.clone() };
    let sheet = project.sheet();
    for kind in [PostKind::Feed, PostKind::Story] {
      let layout = post_image_layout(slide_size(&sheet), kind, PostFit::Expand);
      for page in output_pages(&project, Per::Page) {
        let scale = 1f64.min(layout.target.w / layout.source.w);
        let plan = plan_page(&page, &sheet, &project.photos, Some(sheet.px_per_unit * scale));
        let k = plan.px_per_unit / sheet.px_per_unit;
        let (jpeg, previews) =
          crate::imageio::post_image(&plan, &project.photos, |id| source.paths(id), &layout, k).expect("an image");
        assert_eq!(previews, 0);
        let d = crate::imageio::decode(&jpeg, 10.0).expect("reads back");
        assert_eq!((d.px_w, d.px_h), (layout.width, layout.height));
      }
    }
    std::fs::remove_dir_all(&dir).ok();
  }

  /// A JPEG that's upright goes to InDesign as it is.
  #[test]
  fn links_originals_for_indesign() {
    let Some((_, dir)) = library("indesign") else { return };
    let image = dir.join("images").join("a");
    let (data, format, _, size) = super::linkable(&image, &image).expect("links");
    assert_eq!(format, sequence_core::ImageFormat::Jpeg);
    assert!(matches!(data, super::Linked::File(p) if p == image));
    assert_eq!(size, None);
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn renders_a_pdf_from_the_library() {
    let tour = TOUR;
    let Some((project, dir)) = library("pdf") else { return };
    let mut source = LibrarySource { dir: dir.clone() };
    let r = render_pdf(&project, Per::Spread, None, 300.0, &mut source, &mut |_, _| {});
    assert_eq!((r.missing, r.previews), (0, 0));
    // To look at it: SEQUENCE_PDF_OUT=/some/file.pdf cargo test renders_a_pdf
    if let Some(out) = std::env::var_os("SEQUENCE_PDF_OUT") {
      std::fs::write(out, &r.bytes).expect("writes");
    }
    // "a" is small enough to go in as it is: its bytes are in the file.
    let taxi = std::fs::read(format!("{tour}taxi.jpg")).expect("reads");
    assert!(r.bytes.windows(64).any(|w| w == &taxi[..64]));
    // CoreGraphics opens it: three pages.
    let data = CFData::from_bytes(&r.bytes);
    let provider = CGDataProvider::with_cf_data(Some(&data)).expect("a provider");
    let doc = CGPDFDocument::with_provider(Some(&provider)).expect("opens");
    assert_eq!(CGPDFDocument::number_of_pages(Some(&doc)), 3);
    std::fs::remove_dir_all(&dir).ok();
  }
}
