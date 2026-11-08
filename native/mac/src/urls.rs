//! The file URLs macOS hands the app (a double-click in Finder), as paths.

use std::path::PathBuf;

/// A file URL's path (`file:///…` or `file://localhost/…`), with its %-escapes undone.
pub fn file_url_path(url: &str) -> Option<PathBuf> {
  let rest = url.strip_prefix("file://")?;
  let path = rest.strip_prefix("localhost").unwrap_or(rest);
  path.starts_with('/').then(|| PathBuf::from(percent_decode(path)))
}

/// A string with its %-escapes undone (bytes, so escapes may spell UTF-8).
fn percent_decode(s: &str) -> String {
  let hex = |b: u8| (b as char).to_digit(16);
  let bytes = s.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%'
      && let (Some(&h), Some(&l)) = (bytes.get(i + 1), bytes.get(i + 2))
      && let (Some(h), Some(l)) = (hex(h), hex(l))
    {
      out.push((h * 16 + l) as u8);
      i += 3;
      continue;
    }
    out.push(bytes[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn file_urls_to_paths() {
    assert_eq!(
      file_url_path("file:///Users/a/My%20Book.photo-sequence"),
      Some(PathBuf::from("/Users/a/My Book.photo-sequence"))
    );
    assert_eq!(file_url_path("file://localhost/x%C3%A9"), Some(PathBuf::from("/xé")));
    assert_eq!(percent_decode("%a\u{e9}%"), "%a\u{e9}%");
    assert_eq!(file_url_path("https://x"), None);
  }
}
