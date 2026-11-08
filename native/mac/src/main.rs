//! Sequence for the Mac, in GPUI: the window, its menus, and the files macOS hands it.
//! See docs/proposals/gpui-mac.md.

mod assets;
#[cfg(target_os = "macos")]
mod bookmarks;
mod commands;
#[cfg(target_os = "macos")]
mod imageio;
mod library;
mod prefs;
mod theme;
mod views;
mod workspace;

use std::path::PathBuf;

use gpui_kit::*;

use crate::commands::*;
use crate::library::{Library, support_dir};
use crate::prefs::Prefs;
use crate::workspace::Workspace;

fn main() {
  let app = application().with_assets(assets::Assets);
  // Files macOS hands the app (a double-click in Finder) can arrive before the window
  // exists, so they wait in a channel.
  let (urls_tx, urls_rx) = std::sync::mpsc::channel::<Vec<String>>();
  app.on_open_urls(move |urls| {
    let _ = urls_tx.send(urls);
  });
  app.run(move |cx| {
    gpui_kit::init(cx);
    assets::load_fonts(cx);
    cx.activate(true);
    cx.bind_keys(key_bindings());
    cx.set_menus(menus());
    cx.on_action(|_: &Quit, cx| cx.quit());

    let mut prefs = Prefs::load();
    // The open project's file, through its bookmark (the sandbox forgets it otherwise).
    #[cfg(target_os = "macos")]
    if let Some(b) = &prefs.document_bookmark {
      match bookmarks::resolve(b) {
        Ok(path) => prefs.document = Some(path),
        Err(_) => prefs.document = None,
      }
    }
    let lib = Library::at(support_dir().join("Current"));

    let options = WindowOptions {
      titlebar: Some(TitlebarOptions {
        title: Some("Sequence".into()),
        appears_transparent: true,
        traffic_light_position: Some(point(px(16.0), px(14.0))),
      }),
      window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
        None,
        size(px(1280.0), px(820.0)),
        cx,
      ))),
      window_min_size: Some(size(px(720.0), px(480.0))),
      ..Default::default()
    };
    let window = cx
      .open_window(options, |window, cx| {
        let ws = cx.new(|cx| Workspace::new(lib, prefs, cx));
        let focus = ws.read(cx).focus.clone();
        window.focus(&focus, cx);
        ws
      })
      .expect("couldn't open the window");

    cx.on_action(move |_: &About, cx| {
      let _ = window.update(cx, |ws, _, cx| {
        ws.ui.notice = Some(format!(
          "Sequence {} — sequence.photos. Photos stay on this Mac.",
          env!("CARGO_PKG_VERSION")
        ));
        cx.notify();
      });
    });
    cx.on_action(move |_: &CloseWindow, cx| {
      let _ = window.update(cx, |_, window, _| window.remove_window());
    });

    // Drain files from Finder now and as they come.
    cx.spawn(async move |cx| {
      loop {
        while let Ok(urls) = urls_rx.try_recv() {
          let paths: Vec<PathBuf> = urls
            .iter()
            .filter_map(|u| u.strip_prefix("file://"))
            .map(|p| PathBuf::from(percent_decode(p)))
            .collect();
          let _ = window.update(cx, |ws, _, cx| {
            ws.files_dropped(paths, cx);
          });
        }
        cx.background_executor()
          .timer(std::time::Duration::from_millis(200))
          .await;
      }
    })
    .detach();
  });
}

/// A file URL's path, with its %-escapes undone.
fn percent_decode(s: &str) -> String {
  let bytes = s.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%'
      && i + 2 < bytes.len()
      && let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16)
    {
      out.push(b);
      i += 3;
      continue;
    }
    out.push(bytes[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}
