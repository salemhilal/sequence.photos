//! What the Export page exports to, and the choices each takes (`src/exportOptions.ts`).
//! Measurements convert only where the destination's differ from the project's: an inches
//! project exported as images (or to Instagram) is turned into pixels at a dpi; a pixel
//! project saved as a PDF is given a printed size at a dpi. InDesign opens pixels as pixels.

use crate::model::{
  Arrangement, ExportDestination as Destination, ExportOptions as Saved, ExportPer, ImageFormat, Project, Sheet, Unit,
};
use crate::render_plan::Per;

pub const DEFAULT_PRINT_AT: f64 = 300.0;
/// JPEG quality unless chosen: high, with little to see in what it drops.
pub const DEFAULT_QUALITY: f64 = 0.92;

/// Where a project can go, in the picker's order.
pub const DESTINATIONS: [Destination; 4] = [
  Destination::Pdf,
  Destination::Images,
  Destination::Indesign,
  Destination::Instagram,
];

/// The Export page's choices.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Options {
  /// One output per spread (its pages side by side) or per page. Frames are always per page.
  pub per: Per,
  /// Images only.
  pub format: ImageFormat,
  /// JPEG images' quality, 0 to 1.
  pub quality: f64,
  /// Inches projects: output pixels per inch, for a PDF's photos or for images; at most the
  /// project's. None: the project's, whatever it is now.
  pub dpi: Option<f64>,
  /// Pixel projects as a PDF: how many pixels make an inch of the page.
  pub print_at: f64,
}

impl Options {
  /// The defaults for an arrangement.
  pub fn default_for(arrangement: Arrangement) -> Self {
    Self {
      per: if arrangement == Arrangement::Spreads {
        Per::Spread
      } else {
        Per::Page
      },
      format: ImageFormat::Jpeg,
      quality: DEFAULT_QUALITY,
      dpi: None,
      print_at: DEFAULT_PRINT_AT,
    }
  }

  /// The defaults, with the choices saved with the project over them. (The dpi isn't saved.)
  pub fn for_project(project: &Project) -> Self {
    let mut o = Self::default_for(project.sheet().arrangement);
    if let Some(s) = project.export.as_ref().and_then(|e| e.options.as_ref()) {
      if let Some(per) = s.per {
        o.per = match per {
          ExportPer::Spread => Per::Spread,
          ExportPer::Page => Per::Page,
        };
      }
      if let Some(f) = s.format {
        o.format = f;
      }
      if let Some(q) = s.quality.filter(|q| (0.0..=1.0).contains(q)) {
        o.quality = q;
      }
      if let Some(p) = s.print_at.filter(|p| *p > 0.0) {
        o.print_at = p;
      }
    }
    o
  }

  /// What's saved with the project.
  pub fn saved(&self) -> Saved {
    Saved {
      per: Some(match self.per {
        Per::Spread => ExportPer::Spread,
        Per::Page => ExportPer::Page,
      }),
      format: Some(self.format),
      quality: Some(self.quality),
      print_at: Some(self.print_at),
    }
  }
}

/// Where Export opens before anything's picked: inches as a PDF; pixel frames at
/// Instagram's width to Instagram; other pixels as images.
pub fn default_destination(sheet: &Sheet) -> Destination {
  if sheet.unit == Unit::In {
    Destination::Pdf
  } else if sheet.arrangement == Arrangement::Frames && sheet.page_w == 1080.0 {
    Destination::Instagram
  } else {
    Destination::Images
  }
}

/// Whether a destination measures in pixels (so an inches project converts to it).
pub fn measures_in_pixels(d: Destination) -> bool {
  matches!(d, Destination::Images | Destination::Instagram)
}

/// Whether exporting to `d` converts the project's measurements.
pub fn converts(d: Destination, unit: Unit) -> bool {
  if d == Destination::Indesign {
    return false;
  }
  if unit == Unit::In {
    measures_in_pixels(d)
  } else {
    !measures_in_pixels(d)
  }
}

/// Output pixels per unit an export makes: for inches, the chosen dpi (no more than the
/// project's); for pixels, one each.
pub fn export_px_per_unit(d: Destination, sheet: &Sheet, dpi: Option<f64>) -> f64 {
  if sheet.unit == Unit::Px || matches!(d, Destination::Indesign | Destination::Instagram) {
    return sheet.px_per_unit;
  }
  sheet.px_per_unit.min(dpi.unwrap_or(sheet.px_per_unit).max(1.0))
}

/// One output per spread or per page, as asked; frames are pages either way.
pub fn per_of(project: &Project, per: Per) -> Per {
  if project.sheet().arrangement == Arrangement::Spreads {
    per
  } else {
    Per::Page
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn conversions() {
    assert!(converts(Destination::Images, Unit::In));
    assert!(!converts(Destination::Pdf, Unit::In));
    assert!(converts(Destination::Pdf, Unit::Px));
    assert!(!converts(Destination::Indesign, Unit::Px));
    assert!(!converts(Destination::Instagram, Unit::Px));
  }
}
