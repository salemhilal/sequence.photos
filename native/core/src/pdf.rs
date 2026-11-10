//! The PDF export (`src/pdf.ts`, `src/pdfImage.ts`): one PDF page per output page, at true
//! size (pixels printed at a chosen dpi), drawn from the render plan. Each photo goes in as
//! its original JPEG when that's near the size needed (no decoding, full quality), or else
//! as a JPEG of just the part that shows, at the pixels needed, which the platform makes
//! (`PhotoSource`). Guides are left out. The file is written here, by hand: a PDF of filled
//! rectangles and JPEG images needs very little.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::io;

use crate::PhotoId;
use crate::crop::crop_of;
use crate::export_options::export_px_per_unit;
use crate::geometry::Rect;
use crate::model::{ExportDestination, Ink, PhotoMeta, Project, Unit};
use crate::render_plan::{Draw, Per, ink_rgb, output_pages, page_region, plan_page};
use crate::units::{js_round, terms};

/// How much larger than needed an original may be and still go in as it is.
pub const PASS_THROUGH_SLACK: f64 = 1.5;
/// The most pixels a photo is decoded at for the PDF (as the web app, held to Safari's limit).
pub const MAX_PIXELS: f64 = 16_000_000.0;

/// Whether to embed the original as it is: a JPEG at most PASS_THROUGH_SLACK times the
/// pixels needed across, and not cropped (the original would carry what's cut).
pub fn pass_through(is_jpeg: bool, photo: &PhotoMeta, need_w: f64) -> bool {
  is_jpeg && photo.crop.is_none() && photo.px_w <= need_w * PASS_THROUGH_SLACK
}

/// A PDF transformation matrix: (p, q) → (a p + c q + e, b p + d q + f).
pub type Matrix = [f64; 6];

/// Where a point of the stored image (u right, v down, 0 to 1) shows once upright, by EXIF
/// orientation: x right, y down, 0 to 1.
fn upright(orientation: u32, u: f64, v: f64) -> (f64, f64) {
  match orientation {
    2 => (1.0 - u, v),
    3 => (1.0 - u, 1.0 - v),
    4 => (u, 1.0 - v),
    5 => (v, u),
    6 => (1.0 - v, u),
    7 => (1.0 - v, 1.0 - u),
    8 => (v, 1.0 - u),
    _ => (u, v),
  }
}

/// The matrix that draws a JPEG with an EXIF orientation upright, filling `b` (in points, y
/// up from the page's bottom). PDF draws an image into the unit square with its first row
/// at the top, and doesn't apply EXIF orientation itself.
pub fn orientation_matrix(orientation: u32, b: Rect) -> Matrix {
  let at = |p: f64, q: f64| {
    let (x, y) = upright(orientation, p, 1.0 - q);
    (b.x + x * b.w, b.y + (1.0 - y) * b.h)
  };
  let (e, f) = at(0.0, 0.0);
  let (px, py) = at(1.0, 0.0);
  let (qx, qy) = at(0.0, 1.0);
  [px - e, py - f, qx - e, qy - f, e, f]
}

/// A JPEG's size and channels, from its frame header.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JpegInfo {
  pub width: u32,
  pub height: u32,
  pub components: u8,
}

/// A JPEG's frame header, if `bytes` is a JPEG.
pub fn jpeg_info(bytes: &[u8]) -> Option<JpegInfo> {
  if bytes.get(..2)? != [0xff, 0xd8] {
    return None;
  }
  let mut i = 2;
  while i + 4 <= bytes.len() {
    if bytes[i] != 0xff {
      return None;
    }
    let marker = bytes[i + 1];
    // Fill bytes, and markers with no length.
    if marker == 0xff {
      i += 1;
      continue;
    }
    if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
      i += 2;
      continue;
    }
    let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
    // Start of frame: any SOFn but DHT (c4), JPG (c8) and DAC (cc).
    if (0xc0..=0xcf).contains(&marker) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) {
      let h = bytes.get(i + 5..i + 7)?;
      let w = bytes.get(i + 7..i + 9)?;
      return Some(JpegInfo {
        height: u16::from_be_bytes([h[0], h[1]]) as u32,
        width: u16::from_be_bytes([w[0], w[1]]) as u32,
        components: *bytes.get(i + 9)?,
      });
    }
    if marker == 0xda {
      return None;
    }
    i += 2 + len;
  }
  None
}

/// An image added to a PDF.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ImageRef(usize);

/// A page's drawing: filled rectangles and images, in points from the bottom-left.
#[derive(Default)]
pub struct PageContent {
  ops: String,
  images: Vec<ImageRef>,
}

/// A number as PDF writes it: no exponent, no trailing zeros.
fn num(n: f64) -> String {
  let s = format!("{:.4}", if n.abs() < 5e-5 { 0.0 } else { n });
  let s = s.trim_end_matches('0').trim_end_matches('.');
  if s == "-0" { "0".into() } else { s.into() }
}

impl PageContent {
  pub fn fill_rect(&mut self, r: Rect, rgb: [u8; 3]) {
    let [red, g, b] = rgb.map(|c| num(f64::from(c) / 255.0));
    let _ = writeln!(
      self.ops,
      "{red} {g} {b} rg {} {} {} {} re f",
      num(r.x),
      num(r.y),
      num(r.w),
      num(r.h)
    );
  }

  pub fn draw_image(&mut self, image: ImageRef, m: Matrix) {
    let [a, b, c, d, e, f] = m.map(num);
    let _ = writeln!(self.ops, "q {a} {b} {c} {d} {e} {f} cm /Im{} Do Q", image.0);
    if !self.images.contains(&image) {
      self.images.push(image);
    }
  }
}

/// A PDF being written to `out` as it goes: each object as it's added (a big export
/// needn't fit in memory), then the catalog, page tree, info, and cross-reference table.
pub struct PdfWriter<W: io::Write = Vec<u8>> {
  out: W,
  /// Bytes written so far.
  pos: u64,
  /// Each object's offset, by its number less one. 1 is the catalog, 2 the page tree, 3 the
  /// info: written last, so their offsets are filled in then.
  offsets: Vec<u64>,
  info: String,
  pages: Vec<usize>,
  /// The first write that failed: everything after is skipped, and `finish` reports it.
  error: Option<io::Error>,
}

impl PdfWriter<Vec<u8>> {
  /// A PDF written into memory.
  pub fn new(title: &str) -> Self {
    Self::to(Vec::new(), title)
  }
}

impl<W: io::Write> PdfWriter<W> {
  pub fn to(out: W, title: &str) -> Self {
    let mut w = Self {
      out,
      pos: 0,
      offsets: vec![0, 0, 0],
      info: format!("<< /Title {} /Creator (Sequence) /Producer (Sequence) >>", text(title)),
      pages: Vec::new(),
      error: None,
    };
    w.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    w
  }

  fn write(&mut self, bytes: &[u8]) {
    if self.error.is_some() {
      return;
    }
    match self.out.write_all(bytes) {
      Ok(()) => self.pos += bytes.len() as u64,
      Err(e) => self.error = Some(e),
    }
  }

  /// Write object `n`'s body (its parts in turn), noting where it starts.
  fn object(&mut self, n: usize, parts: &[&[u8]]) {
    self.offsets[n - 1] = self.pos;
    self.write(format!("{n} 0 obj\n").as_bytes());
    for part in parts {
      self.write(part);
    }
    self.write(b"\nendobj\n");
  }

  fn add(&mut self, parts: &[&[u8]]) -> usize {
    self.offsets.push(0);
    let n = self.offsets.len();
    self.object(n, parts);
    n
  }

  /// Embed a JPEG as it is. None if it isn't a JPEG PDF can show (grayscale, RGB or CMYK).
  pub fn add_jpeg(&mut self, bytes: &[u8]) -> Option<ImageRef> {
    let info = jpeg_info(bytes)?;
    let space = match info.components {
      1 => "/DeviceGray",
      3 => "/DeviceRGB",
      // Adobe's CMYK JPEGs store their ink inverted.
      4 => "/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]",
      _ => return None,
    };
    let head = format!(
      "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace {space} /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
      info.width,
      info.height,
      bytes.len()
    );
    Some(ImageRef(self.add(&[head.as_bytes(), bytes, b"\nendstream"])))
  }

  /// A page `w` × `h` points.
  pub fn add_page(&mut self, w: f64, h: f64, content: PageContent) {
    let head = format!("<< /Length {} >>\nstream\n", content.ops.len());
    let contents = self.add(&[head.as_bytes(), content.ops.as_bytes(), b"endstream"]);
    let images: String = content.images.iter().map(|i| format!(" /Im{0} {0} 0 R", i.0)).collect();
    let page = format!(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /XObject <<{images} >> >> /Contents {contents} 0 R >>",
      num(w),
      num(h)
    );
    let n = self.add(&[page.as_bytes()]);
    self.pages.push(n);
  }

  /// The rest of the file; its output.
  pub fn finish(mut self) -> io::Result<W> {
    self.object(1, &[b"<< /Type /Catalog /Pages 2 0 R >>"]);
    let kids: String = self.pages.iter().map(|n| format!("{n} 0 R ")).collect();
    let tree = format!(
      "<< /Type /Pages /Kids [{}] /Count {} >>",
      kids.trim_end(),
      self.pages.len()
    );
    self.object(2, &[tree.as_bytes()]);
    let info = std::mem::take(&mut self.info);
    self.object(3, &[info.as_bytes()]);
    let xref = self.pos;
    let mut table = format!("xref\n0 {}\n0000000000 65535 f \n", self.offsets.len() + 1);
    for o in &self.offsets {
      let _ = writeln!(table, "{o:010} 00000 n ");
    }
    let _ = write!(
      table,
      "trailer\n<< /Size {} /Root 1 0 R /Info 3 0 R >>\nstartxref\n{xref}\n%%EOF\n",
      self.offsets.len() + 1
    );
    self.write(table.as_bytes());
    match self.error {
      Some(e) => Err(e),
      None => Ok(self.out),
    }
  }
}

/// A PDF text string: plain ASCII as a literal, anything else as UTF-16 in hex.
fn text(s: &str) -> String {
  if s.chars().all(|c| c.is_ascii() && !c.is_ascii_control()) {
    format!("({})", s.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)"))
  } else {
    let hex: String = s.encode_utf16().map(|u| format!("{u:04X}")).collect();
    format!("<FEFF{hex}>")
  }
}

/// A part of a photo made for the PDF: a JPEG, and whether it came from the display copy
/// (the original couldn't be read).
pub struct Part {
  pub jpeg: Vec<u8>,
  pub preview: bool,
}

/// Where the PDF's photos come from: the app's own files, decoded by the platform.
pub trait PhotoSource {
  /// The original's EXIF orientation, if the original is a JPEG.
  fn jpeg_orientation(&mut self, id: &PhotoId) -> Option<u32>;
  /// The original's bytes.
  fn original(&mut self, id: &PhotoId) -> Option<Vec<u8>>;
  /// The photo decoded upright at `whole` pixels, then the part `src` of it (in those
  /// pixels) at `out` pixels, on white, as a JPEG. Its display copy, if the original can't
  /// be read.
  fn part(&mut self, id: &PhotoId, whole: (u32, u32), src: Rect, out: (u32, u32)) -> Option<Part>;
}

/// The size a photo is decoded at for a draw (`decodePhoto`): the whole photo at its placed
/// size, but never past its own resolution, nor past MAX_PIXELS.
pub fn decode_size(photo: &PhotoMeta, placed_w: f64, placed_h: f64) -> (u32, u32) {
  let crop = crop_of(photo);
  let w = placed_w / crop.w;
  let h = placed_h / crop.h;
  let own = 1f64.min(photo.px_w / w).min(photo.px_h / h);
  let k = own.min((MAX_PIXELS / (w * h)).sqrt());
  (js_round(w * k).max(1.0) as u32, js_round(h * k).max(1.0) as u32)
}

/// What rendering a PDF made, and what it ran into.
pub struct PdfResult<W = Vec<u8>> {
  pub bytes: W,
  /// Photos drawn from their display copies, their originals unreadable.
  pub previews: usize,
  /// Photos with no image at all, left out.
  pub missing: usize,
}

/// PDF points per unit: 72 to the inch, and for pixels, as many as print at `print_at` dpi.
fn pt_per_unit(unit: Unit, print_at: f64) -> f64 {
  if unit == Unit::In { 72.0 } else { 72.0 / print_at }
}

/// The project as a PDF: one page per spread (a book's first and last pages are single) or
/// per page, as `per` says; inches projects' photos at `dpi` (or the project's), pixel
/// projects printed at `print_at`. `progress` hears after each page.
pub fn render_pdf(
  project: &Project,
  per: Per,
  dpi: Option<f64>,
  print_at: f64,
  source: &mut dyn PhotoSource,
  progress: &mut dyn FnMut(usize, usize),
) -> PdfResult {
  let r = render_pdf_to(Vec::new(), project, per, dpi, print_at, source, progress);
  // Writing into memory can't fail.
  r.unwrap_or_else(|_| PdfResult {
    bytes: Vec::new(),
    previews: 0,
    missing: 0,
  })
}

/// `render_pdf`, written to `out` as it goes.
pub fn render_pdf_to<W: io::Write>(
  out: W,
  project: &Project,
  per: Per,
  dpi: Option<f64>,
  print_at: f64,
  source: &mut dyn PhotoSource,
  progress: &mut dyn FnMut(usize, usize),
) -> io::Result<PdfResult<W>> {
  let sheet = project.sheet();
  let mut pdf = PdfWriter::to(out, terms(sheet.arrangement).pdf_title);
  let to_pt = pt_per_unit(sheet.unit, print_at);
  let px_per_unit = export_px_per_unit(ExportDestination::Pdf, &sheet, dpi);
  // Each original embedded as it is goes in once, however many pages draw it.
  let mut originals: HashMap<PhotoId, Option<(ImageRef, u32)>> = HashMap::new();
  let (mut previews, mut missing) = (0, 0);
  let pages = output_pages(project, crate::export_options::per_of(project, per));
  let total = pages.len();
  for (i, out) in pages.iter().enumerate() {
    let plan = plan_page(out, &sheet, &project.photos, Some(px_per_unit));
    // Output pixels to points; PDF's origin is the bottom-left corner.
    let pt = to_pt / plan.px_per_unit;
    let page_h = sheet.page_h * to_pt;
    let page_w = page_region(out, &sheet).w * to_pt;
    let to_box = |r: Rect| Rect::new(r.x * pt, page_h - (r.y + r.h) * pt, r.w * pt, r.h * pt);
    let mut content = PageContent::default();
    if plan.background != Ink::White {
      content.fill_rect(Rect::new(0.0, 0.0, page_w, page_h), ink_rgb(plan.background));
    }
    for d in &plan.draws {
      let Some(photo) = project.photos.get(&d.photo_id) else {
        continue;
      };
      if let Some(b) = d.border {
        let p = d.placed;
        let r = Rect::new(p.x - b.width, p.y - b.width, p.w + 2.0 * b.width, p.h + 2.0 * b.width);
        content.fill_rect(to_box(r), ink_rgb(b.color));
      }
      match embed(&mut pdf, d, photo, source, &mut originals) {
        Some(Embedded::Whole(image, orientation)) => {
          content.draw_image(image, orientation_matrix(orientation, to_box(d.placed)));
        }
        Some(Embedded::Part(image, preview)) => {
          previews += usize::from(preview);
          let b = to_box(d.dst);
          content.draw_image(image, [b.w, 0.0, 0.0, b.h, b.x, b.y]);
        }
        // An unreadable photo is left out rather than failing the whole PDF.
        None => missing += 1,
      }
    }
    pdf.add_page(page_w, page_h, content);
    progress(i + 1, total);
  }
  Ok(PdfResult {
    bytes: pdf.finish()?,
    previews,
    missing,
  })
}

enum Embedded {
  /// The original, drawn whole at its placed size (the page crops it), with its orientation.
  Whole(ImageRef, u32),
  /// Just the part that shows; whether it came from the display copy.
  Part(ImageRef, bool),
}

fn embed<W: io::Write>(
  pdf: &mut PdfWriter<W>,
  d: &Draw,
  photo: &PhotoMeta,
  source: &mut dyn PhotoSource,
  originals: &mut HashMap<PhotoId, Option<(ImageRef, u32)>>,
) -> Option<Embedded> {
  let orientation = source.jpeg_orientation(&d.photo_id);
  if pass_through(orientation.is_some(), photo, d.placed.w) {
    let original = originals
      .entry(d.photo_id.clone())
      .or_insert_with(|| {
        // Some JPEGs (unusual color spaces, say) won't embed: those are re-encoded below.
        let bytes = source.original(&d.photo_id)?;
        Some((pdf.add_jpeg(&bytes)?, orientation.unwrap_or(1)))
      })
      .as_ref();
    if let Some(&(image, o)) = original {
      return Some(Embedded::Whole(image, o));
    }
  }
  let whole = decode_size(photo, d.placed.w, d.placed.h);
  // The part that shows, at the decoded size (the placed size, or the photo's own if less).
  let kx = f64::from(whole.0) / photo.px_w;
  let ky = f64::from(whole.1) / photo.px_h;
  let out = (
    js_round(d.src.w * kx).max(1.0) as u32,
    js_round(d.src.h * ky).max(1.0) as u32,
  );
  let src = Rect::new(d.src.x * kx, d.src.y * ky, d.src.w * kx, d.src.h * ky);
  let part = source.part(&d.photo_id, whole, src, out)?;
  let image = pdf.add_jpeg(&part.jpeg)?;
  Some(Embedded::Part(image, part.preview))
}

#[cfg(test)]
mod tests {
  use super::*;

  const BOX: Rect = Rect {
    x: 10.0,
    y: 20.0,
    w: 100.0,
    h: 200.0,
  };

  fn apply(m: Matrix, p: f64, q: f64) -> (f64, f64) {
    (m[0] * p + m[2] * q + m[4], m[1] * p + m[3] * q + m[5])
  }

  #[test]
  fn orientation_matrices() {
    assert_eq!(orientation_matrix(1, BOX), [100.0, 0.0, 0.0, 200.0, 10.0, 20.0]);
    let m = orientation_matrix(6, BOX);
    assert_eq!(apply(m, 0.0, 1.0), (110.0, 220.0));
    assert_eq!(apply(m, 0.0, 0.0), (10.0, 220.0));
    assert_eq!(apply(orientation_matrix(3, BOX), 0.0, 1.0), (110.0, 20.0));
    for o in 1..=8 {
      let m = orientation_matrix(o, BOX);
      let mut corners: Vec<(i64, i64)> = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
        .iter()
        .map(|&(p, q)| {
          let (x, y) = apply(m, p, q);
          (x.round() as i64, y.round() as i64)
        })
        .collect();
      corners.sort();
      assert_eq!(corners, vec![(10, 20), (10, 220), (110, 20), (110, 220)]);
      let det = m[0] * m[3] - m[1] * m[2];
      assert_eq!(det < 0.0, [2, 4, 5, 7].contains(&o), "orientation {o}");
    }
  }

  fn photo(px_w: f64) -> PhotoMeta {
    serde_json::from_value(serde_json::json!({
      "id": "p", "name": "p.jpg", "pxW": px_w, "pxH": px_w * 2.0 / 3.0
    }))
    .expect("a photo")
  }

  #[test]
  fn passes_through_jpegs_near_the_size_needed() {
    assert!(pass_through(true, &photo(3000.0), 3000.0));
    assert!(pass_through(true, &photo(4400.0), 3000.0));
    assert!(pass_through(true, &photo(1000.0), 3000.0));
    assert!(!pass_through(true, &photo(6000.0), 3000.0));
    assert!(!pass_through(false, &photo(1000.0), 3000.0));
  }

  /// A JPEG's start, enough for its header: SOI, an APP0, and a baseline frame.
  fn tiny_jpeg(w: u16, h: u16, components: u8) -> Vec<u8> {
    let mut b = vec![
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    ];
    b.extend_from_slice(&h.to_be_bytes());
    b.extend_from_slice(&w.to_be_bytes());
    b.push(components);
    b.extend_from_slice(&[0; 6]);
    b.extend_from_slice(&[0xff, 0xd9]);
    b
  }

  #[test]
  fn reads_jpeg_headers() {
    assert_eq!(
      jpeg_info(&tiny_jpeg(640, 480, 3)),
      Some(JpegInfo {
        width: 640,
        height: 480,
        components: 3
      })
    );
    assert_eq!(jpeg_info(b"\x89PNG"), None);
  }

  #[test]
  fn writes_a_well_formed_file() {
    let mut pdf = PdfWriter::new("Photo book");
    let image = pdf.add_jpeg(&tiny_jpeg(4, 3, 3)).expect("embeds");
    let mut content = PageContent::default();
    content.fill_rect(Rect::new(0.0, 0.0, 72.0, 72.0), [0, 0, 0]);
    content.draw_image(image, [72.0, 0.0, 0.0, 54.0, 0.0, 9.0]);
    pdf.add_page(72.0, 72.0, content);
    let bytes = pdf.finish().expect("writes");
    let rfind = |needle: &[u8]| bytes.windows(needle.len()).rposition(|w| w == needle);
    let text = String::from_utf8_lossy(&bytes);
    assert!(bytes.starts_with(b"%PDF-1.4"));
    assert!(text.contains("/Count 1"));
    assert!(text.contains("0 0 0 rg 0 0 72 72 re f"));
    assert!(text.contains("/Im4 Do"));
    // Every offset in the table points at its object.
    let xref = rfind(b"\nxref\n").expect("a table") + 1;
    let tail = std::str::from_utf8(&bytes[xref..]).expect("the table is text");
    let start: usize = tail
      .lines()
      .skip_while(|l| *l != "startxref")
      .nth(1)
      .and_then(|l| l.parse().ok())
      .expect("an offset");
    assert_eq!(start, xref);
    for (n, line) in tail.lines().skip(3).take_while(|l| l.ends_with(" n ")).enumerate() {
      let at: usize = line[..10].parse().expect("an offset");
      assert!(
        bytes[at..].starts_with(format!("{} 0 obj", n + 1).as_bytes()),
        "object {}",
        n + 1
      );
    }
  }

  type PartAsked = (String, (u32, u32), (u32, u32));

  /// Photos from nowhere: tiny JPEGs, with "b" unreadable when `lose_b`.
  struct Fake {
    lose_b: bool,
    /// Each part asked for: the photo, its decoded size, the part's size.
    parts: Vec<PartAsked>,
  }

  impl PhotoSource for Fake {
    fn jpeg_orientation(&mut self, _: &PhotoId) -> Option<u32> {
      Some(1)
    }
    fn original(&mut self, _: &PhotoId) -> Option<Vec<u8>> {
      Some(tiny_jpeg(8, 8, 3))
    }
    fn part(&mut self, id: &PhotoId, whole: (u32, u32), _: Rect, out: (u32, u32)) -> Option<Part> {
      if self.lose_b && id.to_string() == "b" {
        return None;
      }
      self.parts.push((id.to_string(), whole, out));
      Some(Part {
        jpeg: tiny_jpeg(out.0 as u16, out.1 as u16, 3),
        preview: id.to_string() == "a",
      })
    }
  }

  fn book() -> Project {
    let json = serde_json::from_str(include_str!("../../../shared/fixtures/book.json")).expect("json");
    crate::schema::migrate_project(&json).expect("a project")
  }

  #[test]
  fn renders_the_book() {
    let mut fake = Fake {
      lose_b: false,
      parts: Vec::new(),
    };
    let mut seen = Vec::new();
    let r = render_pdf(&book(), Per::Spread, None, 300.0, &mut fake, &mut |d, t| {
      seen.push((d, t))
    });
    // The first page, the middle spread, the last page.
    assert_eq!(seen, vec![(1, 3), (2, 3), (3, 3)]);
    assert_eq!((r.missing, r.previews), (0, 1));
    // "a" is 3000 px placed at 1800 (6 in at 300 dpi): too large to go in as it is, so
    // it's decoded at the placed size. "b" is cropped, so it's cut too.
    assert_eq!(fake.parts[0], ("a".into(), (1800, 1200), (1800, 1200)));
    assert_eq!(fake.parts[1].0, "b");
    let text = String::from_utf8_lossy(&r.bytes);
    assert!(text.contains("/Count 3"));
    // The middle spread is 20 × 8 in; the last page is black.
    assert!(text.contains("/MediaBox [0 0 1440 576]"));
    assert!(text.contains("0 0 0 rg 0 0 720 576 re f"));
  }

  #[test]
  fn leaves_out_what_it_cant_read() {
    let mut fake = Fake {
      lose_b: true,
      parts: Vec::new(),
    };
    let r = render_pdf(&book(), Per::Page, Some(150.0), 300.0, &mut fake, &mut |_, _| {});
    // "b" crosses the gutter, so it's on both of the spread's pages.
    assert_eq!(r.missing, 2);
    // At 150 dpi, "a" needs 900 px across: still too large to go in as it is.
    assert_eq!(fake.parts[0].1, (900, 600));
    assert!(String::from_utf8_lossy(&r.bytes).contains("/Count 4"));
  }

  #[test]
  fn numbers() {
    assert_eq!(num(72.0), "72");
    assert_eq!(num(0.5), "0.5");
    assert_eq!(num(-0.00001), "0");
    assert_eq!(num(1.0 / 3.0), "0.3333");
  }

  #[test]
  fn titles() {
    assert_eq!(text("Photo (book)"), "(Photo \\(book\\))");
    assert_eq!(text("é"), "<FEFF00E9>");
  }
}
