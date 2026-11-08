//! Sequence for the Mac, in GPUI. For now, the App Store spike (docs/proposals/gpui-mac.md,
//! phase 0): a sandboxed window with the menu bar, the open and save panels, files opened
//! from Finder, and a bookmark that reopens the last file after a restart.

#[cfg(target_os = "macos")]
mod bookmarks;

use std::io::Write;
use std::path::PathBuf;

use gpui_kit::*;

actions!(sequence, [Open, SaveAs, ReopenLast, Quit]);

/// What the spike has done, newest last; also written to a log in the temporary folder
/// (inside the app's container when sandboxed) so a test can read it.
struct Spike {
  lines: Vec<String>,
}

impl Spike {
  fn log(&mut self, line: impl Into<String>, cx: &mut Context<Self>) {
    let line = line.into();
    let file = std::env::temp_dir().join("sequence-gpui.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
      let _ = writeln!(f, "{line}");
    }
    self.lines.push(line);
    cx.notify();
  }
}

impl Render for Spike {
  fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
    div()
      .size_full()
      .flex()
      .flex_col()
      .gap_1()
      .p_4()
      .bg(rgb(0x242424))
      .text_color(rgb(0xe6e6e6))
      .text_sm()
      .child(
        div()
          .text_color(rgb(0x8e8e8e))
          .child("Sequence (GPUI spike). ⌘O open, ⇧⌘S save a copy, ⌘R reopen the last file."),
      )
      .children(self.lines.iter().map(|l| div().child(l.clone())))
  }
}

/// Where the last opened file's bookmark is kept (the app's container when sandboxed).
fn bookmark_file() -> PathBuf {
  let dir = std::env::home_dir()
    .unwrap_or_else(std::env::temp_dir)
    .join("Library/Application Support/Sequence GPUI");
  let _ = std::fs::create_dir_all(&dir);
  dir.join("last.bookmark")
}

/// Read a file the app was given, keep a bookmark to it, and say how it went.
fn opened(path: PathBuf, spike: &Entity<Spike>, cx: &mut App) {
  let size = std::fs::metadata(&path).map(|m| m.len());
  #[cfg(target_os = "macos")]
  let kept = bookmarks::bookmark(&path).and_then(|b| std::fs::write(bookmark_file(), b).map_err(|e| e.to_string()));
  #[cfg(not(target_os = "macos"))]
  let kept: Result<(), String> = Ok(());
  spike.update(cx, |s, cx| {
    s.log(
      format!("opened {} ({size:?} bytes), bookmark: {kept:?}", path.display()),
      cx,
    );
  });
}

fn main() {
  let app = application();
  // Files and links macOS hands the app (a double-click in Finder) can arrive before the
  // window exists, so they wait in a channel.
  let (urls_tx, urls_rx) = std::sync::mpsc::channel::<Vec<String>>();
  app.on_open_urls(move |urls| {
    let _ = urls_tx.send(urls);
  });
  app.run(move |cx| {
    gpui_kit::init(cx);
    cx.activate(true);
    cx.on_action(|_: &Quit, cx| cx.quit());
    cx.bind_keys([
      KeyBinding::new("cmd-o", Open, None),
      KeyBinding::new("cmd-shift-s", SaveAs, None),
      KeyBinding::new("cmd-r", ReopenLast, None),
      KeyBinding::new("cmd-q", Quit, None),
    ]);
    cx.set_menus([
      Menu::new("Sequence").items([
        MenuItem::os_submenu("Services", SystemMenuType::Services),
        MenuItem::separator(),
        MenuItem::action("Quit Sequence", Quit),
      ]),
      Menu::new("File").items([
        MenuItem::action("Open…", Open),
        MenuItem::action("Save a Copy…", SaveAs),
        MenuItem::action("Reopen Last File", ReopenLast),
      ]),
    ]);

    let spike = cx.new(|_| Spike { lines: Vec::new() });
    let options = WindowOptions {
      titlebar: Some(TitlebarOptions {
        title: Some("Sequence".into()),
        ..Default::default()
      }),
      window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
        None,
        size(px(900.), px(600.)),
        cx,
      ))),
      ..Default::default()
    };
    let view = spike.clone();
    cx.open_window(options, move |_, _| view)
      .expect("couldn't open the window");

    let s = spike.clone();
    cx.on_action(move |_: &Open, cx| {
      let picked = cx.prompt_for_paths(PathPromptOptions {
        files: true,
        directories: false,
        multiple: false,
        prompt: None,
      });
      let s = s.clone();
      cx.spawn(async move |cx| {
        if let Ok(Ok(Some(paths))) = picked.await {
          cx.update(|cx| paths.into_iter().for_each(|p| opened(p, &s, cx)));
        }
      })
      .detach();
    });

    let s = spike.clone();
    cx.on_action(move |_: &SaveAs, cx| {
      let dir = std::env::home_dir().unwrap_or_default();
      let picked = cx.prompt_for_new_path(&dir, Some("spike.photo-sequence"));
      let s = s.clone();
      cx.spawn(async move |cx| {
        if let Ok(Ok(Some(path))) = picked.await {
          let wrote = std::fs::write(&path, b"Sequence GPUI spike\n");
          cx.update(|cx| s.update(cx, |s, cx| s.log(format!("saved {}: {wrote:?}", path.display()), cx)));
        }
      })
      .detach();
    });

    let s = spike.clone();
    cx.on_action(move |_: &ReopenLast, cx| {
      let result = std::fs::read(bookmark_file()).map_err(|e| e.to_string()).and_then(|b| {
        #[cfg(target_os = "macos")]
        let path = bookmarks::resolve(&b)?;
        #[cfg(not(target_os = "macos"))]
        let path = PathBuf::from(String::from_utf8_lossy(&b).into_owned());
        std::fs::read(&path).map(|d| (path, d.len())).map_err(|e| e.to_string())
      });
      s.update(cx, |s, cx| s.log(format!("reopened last file: {result:?}"), cx));
    });

    // Drain files from Finder now and as they come.
    let s = spike.clone();
    cx.spawn(async move |cx| {
      loop {
        while let Ok(urls) = urls_rx.try_recv() {
          cx.update(|cx| {
            for url in urls {
              match url.strip_prefix("file://") {
                Some(path) => opened(PathBuf::from(percent_decode(path)), &s, cx),
                None => s.update(cx, |s, cx| s.log(format!("link: {url}"), cx)),
              }
            }
          });
        }
        cx.background_executor()
          .timer(std::time::Duration::from_millis(200))
          .await;
      }
    })
    .detach();
    spike.update(cx, |s, cx| {
      s.log(
        format!(
          "started; sandboxed: {}",
          std::env::var("APP_SANDBOX_CONTAINER_ID").is_ok()
        ),
        cx,
      )
    });
    // For checking the bookmark without a keyboard: `open --env SEQUENCE_SPIKE_REOPEN=1 …`.
    if std::env::var("SEQUENCE_SPIKE_REOPEN").is_ok() {
      cx.dispatch_action(&ReopenLast);
    }
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
