//! Where the open project's photos are kept while it's open: a folder in the app's
//! container with each photo's original (`images/<id>`) and display copy (`thumbs/<id>.jpg`),
//! and the project itself (`project.json`), saved as it changes so nothing is lost if the
//! app quits. Project files are read into it and written from it.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gpui_kit::{Image, ImageFormat};
use sequence_core::geometry::DESK_PHOTO_PX;
use sequence_core::project_file::{OpenError, OpenedProject, PhotoSource, write_project};
use sequence_core::schema::migrate_project;
use sequence_core::{PhotoId, PhotoMeta, Project};

use crate::imageio;

/// The open project's photos on disk, and their display copies in memory.
pub struct Library {
  pub dir: PathBuf,
  thumbs: HashMap<PhotoId, Arc<Image>>,
  missing: HashSet<PhotoId>,
}

/// Photos read from files: the ones that worked, and the names of those that didn't.
pub struct Imported {
  pub photos: Vec<PhotoMeta>,
  pub failed: Vec<String>,
}

/// The app's own folder (in its container, when sandboxed).
pub fn support_dir() -> PathBuf {
  let dir = std::env::home_dir()
    .unwrap_or_else(std::env::temp_dir)
    .join("Library/Application Support/Sequence");
  let _ = fs::create_dir_all(&dir);
  dir
}

/// Image files the app reads, by extension.
pub fn is_image_name(name: &str) -> bool {
  let lower = name.to_lowercase();
  [
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif", ".tif", ".tiff",
  ]
  .iter()
  .any(|e| lower.ends_with(e))
}

fn format_of(bytes: &[u8]) -> ImageFormat {
  if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
    ImageFormat::Png
  } else if bytes.starts_with(b"GIF") {
    ImageFormat::Gif
  } else if bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
    ImageFormat::Webp
  } else {
    ImageFormat::Jpeg
  }
}

impl Library {
  /// The library in `dir`, made if it isn't there.
  pub fn at(dir: PathBuf) -> Self {
    let _ = fs::create_dir_all(dir.join("images"));
    let _ = fs::create_dir_all(dir.join("thumbs"));
    Self {
      dir,
      thumbs: HashMap::new(),
      missing: HashSet::new(),
    }
  }

  pub fn image_path(&self, id: &PhotoId) -> PathBuf {
    self.dir.join("images").join(&id.0)
  }

  pub fn thumb_path(&self, id: &PhotoId) -> PathBuf {
    self.dir.join("thumbs").join(format!("{id}.jpg"))
  }

  fn project_path(&self) -> PathBuf {
    self.dir.join("project.json")
  }

  /// A photo's display copy, read the first time it's asked for.
  pub fn thumb(&mut self, id: &PhotoId) -> Option<Arc<Image>> {
    if let Some(t) = self.thumbs.get(id) {
      return Some(t.clone());
    }
    if self.missing.contains(id) {
      return None;
    }
    match fs::read(self.thumb_path(id)) {
      Ok(bytes) => {
        let img = Arc::new(Image::from_bytes(format_of(&bytes), bytes));
        self.thumbs.insert(id.clone(), img.clone());
        Some(img)
      }
      Err(_) => {
        self.missing.insert(id.clone());
        None
      }
    }
  }

  /// A display copy just made: keep it (and its file).
  fn remember(&mut self, id: &PhotoId, thumb: Vec<u8>) {
    self.missing.remove(id);
    self
      .thumbs
      .insert(id.clone(), Arc::new(Image::from_bytes(ImageFormat::Jpeg, thumb)));
  }

  /// Read image files into the library, sorted by name (numbers in order), as the web
  /// app does. Photos that won't decode are named in `failed`.
  pub fn import(&mut self, paths: &[PathBuf]) -> Imported {
    let mut files: Vec<&PathBuf> = paths
      .iter()
      .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(is_image_name))
      .collect();
    files.sort_by(|a, b| natural_cmp(&name_of(a), &name_of(b)));
    let mut photos = Vec::new();
    let mut failed = Vec::new();
    for path in files {
      let name = name_of(path);
      match self.import_one(path, &name) {
        Some(meta) => photos.push(meta),
        None => failed.push(name),
      }
    }
    Imported { photos, failed }
  }

  fn import_one(&mut self, path: &Path, name: &str) -> Option<PhotoMeta> {
    let bytes = fs::read(path).ok()?;
    let decoded = imageio::decode(&bytes, DESK_PHOTO_PX)?;
    let id = PhotoId::new();
    fs::write(self.image_path(&id), &bytes).ok()?;
    fs::write(self.thumb_path(&id), &decoded.thumb).ok()?;
    self.remember(&id, decoded.thumb);
    Some(PhotoMeta {
      id,
      name: name.to_string(),
      px_w: decoded.px_w,
      px_h: decoded.px_h,
      crop: None,
    })
  }

  /// Copy a photo's files to a new id (a duplicate is its own photo).
  pub fn copy(&mut self, from: &PhotoId, to: &PhotoId) -> bool {
    let ok = fs::copy(self.image_path(from), self.image_path(to)).is_ok();
    let _ = fs::copy(self.thumb_path(from), self.thumb_path(to));
    if let Some(t) = self.thumbs.get(from).cloned() {
      self.thumbs.insert(to.clone(), t);
    }
    ok
  }

  /// Show a copy's display image before its files are copied (while it's dragged out).
  pub fn share_thumb(&mut self, from: &PhotoId, to: &PhotoId) {
    if let Some(t) = self.thumb(from) {
      self.thumbs.insert(to.clone(), t);
    }
  }

  /// Empty the library, for another project.
  pub fn clear(&mut self) {
    for sub in ["images", "thumbs"] {
      let _ = fs::remove_dir_all(self.dir.join(sub));
      let _ = fs::create_dir_all(self.dir.join(sub));
    }
    let _ = fs::remove_file(self.project_path());
    self.thumbs.clear();
    self.missing.clear();
  }

  /// Remove the files of photos no project in `keep` refers to.
  pub fn prune(&mut self, keep: &HashSet<PhotoId>) {
    let Ok(entries) = fs::read_dir(self.dir.join("images")) else {
      return;
    };
    for e in entries.flatten() {
      let id = PhotoId(e.file_name().to_string_lossy().into_owned());
      if !keep.contains(&id) {
        let _ = fs::remove_file(e.path());
        let _ = fs::remove_file(self.thumb_path(&id));
        self.thumbs.remove(&id);
      }
    }
  }

  /// Keep the project in the library (so it comes back after a restart).
  pub fn save_project(&self, project: &Project) -> io::Result<()> {
    let json = serde_json::to_vec(project).map_err(io::Error::other)?;
    let tmp = self.dir.join("project.json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(tmp, self.project_path())
  }

  /// The project kept in the library, if there is one that opens.
  pub fn load_project(&self) -> Option<Project> {
    let text = fs::read(self.project_path()).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&text).ok()?;
    migrate_project(&value).ok()
  }

  /// Read a project file into the (emptied) library. Photos it lacks are left out.
  pub fn open_file(&mut self, path: &Path) -> Result<Project, OpenError> {
    let file = File::open(path).map_err(OpenError::Io)?;
    let mut opened = OpenedProject::open(BufReader::new(file))?;
    self.clear();
    let missing = opened.missing_photos();
    let mut project = opened.project.clone();
    sequence_core::project_file::remove_photos(&mut project, &missing);
    let ids: Vec<PhotoId> = project.photos.keys().cloned().collect();
    for id in ids {
      let Some(files) = opened.files.get(&id).cloned() else {
        continue;
      };
      let mut out = File::create(self.image_path(&id)).map_err(OpenError::Io)?;
      opened.copy_entry(&files.image, &mut out).map_err(OpenError::Io)?;
      let thumb = files.thumb.as_ref().filter(|t| opened.has(t)).cloned();
      match thumb {
        Some(t) => {
          let mut out = File::create(self.thumb_path(&id)).map_err(OpenError::Io)?;
          opened.copy_entry(&t, &mut out).map_err(OpenError::Io)?;
        }
        None => {
          // No display copy saved with it: make one.
          if let Some(d) = fs::read(self.image_path(&id))
            .ok()
            .and_then(|b| imageio::decode(&b, DESK_PHOTO_PX))
          {
            let _ = fs::write(self.thumb_path(&id), &d.thumb);
          }
        }
      }
    }
    Ok(project)
  }

  /// Write the project and its photos to a project file (through a temporary file beside
  /// it, so a failed save leaves the old one).
  pub fn save_file(&self, path: &Path, project: &Project, exported_at: &str) -> io::Result<()> {
    let mut images = Vec::new();
    let mut thumbs = Vec::new();
    for id in project.photos.keys() {
      images.push(BufReader::new(File::open(self.image_path(id))?));
      thumbs.push(File::open(self.thumb_path(id)).ok().map(BufReader::new));
    }
    let mut sources: Vec<PhotoSource> = Vec::new();
    for (((id, meta), image), thumb) in project.photos.iter().zip(images.iter_mut()).zip(thumbs.iter_mut()) {
      sources.push(PhotoSource {
        id,
        name: &meta.name,
        image,
        thumb: thumb.as_mut().map(|t| t as &mut dyn io::Read),
      });
    }
    let tmp = path.with_extension("photo-sequence.saving");
    let out = BufWriter::new(File::create(&tmp)?);
    let result = write_project(out, project, &mut sources, exported_at, |_| {})
      .and_then(|w| w.into_inner().map_err(|e| e.into_error()))
      .and_then(|f| f.sync_all());
    match result {
      Ok(()) => fs::rename(&tmp, path),
      Err(e) => {
        let _ = fs::remove_file(&tmp);
        Err(e)
      }
    }
  }
}

fn name_of(p: &Path) -> String {
  p.file_name()
    .map(|n| n.to_string_lossy().into_owned())
    .unwrap_or_default()
}

/// Compare names as people read them: "IMG_2" before "IMG_10", ignoring case.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
  let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
  loop {
    match (a.peek().copied(), b.peek().copied()) {
      (None, None) => return std::cmp::Ordering::Equal,
      (None, _) => return std::cmp::Ordering::Less,
      (_, None) => return std::cmp::Ordering::Greater,
      (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
        let mut na = String::new();
        while let Some(c) = a.peek().copied().filter(char::is_ascii_digit) {
          na.push(c);
          a.next();
        }
        let mut nb = String::new();
        while let Some(c) = b.peek().copied().filter(char::is_ascii_digit) {
          nb.push(c);
          b.next();
        }
        let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
        let o = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
        if o != std::cmp::Ordering::Equal {
          return o;
        }
      }
      (Some(x), Some(y)) => {
        let o = x.to_lowercase().cmp(y.to_lowercase());
        if o != std::cmp::Ordering::Equal {
          return o;
        }
        a.next();
        b.next();
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn names_sort_as_read() {
    let mut v = vec!["IMG_10.jpg", "img_2.jpg", "IMG_1.jpg"];
    v.sort_by(|a, b| natural_cmp(a, b));
    assert_eq!(v, vec!["IMG_1.jpg", "img_2.jpg", "IMG_10.jpg"]);
  }

  #[test]
  fn a_project_file_round_trips() {
    let dir = std::env::temp_dir().join(format!("sequence-lib-{}", PhotoId::new()));
    let mut lib = Library::at(dir.join("a"));
    let tour = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/tour/taxi.jpg");
    let imported = lib.import(&[PathBuf::from(tour)]);
    assert_eq!(imported.photos.len(), 1);
    let mut p = Project::empty();
    let visible = sequence_core::geometry::Rect::new(0.0, 0.0, 20.0, 12.0);
    sequence_core::actions::add_photos_to_pile(&mut p, imported.photos, visible);
    let file = dir.join("t.photo-sequence");
    lib.save_file(&file, &p, "2026-11-08T00:00:00.000Z").expect("saves");
    let mut other = Library::at(dir.join("b"));
    let back = other.open_file(&file).expect("opens");
    assert_eq!(back, p);
    let id = back.photos.keys().next().cloned().expect("a photo");
    assert!(other.thumb(&id).is_some());
    let _ = fs::remove_dir_all(dir);
  }
}
