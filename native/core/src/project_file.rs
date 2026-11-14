//! Project files (`src/project.ts`): a `.photo-sequence` file is a ZIP holding
//!
//! ```text
//! project.json     the project (as saved, in whatever version) and where each photo's files are
//! images/<name>    the original files, as imported
//! thumbs/<id>.jpg  display copies (optional; made again on opening if missing)
//! ```
//!
//! Reading and writing go through `Read + Seek` and `Write + Seek`, so this works on files
//! (the Mac app) as well as in memory (the browser, one day), and never needs a whole
//! project in memory: photos are copied straight between the archive and their source.

use std::collections::HashSet;
use std::io::{self, Read, Seek, Write};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::PhotoId;
use crate::model::Project;
use crate::schema::{LoadError, migrate_project};

/// From the app's old name (Photobook Sequencer); project files carry it, so it stays.
const FORMAT: &str = "photo-sequencer-project";
/// The file's layout (the project inside has its own schema version).
const VERSION: f64 = 1.0;
const MANIFEST: &str = "project.json";

/// The file extension, and what else opens as a project.
pub const PROJECT_EXTENSION: &str = "photo-sequence";

/// Whether a file's name says it's a project (a `.photo-sequence`, or a plain `.zip`).
pub fn is_project_name(name: &str) -> bool {
  let lower = name.to_lowercase();
  lower.ends_with(".photo-sequence") || lower.ends_with(".zip")
}

/// Where a photo's files are in the archive.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PhotoFiles {
  pub image: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub thumb: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest<'a> {
  format: &'static str,
  version: f64,
  exported_at: &'a str,
  /// Called `doc` (from before), since files carry the name.
  doc: &'a Project,
  files: &'a IndexMap<PhotoId, PhotoFiles>,
}

/// Why a project file couldn't be opened, in words for the person opening it.
#[derive(Debug)]
pub enum OpenError {
  /// Not a ZIP, or no project.json in it.
  NotAProject,
  /// project.json isn't a Sequence project's.
  WrongFormat,
  /// Made by a newer version of Sequence.
  Newer,
  /// Damaged: unreadable JSON, or a project that doesn't check out.
  Damaged,
  Io(io::Error),
}

impl std::fmt::Display for OpenError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(match self {
      OpenError::NotAProject => "This file isn’t a Sequence project.",
      OpenError::WrongFormat => "This file isn’t a Sequence project.",
      OpenError::Newer => {
        "This project was made by a newer version of Sequence. Update Sequence from the App Store, then try again."
      }
      OpenError::Damaged => "The project file is damaged.",
      OpenError::Io(e) => return write!(f, "Couldn’t read the project: {e}"),
    })
  }
}

impl std::error::Error for OpenError {}

/// An opened project file: the project (upgraded and checked), and the archive, to read
/// each photo's files from.
pub struct OpenedProject<R: Read + Seek> {
  pub project: Project,
  /// Where each photo's files are, as the manifest says (photos without an entry are missing).
  pub files: IndexMap<PhotoId, PhotoFiles>,
  /// When it was saved, as the file says (an ISO date, or empty).
  pub exported_at: String,
  archive: ZipArchive<R>,
}

impl<R: Read + Seek> OpenedProject<R> {
  /// Open a project file: read its manifest, and upgrade and check the project in it.
  pub fn open(reader: R) -> Result<Self, OpenError> {
    let mut archive = ZipArchive::new(reader).map_err(|_| OpenError::NotAProject)?;
    let mut text = String::new();
    archive
      .by_name(MANIFEST)
      .map_err(|_| OpenError::NotAProject)?
      .read_to_string(&mut text)
      .map_err(|_| OpenError::Damaged)?;
    let m: Value = serde_json::from_str(&text).map_err(|_| OpenError::Damaged)?;
    let version = m.get("version").and_then(Value::as_f64);
    let files_raw = m.get("files").and_then(Value::as_object);
    let (Some(version), Some(files_raw)) = (version, files_raw) else {
      return Err(OpenError::WrongFormat);
    };
    if m.get("format").and_then(Value::as_str) != Some(FORMAT) {
      return Err(OpenError::WrongFormat);
    }
    let mut files = IndexMap::new();
    for (id, f) in files_raw {
      let image = f.get("image").and_then(Value::as_str).ok_or(OpenError::Damaged)?;
      let thumb = match f.get("thumb") {
        None => None,
        Some(Value::String(t)) => Some(t.clone()),
        Some(_) => return Err(OpenError::Damaged),
      };
      files.insert(
        PhotoId(id.clone()),
        PhotoFiles {
          image: image.into(),
          thumb,
        },
      );
    }
    if version > VERSION {
      return Err(OpenError::Newer);
    }
    let project = migrate_project(m.get("doc").unwrap_or(&Value::Null)).map_err(|e| match e {
      LoadError::Newer => OpenError::Newer,
      LoadError::Invalid(_) => OpenError::Damaged,
    })?;
    let exported_at = match m.get("exportedAt") {
      Some(Value::String(s)) => s.clone(),
      None | Some(Value::Null) => String::new(),
      Some(other) => other.to_string(),
    };
    Ok(Self {
      project,
      files,
      exported_at,
      archive,
    })
  }

  /// Whether a file is in the archive.
  pub fn has(&mut self, path: &str) -> bool {
    self.archive.index_for_name(path).is_some()
  }

  /// Copy a file out of the archive (a photo's original or thumbnail) into `out`.
  pub fn copy_entry(&mut self, path: &str, out: &mut impl Write) -> io::Result<u64> {
    let mut entry = self.archive.by_name(path).map_err(io::Error::other)?;
    io::copy(&mut entry, out)
  }

  /// A file's contents (for small ones, like thumbnails).
  pub fn read_entry(&mut self, path: &str) -> io::Result<Vec<u8>> {
    let mut out = Vec::new();
    self.copy_entry(path, &mut out)?;
    Ok(out)
  }

  /// The photos whose original isn't in the file: the manifest has no entry for them, or
  /// the entry isn't there.
  pub fn missing_photos(&mut self) -> Vec<PhotoId> {
    let ids: Vec<PhotoId> = self.project.photos.keys().cloned().collect();
    ids
      .into_iter()
      .filter(|id| {
        self
          .files
          .get(id)
          .map(|f| f.image.clone())
          .is_none_or(|p| !self.has(&p))
      })
      .collect()
  }
}

/// Leave photos out of a project wherever they are (the ones missing from its file).
pub fn remove_photos(project: &mut Project, ids: &[PhotoId]) {
  let gone: HashSet<&PhotoId> = ids.iter().collect();
  project.photos.retain(|id, _| !gone.contains(id));
  project.pile.retain(|p| !gone.contains(&p.photo_id));
  for s in project.layout.all_mut() {
    s.items.retain(|p| !gone.contains(&p.photo_id));
  }
}

/// A photo's files, to write into a project file.
pub struct PhotoSource<'a> {
  pub id: &'a PhotoId,
  /// Its name, which its original takes in the archive (made unique).
  pub name: &'a str,
  pub image: &'a mut dyn Read,
  pub thumb: Option<&'a mut dyn Read>,
}

/// Write a project file: the manifest, then each photo's original and thumbnail, stored
/// uncompressed (photos are already compressed). `exported_at` is an ISO date. Calls
/// `progress` with the number of files written.
pub fn write_project<W: Write + Seek>(
  out: W,
  project: &Project,
  photos: &mut [PhotoSource<'_>],
  exported_at: &str,
  mut progress: impl FnMut(usize),
) -> io::Result<W> {
  let mut used = HashSet::new();
  let mut files = IndexMap::new();
  let mut paths = Vec::with_capacity(photos.len());
  for p in photos.iter() {
    let image = format!("images/{}", unique_name(p.name, &p.id.0, &mut used));
    let thumb = p.thumb.as_ref().map(|_| format!("thumbs/{}.jpg", p.id));
    files.insert(
      p.id.clone(),
      PhotoFiles {
        image: image.clone(),
        thumb: thumb.clone(),
      },
    );
    paths.push((image, thumb));
  }
  let manifest = Manifest {
    format: FORMAT,
    version: VERSION,
    exported_at,
    doc: project,
    files: &files,
  };
  let json = serde_json::to_vec_pretty(&manifest).map_err(io::Error::other)?;

  let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
  let mut zip = ZipWriter::new(out);
  zip.start_file(MANIFEST, stored).map_err(io::Error::other)?;
  zip.write_all(&json)?;
  let mut done = 0;
  for (p, (image, thumb)) in photos.iter_mut().zip(paths) {
    zip.start_file(image, stored).map_err(io::Error::other)?;
    io::copy(p.image, &mut zip)?;
    done += 1;
    progress(done);
    if let (Some(t), Some(path)) = (p.thumb.as_mut(), thumb) {
      zip.start_file(path, stored).map_err(io::Error::other)?;
      io::copy(t, &mut zip)?;
      done += 1;
      progress(done);
    }
  }
  zip.finish().map_err(io::Error::other)
}

/// A filename not yet in `used` (case-insensitively), made safe for any file system.
pub fn unique_name(name: &str, id: &str, used: &mut HashSet<String>) -> String {
  let mut clean: String = name
    .chars()
    .map(|c| {
      if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
        '_'
      } else {
        c
      }
    })
    .collect();
  if clean.is_empty() {
    clean = format!("{id}.jpg");
  }
  let mut result = clean.clone();
  let mut n = 2;
  while used.contains(&result.to_lowercase()) {
    result = match clean.rfind('.') {
      Some(dot) if dot > 0 => format!("{} ({n}){}", &clean[..dot], &clean[dot..]),
      _ => format!("{clean} ({n})"),
    };
    n += 1;
  }
  used.insert(result.to_lowercase());
  result
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Cursor;

  #[test]
  fn unique_names_as_the_web_app_makes_them() {
    let mut used = HashSet::new();
    assert_eq!(unique_name("a.jpg", "1", &mut used), "a.jpg");
    assert_eq!(unique_name("A.JPG", "2", &mut used), "A (2).JPG");
    assert_eq!(unique_name("a.jpg", "3", &mut used), "a (3).jpg");
    assert_eq!(unique_name("", "4", &mut used), "4.jpg");
    assert_eq!(unique_name("x/y:z", "5", &mut used), "x_y_z");
    assert_eq!(unique_name(".hidden", "6", &mut used), ".hidden");
    assert_eq!(unique_name(".hidden", "7", &mut used), ".hidden (2)");
  }

  fn fixture() -> Project {
    let text = include_str!("../../../shared/fixtures/book.json");
    migrate_project(&serde_json::from_str(text).unwrap()).unwrap()
  }

  #[test]
  fn writes_and_reads_back() {
    let project = fixture();
    let ids: Vec<PhotoId> = project.photos.keys().cloned().collect();
    let mut images: Vec<Cursor<Vec<u8>>> = ids
      .iter()
      .map(|id| Cursor::new(format!("image {id}").into_bytes()))
      .collect();
    let mut thumbs: Vec<Cursor<Vec<u8>>> = ids
      .iter()
      .map(|id| Cursor::new(format!("thumb {id}").into_bytes()))
      .collect();
    let mut sources: Vec<PhotoSource> = ids
      .iter()
      .zip(images.iter_mut().zip(thumbs.iter_mut()))
      .map(|(id, (image, thumb))| PhotoSource {
        id,
        name: &project.photos[id].name,
        image,
        thumb: Some(thumb as &mut dyn Read),
      })
      .collect();
    let mut steps = 0;
    let out = write_project(
      Cursor::new(Vec::new()),
      &project,
      &mut sources,
      "2026-11-08T00:00:00.000Z",
      |n| steps = n,
    )
    .unwrap();
    assert_eq!(steps, ids.len() * 2);

    let mut opened = OpenedProject::open(Cursor::new(out.into_inner())).unwrap();
    assert_eq!(opened.project, project);
    assert_eq!(opened.exported_at, "2026-11-08T00:00:00.000Z");
    assert!(opened.missing_photos().is_empty());
    let first = &ids[0];
    let image = opened.files[first].image.clone();
    assert_eq!(
      opened.read_entry(&image).unwrap(),
      format!("image {first}").into_bytes()
    );
  }

  #[test]
  fn refuses_what_isnt_a_project() {
    assert!(matches!(
      OpenedProject::open(Cursor::new(b"nope".to_vec())),
      Err(OpenError::NotAProject)
    ));
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file(MANIFEST, SimpleFileOptions::default()).unwrap();
    zip.write_all(br#"{"format":"other","version":1,"files":{}}"#).unwrap();
    let bytes = zip.finish().unwrap().into_inner();
    assert!(matches!(
      OpenedProject::open(Cursor::new(bytes)),
      Err(OpenError::WrongFormat)
    ));
  }
}

/// Files the web app's own code wrote (shared/goldens/, from src/goldens.test.ts).
#[cfg(test)]
mod from_the_web_app {
  use super::*;
  use std::io::Cursor;

  #[test]
  fn opens_a_file_the_web_app_wrote() {
    let bytes = include_bytes!("../../../shared/goldens/book.photo-sequence");
    let mut opened = OpenedProject::open(Cursor::new(bytes.to_vec())).unwrap();
    let fixture = include_str!("../../../shared/fixtures/book.json");
    assert_eq!(
      opened.project,
      migrate_project(&serde_json::from_str(fixture).unwrap()).unwrap()
    );
    assert!(opened.missing_photos().is_empty());
    let id = opened.project.photos.keys().next().unwrap().clone();
    let thumb = opened.files[&id].thumb.clone().unwrap();
    assert_eq!(opened.read_entry(&thumb).unwrap(), format!("thumb {id}").into_bytes());
  }

  /// With SEQUENCE_WRITE_TO set, writes a file there for the web app's reader to try.
  #[test]
  fn writes_a_file_for_the_web_app() {
    let Ok(path) = std::env::var("SEQUENCE_WRITE_TO") else {
      return;
    };
    let project =
      migrate_project(&serde_json::from_str(include_str!("../../../shared/fixtures/book.json")).unwrap()).unwrap();
    let ids: Vec<PhotoId> = project.photos.keys().cloned().collect();
    let mut images: Vec<Cursor<Vec<u8>>> = ids
      .iter()
      .map(|id| Cursor::new(format!("image {id}").into_bytes()))
      .collect();
    let mut sources: Vec<PhotoSource> = ids
      .iter()
      .zip(images.iter_mut())
      .map(|(id, image)| PhotoSource {
        id,
        name: &project.photos[id].name,
        image,
        thumb: None,
      })
      .collect();
    let file = std::fs::File::create(path).unwrap();
    write_project(file, &project, &mut sources, "2026-11-08T00:00:00.000Z", |_| {}).unwrap();
  }
}
