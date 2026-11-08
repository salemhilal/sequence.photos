//! What changes with the page's unit, inches or pixels, and the arrangement's words
//! (`src/units.ts`).

use crate::model::{Arrangement, PageSetup, Unit};

/// A unit's steps, limits, and rounding.
#[derive(Clone, Copy, Debug)]
pub struct Units {
  /// Shown after numbers.
  pub suffix: &'static str,
  pub name: &'static str,
  /// An arrow-key nudge, and with Shift.
  pub nudge: f64,
  pub nudge_big: f64,
  /// What Shift snaps a dragged guide to, and its name.
  pub snap: f64,
  pub snap_label: &'static str,
  /// The smallest a border guide's box gets.
  pub min_box: f64,
  /// How much each new border guide steps in from the last.
  pub guide_step: f64,
  /// The smallest page or frame.
  pub min_size: f64,
  /// The smallest side a placed photo gets.
  pub min_photo: f64,
  /// Steps in a number field.
  pub field_step: f64,
}

/// JavaScript's Math.round: halves round up (toward +∞), unlike f64::round.
pub fn js_round(n: f64) -> f64 {
  (n + 0.5).floor()
}

fn round_inches(n: f64) -> f64 {
  let eighths = (n * 8.0 - js_round(n * 8.0)).abs() < 1e-9;
  if eighths {
    js_round(n * 1000.0) / 1000.0
  } else {
    js_round(n * 100.0) / 100.0
  }
}

impl Units {
  /// The unit's values as they're kept and shown: eighths of an inch exactly, else
  /// hundredths; whole pixels.
  pub fn round(&self, n: f64) -> f64 {
    if self.suffix == "in" {
      round_inches(n)
    } else {
      js_round(n)
    }
  }

  /// A value as shown (as JavaScript prints the number).
  pub fn format(&self, n: f64) -> String {
    crate::js_number(self.round(n))
  }
}

pub const INCHES: Units = Units {
  suffix: "in",
  name: "inches",
  nudge: 1.0 / 16.0,
  nudge_big: 0.5,
  snap: 0.125,
  snap_label: "⅛ in",
  min_box: 0.25,
  guide_step: 0.25,
  min_size: 1.0,
  min_photo: 0.1,
  field_step: 0.125,
};

pub const PIXELS: Units = Units {
  suffix: "px",
  name: "pixels",
  nudge: 1.0,
  nudge_big: 10.0,
  snap: 10.0,
  snap_label: "10 px",
  min_box: 24.0,
  guide_step: 25.0,
  min_size: 100.0,
  min_photo: 10.0,
  field_step: 1.0,
};

/// The unit's steps and limits.
pub fn units(unit: Unit) -> &'static Units {
  match unit {
    Unit::In => &INCHES,
    Unit::Px => &PIXELS,
  }
}

/// The resolution inches are exported at unless the document says otherwise.
pub const DEFAULT_DPI: f64 = 300.0;

/// A new project's book: 10 × 8 in pages, at 300 dpi.
pub const DEFAULT_PAGE: PageSetup = PageSetup {
  w: 10.0,
  h: 8.0,
  unit: Unit::In,
  px_per_unit: DEFAULT_DPI,
};

/// A page setting people often want, set all at once.
#[derive(Clone, Copy, Debug)]
pub struct Preset {
  pub label: &'static str,
  pub arrangement: Arrangement,
  pub w: f64,
  pub h: f64,
  pub unit: Unit,
}

const fn preset(label: &'static str, arrangement: Arrangement, w: f64, h: f64, unit: Unit) -> Preset {
  Preset {
    label,
    arrangement,
    w,
    h,
    unit,
  }
}

/// Books, zines, slides, and Instagram's feed and story sizes.
pub const PRESETS: &[Preset] = &[
  preset("Book", Arrangement::Spreads, 10.0, 8.0, Unit::In),
  preset("Zine", Arrangement::Spreads, 5.5, 8.5, Unit::In),
  preset("Square book", Arrangement::Spreads, 8.0, 8.0, Unit::In),
  preset("Slides", Arrangement::Frames, 13.33, 7.5, Unit::In),
  preset("Instagram 4:5", Arrangement::Frames, 1080.0, 1350.0, Unit::Px),
  // The Instagram app takes 3:4; its upload API doesn't (posting crops or expands it).
  preset(
    "Instagram 3:4 (app uploads)",
    Arrangement::Frames,
    1080.0,
    1440.0,
    Unit::Px,
  ),
  preset("Instagram square", Arrangement::Frames, 1080.0, 1080.0, Unit::Px),
  preset("Instagram landscape", Arrangement::Frames, 1080.0, 566.0, Unit::Px),
  preset("Instagram story", Arrangement::Frames, 1080.0, 1920.0, Unit::Px),
];

/// What the UI calls things in each arrangement.
#[derive(Clone, Copy, Debug)]
pub struct Terms {
  pub spread: &'static str,
  pub spreads: &'static str,
  pub spreads_title: &'static str,
  pub page: &'static str,
  pub pages: &'static str,
  pub add_at_end: &'static str,
  pub turn: &'static str,
  pub preview: &'static str,
  pub pdf_title: &'static str,
  pub file_stem: &'static str,
  /// Top, bottom, inside, outside.
  pub edges: [&'static str; 4],
  pub guides_note: &'static str,
}

impl Terms {
  /// The sidebar's count: a book's pages, or a sequence's frames.
  pub fn count(&self, spreads: usize) -> String {
    if self.spread == "spread" {
      format!("{} pages", (spreads * 2).saturating_sub(2))
    } else {
      format!("{spreads} {}", if spreads == 1 { "frame" } else { "frames" })
    }
  }
}

pub const BOOK_TERMS: Terms = Terms {
  spread: "spread",
  spreads: "spreads",
  spreads_title: "Spreads",
  page: "page",
  pages: "pages",
  add_at_end: "Add a spread before the back page",
  turn: "turn pages",
  preview: "Preview book",
  pdf_title: "Photo book",
  file_stem: "photo-book",
  edges: ["Top", "Bottom", "Inside", "Outside"],
  guides_note: "Guides apply to every spread, mirrored on facing pages. Inside is the edge at the gutter; vertical guides are measured from the outside edge.",
};

pub const FRAME_TERMS: Terms = Terms {
  spread: "frame",
  spreads: "frames",
  spreads_title: "Frames",
  page: "frame",
  pages: "frames",
  add_at_end: "Add a frame at the end",
  turn: "go through frames",
  preview: "Preview",
  pdf_title: "Sequence",
  file_stem: "sequence",
  edges: ["Top", "Bottom", "Right", "Left"],
  guides_note: "Guides apply to every frame. Vertical guides are measured from the left edge.",
};

/// The arrangement's words.
pub fn terms(arrangement: Arrangement) -> &'static Terms {
  match arrangement {
    Arrangement::Spreads => &BOOK_TERMS,
    Arrangement::Frames => &FRAME_TERMS,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn rounds_as_the_web_app_does() {
    assert_eq!(INCHES.round(1.0 / 16.0), 0.06);
    assert_eq!(INCHES.round(0.375), 0.375);
    assert_eq!(INCHES.round(0.125), 0.125);
    assert_eq!(INCHES.round(1.2345), 1.23);
    assert_eq!(INCHES.format(2.0), "2");
    assert_eq!(PIXELS.round(2.5), 3.0);
    assert_eq!(PIXELS.round(-2.5), -2.0);
  }

  #[test]
  fn counts() {
    assert_eq!(BOOK_TERMS.count(4), "6 pages");
    assert_eq!(FRAME_TERMS.count(1), "1 frame");
  }
}
