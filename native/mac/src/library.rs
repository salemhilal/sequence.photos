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
/// Why the library's project couldn't be loaded.
#[derive(Debug, PartialEq)]
pub enum Unloadable {
  /// Saved by a newer version of the app: left untouched.
  Newer,
  /// Unreadable: moved aside, to this file.
  SetAside(PathBuf),
}

pub struct Library {
  pub dir: PathBuf,
  /// Bumped whenever the library is emptied or replaced, so work started before (an
  /// import in the background) can tell its files went away.
  pub epoch: u64,
  thumbs: HashMap<PhotoId, Arc<Image>>,
  missing: HashSet<PhotoId>,
}

/// Photos read from files: the ones that worked, and the names of those that didn't.
pub struct Imported {
  pub photos: Vec<PhotoMeta>,
  /// Each photo's display copy, to show without reading it back.
  pub thumbs: Vec<(PhotoId, Vec<u8>)>,
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
      epoch: 0,
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

  /// Remove photos' files (an import that came back to a library that moved on).
  pub fn discard(&mut self, ids: impl IntoIterator<Item = PhotoId>) {
    for id in ids {
      let _ = fs::remove_file(self.image_path(&id));
      let _ = fs::remove_file(self.thumb_path(&id));
      self.thumbs.remove(&id);
    }
  }

  /// Keep display copies made elsewhere (by an import in the background).
  pub fn remember_all(&mut self, thumbs: Vec<(PhotoId, Vec<u8>)>) {
    for (id, t) in thumbs {
      self.remember(&id, t);
    }
  }
}

/// Read image files into the library at `dir`, sorted by name (numbers in order), as the
/// web app does. Photos that won't decode are named in `failed`. Safe to run off the main
/// thread: it only writes new files.
pub fn import_files(dir: &Path, paths: &[PathBuf], mut progress: impl FnMut(usize, usize)) -> Imported {
  let mut files: Vec<&PathBuf> = paths
    .iter()
    .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(is_image_name))
    .collect();
  files.sort_by(|a, b| natural_cmp(&name_of(a), &name_of(b)));
  let mut photos = Vec::new();
  let mut thumbs = Vec::new();
  let mut failed = Vec::new();
  let total = files.len();
  for (i, path) in files.into_iter().enumerate() {
    progress(i, total);
    let name = name_of(path);
    match import_one(dir, path, &name) {
      Some((meta, thumb)) => {
        thumbs.push((meta.id.clone(), thumb));
        photos.push(meta);
      }
      None => failed.push(name),
    }
  }
  Imported { photos, thumbs, failed }
}

fn import_one(dir: &Path, path: &Path, name: &str) -> Option<(PhotoMeta, Vec<u8>)> {
  let bytes = fs::read(path).ok()?;
  let decoded = imageio::decode(&bytes, DESK_PHOTO_PX)?;
  let id = PhotoId::new();
  let image = dir.join("images").join(&id.0);
  fs::write(&image, &bytes).ok()?;
  if fs::write(dir.join("thumbs").join(format!("{id}.jpg")), &decoded.thumb).is_err() {
    let _ = fs::remove_file(image);
    return None;
  }
  let meta = PhotoMeta {
    id,
    name: name.to_string(),
    px_w: decoded.px_w,
    px_h: decoded.px_h,
    crop: None,
  };
  Some((meta, decoded.thumb))
}

impl Library {
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
    self.forget();
  }

  /// Drop what's cached about the files, which have changed under it.
  fn forget(&mut self) {
    self.thumbs.clear();
    self.missing.clear();
    self.epoch += 1;
  }

  /// Remove the files of photos no project in `keep` refers to.
  pub fn prune(&mut self, keep: &HashSet<PhotoId>) {
    let Ok(entries) = fs::read_dir(self.dir.join("images")) else {
      return;
    };
    for e in entries.flatten() {
      let name = e.file_name().to_string_lossy().into_owned();
      if !sequence_core::validate::is_safe_id(&name) {
        continue;
      }
      let id = PhotoId(name);
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

  /// The project kept in the library: none if there isn't one, an error if there's one
  /// that won't open (it's moved aside, so it isn't overwritten).
  pub fn load_project(&self) -> Result<Option<Project>, Unloadable> {
    let Ok(text) = fs::read(self.project_path()) else {
      return Ok(None);
    };
    let project = serde_json::from_slice::<serde_json::Value>(&text)
      .ok()
      .map(|v| migrate_project(&v));
    match project {
      Some(Ok(p)) => Ok(Some(p)),
      // From a newer version: left as it is, for that version.
      Some(Err(sequence_core::schema::LoadError::Newer)) => Err(Unloadable::Newer),
      _ => {
        let stamp = std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .map_or(0, |d| d.as_secs());
        let aside = self.dir.join(format!("project.unreadable-{stamp}.json"));
        let _ = fs::rename(self.project_path(), &aside);
        Err(Unloadable::SetAside(aside))
      }
    }
  }

  /// Read a project file in place of the library's project. Photos it lacks are left
  /// out. It's read into a folder beside the library, which replaces it only once the
  /// whole file is read: a file that fails partway leaves the library as it was.
  #[cfg(test)]
  pub fn open_file(&mut self, path: &Path) -> Result<Project, OpenError> {
    let (project, staging) = Library::read_file(&self.dir, path)?;
    self.swap_in(&staging).map_err(OpenError::Io)?;
    Ok(project)
  }

  /// The first half of opening, which can run in the background: the file read into a
  /// folder beside the library at `dir`, which `swap_in` then puts in its place.
  pub fn read_file(dir: &Path, path: &Path) -> Result<(Project, PathBuf), OpenError> {
    let file = File::open(path).map_err(OpenError::Io)?;
    let mut opened = OpenedProject::open(BufReader::new(file))?;
    let staging = dir.with_extension("opening");
    let _ = fs::remove_dir_all(&staging);
    let stage = Library::at(staging.clone());
    match stage.fill_from(&mut opened) {
      Ok(project) => Ok((project, staging)),
      Err(e) => {
        let _ = fs::remove_dir_all(&staging);
        Err(e)
      }
    }
  }

  /// Replace the library's folder with `staging`.
  pub fn swap_in(&mut self, staging: &Path) -> io::Result<()> {
    let old = self.dir.with_extension("old");
    let _ = fs::remove_dir_all(&old);
    fs::rename(&self.dir, &old)?;
    if let Err(e) = fs::rename(staging, &self.dir) {
      let _ = fs::rename(&old, &self.dir);
      return Err(e);
    }
    let _ = fs::remove_dir_all(&old);
    self.forget();
    Ok(())
  }

  /// Copy an opened project file's photos into this (new, empty) library.
  fn fill_from<R: io::Read + io::Seek>(&self, opened: &mut OpenedProject<R>) -> Result<Project, OpenError> {
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
  #[cfg(test)]
  pub fn save_file(&self, path: &Path, project: &Project, exported_at: &str) -> io::Result<()> {
    Library::save_file_at(&self.dir, path, project, exported_at, |_| {})
  }

  /// Saving, for the background: the library at `dir`, with progress from 0 to 1.
  pub fn save_file_at(
    dir: &Path,
    path: &Path,
    project: &Project,
    exported_at: &str,
    mut progress: impl FnMut(f64),
  ) -> io::Result<()> {
    let lib = Library::at(dir.to_path_buf());
    let me = &lib;
    let mut images = Vec::new();
    let mut thumbs = Vec::new();
    for (id, meta) in &project.photos {
      let image = File::open(me.image_path(id))
        .map_err(|e| io::Error::new(e.kind(), format!("{} is missing from the app’s storage", meta.name)))?;
      images.push(BufReader::new(image));
      thumbs.push(File::open(me.thumb_path(id)).ok().map(BufReader::new));
    }
    let total = (images.len() + thumbs.iter().filter(|t| t.is_some()).count()).max(1) as f64;
    let mut sources: Vec<PhotoSource> = Vec::new();
    for (((id, meta), image), thumb) in project.photos.iter().zip(images.iter_mut()).zip(thumbs.iter_mut()) {
      sources.push(PhotoSource {
        id,
        name: &meta.name,
        image,
        thumb: thumb.as_mut().map(|t| t as &mut dyn io::Read),
      });
    }
    // Written in full to a temporary file first, then copied over the file: the sandbox
    // lets the app write the file the user chose but not make or rename others beside it.
    let tmp = std::env::temp_dir().join(format!("{}.saving", uuid_name()));
    let out = BufWriter::new(File::create(&tmp)?);
    let result = write_project(out, project, &mut sources, exported_at, |done| {
      progress(done as f64 / total)
    })
    .and_then(|w| w.into_inner().map_err(|e| e.into_error()))
    .and_then(|f| f.sync_all())
    .and_then(|()| fs::copy(&tmp, path).map(|_| ()));
    let _ = fs::remove_file(&tmp);
    result
  }
}

/// A fresh, unique file name.
fn uuid_name() -> String {
  PhotoId::new().0
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
    let lib = Library::at(dir.join("a"));
    let tour = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/tour/taxi.jpg");
    let imported = import_files(&lib.dir, &[PathBuf::from(tour)], |_, _| {});
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

    // A file that won't open leaves the library as it was.
    other.save_project(&back).expect("keeps");
    let bad = dir.join("bad.photo-sequence");
    fs::write(&bad, b"not a zip").expect("writes");
    assert!(other.open_file(&bad).is_err());
    assert_eq!(other.load_project(), Ok(Some(back)));
    assert!(other.image_path(&id).exists());
    let _ = fs::remove_dir_all(dir);
  }
}
