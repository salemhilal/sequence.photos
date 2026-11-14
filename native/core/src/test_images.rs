//! Stand-in photos for testing (Settings → Advanced, `src/testImages.ts`): soft gradients in
//! colors like Kodachrome's, with a soft glow, a gentle vignette and a little grain. This
//! makes the pixels; the app encodes them and adds them like any photos.

/// Colors like Kodachrome's, in order around the color wheel so neighbors blend cleanly.
pub const FILM_COLORS: [u32; 11] = [
  0xc8161d, // Kodachrome red
  0xe4572e, // red-orange
  0xf5c518, // golden yellow
  0x3d8b3d, // grass green
  0x2f7f6f, // deep teal
  0x9cc3e0, // pale sky (a pastel)
  0x3a8fd6, // clear sky blue
  0x1f4fa0, // cobalt
  0x1c2a4a, // navy
  0xb02a4a, // deep rose
  0xe8a398, // Portra skin (a pastel), back toward red
];

/// The sizes made, in pixels: about 6 megapixels.
pub const SIZES: [(usize, usize); 3] = [(3000, 2000), (2000, 3000), (2400, 2400)];

/// The most test images added at once.
pub const MAX_TEST_IMAGES: usize = 50;

/// A small, seedable random source (xorshift64*): enough for gradients and grain.
pub struct Rng(u64);

impl Rng {
  pub fn new(seed: u64) -> Self {
    Self(seed.max(1))
  }

  /// A number in [0, 1).
  pub fn next_f64(&mut self) -> f64 {
    let mut x = self.0;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    self.0 = x;
    (x.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11) as f64 / (1u64 << 53) as f64
  }

  fn below(&mut self, n: usize) -> usize {
    ((self.next_f64() * n as f64) as usize).min(n - 1)
  }
}

/// Two or three neighboring film colors, for one gradient, either way around the wheel.
pub fn gradient_colors(rng: &mut Rng) -> Vec<u32> {
  let count = if rng.next_f64() < 0.5 { 2 } else { 3 };
  let n = FILM_COLORS.len();
  let start = rng.below(n);
  let back = rng.next_f64() < 0.5;
  (0..count)
    .map(|i| FILM_COLORS[if back { (start + n * 3 - i) % n } else { (start + i) % n }])
    .collect()
}

/// A gradient photo: its size, and its pixels as RGB bytes, row by row.
pub struct TestImage {
  pub width: usize,
  pub height: usize,
  pub rgb: Vec<u8>,
}

fn channels(c: u32) -> [f64; 3] {
  [(c >> 16 & 0xff) as f64, (c >> 8 & 0xff) as f64, (c & 0xff) as f64]
}

/// Smoothstep: a fade that starts and ends with no edge.
fn ease(s: f64) -> f64 {
  let s = s.clamp(0.0, 1.0);
  s * s * (3.0 - 2.0 * s)
}

fn over(base: &mut [f64; 3], top: [f64; 3], alpha: f64) {
  for (b, t) in base.iter_mut().zip(top) {
    *b += (t - *b) * alpha;
  }
}

/// One gradient photo, at one of `SIZES`: a linear gradient at a random angle, a glow
/// somewhere like light leaking in, a vignette, and grain from a repeated tile.
pub fn gradient_image(rng: &mut Rng) -> TestImage {
  let (w, h) = SIZES[rng.below(SIZES.len())];
  let (wf, hf) = (w as f64, h as f64);
  let colors: Vec<[f64; 3]> = gradient_colors(rng).into_iter().map(channels).collect();
  let angle = rng.next_f64() * std::f64::consts::TAU;
  let (dx, dy) = (angle.cos(), angle.sin());
  let r = wf.hypot(hf) / 2.0;
  let (gx, gy) = (rng.next_f64() * wf, rng.next_f64() * hf);
  let glow_r = r * 1.2;
  const GLOW: [f64; 3] = [255.0, 236.0, 200.0];
  const SHADE: [f64; 3] = [20.0, 16.0, 24.0];
  const TILE: usize = 256;
  let grain: Vec<f64> = (0..TILE * TILE).map(|_| (rng.next_f64() * 256.0).floor()).collect();
  let grain_alpha = 18.0 / 255.0;
  let stops = (colors.len() - 1) as f64;

  let mut rgb = Vec::with_capacity(w * h * 3);
  for y in 0..h {
    let py = y as f64 + 0.5;
    for x in 0..w {
      let px = x as f64 + 0.5;
      // Along the gradient: 0 at one end of the diameter through the middle, 1 at the other.
      let t = (((px - wf / 2.0) * dx + (py - hf / 2.0) * dy) / (2.0 * r) + 0.5).clamp(0.0, 1.0);
      let at = t * stops;
      let i = (at.floor() as usize).min(colors.len() - 2);
      let f = at - i as f64;
      let (a, b) = (colors[i], colors[i + 1]);
      let mut c: [f64; 3] = std::array::from_fn(|k| a[k] + (b[k] - a[k]) * f);
      let glow = 0.12 * ease(1.0 - (px - gx).hypot(py - gy) / glow_r);
      over(&mut c, GLOW, glow);
      let shade = 0.18 * ease((px - wf / 2.0).hypot(py - hf / 2.0) / r);
      over(&mut c, SHADE, shade);
      let g = grain[(y % TILE) * TILE + x % TILE];
      over(&mut c, [g; 3], grain_alpha);
      rgb.extend(c.map(|v| v.round().clamp(0.0, 255.0) as u8));
    }
  }
  TestImage {
    width: w,
    height: h,
    rgb,
  }
}

/// The name of test image `i` (from 1) of `count`: "Gradient 01.jpg" and so on.
pub fn test_image_name(i: usize, count: usize) -> String {
  let digits = count.to_string().len().max(2);
  format!("Gradient {i:0digits$}.jpg")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn colors_are_neighbors() {
    let mut rng = Rng::new(7);
    for _ in 0..50 {
      let cs = gradient_colors(&mut rng);
      assert!((2..=3).contains(&cs.len()));
      let idx: Vec<usize> = cs
        .iter()
        .map(|c| FILM_COLORS.iter().position(|f| f == c).expect("film color"))
        .collect();
      for pair in idx.windows(2) {
        let d = (pair[0] + FILM_COLORS.len() - pair[1]) % FILM_COLORS.len();
        assert!(d == 1 || d == FILM_COLORS.len() - 1, "{idx:?}");
      }
    }
  }

  #[test]
  fn an_image_fills_its_size() {
    let img = gradient_image(&mut Rng::new(3));
    assert!(SIZES.contains(&(img.width, img.height)));
    assert_eq!(img.rgb.len(), img.width * img.height * 3);
    // Never pure black or white.
    assert!(img.rgb.chunks(3).all(|p| p != [0, 0, 0] && p != [255, 255, 255]));
  }

  #[test]
  fn names() {
    assert_eq!(test_image_name(3, 6), "Gradient 03.jpg");
    assert_eq!(test_image_name(7, 120), "Gradient 007.jpg");
  }
}
