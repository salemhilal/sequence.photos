//! Reading photos with macOS's ImageIO, as WebKit does in the Tauri app: any format the
//! system reads (HEIC included), upright per its orientation, with its color profile.

use std::io::Read;
use std::path::{Path, PathBuf};

use objc2_core_foundation::{
  CFBoolean, CFData, CFDictionary, CFMutableData, CFNumber, CFRetained, CFString, CFType, CFURL, CFURLPathStyle,
  CGPoint, CGRect, CGSize,
};
use objc2_core_graphics::{
  CGBitmapContextCreate, CGBitmapContextCreateImage, CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGContext,
  CGDataProvider, CGImage, CGImageAlphaInfo, CGImageByteOrderInfo, CGInterpolationQuality, kCGColorSpaceSRGB,
};
use objc2_image_io::{
  CGImageDestination, CGImageSource, kCGImageDestinationLossyCompressionQuality, kCGImagePropertyOrientation,
  kCGImagePropertyPixelHeight, kCGImagePropertyPixelWidth, kCGImageSourceCreateThumbnailFromImageAlways,
  kCGImageSourceCreateThumbnailWithTransform, kCGImageSourceThumbnailMaxPixelSize,
};
use sequence_core::geometry::Rect;
use sequence_core::indexmap::IndexMap;
use sequence_core::instagram::{PostImageLayout, QUALITIES, limits};
use sequence_core::pdf::decode_size;
use sequence_core::render_plan::{PagePlan, ink_rgb};
use sequence_core::{PhotoId, PhotoMeta};

/// What reading a photo gives: its upright size, and a JPEG display copy.
pub struct Decoded {
  pub px_w: f64,
  pub px_h: f64,
  pub thumb: Vec<u8>,
}

fn dict(keys: &[&CFString], values: &[&CFType]) -> CFRetained<CFDictionary> {
  let d = CFDictionary::<CFString, CFType>::from_slices(keys, values);
  // SAFETY: an opaque dictionary is the same object.
  unsafe { CFRetained::cast_unchecked(d) }
}

fn number(props: &CFDictionary, key: &CFString) -> Option<f64> {
  // SAFETY: the properties dictionary's keys are strings and its values CF objects.
  let props: &CFDictionary<CFString, CFType> = unsafe { props.cast_unchecked() };
  let v = props.get(key)?;
  v.downcast_ref::<CFNumber>()?.as_f64()
}

/// The image's upright size, from its properties (orientations 5–8 turn it a quarter).
fn upright_size(source: &CGImageSource) -> Option<(f64, f64)> {
  // SAFETY: index 0 exists when the source has an image; no options.
  let props = unsafe { source.properties_at_index(0, None) }?;
  // SAFETY: these are the documented property keys.
  let (wk, hk, ok) = unsafe {
    (
      kCGImagePropertyPixelWidth,
      kCGImagePropertyPixelHeight,
      kCGImagePropertyOrientation,
    )
  };
  let w = number(&props, wk)?;
  let h = number(&props, hk)?;
  let orientation = number(&props, ok).unwrap_or(1.0);
  Some(if orientation >= 5.0 { (h, w) } else { (w, h) })
}

/// A photo's upright size and a display copy (`max` px on its longest side, JPEG).
pub fn decode(bytes: &[u8], max: f64) -> Option<Decoded> {
  let data = CFData::from_bytes(bytes);
  // SAFETY: no options.
  let source = unsafe { CGImageSource::with_data(&data, None) }?;
  let (px_w, px_h) = upright_size(&source)?;
  let thumb = thumbnail(&source, max)?;
  Some(Decoded { px_w, px_h, thumb })
}

/// The source's first image, upright, at most `max` px on its longest side, as JPEG.
fn thumbnail(source: &CGImageSource, max: f64) -> Option<Vec<u8>> {
  let image = thumbnail_image(source, max)?;
  jpeg(&image, 0.85)
}

/// An image as JPEG at `quality` (0–1).
fn jpeg(image: &CGImage, quality: f64) -> Option<Vec<u8>> {
  encode(image, "public.jpeg", Some(quality))
}

/// An image as a file of type `uti`, at `quality` for lossy types.
fn encode(image: &CGImage, uti: &'static str, quality: Option<f64>) -> Option<Vec<u8>> {
  let out = CFMutableData::new(None, 0)?;
  let kind = CFString::from_static_str(uti);
  // SAFETY: one image into a destination of a known type; options as documented.
  unsafe {
    let dest = CGImageDestination::with_data(&out, &kind, 1, None)?;
    let props = quality.map(|q| {
      let q = CFNumber::new_f64(q);
      dict(&[kCGImageDestinationLossyCompressionQuality], &[q.as_ref()])
    });
    dest.add_image(image, props.as_deref());
    if !dest.finalize() {
      return None;
    }
  }
  Some(out.to_vec())
}

/// An sRGB bitmap of `w` × `h`, 8-bit RGB with an unused alpha byte.
fn bitmap(w: usize, h: usize) -> Option<CFRetained<CGContext>> {
  // SAFETY: the documented sRGB name.
  let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))?;
  // SAFETY: no buffer given (CoreGraphics makes one).
  unsafe {
    CGBitmapContextCreate(
      std::ptr::null_mut(),
      w,
      h,
      8,
      0,
      Some(&space),
      CGImageAlphaInfo::NoneSkipLast.0,
    )
  }
}

/// A rectangle given from the top (as plans are) in a context `h` high (whose origin is the bottom).
fn from_top(r: Rect, h: f64) -> CGRect {
  CGRect::new(CGPoint::new(r.x, h - r.y - r.h), CGSize::new(r.w, r.h))
}

fn fill(ctx: &CGContext, rgb: [u8; 3], r: CGRect) {
  let c = |v: u8| f64::from(v) / 255.0;
  CGContext::set_rgb_fill_color(Some(ctx), c(rgb[0]), c(rgb[1]), c(rgb[2]), 1.0);
  CGContext::fill_rect(Some(ctx), r);
}

/// An output page drawn from its plan, and what it ran into.
pub struct Rendered {
  pub bytes: Vec<u8>,
  /// Photos with no image, left out.
  pub missing: usize,
  /// Photos drawn from their display copies.
  pub previews: usize,
}

/// An output page drawn from its plan (`renderPage`): the background, then each photo's
/// border and the part of it that shows, decoded from `paths(id)` (the original, then the
/// display copy) at its placed size. Encoded as PNG, or JPEG at `quality`.
pub fn render_page(
  plan: &PagePlan,
  photos: &IndexMap<PhotoId, PhotoMeta>,
  paths: impl Fn(&PhotoId) -> [PathBuf; 2],
  png: bool,
  quality: f64,
) -> Option<Rendered> {
  let (drawn, missing, previews) = draw_plan(plan, photos, paths)?;
  let bytes = if png {
    encode(&drawn, "public.png", None)?
  } else {
    jpeg(&drawn, quality)?
  };
  Some(Rendered {
    bytes,
    missing,
    previews,
  })
}

/// A plan drawn, with how many photos were missing and drawn from their previews.
fn draw_plan(
  plan: &PagePlan,
  photos: &IndexMap<PhotoId, PhotoMeta>,
  paths: impl Fn(&PhotoId) -> [PathBuf; 2],
) -> Option<(CFRetained<CGImage>, usize, usize)> {
  let (w, h) = (plan.px_w as usize, plan.px_h as usize);
  let ctx = bitmap(w, h)?;
  let hh = plan.px_h;
  fill(
    &ctx,
    ink_rgb(plan.background),
    CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(plan.px_w, hh)),
  );
  CGContext::set_interpolation_quality(Some(&ctx), CGInterpolationQuality::High);
  let (mut missing, mut previews) = (0, 0);
  for d in &plan.draws {
    if let Some(b) = d.border {
      let p = d.placed;
      let r = Rect::new(p.x - b.width, p.y - b.width, p.w + 2.0 * b.width, p.h + 2.0 * b.width);
      fill(&ctx, ink_rgb(b.color), from_top(r, hh));
    }
    let Some(photo) = photos.get(&d.photo_id) else {
      missing += 1;
      continue;
    };
    let (dw, dh) = decode_size(photo, d.placed.w, d.placed.h);
    let mut image = None;
    for (i, path) in paths(&d.photo_id).iter().enumerate() {
      if let Some(img) = source_at(path).and_then(|s| thumbnail_image(&s, f64::from(dw.max(dh)))) {
        image = Some(img);
        previews += i;
        break;
      }
    }
    let Some(image) = image else {
      missing += 1;
      continue;
    };
    // The plan's source is in the photo's own pixels; the decoded image may be smaller.
    let kx = CGImage::width(Some(&image)) as f64 / photo.px_w;
    let ky = CGImage::height(Some(&image)) as f64 / photo.px_h;
    draw_part(
      &ctx,
      &image,
      Rect::new(d.src.x * kx, d.src.y * ky, d.src.w * kx, d.src.h * ky),
      d.dst,
      hh,
    );
  }
  let drawn = CGBitmapContextCreateImage(Some(&ctx))?;
  Some((drawn, missing, previews))
}

/// Draw the part `s` of an image (in its pixels, from the top) at `t` (from the top) in a
/// context `hh` high.
fn draw_part(ctx: &CGContext, image: &CGImage, s: Rect, t: Rect, hh: f64) {
  let fx = t.w / s.w;
  let fy = t.h / s.h;
  let whole = Rect::new(
    t.x - s.x * fx,
    t.y - s.y * fy,
    CGImage::width(Some(image)) as f64 * fx,
    CGImage::height(Some(image)) as f64 * fy,
  );
  CGContext::save_g_state(Some(ctx));
  CGContext::clip_to_rect(Some(ctx), from_top(t, hh));
  CGContext::draw_image(Some(ctx), from_top(whole, hh), Some(image));
  CGContext::restore_g_state(Some(ctx));
}

/// A slide as the JPEG Instagram gets (`renderPostImage`): its plan drawn, then the
/// layout's part of it placed on white at the post's size, at the best quality under
/// Instagram's limit. With how many photos came from previews; None if it can't fit.
/// `k` is the plan's pixels per slide pixel.
pub fn post_image(
  plan: &PagePlan,
  photos: &IndexMap<PhotoId, PhotoMeta>,
  paths: impl Fn(&PhotoId) -> [PathBuf; 2],
  layout: &PostImageLayout,
  k: f64,
) -> Option<(Vec<u8>, usize)> {
  let (drawn, _, previews) = draw_plan(plan, photos, paths)?;
  let ctx = bitmap(layout.width as usize, layout.height as usize)?;
  let hh = layout.height;
  fill(
    &ctx,
    [255, 255, 255],
    CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(layout.width, hh)),
  );
  CGContext::set_interpolation_quality(Some(&ctx), CGInterpolationQuality::High);
  let s = layout.source;
  draw_part(
    &ctx,
    &drawn,
    Rect::new(s.x * k, s.y * k, s.w * k, s.h * k),
    layout.target,
    hh,
  );
  let out = CGBitmapContextCreateImage(Some(&ctx))?;
  QUALITIES
    .iter()
    .filter_map(|&q| jpeg(&out, q))
    .find(|b| b.len() <= limits::MAX_BYTES)
    .map(|b| (b, previews))
}

/// RGB pixels (8 bits a channel, rows packed, in sRGB) as JPEG at `quality` (0–1).
pub fn encode_jpeg(rgb: &[u8], width: usize, height: usize, quality: f64) -> Option<Vec<u8>> {
  if width == 0 || height == 0 || rgb.len() != width * height * 3 {
    return None;
  }
  let data = CFData::from_bytes(rgb);
  let provider = CGDataProvider::with_cf_data(Some(&data))?;
  // SAFETY: the documented sRGB name.
  let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))?;
  // SAFETY: the provider holds width × height × 3 bytes, as described; no decode array.
  let image = unsafe {
    CGImage::new(
      width,
      height,
      8,
      24,
      width * 3,
      Some(&space),
      CGBitmapInfo(CGImageAlphaInfo::None.0),
      Some(&provider),
      std::ptr::null(),
      false,
      CGColorRenderingIntent::RenderingIntentDefault,
    )
  }?;
  jpeg(&image, quality)
}

/// A file's image source, read as it's needed (its headers first).
fn source_at(path: &Path) -> Option<CFRetained<CGImageSource>> {
  let path = CFString::from_str(path.to_str()?);
  let url = CFURL::with_file_system_path(None, Some(&path), CFURLPathStyle::CFURLPOSIXPathStyle, false)?;
  // SAFETY: no options.
  unsafe { CGImageSource::with_url(&url, None) }
}

/// A file's EXIF orientation, if the file is a JPEG (by its first bytes, not its name).
pub fn jpeg_orientation(path: &Path) -> Option<u32> {
  let mut head = [0u8; 3];
  std::fs::File::open(path).ok()?.read_exact(&mut head).ok()?;
  if head != [0xff, 0xd8, 0xff] {
    return None;
  }
  let source = source_at(path)?;
  // SAFETY: index 0 exists when the source has an image; no options.
  let props = unsafe { source.properties_at_index(0, None) }?;
  // SAFETY: the documented property key.
  let o = number(&props, unsafe { kCGImagePropertyOrientation }).unwrap_or(1.0);
  Some(if (1.0..=8.0).contains(&o) { o as u32 } else { 1 })
}

/// A file's photo decoded upright at about `whole` pixels, then its part `src` (in those
/// pixels) drawn at `out` pixels on white, as JPEG at `quality`: what an export draws.
pub fn part_jpeg(path: &Path, whole: (u32, u32), src: Rect, out: (u32, u32), quality: f64) -> Option<Vec<u8>> {
  let source = source_at(path)?;
  let image = thumbnail_image(&source, f64::from(whole.0.max(whole.1)))?;
  let (w, h) = (out.0.max(1) as usize, out.1.max(1) as usize);
  let ctx = bitmap(w, h)?;
  let all = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w as f64, h as f64));
  fill(&ctx, [255, 255, 255], all);
  CGContext::set_interpolation_quality(Some(&ctx), CGInterpolationQuality::High);
  // The whole photo, placed so `src` fills the output (CoreGraphics' origin is the bottom).
  let fx = w as f64 / src.w;
  let fy = h as f64 / src.h;
  let (ww, wh) = (f64::from(whole.0), f64::from(whole.1));
  let at = CGRect::new(
    CGPoint::new(-src.x * fx, h as f64 - (wh - src.y) * fy),
    CGSize::new(ww * fx, wh * fy),
  );
  CGContext::draw_image(Some(&ctx), at, Some(&image));
  let drawn = CGBitmapContextCreateImage(Some(&ctx))?;
  jpeg(&drawn, quality)
}

/// A file's photo, upright at full size, as JPEG at `quality`, with its size: for apps that
/// don't turn photos by their orientation, or read their format.
pub fn upright_jpeg(path: &Path, quality: f64) -> Option<(Vec<u8>, u32, u32)> {
  let source = source_at(path)?;
  let (w, h) = upright_size(&source)?;
  let image = thumbnail_image(&source, w.max(h))?;
  let size = (
    CGImage::width(Some(&image)) as u32,
    CGImage::height(Some(&image)) as u32,
  );
  Some((jpeg(&image, quality)?, size.0, size.1))
}

/// A file's photo, upright, at most `max` px on its longest side, as the window draws it:
/// its width, height, and pixels in sRGB, 4 bytes each in the order blue, green, red,
/// alpha, rows packed. Transparent parts are on white, so every pixel is opaque.
pub fn bgra(path: &Path, max: f64) -> Option<(u32, u32, Vec<u8>)> {
  let source = source_at(path)?;
  let image = thumbnail_image(&source, max)?;
  let (w, h) = (CGImage::width(Some(&image)), CGImage::height(Some(&image)));
  if w == 0 || h == 0 {
    return None;
  }
  let mut pixels = vec![0u8; w * h * 4];
  // SAFETY: the documented sRGB name.
  let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))?;
  // Alpha first in a little-endian word: blue, green, red, alpha in memory.
  let info = CGImageAlphaInfo::PremultipliedFirst.0 | CGImageByteOrderInfo::Order32Little.0;
  // SAFETY: the buffer holds w × h × 4 bytes, as described, and outlives the context.
  let ctx = unsafe { CGBitmapContextCreate(pixels.as_mut_ptr().cast(), w, h, 8, w * 4, Some(&space), info) }?;
  let all = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w as f64, h as f64));
  fill(&ctx, [255, 255, 255], all);
  CGContext::draw_image(Some(&ctx), all, Some(&image));
  drop(ctx);
  Some((w as u32, h as u32, pixels))
}

/// The source's first image, upright, at most `max` px on its longest side.
fn thumbnail_image(source: &CGImageSource, max: f64) -> Option<CFRetained<CGImage>> {
  let size = CFNumber::new_f64(max.max(1.0));
  let yes = CFBoolean::new(true);
  // SAFETY: the documented option keys, with the value types they take.
  let options = unsafe {
    dict(
      &[
        kCGImageSourceCreateThumbnailFromImageAlways,
        kCGImageSourceCreateThumbnailWithTransform,
        kCGImageSourceThumbnailMaxPixelSize,
      ],
      &[yes.as_ref(), yes.as_ref(), size.as_ref()],
    )
  };
  // SAFETY: index 0, options as above.
  unsafe { source.thumbnail_at_index(0, Some(&options)) }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_a_jpeg() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/tour/taxi.jpg");
    let Ok(bytes) = std::fs::read(path) else { return };
    let d = decode(&bytes, 200.0).expect("decodes");
    assert!(d.px_w > 0.0 && d.px_h > 0.0);
    assert!(d.thumb.starts_with(&[0xff, 0xd8]));
  }

  #[test]
  fn writes_a_jpeg() {
    let (w, h) = (40, 30);
    let rgb: Vec<u8> = (0..w * h).flat_map(|i| [(i % 255) as u8, 120, 200]).collect();
    let bytes = encode_jpeg(&rgb, w, h, 0.9).expect("encodes");
    let d = decode(&bytes, 100.0).expect("reads back");
    assert_eq!((d.px_w, d.px_h), (40.0, 30.0));
  }

  /// A JPEG's middle pixel, as RGB.
  fn middle(jpeg: &[u8]) -> [u8; 3] {
    let data = CFData::from_bytes(jpeg);
    // SAFETY: no options; index 0.
    let image =
      unsafe { CGImageSource::with_data(&data, None).and_then(|s| s.image_at_index(0, None)) }.expect("an image");
    let mut px = [0u8; 4];
    let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB })).expect("sRGB");
    // SAFETY: a 1 × 1 buffer of 4 bytes, as described.
    let ctx = unsafe {
      CGBitmapContextCreate(
        px.as_mut_ptr().cast(),
        1,
        1,
        8,
        4,
        Some(&space),
        CGImageAlphaInfo::NoneSkipLast.0,
      )
    }
    .expect("a context");
    let (w, h) = (
      CGImage::width(Some(&image)) as f64,
      CGImage::height(Some(&image)) as f64,
    );
    // Only the middle pixel lands in the 1 × 1 context.
    let at = CGRect::new(CGPoint::new(-(w / 2.0).floor(), -(h / 2.0).floor()), CGSize::new(w, h));
    CGContext::draw_image(Some(&ctx), at, Some(&image));
    drop(ctx);
    [px[0], px[1], px[2]]
  }

  #[test]
  fn cuts_a_part() {
    let dir = std::env::temp_dir().join(format!("sequence-part-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a folder");
    let path = dir.join("p.jpg");
    // Red on top, blue below.
    let (w, h) = (80, 60);
    let rgb: Vec<u8> = (0..w * h)
      .flat_map(|i| if i / w < h / 2 { [220, 20, 20] } else { [20, 20, 220] })
      .collect();
    std::fs::write(&path, encode_jpeg(&rgb, w, h, 0.95).expect("encodes")).expect("writes");
    assert_eq!(jpeg_orientation(&path), Some(1));
    let top = part_jpeg(&path, (80, 60), Rect::new(0.0, 0.0, 80.0, 30.0), (40, 15), 0.95).expect("a part");
    let d = decode(&top, 100.0).expect("reads back");
    assert_eq!((d.px_w, d.px_h), (40.0, 15.0));
    let [r, _, b] = middle(&top);
    assert!(r > 150 && b < 80, "the top is red: {r} {b}");
    let bottom = part_jpeg(&path, (80, 60), Rect::new(0.0, 30.0, 80.0, 30.0), (40, 15), 0.95).expect("a part");
    let [r, _, b] = middle(&bottom);
    assert!(b > 150 && r < 80, "the bottom is blue: {r} {b}");
    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn decodes_to_pixels_for_the_window() {
    let dir = std::env::temp_dir().join(format!("sequence-bgra-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a folder");
    let path = dir.join("p.jpg");
    // Red on top, blue below.
    let (w, h) = (80, 60);
    let rgb: Vec<u8> = (0..w * h)
      .flat_map(|i| if i / w < h / 2 { [220, 20, 20] } else { [20, 20, 220] })
      .collect();
    std::fs::write(&path, encode_jpeg(&rgb, w, h, 0.95).expect("encodes")).expect("writes");
    let (pw, ph, px) = bgra(&path, 40.0).expect("decodes");
    assert_eq!((pw, ph), (40, 30));
    assert_eq!(px.len(), 40 * 30 * 4);
    // The first row is the top: red, so its third byte is high and its first low.
    let top = &px[..4];
    assert!(top[2] > 150 && top[0] < 80 && top[3] == 255, "the top is red: {top:?}");
    let bottom = &px[px.len() - 4..];
    assert!(
      bottom[0] > 150 && bottom[2] < 80 && bottom[3] == 255,
      "the bottom is blue: {bottom:?}"
    );
    std::fs::remove_dir_all(&dir).ok();
  }
}
