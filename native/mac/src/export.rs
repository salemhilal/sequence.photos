//! The Export page's state and what it runs (`ExportView.tsx`, `pdf.ts`'s `savePdf`): where
//! the project goes, the choices for it (kept with the project, outside undo), and saving
//! a PDF, rendered in the background from the app's own copies of the photos.

use std::path::PathBuf;

use gpui_kit::*;
use sequence_core::PhotoId;
use sequence_core::export_options::{Options, default_destination};
use sequence_core::geometry::Rect;
use sequence_core::model::{ExportDestination as Destination, ExportState};
use sequence_core::pdf::{Part, PhotoSource, render_pdf};
use sequence_core::units::terms;

use crate::commands::now_iso;
use crate::workspace::Workspace;

/// The Export page's own state: the page of the preview showing.
#[derive(Default)]
pub struct ExportUi {
  pub index: usize,
  /// Inches projects' dpi for this session (not saved, as on the web).
  pub dpi: Option<f64>,
}

/// JPEG quality of the parts of photos made for a PDF.
const PDF_QUALITY: f64 = 0.92;

pub const PREVIEWS_NOTICE: &str = "Some photos couldn’t be read at full size, so their previews were used.";

/// The app's copies of photos: originals in `images/`, display copies in `thumbs/`.
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
    o
  }

  /// Keep the Export page's choices with the project: in the library's copy and the file,
  /// outside undo. Nothing changes when they're as they were.
  fn save_export_state(&mut self, change: impl FnOnce(&mut ExportState)) {
    let was = self.project().export.clone().unwrap_or_default();
    let mut next = was.clone();
    change(&mut next);
    if next == was {
      return;
    }
    self.history.silent(|d| d.export = Some(next));
    if self.lib.save_project(self.history.project()).is_err() {
      self.ui.notice = Some("Couldn’t keep a copy of your work in the app’s storage.".into());
    }
  }

  pub fn pick_destination(&mut self, to: Destination, cx: &mut Context<Self>) {
    self.save_export_state(|s| s.to = Some(to));
    cx.notify();
  }

  /// Change the choices (the dpi stays with this session; the rest is saved).
  pub fn set_export_options(&mut self, cx: &mut Context<Self>, change: impl FnOnce(&mut Options)) {
    let mut o = self.export_options();
    change(&mut o);
    self.ui.export.dpi = o.dpi;
    let saved = o.saved();
    self.save_export_state(|s| s.options = Some(saved));
    cx.notify();
  }

  pub fn export_go(&mut self, delta: isize, total: usize, cx: &mut Context<Self>) {
    let next = (self.ui.export.index as isize + delta).clamp(0, total.saturating_sub(1) as isize);
    self.ui.export.index = next as usize;
    cx.notify();
  }

  /// Ask where, then render and save the PDF, with progress in the status bar. Back to the
  /// desk once it's saved.
  pub fn save_pdf(&mut self, cx: &mut Context<Self>) {
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
    let name = format!("{stem}-{}.pdf", &now_iso()[..10]);
    let picked = cx.prompt_for_new_path(&dir, Some(&name));
    cx.spawn(async move |this, cx| {
      if let Ok(Ok(Some(path))) = picked.await {
        let _ = this.update(cx, |ws, cx| ws.write_pdf(path, cx));
      }
    })
    .detach();
  }

  fn write_pdf(&mut self, path: PathBuf, cx: &mut Context<Self>) {
    let path = if path.extension().is_none() {
      path.with_extension("pdf")
    } else {
      path
    };
    let project = self.project().clone();
    let o = self.export_options();
    let mut source = LibrarySource {
      dir: self.lib.dir.clone(),
    };
    self.ui.busy = Some("Rendering PDF…".into());
    cx.notify();
    let (tx, mut rx) = futures::channel::mpsc::unbounded::<(usize, usize)>();
    let task = cx.background_executor().spawn(async move {
      let result = render_pdf(&project, o.per, o.dpi, o.print_at, &mut source, &mut |done, total| {
        let _ = tx.unbounded_send((done, total));
      });
      std::fs::write(&path, &result.bytes).map(|()| result)
    });
    cx.spawn(async move |this, cx| {
      use futures::StreamExt;
      while let Some((done, total)) = rx.next().await {
        let _ = this.update(cx, |ws, cx| {
          ws.ui.busy = Some(format!("Rendering PDF {done} of {total}…"));
          cx.notify();
        });
      }
      let result = task.await;
      let _ = this.update(cx, |ws, cx| {
        ws.ui.busy = None;
        match result {
          Ok(r) => {
            if r.missing > 0 {
              ws.ui.notice = Some("Some photos’ images were missing, so they’re left out.".into());
            } else if r.previews > 0 {
              ws.ui.notice = Some(PREVIEWS_NOTICE.into());
            }
            ws.go_to(crate::workspace::Page::Desk, cx);
          }
          Err(_) => ws.ui.notice = Some("Couldn’t make the PDF.".into()),
        }
        cx.notify();
      });
    })
    .detach();
  }
}

#[cfg(test)]
mod tests {
  // Not `super::*`: GPUI's glob brings its own `test` attribute.
  use super::LibrarySource;
  use objc2_core_foundation::CFData;
  use objc2_core_graphics::{CGDataProvider, CGPDFDocument};
  use sequence_core::pdf::render_pdf;
  use sequence_core::render_plan::Per;

  /// The shared book fixture, with the tour's photos as its "a" and "b", and their real sizes.
  #[test]
  fn renders_a_pdf_from_the_library() {
    let tour = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/tour/");
    let dir = std::env::temp_dir().join(format!("sequence-pdf-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("images")).expect("a folder");
    std::fs::create_dir_all(dir.join("thumbs")).expect("a folder");
    let json = serde_json::from_str(include_str!("../../../shared/fixtures/book.json")).expect("json");
    let mut project = sequence_core::schema::migrate_project(&json).expect("a project");
    for (id, file) in [("a", "taxi.jpg"), ("b", "door.jpg")] {
      let Ok(bytes) = std::fs::read(format!("{tour}{file}")) else {
        return;
      };
      std::fs::write(dir.join("images").join(id), &bytes).expect("writes");
      let p = project
        .photos
        .values_mut()
        .find(|p| p.id.to_string() == id)
        .expect("the photo");
      (p.px_w, p.px_h) = (795.0, 1200.0);
    }
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
