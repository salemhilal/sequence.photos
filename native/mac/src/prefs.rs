//! Settings and what the window remembers between launches (`src/prefs.ts`), kept as JSON
//! in the app's folder.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::library::support_dir;
use crate::theme::{DEFAULT_DESK, ThemePref};

pub const SIDEBAR_DEFAULT_WIDTH: f64 = 284.0;
pub const SIDEBAR_MIN_WIDTH: f64 = 240.0;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Prefs {
  pub theme: ThemePref,
  pub desk_color: u32,
  pub sidebar_open: bool,
  pub sidebar_width: f64,
  pub status_bar: bool,
  pub shortcut_badges: bool,
  pub tour_seen: bool,
  /// The open project's file, if it has one (and a bookmark to it, in the sandbox).
  pub document: Option<PathBuf>,
  #[serde(with = "bytes_b64", skip_serializing_if = "Option::is_none")]
  pub document_bookmark: Option<Vec<u8>>,
  /// Whether it had unsaved changes when last seen.
  pub document_edited: bool,
  /// Recently opened projects, newest first.
  pub recent: Vec<PathBuf>,
}

impl Default for Prefs {
  fn default() -> Self {
    Self {
      theme: ThemePref::System,
      desk_color: DEFAULT_DESK,
      sidebar_open: true,
      sidebar_width: SIDEBAR_DEFAULT_WIDTH,
      status_bar: true,
      shortcut_badges: true,
      tour_seen: false,
      document: None,
      document_bookmark: None,
      document_edited: false,
      recent: Vec::new(),
    }
  }
}

fn path() -> PathBuf {
  support_dir().join("prefs.json")
}

impl Prefs {
  pub fn load() -> Self {
    std::fs::read(path())
      .ok()
      .and_then(|b| serde_json::from_slice(&b).ok())
      .unwrap_or_default()
  }

  pub fn save(&self) {
    if let Ok(json) = serde_json::to_vec_pretty(self) {
      let _ = std::fs::write(path(), json);
    }
  }
}

/// Bookmarks as hex text, so the file stays readable JSON.
mod bytes_b64 {
  use serde::{Deserialize, Deserializer, Serializer};

  pub fn serialize<S: Serializer>(v: &Option<Vec<u8>>, s: S) -> Result<S::Ok, S::Error> {
    match v {
      Some(b) => s.serialize_str(&b.iter().map(|x| format!("{x:02x}")).collect::<String>()),
      None => s.serialize_none(),
    }
  }

  pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<u8>>, D::Error> {
    let s: Option<String> = Option::deserialize(d)?;
    Ok(s.and_then(|s| {
      (0..s.len())
        .step_by(2)
        .map(|i| s.get(i..i + 2).and_then(|h| u8::from_str_radix(h, 16).ok()))
        .collect()
    }))
  }
}
