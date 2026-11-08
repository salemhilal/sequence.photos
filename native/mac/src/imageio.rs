//! Reading photos with macOS's ImageIO, as WebKit does in the Tauri app: any format the
//! system reads (HEIC included), upright per its orientation, with its color profile.

use objc2_core_foundation::{CFBoolean, CFData, CFDictionary, CFMutableData, CFNumber, CFRetained, CFString, CFType};
use objc2_image_io::{
  CGImageDestination, CGImageSource, kCGImageDestinationLossyCompressionQuality, kCGImagePropertyOrientation,
  kCGImagePropertyPixelHeight, kCGImagePropertyPixelWidth, kCGImageSourceCreateThumbnailFromImageAlways,
  kCGImageSourceCreateThumbnailWithTransform, kCGImageSourceThumbnailMaxPixelSize,
};

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
  let size = CFNumber::new_f64(max);
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
  // SAFETY: index 0 exists (its properties were read); options as above.
  let image = unsafe { source.thumbnail_at_index(0, Some(&options)) }?;
  let out = CFMutableData::new(None, 0)?;
  let jpeg = CFString::from_static_str("public.jpeg");
  // SAFETY: one image into a JPEG destination; options as documented.
  unsafe {
    let dest = CGImageDestination::with_data(&out, &jpeg, 1, None)?;
    let quality = CFNumber::new_f64(0.85);
    let props = dict(&[kCGImageDestinationLossyCompressionQuality], &[quality.as_ref()]);
    dest.add_image(&image, Some(&props));
    if !dest.finalize() {
      return None;
    }
  }
  Some(out.to_vec())
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
}
