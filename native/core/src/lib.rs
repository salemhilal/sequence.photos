//! Sequence's project model and logic, without a window: what the Mac app (and one day the
//! website, through wasm) shares. Ported from the TypeScript in `src/`, which stays the
//! reference; tests check this against golden files the TypeScript writes (`tests/`).

pub mod actions;
pub mod crop;
pub mod desk;
pub mod geometry;
pub mod ids;
pub mod model;
pub mod project_file;
pub mod render_plan;
pub mod schema;
pub mod store;
pub mod units;
pub mod validate;

pub use ids::{GuideId, PhotoId, SpreadId};
pub use model::*;

/// A number as JavaScript prints it (`String(n)`): no ".0" on whole numbers.
pub fn js_number(n: f64) -> String {
  if n == 0.0 {
    return "0".into();
  }
  if n.fract() == 0.0 && n.abs() < 1e21 {
    return format!("{n:.0}");
  }
  // Rust's shortest round-trip form matches JavaScript's for ordinary values.
  format!("{n}")
}
