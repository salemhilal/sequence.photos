//! Instagram, over the network (`src/instagram.ts`, `instagramPost.ts`): signing in through
//! Sequence's server, keeping the connection fresh, and posting. Everything here blocks, so
//! it runs in the background; what to say and what's allowed is in the core's `instagram`.
//!
//! Signing in: the app opens Instagram's sign-in page in the browser with a `state` of
//! `mac.<nonce>.<challenge>`, keeping a secret `verifier` (whose hash is the challenge).
//! Instagram sends the user to the server, which sends them back to `sequence-photos://
//! instagram#…` with a sealed bundle, which the app trades, with the verifier, for the
//! connection. The connection is kept in the app's folder.

use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use sequence_core::instagram::{
  Connection, PostStep, RECONNECT, REFRESH_AFTER, RENEW_BEFORE, SERVER_ERROR, encode_base64_url, enrollment_expiry,
  graph_error_message, normalize_server_url, parse_connection, quote_ids, user_tags_param,
};
use sequence_core::{PostKind, Tag};

use crate::config;
use crate::library::support_dir;

/// A failure to show the user as it is.
#[derive(Debug)]
pub enum Failure {
  /// Cancelled by the user: nothing was posted.
  Cancelled,
  /// The connection is gone: the user has to connect again.
  Reconnect(String),
  Other(String),
}

impl Failure {
  pub fn message(&self) -> String {
    match self {
      Failure::Cancelled => "Cancelled. Nothing was posted.".into(),
      Failure::Reconnect(m) | Failure::Other(m) => m.clone(),
    }
  }
}

fn other(m: impl Into<String>) -> Failure {
  Failure::Other(m.into())
}

// --- Servers and the stored connection -----------------------------------------------------

/// A server address the app can use: Sequence's, its development one, or one on this computer.
pub fn normalize_server(raw: &str) -> Option<String> {
  normalize_server_url(raw, &[config::server_url(), config::dev_server_url()])
}

/// The server to use: the one chosen in Settings → Advanced, else Sequence's.
pub fn server_url(chosen: &str) -> String {
  normalize_server(chosen).unwrap_or_else(|| config::server_url().to_string())
}

fn connection_path() -> PathBuf {
  support_dir().join("instagram.json")
}

/// The connection kept from last time.
pub fn load_connection() -> Option<Connection> {
  let bytes = std::fs::read(connection_path()).ok()?;
  let v: Value = serde_json::from_slice(&bytes).ok()?;
  parse_connection(&v, config::server_url(), normalize_server)
}

/// Keep the connection (or forget it).
pub fn save_connection(c: Option<&Connection>) {
  match c {
    Some(c) => {
      if let Ok(bytes) = serde_json::to_vec(c) {
        let _ = std::fs::write(connection_path(), bytes);
      }
    }
    None => {
      let _ = std::fs::remove_file(connection_path());
    }
  }
}

pub fn now_s() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map_or(0, |d| d.as_secs() as i64)
}

// --- HTTP ---------------------------------------------------------------------------------

fn agent() -> ureq::Agent {
  ureq::Agent::config_builder()
    .http_status_as_error(false)
    .timeout_global(Some(Duration::from_secs(60)))
    .build()
    .into()
}

/// A response's status and body, as text.
fn text(res: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> Option<(u16, String)> {
  let mut res = res.ok()?;
  let status = res.status().as_u16();
  let body = res.body_mut().read_to_string().unwrap_or_default();
  Some((status, body))
}

/// A query string, encoded as a form is.
fn form(params: &[(&str, &str)]) -> String {
  params
    .iter()
    .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
    .collect::<Vec<_>>()
    .join("&")
}

fn encode(s: &str) -> String {
  let mut out = String::new();
  for b in s.bytes() {
    if b.is_ascii_alphanumeric() || b"-_.*".contains(&b) {
      out.push(b as char);
    } else if b == b' ' {
      out.push('+');
    } else {
      out.push_str(&format!("%{b:02X}"));
    }
  }
  out
}

// --- Signing in ----------------------------------------------------------------------------

/// A sign-in under way: what finishing it needs.
#[derive(Clone, Debug)]
pub struct Pending {
  pub state: String,
  pub verifier: String,
  pub server: String,
}

fn random_token() -> String {
  let mut bytes = [0u8; 32];
  // Without randomness there's no safe sign-in; the state just won't match.
  let _ = getrandom::fill(&mut bytes);
  encode_base64_url(&bytes)
}

pub fn challenge_of(verifier: &str) -> String {
  encode_base64_url(&Sha256::digest(verifier.as_bytes()))
}

/// Instagram's sign-in page for a server, and what to keep until it comes back.
pub fn plan_sign_in(server: &str) -> (String, Pending) {
  let verifier = random_token();
  let state = format!("{}.{}.{}", config::CLIENT, random_token(), challenge_of(&verifier));
  let redirect = format!("{server}/auth/callback");
  let query = form(&[
    ("client_id", config::instagram_app_id()),
    ("redirect_uri", &redirect),
    ("response_type", "code"),
    ("scope", config::INSTAGRAM_SCOPES),
    ("enable_fb_login", "false"),
    ("state", &state),
  ]);
  (
    format!("{}?{query}", config::INSTAGRAM_AUTHORIZE_URL),
    Pending {
      state,
      verifier,
      server: server.to_string(),
    },
  )
}

/// Trade a sign-in's sealed bundle and verifier for the connection.
pub fn redeem(pending: &Pending, sealed: &str) -> Result<Connection, String> {
  let body = json!({ "sealed": sealed, "verifier": pending.verifier }).to_string();
  let Some((status, text)) = text(
    agent()
      .post(format!("{}/auth/redeem", pending.server))
      .header("Content-Type", "application/json")
      .send(body),
  ) else {
    return Err(SERVER_ERROR.into());
  };
  let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
  match parse_connection(&v, &pending.server, normalize_server) {
    Some(c) if (200..300).contains(&status) => Ok(c),
    _ => Err("Couldn’t connect to Instagram. Try again in a moment.".into()),
  }
}

// --- Keeping the connection fresh ------------------------------------------------------------

/// A new token from Instagram, or the same connection if that fails. Err when the token is
/// refused for good.
fn refresh_token(c: &Connection, now: i64) -> Result<Connection, Failure> {
  let url = format!(
    "{}/refresh_access_token?{}",
    config::GRAPH_ORIGIN,
    form(&[("grant_type", "ig_refresh_token"), ("access_token", &c.token)])
  );
  let Some((status, body)) = text(agent().get(url).call()) else {
    return Ok(c.clone());
  };
  let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
  if (200..300).contains(&status)
    && let (Some(token), Some(expires_in)) = (v["access_token"].as_str(), v["expires_in"].as_f64())
  {
    return Ok(Connection {
      token: token.into(),
      expires_at: now + expires_in as i64,
      refreshed_at: now,
      ..c.clone()
    });
  }
  // Only an invalid token means reconnecting; anything else (limits, too new) is retried.
  if v["error"]["code"].as_i64() == Some(190) {
    return Err(Failure::Reconnect(RECONNECT.into()));
  }
  Ok(c.clone())
}

/// A new enrollment from the server that issued it, or the same connection if that fails.
fn renew_enrollment(c: &Connection) -> Connection {
  let body = json!({ "enrollment": c.enrollment }).to_string();
  if let Some((status, text)) = text(
    agent()
      .post(format!("{}/auth/renew", c.server))
      .header("Content-Type", "application/json")
      .header("Authorization", &format!("Bearer {}", c.token))
      .send(body),
  ) && (200..300).contains(&status)
    && let Ok(v) = serde_json::from_str::<Value>(&text)
    && let Some(e) = v["enrollment"].as_str()
  {
    return Connection {
      enrollment: e.into(),
      ..c.clone()
    };
  }
  c.clone()
}

/// The connection, kept fresh: the token refreshed once it's a month old, the enrollment
/// renewed within two weeks of expiring.
pub fn fresh_connection(c: &Connection, now: i64) -> Result<Connection, Failure> {
  if c.needs_reconnect || c.expires_at <= now {
    return Err(Failure::Reconnect(RECONNECT.into()));
  }
  let mut next = c.clone();
  if now - c.refreshed_at >= REFRESH_AFTER {
    next = refresh_token(&next, now)?;
  }
  if enrollment_expiry(&next.enrollment) - now < RENEW_BEFORE {
    next = renew_enrollment(&next);
  }
  Ok(next)
}

// --- Instagram's API -------------------------------------------------------------------------

/// Whether the user has cancelled.
#[derive(Clone, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
  pub fn cancel(&self) {
    self.0.store(true, Ordering::SeqCst);
  }

  pub fn is_cancelled(&self) -> bool {
    self.0.load(Ordering::SeqCst)
  }

  fn check(&self) -> Result<(), Failure> {
    if self.0.load(Ordering::SeqCst) {
      Err(Failure::Cancelled)
    } else {
      Ok(())
    }
  }

  /// Wait, or stop as soon as the user cancels.
  fn sleep(&self, d: Duration) -> Result<(), Failure> {
    let until = Instant::now() + d;
    while Instant::now() < until {
      self.check()?;
      std::thread::sleep(Duration::from_millis(100).min(until - Instant::now()));
    }
    self.check()
  }
}

/// A call to Instagram's API, with the token as a parameter.
fn graph(
  token: &str,
  post: bool,
  path: &str,
  params: &[(&str, &str)],
  cancel: Option<&Cancel>,
) -> Result<Value, Failure> {
  if let Some(c) = cancel {
    c.check()?;
  }
  let mut all = params.to_vec();
  all.push(("access_token", token));
  let body = form(&all);
  let url = format!("{}/{path}", config::GRAPH_URL);
  let res = if post {
    agent()
      .post(&url)
      .header("Content-Type", "application/x-www-form-urlencoded")
      .send(body)
  } else {
    agent().get(format!("{url}?{body}")).call()
  };
  let Some((status, text)) = text(res) else {
    if let Some(c) = cancel {
      c.check()?;
    }
    return Err(other("Couldn’t reach Instagram. Check your connection and try again."));
  };
  let json: Value = serde_json::from_str(&quote_ids(&text)).unwrap_or(Value::Null);
  if (200..300).contains(&status) && json.is_object() {
    return Ok(json);
  }
  let e = &json["error"];
  let code = e["code"].as_i64();
  let message = graph_error_message(code, e["error_user_msg"].as_str(), status);
  Err(if code == Some(190) {
    Failure::Reconnect(message)
  } else {
    Failure::Other(message)
  })
}

fn id_of(v: &Value) -> Result<String, Failure> {
  v["id"]
    .as_str()
    .filter(|s| !s.is_empty())
    .map(String::from)
    .ok_or_else(|| other("Instagram sent an unexpected answer."))
}

/// Wait until Instagram has fetched and processed a container: soon, then less often.
fn wait_until_ready(token: &str, container: &str, cancel: &Cancel) -> Result<(), Failure> {
  let started = Instant::now();
  for secs in [1, 2, 3, 5, 8, 13, 21, 30, 60, 60, 60, 60] {
    let v = graph(token, false, container, &[("fields", "status_code")], Some(cancel))?;
    match v["status_code"].as_str() {
      Some("FINISHED" | "PUBLISHED") => return Ok(()),
      Some("ERROR" | "EXPIRED") => return Err(other("Instagram couldn’t process the images. Try again in a moment.")),
      _ => {}
    }
    if started.elapsed() > Duration::from_secs(300) {
      break;
    }
    cancel.sleep(Duration::from_secs(secs))?;
  }
  Err(other(
    "Instagram is taking too long to process the post. Try again later.",
  ))
}

// --- Sequence's server ----------------------------------------------------------------------

struct Batch {
  frames: Vec<(String, String)>,
  delete: String,
}

fn start_upload(c: &Connection, count: usize, cancel: &Cancel) -> Result<Batch, Failure> {
  cancel.check()?;
  let body = json!({ "enrollment": c.enrollment, "count": count }).to_string();
  let Some((status, text)) = text(
    agent()
      .post(format!("{}/uploads", c.server))
      .header("Content-Type", "application/json")
      .header("Authorization", &format!("Bearer {}", c.token))
      .send(body),
  ) else {
    cancel.check()?;
    return Err(other(SERVER_ERROR));
  };
  if status == 401 {
    return Err(Failure::Reconnect(RECONNECT.into()));
  }
  if status == 429 {
    return Err(other("Too many posts in a row. Wait a minute and try again."));
  }
  let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
  let frames: Vec<(String, String)> = v["frames"]
    .as_array()
    .map(|a| {
      a.iter()
        .filter_map(|f| Some((f["put"].as_str()?.to_string(), f["url"].as_str()?.to_string())))
        .collect()
    })
    .unwrap_or_default();
  match (v["id"].as_str(), v["delete"].as_str()) {
    (Some(_), Some(delete)) if (200..300).contains(&status) && frames.len() == count => Ok(Batch {
      frames,
      delete: delete.into(),
    }),
    _ => Err(other(format!(
      "The Sequence server couldn’t take the images (HTTP {status})."
    ))),
  }
}

fn upload_frame(put: &str, image: &[u8], cancel: &Cancel) -> Result<(), Failure> {
  cancel.check()?;
  let Some((status, _)) = text(agent().put(put).header("Content-Type", "image/jpeg").send(image)) else {
    cancel.check()?;
    return Err(other(SERVER_ERROR));
  };
  if (200..300).contains(&status) {
    Ok(())
  } else {
    Err(other(format!("The Sequence server refused an image (HTTP {status}).")))
  }
}

// --- Posting ----------------------------------------------------------------------------------

/// A post, its images made.
pub struct Post {
  pub images: Vec<Vec<u8>>,
  /// People tagged on each image.
  pub tags: Vec<Vec<Tag>>,
  pub kind: PostKind,
  pub caption: String,
}

/// How many posts the account may still make today, if Instagram says.
fn quota_left(c: &Connection, cancel: &Cancel) -> Result<Option<(i64, i64)>, Failure> {
  match graph(
    &c.token,
    false,
    &format!("{}/content_publishing_limit", c.user_id),
    &[("fields", "quota_usage,config")],
    Some(cancel),
  ) {
    Ok(v) => {
      let d = &v["data"][0];
      Ok(d["quota_usage"].as_i64().zip(d["config"]["quota_total"].as_i64()))
    }
    Err(Failure::Cancelled) => Err(Failure::Cancelled),
    Err(_) => Ok(None),
  }
}

/// Before making the images: whether the account can post this many today.
pub fn check_quota(c: &Connection, needed: i64, cancel: &Cancel) -> Result<(), Failure> {
  if let Some((used, total)) = quota_left(c, cancel)?
    && used + needed > total
  {
    return Err(other(format!(
      "Instagram allows {total} posts a day through apps, and that’s been reached. Try again later."
    )));
  }
  Ok(())
}

/// Post the images: hand them to Sequence's server for Instagram to fetch, create the post
/// (one image, a carousel, or one story each), wait until Instagram has processed all of it,
/// and publish. Cancelling works until publishing starts. The server's copies are deleted
/// afterwards however it went. The post's link (the first story's, for stories), if any.
pub fn publish(
  c: &Connection,
  post: &Post,
  step: &dyn Fn(PostStep),
  cancel: &Cancel,
) -> Result<Option<String>, Failure> {
  let token = &c.token;
  let user = &c.user_id;
  let batch = start_upload(c, post.images.len(), cancel)?;
  let mut result = "failed";
  let outcome = (|| {
    for (i, image) in post.images.iter().enumerate() {
      step(PostStep::Uploading {
        done: i,
        total: post.images.len(),
      });
      if let Some((put, _)) = batch.frames.get(i) {
        upload_frame(put, image, cancel)?;
      }
    }
    step(PostStep::Processing);
    let urls: Vec<&str> = batch.frames.iter().map(|(_, u)| u.as_str()).collect();
    let create = |params: &[(&str, &str)]| {
      graph(token, true, &format!("{user}/media"), params, Some(cancel)).and_then(|v| id_of(&v))
    };
    let tagged = |i: usize| post.tags.get(i).and_then(|t| user_tags_param(t));
    let mut to_publish = Vec::new();
    match post.kind {
      PostKind::Story => {
        for (i, url) in urls.iter().enumerate() {
          let tags = tagged(i);
          let mut p = vec![("image_url", *url), ("media_type", "STORIES")];
          if let Some(t) = &tags {
            p.push(("user_tags", t));
          }
          to_publish.push(create(&p)?);
        }
      }
      PostKind::Feed if urls.len() == 1 => {
        let tags = tagged(0);
        let mut p = vec![("image_url", urls[0]), ("caption", post.caption.as_str())];
        if let Some(t) = &tags {
          p.push(("user_tags", t));
        }
        to_publish.push(create(&p)?);
      }
      PostKind::Feed => {
        let mut children = Vec::new();
        for (i, url) in urls.iter().enumerate() {
          let tags = tagged(i);
          let mut p = vec![("image_url", *url), ("is_carousel_item", "true")];
          if let Some(t) = &tags {
            p.push(("user_tags", t));
          }
          children.push(create(&p)?);
        }
        for child in &children {
          wait_until_ready(token, child, cancel)?;
        }
        let joined = children.join(",");
        to_publish.push(create(&[
          ("media_type", "CAROUSEL"),
          ("children", &joined),
          ("caption", &post.caption),
        ])?);
      }
    }
    for container in &to_publish {
      wait_until_ready(token, container, cancel)?;
    }
    cancel.check()?;

    // Publishing: no cancelling from here, and a failure partway says what's already up.
    let mut published = Vec::new();
    for (i, container) in to_publish.iter().enumerate() {
      step(PostStep::Publishing {
        done: i,
        total: to_publish.len(),
      });
      match graph(
        token,
        true,
        &format!("{user}/media_publish"),
        &[("creation_id", container)],
        None,
      )
      .and_then(|v| id_of(&v))
      {
        Ok(id) => {
          published.push(id);
          result = "posted";
        }
        Err(e) if published.is_empty() => return Err(e),
        Err(e) => {
          return Err(other(format!(
            "{} of {} stories were posted, then it stopped. {}",
            published.len(),
            to_publish.len(),
            e.message()
          )));
        }
      }
    }
    let Some(first) = published.first() else {
      return Ok(None);
    };
    Ok(
      graph(token, false, first, &[("fields", "permalink")], None)
        .ok()
        .and_then(|v| v["permalink"].as_str().map(String::from)),
    )
  })();
  if matches!(outcome, Err(Failure::Cancelled)) {
    result = "cancelled";
  }
  // The server deletes them within the hour anyway; this is sooner.
  let sep = if batch.delete.contains('?') { '&' } else { '?' };
  let _ = agent().delete(format!("{}{sep}result={result}", batch.delete)).call();
  outcome
}

/// Whether `url` is an image on Instagram's servers.
fn is_instagram_image(url: &str) -> bool {
  let Some(rest) = url.strip_prefix("https://") else {
    return false;
  };
  let host = rest.split(['/', '?', '#']).next().unwrap_or("");
  config::INSTAGRAM_IMAGE_DOMAINS
    .iter()
    .any(|d| host.ends_with(&format!(".{d}")))
}

/// The account's profile picture, from Instagram, if it has one and it could be fetched.
pub fn profile_picture(token: &str) -> Option<Vec<u8>> {
  let me = graph(token, false, "me", &[("fields", "profile_picture_url")], None).ok()?;
  let url = me["profile_picture_url"].as_str().filter(|u| is_instagram_image(u))?;
  let mut res = agent().get(url).call().ok()?;
  if !res.status().is_success() {
    return None;
  }
  let mut bytes = Vec::new();
  res.body_mut().as_reader().take(4 << 20).read_to_end(&mut bytes).ok()?;
  Some(bytes)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sign_in_urls() {
    let (url, pending) = plan_sign_in("https://example.test");
    assert!(url.starts_with(config::INSTAGRAM_AUTHORIZE_URL));
    assert!(url.contains("redirect_uri=https%3A%2F%2Fexample.test%2Fauth%2Fcallback"));
    let parts: Vec<&str> = pending.state.split('.').collect();
    assert_eq!(parts.len(), 3);
    assert_eq!(parts[0], "mac");
    assert_eq!(parts[2], challenge_of(&pending.verifier));
    // RFC 7636's example.
    assert_eq!(
      challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  }

  #[test]
  fn instagram_images() {
    assert!(is_instagram_image("https://scontent.cdninstagram.com/a.jpg"));
    assert!(!is_instagram_image("https://cdninstagram.com.evil.test/a.jpg"));
    assert!(!is_instagram_image("http://x.fbcdn.net/a.jpg"));
  }
}
