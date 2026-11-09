//! Sequence for the Mac, in GPUI: the window, its menus, and the files macOS hands it.
//! See docs/proposals/gpui-mac.md.

mod assets;
#[cfg(target_os = "macos")]
mod bookmarks;
mod commands;
mod config;
mod crop;
mod export;
mod fields;
#[cfg(target_os = "macos")]
mod imageio;
mod instagram;
mod layout;
mod library;
mod posting;
mod prefs;
mod theme;
mod urls;
mod views;
mod workspace;

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use futures::StreamExt;
use gpui_kit::*;

use crate::commands::*;
use crate::library::{Library, support_dir};
use crate::prefs::Prefs;
use crate::views::settings::SettingsWindow;
use crate::workspace::Workspace;

fn main() {
  let app = application().with_assets(assets::Assets);
  // Files macOS hands the app (a double-click in Finder) can arrive before the window
  // exists, so they wait in a channel.
  let (urls_tx, mut urls_rx) = futures::channel::mpsc::unbounded::<Vec<String>>();
  app.on_open_urls(move |urls| {
    let _ = urls_tx.unbounded_send(urls);
  });
  app.run(move |cx| {
    gpui_kit::init(cx);
    assets::load_fonts(cx);
    cx.activate(true);
    cx.bind_keys(key_bindings());
    cx.set_menus(menus());

    let mut prefs = Prefs::load();
    // The open project's file, through its bookmark (the sandbox forgets it otherwise).
    #[cfg(target_os = "macos")]
    if let Some(b) = &prefs.document_bookmark {
      match bookmarks::resolve(b) {
        Ok((path, stale)) => {
          // A bookmark gone stale (the file moved) is made again while it still resolves.
          if stale && let Ok(fresh) = bookmarks::bookmark(&path) {
            prefs.document_bookmark = Some(fresh);
            prefs.save();
          }
          prefs.document = Some(path);
        }
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
        // A debug build can open with the Layout view showing, for a quick look.
        #[cfg(debug_assertions)]
        if let Some(tab) = std::env::var_os("SEQUENCE_OPEN_LAYOUT") {
          ws.update(cx, |ws, cx| {
            ws.open_layout(cx);
            if tab == "guides"
              && let Some(l) = &mut ws.ui.layout
            {
              l.tab = layout::LayoutTab::Guides;
            }
          });
        }
        #[cfg(debug_assertions)]
        if let Some(to) = std::env::var_os("SEQUENCE_OPEN_EXPORT") {
          ws.update(cx, |ws, cx| {
            use sequence_core::model::ExportDestination as D;
            let d = match to.to_str() {
              Some("images") => Some(D::Images),
              Some("indesign") => Some(D::Indesign),
              Some("instagram") => Some(D::Instagram),
              Some("pdf") => Some(D::Pdf),
              _ => None,
            };
            if let Some(d) = d {
              ws.pick_destination(d, cx);
            }
            ws.go_to(workspace::Page::Export, cx);
          });
        }
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
    // Quitting keeps the work in the library first (its save waits a moment after changes).
    cx.on_action(move |_: &Quit, cx| {
      let _ = window.update(cx, |ws, _, _| ws.save_to_library());
      cx.quit();
    });
    // ⌘W closes the window in front (Settings, or the main window).
    cx.on_action(|_: &CloseWindow, cx| {
      if let Some(w) = cx.active_window() {
        let _ = w.update(cx, |_, window, _| window.remove_window());
      }
    });
    // Settings, in a window of its own: one at a time, brought forward if it's open.
    let settings: Rc<RefCell<Option<WindowHandle<SettingsWindow>>>> = Rc::default();
    let workspace = window.entity(cx).expect("the window was just opened");
    cx.on_action(move |_: &OpenSettings, cx| {
      // Later, once the window that sent this (on the stack now) is done with it.
      let settings = settings.clone();
      let ws = workspace.clone();
      cx.defer(move |cx| open_settings(&settings, ws, cx));
    });

    // A debug build can open Settings at launch, for a quick look.
    #[cfg(debug_assertions)]
    if std::env::var_os("SEQUENCE_OPEN_SETTINGS").is_some() {
      cx.dispatch_action(&OpenSettings);
    }

    // Files from Finder, as they come.
    cx.spawn(async move |cx| {
      while let Some(urls) = urls_rx.next().await {
        let paths: Vec<PathBuf> = urls.iter().filter_map(|u| urls::file_url_path(u)).collect();
        let links: Vec<String> = urls
          .into_iter()
          .filter(|u| u.starts_with("sequence-photos://"))
          .collect();
        let done = window.update(cx, |ws, _, cx| {
          for link in &links {
            ws.finish_sign_in(link, cx);
          }
          if !paths.is_empty() {
            ws.files_dropped(paths, cx);
          }
        });
        if done.is_err() {
          break;
        }
      }
    })
    .detach();
  });
}

/// Open Settings, or bring it forward if it's open.
fn open_settings(settings: &RefCell<Option<WindowHandle<SettingsWindow>>>, ws: Entity<Workspace>, cx: &mut App) {
  if let Some(open) = *settings.borrow()
    && open.update(cx, |_, w, _| w.activate_window()).is_ok()
  {
    return;
  }
  let options = WindowOptions {
    titlebar: Some(TitlebarOptions {
      title: Some("Settings".into()),
      appears_transparent: true,
      traffic_light_position: None,
    }),
    window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
      None,
      size(px(520.0), px(400.0)),
      cx,
    ))),
    is_resizable: false,
    is_minimizable: false,
    ..Default::default()
  };
  *settings.borrow_mut() = cx
    .open_window(options, |window, cx| cx.new(|cx| SettingsWindow::new(ws, window, cx)))
    .ok();
}
