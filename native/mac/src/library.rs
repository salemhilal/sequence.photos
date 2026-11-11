//! Where the open project's photos are kept while it's open: a folder in the app's
//! container with each photo's original (`images/<id>`) and display copy (`thumbs/<id>.jpg`),
//! and the project itself (`project.json`), saved as it changes so nothing is lost if the
//! app quits. Project files are read into it and written from it.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gpui_kit::{ImageFormat, RenderImage};
use sequence_core::geometry::DESK_PHOTO_PX;
use sequence_core::project_file::{OpenError, OpenedProject, PhotoSource, write_project};
use sequence_core::schema::migrate_project;
use sequence_core::{PhotoId, PhotoMeta, Project};

use crate::imageio;
use crate::photo_cache::{self, Decode, PhotoCache};

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
  /// The photos decoded for drawing.
  pictures: PhotoCache<Arc<RenderImage>>,
  /// The window's device pixels per point, which photos are decoded for.
  scale: f64,
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

/// An image's format, from its first bytes: one the window can draw, or None.
pub fn sniff_format(bytes: &[u8]) -> Option<ImageFormat> {
  if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
    Some(ImageFormat::Png)
  } else if bytes.starts_with(b"GIF") {
    Some(ImageFormat::Gif)
  } else if bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
    Some(ImageFormat::Webp)
  } else if bytes.starts_with(&[0xff, 0xd8]) {
    Some(ImageFormat::Jpeg)
  } else {
    None
  }
}

/// The app's temporary folders (pasted images, test images) left by earlier runs: removed.
pub fn clean_temp() {
  let Ok(entries) = fs::read_dir(std::env::temp_dir()) else {
    return;
  };
  for e in entries.flatten() {
    let name = e.file_name().to_string_lossy().into_owned();
    if name.starts_with("sequence-paste-") || name.starts_with("Sequence test images ") {
      let _ = fs::remove_dir_all(e.path());
    }
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
      pictures: PhotoCache::new(photo_cache::BUDGET),
      scale: 1.0,
    }
  }

  /// The start of drawing a frame at `scale` device pixels per point: the pictures let go
  /// since the last, which the window drops (GPUI keeps each one's texture until told).
  pub fn begin_frame(&mut self, scale: f64) -> Vec<Arc<RenderImage>> {
    self.scale = scale;
    self.pictures.take_evicted()
  }

  /// The end of drawing a frame: the decodes it asked for, to start in the background
  /// (`decode`, then `landed`). Pictures over the budget that it didn't draw are let go.
  pub fn end_frame(&mut self) -> Vec<Decode> {
    self.pictures.end_frame()
  }

  /// The file a decode reads: the display copy, or the original for the larger levels.
  pub fn decode_path(&self, d: &Decode) -> PathBuf {
    if d.key.1.is_original() {
      self.image_path(&d.key.0)
    } else {
      self.thumb_path(&d.key.0)
    }
  }

  /// A decode finished (None: its file couldn't be read).
  pub fn landed(&mut self, d: &Decode, image: Option<(Arc<RenderImage>, usize)>) {
    self.pictures.landed(d, image);
  }

  /// The picture to draw a photo with, its whole drawn `w` × `h` points (not just its
  /// crop): decoded about that large, in the background; meanwhile a nearby size, or None.
  pub fn picture(&mut self, meta: &PhotoMeta, w: f64, h: f64) -> Option<Arc<RenderImage>> {
    let drawn = w.abs().max(h.abs()) * self.scale;
    self.pictures.get(&meta.id, drawn, meta.px_w.max(meta.px_h))
  }

  /// A photo's files were written again (the tour's samples): what was decoded of it goes.
  pub fn rewrote(&mut self, id: &PhotoId) {
    self.pictures.forget(id);
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

  /// Remove photos' files (an import that came back to a library that moved on).
  pub fn discard(&mut self, ids: impl IntoIterator<Item = PhotoId>) {
    for id in ids {
      let _ = fs::remove_file(self.image_path(&id));
      let _ = fs::remove_file(self.thumb_path(&id));
      self.pictures.forget(&id);
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
  let total = files.len();
  // Decoding is most of the work, and each photo's is its own: a few at a time, on as many
  // threads, with the photos kept in their sorted order.
  let workers = std::thread::available_parallelism()
    .map_or(2, |n| n.get())
    .clamp(1, 6)
    .min(total.max(1));
  let next = std::sync::atomic::AtomicUsize::new(0);
  let (tx, rx) = std::sync::mpsc::channel();
  let mut read: Vec<Option<PhotoMeta>> = (0..total).map(|_| None).collect();
  progress(0, total);
  std::thread::scope(|s| {
    for _ in 0..workers {
      let tx = tx.clone();
      let (next, files) = (&next, &files);
      s.spawn(move || {
        loop {
          let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
          let Some(path) = files.get(i) else { break };
          // ImageIO's temporaries are let go after each photo, not when the thread ends.
          let one = objc2::rc::autoreleasepool(|_| import_one(dir, path, &name_of(path)));
          if tx.send((i, one)).is_err() {
            break;
          }
        }
      });
    }
    drop(tx);
    for (done, (i, one)) in rx.iter().enumerate() {
      read[i] = one;
      progress(done + 1, total);
    }
  });
  let mut photos = Vec::new();
  let mut failed = Vec::new();
  for (path, one) in files.into_iter().zip(read) {
    match one {
      Some(meta) => photos.push(meta),
      None => failed.push(name_of(path)),
    }
  }
  Imported { photos, failed }
}

fn import_one(dir: &Path, path: &Path, name: &str) -> Option<PhotoMeta> {
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
  Some(meta)
}

impl Library {
  /// Copy a photo's files to a new id (a duplicate is its own photo).
  pub fn copy(&mut self, from: &PhotoId, to: &PhotoId) -> bool {
    let ok = fs::copy(self.image_path(from), self.image_path(to)).is_ok();
    let _ = fs::copy(self.thumb_path(from), self.thumb_path(to));
    // Its pictures are its original's, already decoded, until the original goes.
    self.pictures.alias(from, to);
    ok
  }

  /// Show a copy with its original's pictures before its files are copied (while it's
  /// dragged out).
  pub fn share_thumb(&mut self, from: &PhotoId, to: &PhotoId) {
    self.pictures.alias(from, to);
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
    self.pictures.clear();
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
        self.pictures.forget(&id);
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
    // Only to name its files: nothing's created (a save runs beside opens' folder swaps).
    let lib = Library {
      dir: dir.to_path_buf(),
      epoch: 0,
      pictures: PhotoCache::new(0),
      scale: 1.0,
    };
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
    assert!(other.thumb_path(&id).exists());

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
