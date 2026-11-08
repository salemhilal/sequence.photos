//! The project model (`src/types.ts`), saved as the same JSON. Positions and sizes on pages
//! are in the page's unit (inches or pixels); the desk is always inches.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::ids::{GuideId, PhotoId, SpreadId};

/// The version of the saved project's shape; see `schema`.
pub const CURRENT_SCHEMA: u32 = 7;

/// A photo the project holds.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoMeta {
  pub id: PhotoId,
  pub name: String,
  /// Pixel dimensions of the original, after EXIF orientation.
  #[serde(rename = "pxW")]
  pub px_w: f64,
  #[serde(rename = "pxH")]
  pub px_h: f64,
  /// The part of the original that shows, wherever the photo is; none is the whole photo.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub crop: Option<Crop>,
}

/// A rectangle within a photo, in fractions of its upright width and height (0 to 1).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Crop {
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
}

/// The colors a page's background and a photo's border come in, for now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Ink {
  White,
  Black,
}

/// A border drawn around a placed photo, outside its edges, in the page's unit.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PhotoBorder {
  pub width: f64,
  pub color: Ink,
}

/// A photo placed on the desk or a page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
  pub photo_id: PhotoId,
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
  /// Stacking order; the most recently touched photo has the highest z.
  pub z: f64,
  /// None: no border. Only on pages.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub border: Option<PhotoBorder>,
}

/// Which place in a layout a spread has.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpreadKind {
  /// A book's single first (right) page.
  First,
  /// A pair of facing pages.
  Middle,
  /// A book's single last (left) page.
  Last,
  /// One image of a sequence.
  Frame,
}

/// A spread or a frame. In spreads, x = 0 is the gutter (the left page spans -pageW..0,
/// the right page 0..pageW); a frame's x = 0 is its left edge. y = 0 is the top.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Spread {
  pub kind: SpreadKind,
  pub id: SpreadId,
  pub items: Vec<Placement>,
  /// The color behind its photos; none is white.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub background: Option<Ink>,
}

impl Spread {
  /// An empty one of this kind.
  pub fn empty(kind: SpreadKind) -> Self {
    Self {
      kind,
      id: SpreadId::new(),
      items: Vec::new(),
      background: None,
    }
  }
}

/// A page of a spread: a book's left or right page, or the whole of a frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PageSide {
  Left,
  Right,
  Whole,
}

/// Facing pages (a book) or single pages in order (a sequence of frames).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Arrangement {
  Spreads,
  Frames,
}

/// What sizes and positions on pages are stored in. The desk is always inches.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Unit {
  #[serde(rename = "in")]
  In,
  #[serde(rename = "px")]
  Px,
}

/// The page: one page's size (a spread is two), its unit, and its resolution.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSetup {
  pub w: f64,
  pub h: f64,
  pub unit: Unit,
  /// Output pixels per unit: the dpi for inches, the pixel density for pixels.
  pub px_per_unit: f64,
}

/// A book's spreads, each in its place, or a sequence's frames (never empty).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Layout {
  #[serde(rename_all = "camelCase")]
  Spreads {
    first_spread: Spread,
    spreads: Vec<Spread>,
    last_spread: Spread,
  },
  Frames {
    frames: Vec<Spread>,
  },
}

impl Layout {
  pub fn arrangement(&self) -> Arrangement {
    match self {
      Layout::Spreads { .. } => Arrangement::Spreads,
      Layout::Frames { .. } => Arrangement::Frames,
    }
  }

  /// Every spread (or frame), first to last.
  pub fn all(&self) -> Vec<&Spread> {
    match self {
      Layout::Spreads {
        first_spread,
        spreads,
        last_spread,
      } => std::iter::once(first_spread)
        .chain(spreads)
        .chain(std::iter::once(last_spread))
        .collect(),
      Layout::Frames { frames } => frames.iter().collect(),
    }
  }

  /// Every spread (or frame), first to last, to change.
  pub fn all_mut(&mut self) -> Vec<&mut Spread> {
    match self {
      Layout::Spreads {
        first_spread,
        spreads,
        last_spread,
      } => std::iter::once(first_spread)
        .chain(spreads.iter_mut())
        .chain(std::iter::once(last_spread))
        .collect(),
      Layout::Frames { frames } => frames.iter_mut().collect(),
    }
  }
}

/// Distances from a page's edges. Inside is the gutter's edge (a frame's right), outside
/// the one opposite (a frame's left), so they mirror on facing pages.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Edges {
  pub top: f64,
  pub bottom: f64,
  pub inside: f64,
  pub outside: f64,
}

/// A border guide's box: the same distance from each edge, or its own per edge.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BorderShape {
  Even { inset: f64 },
  Edges(Edges),
}

/// A box inset from every page's edges.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BorderGuide {
  pub id: GuideId,
  #[serde(flatten)]
  pub shape: BorderShape,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
  Vertical,
  Horizontal,
}

/// A straight guide across every page, mirrored on facing pages. A vertical guide's `at`
/// is from the page's outside edge (a frame's left); a horizontal guide's, from its top.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LineGuide {
  pub id: GuideId,
  pub axis: Axis,
  pub at: f64,
}

/// The guides and how page changes treat photos.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
  pub center_v: bool,
  pub center_h: bool,
  /// When the page size changes, move photos with the guides.
  pub keep_relative: bool,
  pub borders: Vec<BorderGuide>,
  pub lines: Vec<LineGuide>,
  /// The border guide dropped photos fit inside; none (or one that's gone) is the largest.
  pub drop_border: Option<GuideId>,
}

/// A project: its photos, the desk, the page, the layout, and the guides.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
  pub schema_version: u32,
  pub photos: IndexMap<PhotoId, PhotoMeta>,
  /// Photos on the desk, in inches.
  pub pile: Vec<Placement>,
  pub page: PageSetup,
  pub layout: Layout,
  pub settings: Settings,
  pub next_z: f64,
  /// How it was last set up to export; saved with it, outside undo.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub export: Option<ExportState>,
}

/// Where a project exports to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportDestination {
  Pdf,
  Images,
  Indesign,
  Instagram,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportPer {
  Spread,
  Page,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
  Jpeg,
  Png,
}

/// PDF, images, and InDesign's options.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub per: Option<ExportPer>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub format: Option<ImageFormat>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub quality: Option<f64>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub print_at: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PostKind {
  Feed,
  Story,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PostFit {
  Crop,
  Expand,
}

/// Someone tagged on a slide, at a point in fractions of it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Tag {
  pub username: String,
  pub x: f64,
  pub y: f64,
}

/// The Instagram post being written.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct InstagramState {
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub kind: Option<PostKind>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub fit: Option<PostFit>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub caption: Option<String>,
  /// The slides chosen to post (slide keys), in no particular order.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub chosen: Option<Vec<String>>,
  /// People tagged, by slide key.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub tags: Option<IndexMap<String, Vec<Tag>>>,
}

/// The Export page's choices for a project, each kept once it's been made.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ExportState {
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub to: Option<ExportDestination>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub options: Option<ExportOptions>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub instagram: Option<InstagramState>,
}

/// What geometry lays photos out on: the project's page and guides. Worked out from the
/// project (`Project::sheet`), never saved.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
  pub arrangement: Arrangement,
  pub unit: Unit,
  pub px_per_unit: f64,
  pub page_w: f64,
  pub page_h: f64,
  pub center_v: bool,
  pub center_h: bool,
  pub keep_relative: bool,
  pub borders: Vec<BorderGuide>,
  pub lines: Vec<LineGuide>,
  pub drop_border: Option<GuideId>,
}

impl Project {
  /// A new project: a 10 × 8 in book at 300 dpi with two empty spreads and two border guides.
  pub fn empty() -> Self {
    let margin = GuideId::new();
    Self {
      schema_version: CURRENT_SCHEMA,
      photos: IndexMap::new(),
      pile: Vec::new(),
      page: crate::units::DEFAULT_PAGE,
      layout: Layout::Spreads {
        first_spread: Spread::empty(SpreadKind::First),
        spreads: vec![Spread::empty(SpreadKind::Middle), Spread::empty(SpreadKind::Middle)],
        last_spread: Spread::empty(SpreadKind::Last),
      },
      settings: Settings {
        center_v: true,
        center_h: true,
        keep_relative: true,
        borders: vec![
          BorderGuide {
            id: margin.clone(),
            shape: BorderShape::Even { inset: 0.5 },
          },
          BorderGuide {
            id: GuideId::new(),
            shape: BorderShape::Even { inset: 1.25 },
          },
        ],
        lines: Vec::new(),
        drop_border: Some(margin),
      },
      next_z: 1.0,
      export: None,
    }
  }

  /// The page or frame photos are laid out on, with its size and guides.
  pub fn sheet(&self) -> Sheet {
    let s = &self.settings;
    Sheet {
      arrangement: self.layout.arrangement(),
      unit: self.page.unit,
      px_per_unit: self.page.px_per_unit,
      page_w: self.page.w,
      page_h: self.page.h,
      center_v: s.center_v,
      center_h: s.center_h,
      keep_relative: s.keep_relative,
      borders: s.borders.clone(),
      lines: s.lines.clone(),
      drop_border: s.drop_border.clone(),
    }
  }

  /// The spread (or frame) with this id.
  pub fn find_spread(&self, id: &SpreadId) -> Option<&Spread> {
    self.layout.all().into_iter().find(|s| &s.id == id)
  }
}
