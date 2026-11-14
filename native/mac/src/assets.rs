//! What's built into the app: the icons (Lucide's, as the web app's, at a fine stroke) and
//! the fonts (Inter Tight and IBM Plex Mono, the iPhone app's copies).

use std::borrow::Cow;

use gpui_kit::{App, AssetSource, SharedString};

macro_rules! icons {
  ($($name:literal),* $(,)?) => {
    &[$(($name, include_bytes!(concat!("../assets/icons/", $name, ".svg")))),*]
  };
}

const ICONS: &[(&str, &[u8])] = icons![
  "arrow-left-right",
  "check",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "code-xml",
  "compass",
  "copy",
  "copy-plus",
  "crop",
  "download",
  "external-link",
  "eye",
  "eye-off",
  "file-plus",
  "file-text",
  "folder-open",
  "image-plus",
  "images",
  "info",
  "instagram",
  "layout-grid",
  "link-2",
  "link-2-off",
  "mail",
  "maximize-2",
  "minimize-2",
  "minus",
  "package",
  "panel-right-close",
  "panel-right-open",
  "pencil",
  "pin",
  "pipette",
  "plus",
  "redo-2",
  "ruler",
  "separator-horizontal",
  "separator-vertical",
  "settings",
  "shield",
  "trash-2",
  "triangle-alert",
  "undo-2",
  "upload",
  "x",
];

/// The icons, at `icons/<name>.svg`.
pub struct Assets;

impl AssetSource for Assets {
  fn load(&self, path: &str) -> anyhow::Result<Option<Cow<'static, [u8]>>> {
    let name = path.strip_prefix("icons/").and_then(|p| p.strip_suffix(".svg"));
    Ok(
      name
        .and_then(|n| ICONS.iter().find(|(k, _)| *k == n))
        .map(|(_, b)| Cow::Borrowed(*b)),
    )
  }

  fn list(&self, path: &str) -> anyhow::Result<Vec<SharedString>> {
    Ok(
      ICONS
        .iter()
        .map(|(n, _)| SharedString::from(format!("icons/{n}.svg")))
        .filter(|p| p.starts_with(path))
        .collect(),
    )
  }
}

/// An icon's path, for `svg().path(..)`.
pub fn icon(name: &str) -> SharedString {
  SharedString::from(format!("icons/{name}.svg"))
}

/// The UI font and the monospaced one, as the web app's CSS names them.
pub const FONT: &str = "Inter Tight";
pub const MONO: &str = "IBM Plex Mono";

/// Make the fonts available to the app.
pub fn load_fonts(cx: &mut App) {
  let fonts: Vec<Cow<'static, [u8]>> = vec![
    Cow::Borrowed(include_bytes!("../../../ios/Sequence/Fonts/InterTight-Regular.ttf")),
    Cow::Borrowed(include_bytes!("../../../ios/Sequence/Fonts/InterTight-Medium.ttf")),
    Cow::Borrowed(include_bytes!("../../../ios/Sequence/Fonts/InterTight-SemiBold.ttf")),
    Cow::Borrowed(include_bytes!("../../../ios/Sequence/Fonts/InterTight-Bold.ttf")),
    Cow::Borrowed(include_bytes!("../../../ios/Sequence/Fonts/IBMPlexMono-Regular.ttf")),
    Cow::Borrowed(include_bytes!("../../../ios/Sequence/Fonts/IBMPlexMono-Medium.ttf")),
  ];
  let _ = cx.text_system().add_fonts(fonts);
}
