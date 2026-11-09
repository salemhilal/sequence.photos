//! What the app is configured with (`src/config.ts`): the public values in the repository's
//! `.env`, read when the app is built, so there's one place to change them.

use std::sync::OnceLock;

/// `.env`'s values, by name (only public `VITE_` values live there).
fn env() -> &'static [(String, String)] {
  static ENV: OnceLock<Vec<(String, String)>> = OnceLock::new();
  ENV.get_or_init(|| {
    include_str!("../../../.env")
      .lines()
      .filter(|l| !l.trim_start().starts_with('#'))
      .filter_map(|l| l.split_once('='))
      .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
      .collect()
  })
}

fn value(name: &str) -> &'static str {
  env().iter().find(|(k, _)| k == name).map_or("", |(_, v)| v.as_str())
}

/// Sequence's server for posting to Instagram, and the development one.
pub fn server_url() -> &'static str {
  value("VITE_SERVER_URL")
}

pub fn dev_server_url() -> &'static str {
  value("VITE_DEV_SERVER_URL")
}

/// The Instagram app's id (public: it's in every sign-in URL).
pub fn instagram_app_id() -> &'static str {
  value("VITE_INSTAGRAM_APP_ID")
}

pub const INSTAGRAM_AUTHORIZE_URL: &str = "https://www.instagram.com/oauth/authorize";
pub const GRAPH_ORIGIN: &str = "https://graph.instagram.com";
/// Matches the server's GRAPH_VERSION (server/wrangler.jsonc).
pub const GRAPH_URL: &str = "https://graph.instagram.com/v26.0";
pub const INSTAGRAM_SCOPES: &str = "instagram_business_basic,instagram_business_content_publish";
/// The image servers profile pictures come from.
pub const INSTAGRAM_IMAGE_DOMAINS: [&str; 2] = ["cdninstagram.com", "fbcdn.net"];
/// The server's name for this app, which it sends sign-ins back to (`sequence-photos://instagram`).
pub const CLIENT: &str = "mac";

#[cfg(test)]
mod tests {
  #[test]
  fn reads_the_env() {
    assert!(super::server_url().starts_with("https://"));
    assert!(!super::instagram_app_id().is_empty());
  }
}
