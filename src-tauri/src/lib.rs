// The Mac app: a native window around the same web app as the website, plus what
// browsers can't do: the plugins and project files (see src/platform/macos/).

// The project files' commands are the Mac app's alone (see `handlers`).
#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_imports))]

use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Emitter, Manager};

/// Files macOS asked the app to open (a double-click in Finder, a drop on the Dock
/// icon) that the page hasn't taken yet. The one that launches the app arrives
/// before the page is ready, so they wait here.
#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_files(opened: tauri::State<OpenedFiles>) -> Vec<String> {
  std::mem::take(&mut *opened.0.lock().unwrap())
}

/// The app's own links (`sequence-photos://…`) macOS has handed it, until the page takes
/// them: an Instagram sign-in coming back from the browser.
#[derive(Default)]
struct OpenedLinks(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_links(opened: tauri::State<OpenedLinks>) -> Vec<String> {
  std::mem::take(&mut *opened.0.lock().unwrap())
}

/// A project file's contents, as raw bytes (projects can be hundreds of megabytes).
#[tauri::command]
fn read_project(path: String) -> Result<Response, String> {
  std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

/// Saves in progress. The page sends a file in pieces (a project can be hundreds of
/// megabytes); they go to a temporary file, and the target is only touched once all of
/// them have arrived. The finished file is then copied over the target: under the App
/// Sandbox the app may write the file the user chose, but not rename files into its folder.
#[derive(Default)]
struct Saves {
  next: AtomicU32,
  open: Mutex<HashMap<u32, (PathBuf, File)>>,
}

#[tauri::command]
fn begin_save(saves: tauri::State<Saves>) -> Result<u32, String> {
  let id = saves.next.fetch_add(1, Ordering::Relaxed);
  let temp = std::env::temp_dir().join(format!("sequence-save-{}-{id}.tmp", std::process::id()));
  let file = File::create(&temp).map_err(|e| e.to_string())?;
  saves.open.lock().unwrap().insert(id, (temp, file));
  Ok(id)
}

/// The next piece of a save: the raw bytes are the request body, the save's id a header.
#[tauri::command]
fn append_save(request: Request, saves: tauri::State<Saves>) -> Result<(), String> {
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("expected the file's contents".into());
  };
  let id: u32 = request
    .headers()
    .get("save")
    .and_then(|v| v.to_str().ok())
    .and_then(|v| v.parse().ok())
    .ok_or("missing save id")?;
  let mut open = saves.open.lock().unwrap();
  let (_, file) = open.get_mut(&id).ok_or("unknown save")?;
  file.write_all(bytes).map_err(|e| e.to_string())
}

/// Put the finished file in place (or, without a path, abandon the save).
#[tauri::command]
fn finish_save(id: u32, path: Option<String>, saves: tauri::State<Saves>) -> Result<(), String> {
  let (temp, file) = saves.open.lock().unwrap().remove(&id).ok_or("unknown save")?;
  let result = match path {
    Some(path) => file
      .sync_all()
      .and_then(|_| std::fs::copy(&temp, path))
      .map(|_| ())
      .map_err(|e| e.to_string()),
    None => Ok(()),
  };
  drop(file);
  let _ = std::fs::remove_file(&temp);
  result
}

/// Security-scoped bookmarks. In the App Sandbox the app may only use files the user
/// picked (or double-clicked), and only until it quits; a bookmark, kept with the
/// project, gets that access back on the next launch (and follows the file if it moved).
#[cfg(target_os = "macos")]
mod bookmarks {
  use objc2::rc::Retained;
  use objc2::runtime::Bool;
  use objc2_foundation::{
    NSData, NSString, NSURL, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions,
  };

  /// A bookmark to a file the app can use now.
  #[tauri::command]
  pub fn bookmark_file(path: String) -> Result<Vec<u8>, String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
    let data = url
      .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
        NSURLBookmarkCreationOptions::WithSecurityScope,
        None,
        None,
      )
      .map_err(|e| e.localizedDescription().to_string())?;
    Ok(data.to_vec())
  }

  /// Use a bookmarked file again (for the rest of this launch); returns where it is now.
  #[tauri::command]
  pub fn open_bookmark(bookmark: Vec<u8>) -> Result<String, String> {
    let data = NSData::with_bytes(&bookmark);
    let mut stale = Bool::NO;
    let url: Retained<NSURL> = unsafe {
      NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
        &data,
        NSURLBookmarkResolutionOptions::WithSecurityScope,
        None,
        &mut stale,
      )
    }
    .map_err(|e| e.localizedDescription().to_string())?;
    // Kept until the app quits: the project stays open, and may be saved, until then.
    unsafe { url.startAccessingSecurityScopedResource() };
    url.path().map(|p| p.to_string()).ok_or_else(|| "not a file".into())
  }
}

/// The end-to-end test's hooks (npm run test:app; see src/platform/macos/e2e.ts). Not in the real app.
#[cfg(feature = "e2e")]
mod e2e {
  use std::io::Write;

  /// The report goes to stdout, and to a file in the temporary folder: sandboxed, that's
  /// inside the app's container, where the test can read it (stdout doesn't reach it there).
  fn report(line: &str) {
    println!("{line}");
    let file = std::env::temp_dir().join("sequence-e2e.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
      let _ = writeln!(f, "{line}");
    }
  }

  /// Where the test's fixtures are, when the app was started to run it.
  #[tauri::command]
  pub fn e2e_dir() -> Option<String> {
    std::env::var("PBS_E2E").ok()
  }

  /// Which part of the test this run is (see scripts/e2e-app.mjs).
  #[tauri::command]
  pub fn e2e_phase() -> Option<String> {
    std::env::var("PBS_E2E_PHASE").ok()
  }

  /// Progress, for when a run gets stuck.
  #[tauri::command]
  pub fn e2e_log(message: String) {
    report(&format!("… {message}"));
  }

  #[tauri::command]
  pub fn e2e_finish(ok: bool, report: String) {
    self::report(&report);
    std::process::exit(if ok { 0 } else { 1 });
  }
}

#[cfg(all(target_os = "macos", not(feature = "e2e")))]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
  tauri::generate_handler![
    take_opened_files,
    take_opened_links,
    read_project,
    begin_save,
    append_save,
    finish_save,
    bookmarks::bookmark_file,
    bookmarks::open_bookmark
  ]
}

#[cfg(all(target_os = "macos", feature = "e2e"))]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
  tauri::generate_handler![
    take_opened_files,
    take_opened_links,
    read_project,
    begin_save,
    append_save,
    finish_save,
    bookmarks::bookmark_file,
    bookmarks::open_bookmark,
    e2e::e2e_dir,
    e2e::e2e_phase,
    e2e::e2e_log,
    e2e::e2e_finish
  ]
}

/// Off the Mac, which nothing ships for: only the links that bring an Instagram sign-in back.
#[cfg(not(target_os = "macos"))]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
  tauri::generate_handler![take_opened_links]
}

pub fn run() {
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .manage(OpenedFiles::default())
    .manage(OpenedLinks::default())
    .manage(Saves::default())
    .invoke_handler(handlers())
    .build(tauri::generate_context!())
    .expect("error while building Sequence");

  app.run(|handle, event| {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Opened { urls } = event {
      let paths = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned());
      handle.state::<OpenedFiles>().0.lock().unwrap().extend(paths);
      let _ = handle.emit("opened-files", ());
      let links: Vec<String> = urls
        .iter()
        .filter(|url| url.scheme() == "sequence-photos")
        .map(|url| url.to_string())
        .collect();
      if !links.is_empty() {
        handle.state::<OpenedLinks>().0.lock().unwrap().extend(links);
        let _ = handle.emit("opened-links", ());
      }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (handle, event);
  });
}
