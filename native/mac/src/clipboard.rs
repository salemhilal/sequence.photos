//! Copying photos inside the app (`src/clipboard.ts`). ⌘C remembers which photos were
//! copied and puts the first on the system clipboard as an image, for pasting elsewhere.
//! ⌘V pastes copies of them while the clipboard still holds that image (the same as
//! Duplicate, each paste a little further along); if something else was copied since, a
//! pasted image (or image files copied in Finder) is added to the desk instead.

use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;

use gpui_kit::*;
use sequence_core::PhotoId;

use crate::workspace::Workspace;

/// How far each paste of the same copy steps along, in desk inches.
const PASTE_STEP: f64 = 0.25;

/// What was copied: the photos, and a hash of the image put on the clipboard.
#[derive(Default)]
pub struct Copied {
  ids: Vec<PhotoId>,
  image: Option<u64>,
  pastes: usize,
}

fn hash(bytes: &[u8]) -> u64 {
  let mut h = DefaultHasher::new();
  bytes.hash(&mut h);
  h.finish()
}

fn format_of(bytes: &[u8]) -> Option<ImageFormat> {
  if bytes.starts_with(&[0xff, 0xd8]) {
    Some(ImageFormat::Jpeg)
  } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
    Some(ImageFormat::Png)
  } else {
    None
  }
}

impl Workspace {
  /// The photos ⌘C copies: the editor's selected photo, or the desk's selection.
  fn copyable(&self) -> Vec<PhotoId> {
    if self.ui.editing.is_some() {
      self.ui.editor_selected.iter().cloned().collect()
    } else {
      self.ui.selection.clone()
    }
  }

  /// ⌘C: remember the photos, and put the first on the clipboard as an image.
  pub fn copy_photos(&mut self, cx: &mut Context<Self>) {
    let ids = self.copyable();
    let Some(first) = ids.first() else { return };
    // The original if it's a JPEG or PNG, else its display copy.
    let original = std::fs::read(self.lib.image_path(first)).ok();
    let bytes = original
      .filter(|b| format_of(b).is_some())
      .or_else(|| std::fs::read(self.lib.dir.join("thumbs").join(format!("{first}.jpg"))).ok());
    let image = bytes.and_then(|b| {
      let format = format_of(&b)?;
      let h = hash(&b);
      cx.write_to_clipboard(ClipboardItem::new_image(&Image::from_bytes(format, b)));
      Some(h)
    });
    self.copied = Copied { ids, image, pastes: 0 };
  }

  /// ⌘V: copies of the photos copied here, or images from elsewhere added to the desk.
  pub fn paste(&mut self, cx: &mut Context<Self>) {
    if self.is_importing() || self.ui.cropping.is_some() || self.ui.layout.is_some() {
      return;
    }
    let item = cx.read_from_clipboard();
    let mut images = Vec::new();
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut ours = false;
    for entry in item.iter().flat_map(|i| i.entries.iter()) {
      match entry {
        ClipboardEntry::Image(img) => {
          if Some(hash(&img.bytes)) == self.copied.image {
            ours = true;
          } else {
            images.push(img.clone());
          }
        }
        ClipboardEntry::ExternalPaths(p) => paths.extend(p.paths().iter().cloned()),
        ClipboardEntry::String(_) => {}
      }
    }
    // Nothing on the clipboard (writing to it failed): the copy here still pastes.
    let empty = item.as_ref().is_none_or(|i| i.entries.is_empty());
    if (ours || (empty && self.copied.image.is_none())) && !self.copied.ids.is_empty() {
      self.paste_copied(cx);
      return;
    }
    if !paths.is_empty() {
      self.add_photos(paths, cx);
      return;
    }
    if images.is_empty() {
      return;
    }
    // Clipboard images have no name: "Pasted image 18.23.png".
    let dir = std::env::temp_dir().join(format!("sequence-paste-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let time = crate::commands::local_time_hm().replace(':', ".");
    let count = images.len();
    let mut files = Vec::new();
    for (i, img) in images.into_iter().enumerate() {
      let ext = match img.format {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Png => "png",
        ImageFormat::Gif => "gif",
        ImageFormat::Webp => "webp",
        ImageFormat::Tiff => "tiff",
        _ => "png",
      };
      let suffix = if count > 1 {
        format!(" {}", i + 1)
      } else {
        String::new()
      };
      let path = dir.join(format!("Pasted image {time}{suffix}.{ext}"));
      if std::fs::write(&path, &img.bytes).is_ok() {
        files.push(path);
      }
    }
    self.add_photos(files, cx);
  }

  /// Paste the copied photos as duplicates, each paste further along; select those on the desk.
  fn paste_copied(&mut self, cx: &mut Context<Self>) {
    let ids: Vec<PhotoId> = self
      .copied
      .ids
      .iter()
      .filter(|id| self.project().photos.contains_key(*id))
      .cloned()
      .collect();
    if ids.is_empty() {
      return;
    }
    self.copied.pastes += 1;
    let offset = PASTE_STEP * self.copied.pastes as f64;
    let created = self.duplicate_by(&ids, offset, cx);
    let on_desk: Vec<PhotoId> = created
      .into_iter()
      .filter(|id| self.project().pile.iter().any(|p| &p.photo_id == id))
      .collect();
    if !on_desk.is_empty() {
      self.ui.selection = on_desk;
    }
    cx.notify();
  }
}
