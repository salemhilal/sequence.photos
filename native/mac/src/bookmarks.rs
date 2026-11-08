//! Security-scoped bookmarks. In the App Sandbox the app may only use files the user
//! picked (or double-clicked), and only until it quits; a bookmark gets that access back
//! on the next launch (and follows the file if it moved). The same calls as the Tauri
//! app's (`src-tauri/src/lib.rs`), so bookmarks it saved stay readable.

use std::path::{Path, PathBuf};

use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{NSData, NSString, NSURL, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions};

/// A bookmark to a file the app can use now.
pub fn bookmark(path: &Path) -> Result<Vec<u8>, String> {
  let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
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
pub fn resolve(bookmark: &[u8]) -> Result<PathBuf, String> {
  let data = NSData::with_bytes(bookmark);
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
  url
    .path()
    .map(|p| PathBuf::from(p.to_string()))
    .ok_or_else(|| "not a file".into())
}
