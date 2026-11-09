//! An IDML file (`src/idml.ts`): InDesign Markup Language, a ZIP of XML that InDesign opens
//! as a new document. A book becomes a facing-pages document with the same page size and
//! spreads, and a sequence of frames a document of single pages, one to a spread (in
//! inches, or pixels at a point each), with the drop border guide as margins, the other
//! guides as ruler guides, and each photo as a frame with its image linked from `Links/`.
//!
//! Coordinates: an IDML spread's origin is at its binding (our gutter) and vertical center,
//! in points; y grows downward, as in the app. A single page without facing pages is
//! centered on it, so a frame's photos shift left by half its width.

use std::collections::HashMap;
use std::io::{self, Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::crop::{crop_of, whole_rect};
use crate::geometry::{Rect, drop_guide, edges_of, line_on_page, line_position, page_rect, page_sides};
use crate::model::{Arrangement, Axis, Crop, Edges, ImageFormat, PageSide, Project, Sheet, Spread, Unit};
use crate::units::js_round;
use crate::{PhotoId, js_number};

/// Points to the inch: images are sized by their own resolution in it.
const PT_PER_INCH: f64 = 72.0;
const PKG: &str = "http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging";
const DOM: &str = "8.0";
const HEAD: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#;
const LAYER: &str = "layer";
/// Space between spreads on InDesign's pasteboard.
const SPREAD_SPACING: f64 = 36.0;
/// The package's type, the archive's first file.
pub const MIMETYPE: &str = "application/vnd.adobe.indesign-idml-package";

/// A photo's image file, relative to the IDML file.
#[derive(Clone, Debug, PartialEq)]
pub struct LinkedImage {
  pub path: String,
  pub format: ImageFormat,
  /// The file's stored resolution, which InDesign sizes it by.
  pub ppi: f64,
  /// The file's pixel size (upright).
  pub px_w: f64,
  pub px_h: f64,
}

/// Where a frame's left edge sits in its spread, in page units: centered on the origin.
fn frame_shift(s: &Sheet) -> f64 {
  if s.arrangement == Arrangement::Frames {
    -s.page_w / 2.0
  } else {
    0.0
  }
}

/// A page's left and right distances from a border guide's edges: outside is a frame's
/// (and a left page's) left.
fn left_right(side: Option<PageSide>, g: &Edges) -> (f64, f64) {
  if matches!(side, Some(PageSide::Right) | None) {
    (g.inside, g.outside)
  } else {
    (g.outside, g.inside)
  }
}

/// Points per page unit: 72 to the inch, and a point to the pixel (InDesign's pixels).
fn pt_per_unit(s: &Sheet) -> f64 {
  if s.unit == Unit::In { PT_PER_INCH } else { 1.0 }
}

/// A number for XML: no exponent notation, and no floating-point noise.
fn n(v: f64) -> String {
  js_number(js_round(v * 10000.0) / 10000.0)
}

fn esc(s: &str) -> String {
  s.replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
}

/// JavaScript's encodeURIComponent.
fn encode_uri_component(s: &str) -> String {
  let mut out = String::new();
  for b in s.bytes() {
    if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
      out.push(b as char);
    } else {
      out.push_str(&format!("%{b:02X}"));
    }
  }
  out
}

/// The IDML's files, by name, in order (the package type first).
pub fn build_idml(project: &Project, links: &HashMap<PhotoId, LinkedImage>) -> Vec<(String, String)> {
  let mut next = 0;
  // InDesign names its own objects u1, u2, …; a distinct prefix keeps ours from matching them.
  let mut id = move || {
    next += 1;
    format!("pbs{next}")
  };
  let sheet = project.sheet();
  let spreads = project.layout.all();
  let mut spread_files = Vec::new();
  for (i, spread) in spreads.iter().enumerate() {
    let spread_id = id();
    let xml = spread_xml(project, &spreads, spread, i, &spread_id, &mut id, links);
    spread_files.push((format!("Spreads/Spread_{spread_id}.xml"), xml));
  }
  let spread_refs: Vec<String> = spread_files
    .iter()
    .map(|(name, _)| format!(r#"<idPkg:Spread src="{name}"/>"#))
    .collect();
  let designmap = format!(
    r#"{HEAD}
<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="8.0(370)" ?>
<Document xmlns:idPkg="{PKG}" DOMVersion="{DOM}" Self="d">
<idPkg:Preferences src="Resources/Preferences.xml"/>
<Layer Self="{LAYER}" Name="Photos" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"/>
{}
</Document>"#,
    spread_refs.join("\n")
  );
  let container = format!(
    r#"{HEAD}
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
<rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles>
</container>"#
  );
  let mut files = vec![
    ("mimetype".to_string(), MIMETYPE.to_string()),
    ("designmap.xml".to_string(), designmap),
    ("META-INF/container.xml".to_string(), container),
    ("Resources/Preferences.xml".to_string(), preferences_xml(&sheet)),
  ];
  files.extend(spread_files);
  files
}

/// Files as a ZIP, stored (InDesign wants the package type first and uncompressed).
pub fn zip_stored(files: &[(String, Vec<u8>)]) -> io::Result<Vec<u8>> {
  let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
  let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
  for (name, data) in files {
    zip.start_file(name, stored).map_err(io::Error::other)?;
    zip.write_all(data)?;
  }
  Ok(zip.finish().map_err(io::Error::other)?.into_inner())
}

/// Page setup. PagesPerDocument is 1 whatever the book's length: InDesign starts from a
/// blank document with that many pages, and only its first spread is replaced by ours.
fn preferences_xml(s: &Sheet) -> String {
  let pt = pt_per_unit(s);
  let rulers = if s.unit == Unit::In { "Inches" } else { "Pixels" };
  let w = s.page_w * pt;
  let h = s.page_h * pt;
  format!(
    r#"{HEAD}
<idPkg:Preferences xmlns:idPkg="{PKG}" DOMVersion="{DOM}">
<DocumentPreference PageHeight="{}" PageWidth="{}" PageOrientation="{}" PagesPerDocument="1" FacingPages="{}" StartPageNumber="1" PageBinding="LeftToRight" AllowPageShuffle="true" DocumentBleedUniformSize="true" DocumentBleedTopOffset="0" DocumentBleedBottomOffset="0" DocumentBleedInsideOrLeftOffset="0" DocumentBleedOutsideOrRightOffset="0" Intent="PrintIntent"/>
{}
<ViewPreference HorizontalMeasurementUnits="{rulers}" VerticalMeasurementUnits="{rulers}"/>
</idPkg:Preferences>"#,
    n(h),
    n(w),
    if w > h { "Landscape" } else { "Portrait" },
    s.arrangement == Arrangement::Spreads,
    margin_xml(s, None)
  )
}

/// Margins from the border guide dropped photos fit inside. For a facing-pages document,
/// Left and Right are inside and outside; for single pages, and on a page, they're its own
/// left and right.
fn margin_xml(s: &Sheet, side: Option<PageSide>) -> String {
  let g = drop_guide(s).map_or(
    Edges {
      top: 0.0,
      bottom: 0.0,
      inside: 0.0,
      outside: 0.0,
    },
    edges_of,
  );
  let side = side.or((s.arrangement == Arrangement::Frames).then_some(PageSide::Whole));
  let (left, right) = left_right(side, &g);
  let pt = pt_per_unit(s);
  let m = |v: f64| n(v * pt);
  format!(
    r#"<MarginPreference ColumnCount="1" ColumnGutter="12" Top="{}" Bottom="{}" Left="{}" Right="{}" ColumnDirection="Horizontal" ColumnsPositions="0 {}"/>"#,
    m(g.top),
    m(g.bottom),
    m(left),
    m(right),
    m(s.page_w - left - right)
  )
}

fn spread_xml(
  project: &Project,
  spreads: &[&Spread],
  spread: &Spread,
  index: usize,
  spread_id: &str,
  id: &mut impl FnMut() -> String,
  links: &HashMap<PhotoId, LinkedImage>,
) -> String {
  let s = project.sheet();
  let pt = pt_per_unit(&s);
  let sides = page_sides(spread.kind);
  let first: usize = spreads[..index].iter().map(|sp| page_sides(sp.kind).len()).sum();
  let top = -s.page_h * pt / 2.0;

  let mut pages = Vec::new();
  for (i, &side) in sides.iter().enumerate() {
    let x = (page_rect(side, &s).x + frame_shift(&s)) * pt;
    let page_id = id();
    let guides = guides_xml(&s, side, i, id);
    pages.push(format!(
      r#"<Page Self="{page_id}" Name="{}" AppliedMaster="n" GeometricBounds="0 0 {} {}" ItemTransform="1 0 0 1 {} {}" MasterPageTransform="1 0 0 1 0 0">
{}
{guides}
</Page>"#,
      first + i + 1,
      n(s.page_h * pt),
      n(s.page_w * pt),
      n(x),
      n(top),
      margin_xml(&s, Some(side)),
    ));
  }

  let mut items: Vec<_> = spread.items.iter().collect();
  items.sort_by(|a, b| a.z.total_cmp(&b.z));
  let mut frames = Vec::new();
  for p in items {
    let x1 = (p.x + frame_shift(&s)) * pt;
    let y1 = p.y * pt + top;
    let x2 = x1 + p.w * pt;
    let y2 = y1 + p.h * pt;
    let points: String = [(x1, y1), (x1, y2), (x2, y2), (x2, y1)]
      .iter()
      .map(|&(x, y)| {
        let at = format!("{} {}", n(x), n(y));
        format!(r#"<PathPointType Anchor="{at}" LeftDirection="{at}" RightDirection="{at}"/>"#)
      })
      .collect();
    let meta = project.photos.get(&p.photo_id);
    let image = links.get(&p.photo_id).map_or(String::new(), |link| {
      image_xml(
        id,
        link,
        Rect::new(x1, y1, x2 - x1, y2 - y1),
        meta.map_or(crop_of_none(), crop_of),
      )
    });
    let rect_id = id();
    frames.push(format!(
      r#"<Rectangle Self="{rect_id}" Name="{}" ContentType="GraphicType" StoredState="Normal" ItemLayer="{LAYER}" Locked="false" Visible="true" AppliedObjectStyle="ObjectStyle/$ID/[None]" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0" ItemTransform="1 0 0 1 0 0">
<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>{points}</PathPointArray></GeometryPathType></PathGeometry></Properties>
{image}
</Rectangle>"#,
      esc(meta.map_or("$ID/", |m| m.name.as_str())),
    ));
  }

  let offset = index as f64 * (s.page_h * pt + SPREAD_SPACING);
  format!(
    r#"{HEAD}
<idPkg:Spread xmlns:idPkg="{PKG}" DOMVersion="{DOM}">
<Spread Self="{spread_id}" PageCount="{}" BindingLocation="{}" ShowMasterItems="true" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 {}">
{}
{}
</Spread>
</idPkg:Spread>"#,
    sides.len(),
    if sides.first() == Some(&PageSide::Left) { 1 } else { 0 },
    n(offset),
    pages.join("\n"),
    frames.join("\n"),
  )
}

fn crop_of_none() -> Crop {
  crate::crop::WHOLE
}

/// Ruler guides: the center lines, line guides, and every border guide but the margins' one.
fn guides_xml(s: &Sheet, side: PageSide, page_index: usize, id: &mut impl FnMut() -> String) -> String {
  let pt = pt_per_unit(s);
  let w = s.page_w * pt;
  let h = s.page_h * pt;
  let margin = drop_guide(s).map(|g| g.id.clone());
  let mut vertical = Vec::new();
  let mut horizontal = Vec::new();
  if s.center_v {
    vertical.push(w / 2.0);
  }
  if s.center_h {
    horizontal.push(h / 2.0);
  }
  for b in &s.borders {
    if Some(&b.id) == margin.as_ref() {
      continue;
    }
    let g = edges_of(b);
    let (left, right) = left_right(Some(side), &g);
    vertical.extend([left * pt, w - right * pt]);
    horizontal.extend([g.top * pt, h - g.bottom * pt]);
  }
  // Line guides' positions from the page's left edge.
  let page = page_rect(side, s);
  for l in s.lines.iter().filter(|l| line_on_page(s, l)) {
    if l.axis == Axis::Vertical {
      vertical.push((line_position(side, s, l) - page.x) * pt);
    } else {
      horizontal.push(l.at * pt);
    }
  }
  // Vertical guides are placed from the spread's left edge, not the page's.
  let left = page_index as f64 * w;
  let unique = |v: Vec<f64>| {
    let mut out: Vec<f64> = Vec::new();
    for x in v {
      let r = js_round(x * 1000.0) / 1000.0;
      if !out.contains(&r) {
        out.push(r);
      }
    }
    out
  };
  let mut guide = |orientation: &str, at: f64| {
    let location = if orientation == "Vertical" { left + at } else { at };
    format!(
      r#"<Guide Self="{}" Orientation="{orientation}" Location="{}" FitToPage="true" ViewThreshold="0" Locked="false" ItemLayer="{LAYER}" PageIndex="{page_index}" GuideType="Ruler"/>"#,
      id(),
      n(location)
    )
  };
  let mut out: Vec<String> = unique(vertical).into_iter().map(|v| guide("Vertical", v)).collect();
  out.extend(unique(horizontal).into_iter().map(|y| guide("Horizontal", y)));
  out.join("\n")
}

/// A linked image in its frame, scaled from its size at its stored resolution: filling it,
/// or for a cropped photo, the whole image placed so the frame shows its crop (InDesign
/// clips the rest, which stays there to recrop).
fn image_xml(id: &mut impl FnMut() -> String, link: &LinkedImage, frame: Rect, crop: Crop) -> String {
  let gw = link.px_w * PT_PER_INCH / link.ppi;
  let gh = link.px_h * PT_PER_INCH / link.ppi;
  let whole = whole_rect(frame, crop);
  let sx = whole.w / gw;
  let sy = whole.h / gh;
  let format = if link.format == ImageFormat::Png {
    "$ID/Portable Network Graphics (PNG)"
  } else {
    "$ID/JPEG"
  };
  let ppi = n(link.ppi);
  let path: Vec<String> = link.path.split('/').map(encode_uri_component).collect();
  let image_id = id();
  let link_id = id();
  format!(
    r#"<Image Self="{image_id}" ItemTransform="{} 0 0 {} {} {}" ActualPpi="{ppi} {ppi}" EffectivePpi="{} {}">
<Properties><GraphicBounds Left="0" Top="0" Right="{}" Bottom="{}"/></Properties>
<Link Self="{link_id}" LinkResourceURI="file:{}" LinkResourceFormat="{format}" StoredState="Normal" LinkClassID="35906" LinkClientID="257" LinkResourceModified="false" LinkObjectModified="false" ShowInUI="true" CanEmbed="true" CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport"/>
</Image>"#,
    n(sx),
    n(sy),
    n(whole.x),
    n(whole.y),
    js_number(js_round(link.ppi / sx)),
    js_number(js_round(link.ppi / sy)),
    n(gw),
    n(gh),
    esc(&path.join("/")),
  )
}

/// What InDesign needs to know about an image file (`src/imageInfo.ts`): its stored
/// resolution (InDesign sizes placed images by it) and, for JPEGs, its EXIF orientation
/// (which InDesign doesn't apply).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ImageInfo {
  /// JPEG or PNG; None for anything else.
  pub format: Option<ImageFormat>,
  /// Pixels per inch, horizontally; 72 when the file doesn't say.
  pub ppi: f64,
  /// EXIF orientation, 1 (upright) when absent.
  pub orientation: u16,
}

const DEFAULT_PPI: f64 = 72.0;
const CM_PER_INCH: f64 = 2.54;

/// An image file's format, resolution and orientation, from its first bytes.
pub fn read_image_info(bytes: &[u8]) -> ImageInfo {
  if bytes.starts_with(&[0xff, 0xd8]) {
    return read_jpeg(bytes);
  }
  if bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47]) {
    return read_png(bytes);
  }
  ImageInfo {
    format: None,
    ppi: DEFAULT_PPI,
    orientation: 1,
  }
}

fn be16(b: &[u8], at: usize) -> Option<u16> {
  Some(u16::from_be_bytes([*b.get(at)?, *b.get(at + 1)?]))
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
  Some(u32::from_be_bytes([*b.get(at)?, *b.get(at + 1)?, *b.get(at + 2)?, *b.get(at + 3)?]))
}

fn read_jpeg(bytes: &[u8]) -> ImageInfo {
  let mut jfif_ppi = None;
  let mut exif: Option<(Option<f64>, u16)> = None;
  let mut p = 2;
  while p + 4 <= bytes.len() && bytes[p] == 0xff {
    let marker = bytes[p + 1];
    // Start of scan: the metadata segments are all before it.
    if marker == 0xda || marker == 0xd9 {
      break;
    }
    let Some(length) = be16(bytes, p + 2) else { break };
    let length = usize::from(length);
    let start = p + 4;
    if marker == 0xe0 && bytes.get(start..start + 5) == Some(b"JFIF\0") && start + 12 <= bytes.len() {
      let units = bytes[start + 7];
      let density = f64::from(be16(bytes, start + 8).unwrap_or(0));
      if density > 0.0 && units == 1 {
        jfif_ppi = Some(density);
      }
      if density > 0.0 && units == 2 {
        jfif_ppi = Some(density * CM_PER_INCH);
      }
    } else if marker == 0xe1 && bytes.get(start..start + 6) == Some(b"Exif\0\0") {
      exif = Some(read_exif(bytes, start + 6, bytes.len().min(p + 2 + length)));
    }
    p += 2 + length;
  }
  ImageInfo {
    format: Some(ImageFormat::Jpeg),
    ppi: jfif_ppi.or(exif.and_then(|e| e.0)).unwrap_or(DEFAULT_PPI),
    orientation: exif.map_or(1, |e| e.1),
  }
}

/// Resolution and orientation from the first IFD of an EXIF (TIFF) block.
fn read_exif(b: &[u8], tiff: usize, end: usize) -> (Option<f64>, u16) {
  let inner = || -> Option<(Option<f64>, u16)> {
    let little = be16(b, tiff)? == 0x4949;
    let u16_at = |o: usize| -> Option<u16> {
      let v = [*b.get(o)?, *b.get(o + 1)?];
      Some(if little { u16::from_le_bytes(v) } else { u16::from_be_bytes(v) })
    };
    let u32_at = |o: usize| -> Option<u32> {
      let v = [*b.get(o)?, *b.get(o + 1)?, *b.get(o + 2)?, *b.get(o + 3)?];
      Some(if little { u32::from_le_bytes(v) } else { u32::from_be_bytes(v) })
    };
    let ifd = tiff + u32_at(tiff + 4)? as usize;
    let mut orientation = 1;
    let mut x_res = None;
    let mut unit = 2;
    for i in 0..usize::from(u16_at(ifd)?) {
      let e = ifd + 2 + i * 12;
      if e + 12 > end {
        break;
      }
      match u16_at(e)? {
        0x0112 => orientation = u16_at(e + 8)?,
        0x0128 => unit = u16_at(e + 8)?,
        0x011a => {
          let at = tiff + u32_at(e + 8)? as usize;
          let den = u32_at(at + 4)?;
          if den != 0 {
            x_res = Some(f64::from(u32_at(at)?) / f64::from(den));
          }
        }
        _ => {}
      }
    }
    let ppi = x_res.filter(|x| *x != 0.0).map(|x| if unit == 3 { x * CM_PER_INCH } else { x });
    Some((ppi, orientation))
  };
  // A malformed block just means no information.
  inner().unwrap_or((None, 1))
}

fn read_png(bytes: &[u8]) -> ImageInfo {
  let mut p = 8;
  while p + 12 <= bytes.len() {
    let Some(length) = be32(bytes, p) else { break };
    let kind = &bytes[p + 4..p + 8];
    if kind == b"pHYs" && length >= 9 {
      let per_meter = be32(bytes, p + 8).unwrap_or(0);
      // Unit 1 is meters; 0 means only the aspect ratio is known.
      if bytes.get(p + 16) == Some(&1) && per_meter != 0 {
        return ImageInfo {
          format: Some(ImageFormat::Png),
          ppi: f64::from(per_meter) * CM_PER_INCH / 100.0,
          orientation: 1,
        };
      }
    }
    if kind == b"IDAT" || kind == b"IEND" {
      break;
    }
    p += 12 + length as usize;
  }
  ImageInfo {
    format: Some(ImageFormat::Png),
    ppi: DEFAULT_PPI,
    orientation: 1,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn encodes_like_javascript() {
    assert_eq!(encode_uri_component("a b&c(1).jpg"), "a%20b%26c(1).jpg");
    assert_eq!(encode_uri_component("é"), "%C3%A9");
    assert_eq!(n(1.0 / 3.0), "0.3333");
    assert_eq!(n(-288.0), "-288");
  }

  #[test]
  fn reads_image_info() {
    let tour = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/tour/taxi.jpg");
    let Ok(bytes) = std::fs::read(tour) else { return };
    let info = read_image_info(&bytes);
    assert_eq!(info.format, Some(ImageFormat::Jpeg));
    assert!(info.ppi > 0.0);
    assert_eq!(read_image_info(b"GIF89a").format, None);
    // A PNG with a pHYs of 11811 per meter: 300 ppi.
    let mut png = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    png.extend([0, 0, 0, 9]);
    png.extend(b"pHYs");
    png.extend(11811u32.to_be_bytes());
    png.extend(11811u32.to_be_bytes());
    png.push(1);
    png.extend([0, 0, 0, 0]);
    let info = read_image_info(&png);
    assert_eq!(info.format, Some(ImageFormat::Png));
    assert!((info.ppi - 300.0).abs() < 0.01, "{}", info.ppi);
  }
}
