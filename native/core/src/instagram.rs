//! Posting to Instagram, apart from the network (`src/instagram.ts`, `instagramImage.ts`,
//! `instagramPost.ts`, `instagramTags.ts`): the shapes and sizes Instagram takes, the
//! connection as the server hands it over, what comes back from signing in, and what to
//! tell the user. The Mac app does the talking.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::geometry::Rect;
use crate::js_number;
use crate::model::{PostFit, PostKind, Sheet, Tag};
use crate::units::js_round;

/// Instagram's API limits.
pub mod limits {
  /// Feed images: portrait 4:5 to landscape 1.91:1.
  pub const MIN_RATIO: f64 = 4.0 / 5.0;
  pub const MAX_RATIO: f64 = 1.91;
  /// Images per carousel. (The Instagram app allows 20; the API, 10.)
  pub const MAX_ITEMS: usize = 10;
  pub const MIN_WIDTH: f64 = 320.0;
  pub const MAX_WIDTH: f64 = 1440.0;
  /// Sequence's server refuses taller images.
  pub const MAX_HEIGHT: f64 = 2560.0;
  /// Instagram's limit per image, and the server's.
  pub const MAX_BYTES: usize = 8 * 1024 * 1024;
  pub const CAPTION_LENGTH: usize = 2200;
  pub const HASHTAGS: usize = 30;
  /// People tagged per image.
  pub const MAX_TAGS: usize = 20;
}
use limits::*;

/// Lower qualities to try, in turn, until an image is under Instagram's size limit.
pub const QUALITIES: [f64; 4] = [0.92, 0.85, 0.75, 0.6];

/// A slide's size in output pixels: the page at its resolution.
pub fn slide_size(sheet: &Sheet) -> (f64, f64) {
  (sheet.page_w * sheet.px_per_unit, sheet.page_h * sheet.px_per_unit)
}

/// The shapes Instagram takes, as width / height: feed images from 4:5 to 1.91:1; stories
/// any shape Sequence's server takes once scaled to Instagram's widths.
fn ratio_range(kind: PostKind) -> (f64, f64) {
  match kind {
    PostKind::Feed => (MIN_RATIO, MAX_RATIO),
    PostKind::Story => (MIN_WIDTH / MAX_HEIGHT, f64::INFINITY),
  }
}

/// Whether a slide of this size can be posted as it is.
pub fn fits((w, h): (f64, f64), kind: PostKind) -> bool {
  let (min, max) = ratio_range(kind);
  let r = w / h;
  r >= min - 1e-9 && r <= max + 1e-9
}

/// The nearest shape Instagram takes, as width / height.
pub fn target_ratio((w, h): (f64, f64), kind: PostKind) -> f64 {
  let (min, max) = ratio_range(kind);
  max.min(min.max(w / h))
}

/// A ratio as people say it: 4:5, 1.91:1, or 3:4.
pub fn ratio_label(r: f64) -> String {
  for (a, b) in [(4, 5), (3, 4), (1, 1), (9, 16), (16, 9), (2, 3), (3, 2)] {
    if (r - f64::from(a) / f64::from(b)).abs() < 0.005 {
      return format!("{a}:{b}");
    }
  }
  format!("{}:1", js_number(js_round(r * 100.0) / 100.0))
}

/// An image as posted: its size, the part of the slide it shows, and where that goes.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PostImageLayout {
  pub width: f64,
  pub height: f64,
  /// The part of the slide shown, in its output pixels.
  pub source: Rect,
  /// Where it's drawn, in image pixels (the rest is white).
  pub target: Rect,
}

/// How a slide becomes an image for Instagram. A slide outside the shapes Instagram takes is
/// cropped (centered) or expanded with white margins to the nearest one; then the image is
/// scaled to Instagram's widths and the server's height limit, staying within the shapes.
pub fn post_image_layout(size: (f64, f64), kind: PostKind, fit: PostFit) -> PostImageLayout {
  let (sw, sh) = size;
  let mut source = Rect::new(0.0, 0.0, sw, sh);
  let mut canvas = (sw, sh);
  let r = target_ratio(size, kind);
  if !fits(size, kind) {
    let tall = sw / sh < r;
    if fit == PostFit::Crop {
      source = if tall {
        Rect::new(0.0, (sh - sw / r) / 2.0, sw, sw / r)
      } else {
        Rect::new((sw - sh * r) / 2.0, 0.0, sh * r, sh)
      };
      canvas = (source.w, source.h);
    } else {
      canvas = if tall { (sh * r, sh) } else { (sw, sw / r) };
    }
  }
  let scale = (MIN_WIDTH / canvas.0).max(1f64.min(MAX_WIDTH / canvas.0).min(MAX_HEIGHT / canvas.1));
  let mut width = js_round(canvas.0 * scale);
  let mut height = js_round(canvas.1 * scale);
  // Rounding mustn't tip the image past an allowed shape (e.g. 1003 × 1254 is under 4:5).
  let (min, max) = ratio_range(kind);
  if width / height < min {
    height = (width / min).floor();
  }
  if width / height > max {
    width = (height * max).floor();
  }
  height = height.min(MAX_HEIGHT);
  let w = width.min(source.w * scale);
  let h = height.min(source.h * scale);
  PostImageLayout {
    width,
    height,
    source,
    target: Rect::new((width - w) / 2.0, (height - h) / 2.0, w, h),
  }
}

/// JavaScript's `\s`, near enough.
fn is_space(c: char) -> bool {
  c.is_whitespace() || c == '\u{feff}'
}

/// Hashtags in a caption (Instagram allows 30).
pub fn hashtag_count(caption: &str) -> usize {
  let chars: Vec<char> = caption.chars().collect();
  let mut n = 0;
  for (i, &c) in chars.iter().enumerate() {
    if c != '#' || (i > 0 && !is_space(chars[i - 1])) {
      continue;
    }
    if chars.get(i + 1).is_some_and(|&d| d.is_alphanumeric() || d == '_') {
      n += 1;
    }
  }
  n
}

/// Instagram usernames: letters, digits, periods, underscores, up to 30.
fn is_username(name: &str) -> bool {
  (1..=30).contains(&name.len())
    && name
      .bytes()
      .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_')
}

/// A username as typed ("@Some.One ", say) as Instagram takes it, or None if it can't be one.
pub fn username_of(input: &str) -> Option<String> {
  let t = input.trim();
  let name = t.strip_prefix('@').unwrap_or(t).to_lowercase();
  is_username(&name).then_some(name)
}

/// Add a tag, replacing one of the same person elsewhere on the image.
pub fn add_tag(tags: &[Tag], tag: Tag) -> Vec<Tag> {
  let mut out: Vec<Tag> = tags.iter().filter(|t| t.username != tag.username).cloned().collect();
  out.push(tag);
  let extra = out.len().saturating_sub(MAX_TAGS);
  out.split_off(extra)
}

/// Move a person's tag to another spot, kept inside the image.
pub fn move_tag(tags: &[Tag], username: &str, x: f64, y: f64) -> Vec<Tag> {
  let clamp = |n: f64| n.clamp(0.0, 1.0);
  tags
    .iter()
    .map(|t| {
      if t.username == username {
        Tag {
          x: clamp(x),
          y: clamp(y),
          ..t.clone()
        }
      } else {
        t.clone()
      }
    })
    .collect()
}

/// `user_tags` for an image's container: the tags, with spots kept inside the image.
pub fn user_tags_param(tags: &[Tag]) -> Option<String> {
  if tags.is_empty() {
    return None;
  }
  let clamp = |n: f64| js_number(js_round(n.clamp(0.0, 1.0) * 1000.0) / 1000.0);
  let items: Vec<String> = tags
    .iter()
    .take(MAX_TAGS)
    .map(|t| {
      format!(
        r#"{{"username":{},"x":{},"y":{}}}"#,
        Value::from(t.username.as_str()),
        clamp(t.x),
        clamp(t.y)
      )
    })
    .collect();
  Some(format!("[{}]", items.join(",")))
}

/// What to tell the user about an Instagram error (by its code, from Meta's docs).
pub fn graph_error_message(code: Option<i64>, user_msg: Option<&str>, status: u16) -> String {
  match code {
    Some(190) => return "Your Instagram connection expired. Connect again in Settings.".into(),
    Some(4 | 17 | 32 | 613 | 9) => return "Instagram’s posting limit was reached. Try again later.".into(),
    Some(10 | 200) => return "Sequence doesn’t have permission to post. Connect again in Settings.".into(),
    Some(9004) => return "Instagram couldn’t fetch the images. Try again in a moment.".into(),
    Some(36003) => {
      return "Instagram doesn’t accept this image shape. Try cropping or expanding the slides.".into();
    }
    _ => {}
  }
  if let Some(m) = user_msg.filter(|m| !m.is_empty()) {
    return m.into();
  }
  match code {
    Some(c) => format!("Instagram couldn’t post this (error {c})."),
    None => format!("Instagram couldn’t post this (HTTP {status})."),
  }
}

/// Instagram may send ids as bare JSON numbers longer than a double holds exactly; they're
/// quoted before parsing to keep every digit.
pub fn quote_ids(text: &str) -> String {
  let b = text.as_bytes();
  let mut out = String::with_capacity(text.len() + 8);
  let mut i = 0;
  let mut copied = 0;
  while i < b.len() {
    let key = [&b"\"id\""[..], &b"\"user_id\""[..]]
      .into_iter()
      .find(|k| b[i..].starts_with(k));
    let Some(key) = key else {
      i += 1;
      continue;
    };
    let mut j = i + key.len();
    while j < b.len() && (b[j] as char).is_ascii_whitespace() {
      j += 1;
    }
    if b.get(j) != Some(&b':') {
      i += 1;
      continue;
    }
    j += 1;
    while j < b.len() && (b[j] as char).is_ascii_whitespace() {
      j += 1;
    }
    let start = j;
    while j < b.len() && b[j].is_ascii_digit() {
      j += 1;
    }
    if j == start {
      i += 1;
      continue;
    }
    out.push_str(&text[copied..start]);
    out.push('"');
    out.push_str(&text[start..j]);
    out.push('"');
    copied = j;
    i = j;
  }
  out.push_str(&text[copied..]);
  out
}

/// The connection the server hands over (server/src/api.ts), plus what the app keeps.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
  pub token: String,
  /// Unix seconds: when the token expires, and when it was issued or last refreshed.
  pub expires_at: i64,
  pub refreshed_at: i64,
  pub user_id: String,
  pub username: String,
  pub enrollment: String,
  /// The server that signed the enrollment: uploads and renewals go there.
  pub server: String,
  /// Instagram or the server refused it: the user has to connect again.
  #[serde(default, skip_serializing_if = "std::ops::Not::not")]
  pub needs_reconnect: bool,
}

const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

fn safe_int(v: &Value) -> Option<i64> {
  let n = v.as_f64()?;
  (n.fract() == 0.0 && n.abs() <= MAX_SAFE).then_some(n as i64)
}

/// The connection, if `value` is one: from storage, or from the server `server` (which
/// doesn't name itself). `normalize` checks a server's address.
pub fn parse_connection(value: &Value, server: &str, normalize: impl Fn(&str) -> Option<String>) -> Option<Connection> {
  let o = value.as_object()?;
  let s = |k: &str| o.get(k).and_then(Value::as_str);
  let token = s("token").filter(|t| !t.is_empty())?;
  let expires_at = safe_int(o.get("expiresAt")?)?;
  let refreshed_at = safe_int(o.get("refreshedAt")?)?;
  let user_id = s("userId").filter(|u| (1..=32).contains(&u.len()) && u.bytes().all(|b| b.is_ascii_digit()))?;
  let username = s("username").filter(|u| {
    (1..=64).contains(&u.len()) && u.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_')
  })?;
  let enrollment = s("enrollment").filter(|e| !e.is_empty())?;
  let from = normalize(s("server").unwrap_or(server))?;
  Some(Connection {
    token: token.into(),
    expires_at,
    refreshed_at,
    user_id: user_id.into(),
    username: username.into(),
    enrollment: enrollment.into(),
    server: from,
    needs_reconnect: o.get("needsReconnect") == Some(&Value::Bool(true)),
  })
}

/// A server's address as the app keeps it (its origin, no trailing slash), or None if it
/// isn't one the app can use: one of `known`, or plain http on this computer.
pub fn normalize_server_url(raw: &str, known: &[&str]) -> Option<String> {
  let t = raw.trim();
  let (scheme, rest) = t.split_once("://")?;
  let scheme = scheme.to_ascii_lowercase();
  let host_port = rest.strip_suffix('/').unwrap_or(rest);
  if host_port.is_empty() || host_port.contains(['/', '?', '#', '@', ' ']) {
    return None;
  }
  let lower = host_port.to_ascii_lowercase();
  let (host, port) = match lower.rsplit_once(':') {
    Some((h, p)) if !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) => (h.to_string(), Some(p.to_string())),
    Some(_) => return None,
    None => (lower.clone(), None),
  };
  let default_port = match scheme.as_str() {
    "http" => "80",
    "https" => "443",
    _ => return None,
  };
  let origin = match port.filter(|p| p != default_port) {
    Some(p) => format!("{scheme}://{host}:{p}"),
    None => format!("{scheme}://{host}"),
  };
  let local = scheme == "http" && (host == "localhost" || host == "127.0.0.1");
  (local || known.contains(&origin.as_str())).then_some(origin)
}

/// Why a sign-in came back without a connection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SignInError {
  Cancelled,
  ExchangeFailed,
  MissingPermission,
  NotProfessional,
}

/// What came back in a sign-in's return link (its fragment).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SignInReturn {
  Connected { sealed: String, state: String },
  Error { error: SignInError, state: String },
}

/// A query string's (or fragment's) pairs, decoded as a form is.
fn form_pairs(s: &str) -> Vec<(String, String)> {
  let decode = |t: &str| {
    let t = t.replace('+', " ");
    let b = t.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
      if b[i] == b'%'
        && let Some(h) = t.get(i + 1..i + 3)
        && let Ok(v) = u8::from_str_radix(h, 16)
      {
        out.push(v);
        i += 3;
        continue;
      }
      out.push(b[i]);
      i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
  };
  s.split('&')
    .filter(|p| !p.is_empty())
    .map(|p| {
      let (k, v) = p.split_once('=').unwrap_or((p, ""));
      (decode(k), decode(v))
    })
    .collect()
}

/// A sign-in's return, from its link's fragment (`#state=…&instagram=…`).
pub fn parse_sign_in_return(hash: &str) -> Option<SignInReturn> {
  let pairs = form_pairs(hash.strip_prefix('#').unwrap_or(hash));
  let get = |k: &str| pairs.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
  let state = get("state").filter(|s| !s.is_empty())?;
  if let Some(sealed) = get("instagram").filter(|s| !s.is_empty()) {
    return Some(SignInReturn::Connected { sealed, state });
  }
  let error = get("instagram_error")?;
  let error = match error.as_str() {
    "cancelled" => SignInError::Cancelled,
    "missing_permission" => SignInError::MissingPermission,
    "not_professional" => SignInError::NotProfessional,
    _ => SignInError::ExchangeFailed,
  };
  Some(SignInReturn::Error { error, state })
}

/// What to say about a sign-in that came back with an error (nothing, if they cancelled).
pub fn sign_in_error_message(e: SignInError) -> Option<&'static str> {
  match e {
    SignInError::Cancelled => None,
    SignInError::ExchangeFailed => Some("Couldn’t connect to Instagram. Try again in a moment."),
    SignInError::MissingPermission => {
      Some("Sequence needs permission to publish to your account. Connect again and allow it.")
    }
    SignInError::NotProfessional => Some(
      "Posting from Sequence needs an Instagram Business or Creator account. You can switch in Instagram’s settings.",
    ),
  }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Base64url (with - and _, unpadded), as OAuth's PKCE and the server's tokens use.
pub fn encode_base64_url(bytes: &[u8]) -> String {
  let mut out = String::new();
  for chunk in bytes.chunks(3) {
    let n = chunk
      .iter()
      .enumerate()
      .fold(0u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
    for i in 0..=chunk.len() {
      out.push(B64[(n >> (18 - 6 * i) & 63) as usize] as char);
    }
  }
  out
}

/// Base64url decoded, or None if it isn't.
pub fn decode_base64_url(text: &str) -> Option<Vec<u8>> {
  let vals: Vec<u32> = text
    .bytes()
    .map(|c| B64.iter().position(|&b| b == c).map(|p| p as u32))
    .collect::<Option<_>>()?;
  if vals.len() % 4 == 1 {
    return None;
  }
  let mut out = Vec::new();
  for chunk in vals.chunks(4) {
    let n = chunk.iter().enumerate().fold(0u32, |n, (i, &v)| n | v << (18 - 6 * i));
    for i in 0..chunk.len() - 1 {
      out.push((n >> (16 - 8 * i)) as u8);
    }
  }
  Some(out)
}

/// When an enrollment expires (unix seconds), from its signed payload; 0 if unreadable.
pub fn enrollment_expiry(enrollment: &str) -> i64 {
  let payload = enrollment.split('.').next().unwrap_or("");
  let Some(text) = decode_base64_url(payload).and_then(|b| String::from_utf8(b).ok()) else {
    return 0;
  };
  let parts: Vec<&str> = text.split('\n').collect();
  match parts.as_slice() {
    ["v1", "ENROLL", a, exp]
      if !a.is_empty()
        && a.bytes().all(|b| b.is_ascii_digit())
        && !exp.is_empty()
        && exp.bytes().all(|b| b.is_ascii_digit()) =>
    {
      exp
        .parse::<f64>()
        .ok()
        .and_then(|n| safe_int(&Value::from(n)))
        .unwrap_or(0)
    }
    _ => 0,
  }
}

/// How far a post has got, for the panel.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PostStep {
  Preparing { done: usize, total: usize },
  Uploading { done: usize, total: usize },
  Processing,
  Publishing { done: usize, total: usize },
}

impl PostStep {
  pub fn label(self) -> String {
    match self {
      PostStep::Preparing { done, total } => format!("Preparing slide {} of {total}…", done + 1),
      PostStep::Uploading { done, total } => format!("Uploading slide {} of {total}…", done + 1),
      PostStep::Processing => "Instagram is processing the post…".into(),
      PostStep::Publishing { done, total } if total > 1 => format!("Publishing story {} of {total}…", done + 1),
      PostStep::Publishing { .. } => "Publishing…".into(),
    }
  }
}

/// When the chosen server can't be reached, or used from here.
pub const SERVER_ERROR: &str = "Couldn’t connect to the Sequence server. Check the server in Settings → Advanced.";
pub const RECONNECT: &str = "Your Instagram connection needs renewing. Reconnect in Settings.";
/// Said while the app waits for a sign-in in the browser to come back.
pub const SIGN_IN_IN_BROWSER: &str = "Finish signing in to Instagram in your browser, then come back.";
pub const OTHER_SIGN_IN: &str =
  "That Instagram sign-in was started in another tab or window, so it was ignored. Connect again from here.";

const DAY: i64 = 24 * 60 * 60;
/// Refresh the token once it's this old (it lasts ~60 days; Instagram refuses under a day).
pub const REFRESH_AFTER: i64 = 30 * DAY;
/// Renew the enrollment this long before it expires (it lasts 60 days).
pub const RENEW_BEFORE: i64 = 15 * DAY;

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn base64url_round_trips() {
    for s in ["", "f", "fo", "foo", "foob", "fooba", "foobar"] {
      let e = encode_base64_url(s.as_bytes());
      assert_eq!(decode_base64_url(&e).as_deref(), Some(s.as_bytes()), "{s} {e}");
    }
    assert_eq!(encode_base64_url(&[0xfb, 0xff]), "-_8");
  }

  #[test]
  fn servers() {
    let known = ["https://a.example"];
    assert_eq!(
      normalize_server_url("https://a.example/", &known).as_deref(),
      Some("https://a.example")
    );
    assert_eq!(
      normalize_server_url("http://localhost:8787", &known).as_deref(),
      Some("http://localhost:8787")
    );
    assert_eq!(normalize_server_url("https://b.example", &known), None);
    assert_eq!(normalize_server_url("https://a.example/x", &known), None);
    assert_eq!(normalize_server_url("ftp://localhost", &known), None);
  }

  #[test]
  fn tags() {
    let t = |u: &str| Tag {
      username: u.into(),
      x: 0.5,
      y: 0.5,
    };
    let tags = add_tag(&[t("a"), t("b")], t("a"));
    assert_eq!(tags.iter().map(|t| t.username.as_str()).collect::<Vec<_>>(), ["b", "a"]);
    let moved = move_tag(&tags, "a", 2.0, -1.0);
    assert_eq!((moved[1].x, moved[1].y), (1.0, 0.0));
  }
}
