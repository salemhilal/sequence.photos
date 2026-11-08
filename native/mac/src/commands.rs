//! Every command, with its shortcut and its place in the menu bar (`src/commands.ts`,
//! `src/platform/macos/menu.ts`), and the document's commands: new, open, save.

use std::path::PathBuf;

use gpui_kit::*;
use sequence_core::Project;
use sequence_core::actions as act;
use sequence_core::project_file::PROJECT_EXTENSION;

use crate::theme::ThemePref;
use crate::workspace::{ContextMenu, Page, Workspace};

actions!(
  sequence,
  [
    About,
    Quit,
    NewProject,
    OpenProject,
    SaveProject,
    SaveProjectAs,
    AddPhotos,
    Undo,
    Redo,
    SelectAll,
    Duplicate,
    Delete,
    Escape,
    ShowDesk,
    ShowPreview,
    ShowExport,
    ToggleSidebar,
    ToggleGuides,
    Tidy,
    ZoomIn,
    ZoomOut,
    ZoomToFit,
    NudgeLeft,
    NudgeRight,
    NudgeUp,
    NudgeDown,
    NudgeLeftBig,
    NudgeRightBig,
    NudgeUpBig,
    NudgeDownBig,
    QuickLook,
    Minimize,
    Zoom,
    ToggleFullScreen,
    CloseWindow,
    Confirm,
  ]
);

/// The shortcuts, in the workspace's key context.
pub fn key_bindings() -> Vec<KeyBinding> {
  let w = Some("Workspace");
  vec![
    KeyBinding::new("cmd-q", Quit, None),
    KeyBinding::new("cmd-o", OpenProject, None),
    KeyBinding::new("cmd-s", SaveProject, None),
    KeyBinding::new("cmd-shift-s", SaveProjectAs, None),
    KeyBinding::new("cmd-i", AddPhotos, None),
    KeyBinding::new("cmd-z", Undo, None),
    KeyBinding::new("cmd-shift-z", Redo, None),
    KeyBinding::new("cmd-a", SelectAll, w),
    KeyBinding::new("cmd-d", Duplicate, w),
    KeyBinding::new("backspace", Delete, w),
    KeyBinding::new("delete", Delete, w),
    KeyBinding::new("escape", Escape, w),
    KeyBinding::new("enter", Confirm, w),
    KeyBinding::new("alt-cmd-1", ShowDesk, None),
    KeyBinding::new("alt-cmd-2", ShowPreview, None),
    KeyBinding::new("cmd-p", ShowPreview, None),
    KeyBinding::new("alt-cmd-3", ShowExport, None),
    KeyBinding::new("cmd-shift-e", ShowExport, None),
    KeyBinding::new("cmd-b", ToggleSidebar, None),
    KeyBinding::new("cmd-;", ToggleGuides, None),
    KeyBinding::new("cmd-=", ZoomIn, w),
    KeyBinding::new("cmd-+", ZoomIn, w),
    KeyBinding::new("cmd--", ZoomOut, w),
    KeyBinding::new("cmd-0", ZoomToFit, w),
    KeyBinding::new("left", NudgeLeft, w),
    KeyBinding::new("right", NudgeRight, w),
    KeyBinding::new("up", NudgeUp, w),
    KeyBinding::new("down", NudgeDown, w),
    KeyBinding::new("shift-left", NudgeLeftBig, w),
    KeyBinding::new("shift-right", NudgeRightBig, w),
    KeyBinding::new("shift-up", NudgeUpBig, w),
    KeyBinding::new("shift-down", NudgeDownBig, w),
    KeyBinding::new("cmd-m", Minimize, None),
    KeyBinding::new("ctrl-cmd-f", ToggleFullScreen, None),
    KeyBinding::new("cmd-w", CloseWindow, None),
  ]
}

/// The menu bar. macOS titles the first menu with the app's name.
pub fn menus() -> Vec<Menu> {
  vec![
    Menu::new("Sequence").items([
      MenuItem::action("About Sequence", About),
      MenuItem::separator(),
      MenuItem::os_submenu("Services", SystemMenuType::Services),
      MenuItem::separator(),
      MenuItem::action("Quit Sequence", Quit),
    ]),
    Menu::new("File").items([
      MenuItem::action("New Project…", NewProject),
      MenuItem::action("Open…", OpenProject),
      MenuItem::separator(),
      MenuItem::action("Save", SaveProject),
      MenuItem::action("Save As…", SaveProjectAs),
      MenuItem::separator(),
      MenuItem::action("Add Photos…", AddPhotos),
      MenuItem::separator(),
      MenuItem::action("Export…", ShowExport),
      MenuItem::separator(),
      MenuItem::action("Close", CloseWindow),
    ]),
    Menu::new("Edit").items([
      MenuItem::action("Undo", Undo),
      MenuItem::action("Redo", Redo),
      MenuItem::separator(),
      MenuItem::action("Duplicate", Duplicate),
      MenuItem::action("Delete", Delete),
      MenuItem::action("Select All", SelectAll),
    ]),
    Menu::new("View").items([
      MenuItem::action("Desk", ShowDesk),
      MenuItem::action("Preview", ShowPreview),
      MenuItem::action("Export", ShowExport),
      MenuItem::separator(),
      MenuItem::action("Show or Hide Spreads", ToggleSidebar),
      MenuItem::action("Show or Hide Guides", ToggleGuides),
      MenuItem::separator(),
      MenuItem::action("Tidy Up", Tidy),
      MenuItem::action("Zoom In", ZoomIn),
      MenuItem::action("Zoom Out", ZoomOut),
      MenuItem::action("Zoom to Fit", ZoomToFit),
      MenuItem::separator(),
      MenuItem::action("Enter Full Screen", ToggleFullScreen),
    ]),
    Menu::new("Window").items([MenuItem::action("Minimize", Minimize), MenuItem::action("Zoom", Zoom)]),
  ]
}

/// What a context menu's item does.
#[derive(Clone, Copy, Debug)]
pub enum MenuAction {
  AddPhotos,
  Tidy,
  Fit,
  SelectAll,
  DeskColor,
  QuickLook,
  Duplicate,
  ToDesk,
  Delete,
}

impl Workspace {
  /// The workspace's own commands, on its root element.
  pub fn bind_commands(&mut self, root: Stateful<Div>, cx: &mut Context<Self>) -> Stateful<Div> {
    root
      .on_action(cx.listener(|ws, _: &Undo, _, cx| ws.undo(cx)))
      .on_action(cx.listener(|ws, _: &Redo, _, cx| ws.redo(cx)))
      .on_action(cx.listener(|ws, _: &SelectAll, _, cx| {
        if ws.ui.editing.is_none() && ws.ui.page == Page::Desk {
          ws.ui.selection = ws.project().pile.iter().map(|p| p.photo_id.clone()).collect();
          cx.notify();
        }
      }))
      .on_action(cx.listener(|ws, _: &Duplicate, _, cx| {
        if ws.ui.page != Page::Desk {
          return;
        }
        if ws.ui.editing.is_some() {
          if let Some(id) = ws.ui.editor_selected.clone() {
            let ids = ws.duplicate(&[id], cx);
            ws.ui.editor_selected = ids.into_iter().next();
          }
        } else {
          let sel = ws.ui.selection.clone();
          ws.ui.selection = ws.duplicate(&sel, cx);
        }
        cx.notify();
      }))
      .on_action(cx.listener(|ws, _: &Delete, _, cx| {
        if ws.ui.page == Page::Desk {
          ws.delete_selection(cx);
        }
      }))
      .on_action(cx.listener(|ws, _: &Escape, window, cx| ws.escape(window, cx)))
      .on_action(cx.listener(|ws, _: &ShowDesk, _, cx| ws.go_to(Page::Desk, cx)))
      .on_action(cx.listener(|ws, _: &ShowPreview, _, cx| ws.go_to(Page::Preview, cx)))
      .on_action(cx.listener(|ws, _: &ShowExport, _, cx| ws.go_to(Page::Export, cx)))
      .on_action(cx.listener(|ws, _: &ToggleSidebar, _, cx| ws.toggle_sidebar(cx)))
      .on_action(cx.listener(|ws, _: &ToggleGuides, _, cx| {
        ws.ui.guides_hidden = !ws.ui.guides_hidden;
        cx.notify();
      }))
      .on_action(cx.listener(|ws, _: &Tidy, _, cx| ws.tidy(cx)))
      .on_action(cx.listener(|ws, _: &ZoomIn, _, cx| {
        ws.zoom_desk(1.25);
        cx.notify();
      }))
      .on_action(cx.listener(|ws, _: &ZoomOut, _, cx| {
        ws.zoom_desk(0.8);
        cx.notify();
      }))
      .on_action(cx.listener(|ws, _: &ZoomToFit, _, cx| {
        ws.fit_desk();
        cx.notify();
      }))
      .on_action(cx.listener(|ws, _: &NudgeLeft, _, cx| ws.arrow(-1.0, 0.0, false, cx)))
      .on_action(cx.listener(|ws, _: &NudgeRight, _, cx| ws.arrow(1.0, 0.0, false, cx)))
      .on_action(cx.listener(|ws, _: &NudgeUp, _, cx| ws.arrow(0.0, -1.0, false, cx)))
      .on_action(cx.listener(|ws, _: &NudgeDown, _, cx| ws.arrow(0.0, 1.0, false, cx)))
      .on_action(cx.listener(|ws, _: &NudgeLeftBig, _, cx| ws.arrow(-1.0, 0.0, true, cx)))
      .on_action(cx.listener(|ws, _: &NudgeRightBig, _, cx| ws.arrow(1.0, 0.0, true, cx)))
      .on_action(cx.listener(|ws, _: &NudgeUpBig, _, cx| ws.arrow(0.0, -1.0, true, cx)))
      .on_action(cx.listener(|ws, _: &NudgeDownBig, _, cx| ws.arrow(0.0, 1.0, true, cx)))
      .on_action(cx.listener(|ws, _: &AddPhotos, window, cx| ws.pick_photos(window, cx)))
      .on_action(cx.listener(|ws, _: &NewProject, window, cx| ws.new_project(window, cx)))
      .on_action(cx.listener(|ws, _: &OpenProject, window, cx| ws.pick_project(window, cx)))
      .on_action(cx.listener(|ws, _: &SaveProject, window, cx| ws.save(false, window, cx)))
      .on_action(cx.listener(|ws, _: &SaveProjectAs, window, cx| ws.save(true, window, cx)))
      .on_action(cx.listener(|_, _: &Minimize, window, _| window.minimize_window()))
      .on_action(cx.listener(|_, _: &Zoom, window, _| window.zoom_window()))
      .on_action(cx.listener(|_, _: &ToggleFullScreen, window, _| window.toggle_fullscreen()))
      .on_action(cx.listener(|ws, _: &QuickLook, _, cx| ws.quick_look(cx)))
      .on_key_down(cx.listener(|ws, ev: &KeyDownEvent, _, cx| ws.key_down(ev, cx)))
      .on_key_up(cx.listener(|ws, ev: &KeyUpEvent, _, cx| ws.key_up(ev, cx)))
  }

  /// While cropping, only finishing or cancelling the crop (and the window's own commands).
  pub fn bind_crop_commands(&mut self, root: Stateful<Div>, cx: &mut Context<Self>) -> Stateful<Div> {
    root
      .on_action(cx.listener(|ws, _: &Confirm, _, cx| ws.finish_crop(true, cx)))
      .on_action(cx.listener(|ws, _: &Escape, _, cx| {
        if !ws.cancel_drag(cx) {
          ws.finish_crop(false, cx);
        }
      }))
      .on_action(cx.listener(|_, _: &Minimize, window, _| window.minimize_window()))
      .on_action(cx.listener(|_, _: &Zoom, window, _| window.zoom_window()))
      .on_action(cx.listener(|_, _: &ToggleFullScreen, window, _| window.toggle_fullscreen()))
  }

  /// Arrow keys: in Preview, turn pages; elsewhere nudge.
  fn arrow(&mut self, dx: f64, dy: f64, big: bool, cx: &mut Context<Self>) {
    match self.ui.page {
      Page::Preview => {
        if dx != 0.0 {
          self.preview_go(dx as isize, cx);
        } else if dy != 0.0 {
          self.preview_go(dy as isize, cx);
        }
      }
      Page::Desk => self.nudge(dx, dy, big, cx),
      Page::Export => {}
    }
  }

  /// Escape: end a gesture, close what's open, or clear the selection.
  fn escape(&mut self, window: &mut Window, cx: &mut Context<Self>) {
    if self.cancel_drag(cx) {
      return;
    }
    if self.ui.context_menu.take().is_some() || self.ui.quick_look.take().is_some() {
      cx.notify();
      return;
    }
    if self.ui.presenting {
      self.present(false, window, cx);
      return;
    }
    if self.ui.editing.is_some() {
      if self.ui.editor_selected.take().is_none() {
        self.ui.editing = None;
      }
      cx.notify();
      return;
    }
    self.ui.selection.clear();
    self.ui.spread_selection.clear();
    cx.notify();
  }

  /// Space: tapped, Quick Look; held, the desk pans under the pointer.
  fn key_down(&mut self, ev: &KeyDownEvent, cx: &mut Context<Self>) {
    if ev.keystroke.key == "space" && !ev.keystroke.modifiers.modified() {
      if !ev.is_held {
        self.ui.space_down = Some(std::time::Instant::now());
        self.ui.space_panned = false;
      }
      cx.stop_propagation();
    } else if ev.keystroke.key == "c" && !ev.keystroke.modifiers.modified() {
      // C crops the one photo selected.
      let one = if self.ui.editing.is_some() {
        self.ui.editor_selected.clone()
      } else if self.ui.selection.len() == 1 {
        self.ui.selection.first().cloned()
      } else {
        None
      };
      if let Some(id) = one {
        self.start_crop(&id, cx);
      }
    }
  }

  fn key_up(&mut self, ev: &KeyUpEvent, cx: &mut Context<Self>) {
    if ev.keystroke.key != "space" {
      return;
    }
    let down = self.ui.space_down.take();
    if let Some(at) = down
      && !self.ui.space_panned
      && at.elapsed() < std::time::Duration::from_millis(400)
    {
      self.quick_look(cx);
    }
  }

  /// Quick Look the selection (on the desk, or the editor's photo).
  fn quick_look(&mut self, cx: &mut Context<Self>) {
    if self.ui.quick_look.is_some() {
      self.ui.quick_look = None;
    } else {
      let ids = if self.ui.editing.is_some() {
        self.ui.editor_selected.iter().cloned().collect()
      } else {
        self.ui.selection.clone()
      };
      if !ids.is_empty() {
        self.ui.quick_look = Some((ids, 0));
      }
    }
    cx.notify();
  }

  pub fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
    self.prefs.sidebar_open = !self.prefs.sidebar_open;
    self.prefs.save();
    cx.notify();
  }

  /// Settings come in the next pass; the button switches the theme meanwhile.
  pub fn cycle_theme(&mut self, cx: &mut Context<Self>) {
    self.prefs.theme = match self.prefs.theme {
      ThemePref::System => ThemePref::Light,
      ThemePref::Light => ThemePref::Dark,
      ThemePref::Dark => ThemePref::System,
    };
    self.prefs.save();
    self.ui.notice = Some(format!(
      "Theme: {}",
      match self.prefs.theme {
        ThemePref::System => "follows the system",
        ThemePref::Light => "light",
        ThemePref::Dark => "dark",
      }
    ));
    cx.notify();
  }

  pub fn tidy(&mut self, cx: &mut Context<Self>) {
    let ids = self.ui.selection.clone();
    let visible = self.visible();
    self.apply(cx, |d| act::tidy_pile(d, &ids, visible));
  }

  pub fn run_menu(&mut self, menu: &ContextMenu, action: MenuAction, cx: &mut Context<Self>) {
    self.ui.context_menu = None;
    let photo = match menu {
      ContextMenu::Photo { photo, .. } => Some(photo.clone()),
      ContextMenu::Desk { .. } => None,
    };
    let targets = match &photo {
      Some(p) if self.ui.selection.contains(p) => self.ui.selection.clone(),
      Some(p) => vec![p.clone()],
      None => Vec::new(),
    };
    let visible = self.visible();
    match action {
      MenuAction::AddPhotos => cx.dispatch_action(&AddPhotos),
      MenuAction::Tidy => self.tidy(cx),
      MenuAction::Fit => self.fit_desk(),
      MenuAction::SelectAll => self.ui.selection = self.project().pile.iter().map(|p| p.photo_id.clone()).collect(),
      MenuAction::DeskColor => {
        let colors = crate::theme::DESK_COLORS;
        let i = colors
          .iter()
          .position(|c| c.1 == self.prefs.desk_color)
          .map_or(0, |i| (i + 1) % colors.len());
        self.prefs.desk_color = colors[i].1;
        self.prefs.save();
        self.ui.notice = Some(format!("Desk color: {}", colors[i].0.to_lowercase()));
      }
      MenuAction::QuickLook => self.ui.quick_look = Some((targets, 0)),
      MenuAction::Duplicate => self.ui.selection = self.duplicate(&targets, cx),
      MenuAction::ToDesk => self.apply(cx, |d| {
        for id in &targets {
          act::put_in_pile(d, id, None, visible);
        }
      }),
      MenuAction::Delete => self.delete_photos(&targets, cx),
    }
    cx.notify();
  }

  // Files.

  pub fn pick_photos(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
    let picked = cx.prompt_for_paths(PathPromptOptions {
      files: true,
      directories: true,
      multiple: true,
      prompt: Some("Add".into()),
    });
    cx.spawn(async move |this, cx| {
      if let Ok(Ok(Some(paths))) = picked.await {
        let _ = this.update(cx, |ws, cx| ws.add_photos(paths, cx));
      }
    })
    .detach();
  }

  /// Files dropped on the window: a project opens; photos are added.
  pub fn files_dropped(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
    if let Some(project) = paths.iter().find(|p| {
      p.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(sequence_core::project_file::is_project_name)
    }) {
      self.open_path(project.clone(), cx);
    } else {
      self.add_photos(paths, cx);
    }
  }

  pub fn pick_project(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
    let picked = cx.prompt_for_paths(PathPromptOptions {
      files: true,
      directories: false,
      multiple: false,
      prompt: Some("Open".into()),
    });
    cx.spawn(async move |this, cx| {
      if let Ok(Ok(Some(paths))) = picked.await
        && let Some(path) = paths.into_iter().next()
      {
        let _ = this.update(cx, |ws, cx| ws.open_path(path, cx));
      }
    })
    .detach();
  }

  /// Open a project file into the window, replacing what's there (which is kept in its
  /// own file, if it has one, or was empty).
  pub fn open_path(&mut self, path: PathBuf, cx: &mut Context<Self>) {
    if !self.keep_current(cx) {
      return;
    }
    self.cancel_drag(cx);
    self.finish_crop(true, cx);
    match self.lib.open_file(&path) {
      Ok(project) => {
        self.history.reset(project);
        self.ui = crate::workspace::Ui::default();
        self.doc.path = Some(path.clone());
        self.doc.saved_revision = self.history.revision();
        self.remember_document(&path);
        self.changed(cx);
      }
      Err(e) => {
        self.ui.notice = Some(e.to_string());
        cx.notify();
      }
    }
  }

  /// Before another project replaces this one: unsaved changes are saved to its file. False
  /// (with a notice) when they can't be: untitled, or the save failed.
  fn keep_current(&mut self, cx: &mut Context<Self>) -> bool {
    if !self.edited() || self.project().photos.is_empty() {
      return true;
    }
    let Some(path) = self.doc.path.clone() else {
      self.ui.notice = Some("Save this project first (⌘S): another project would replace it.".into());
      cx.notify();
      return false;
    };
    match self.lib.save_file(&path, self.project(), &now_iso()) {
      Ok(()) => true,
      Err(e) => {
        self.ui.notice = Some(format!("Couldn’t save the open project, so it’s still open: {e}"));
        cx.notify();
        false
      }
    }
  }

  fn remember_document(&mut self, path: &std::path::Path) {
    self.prefs.document = Some(path.to_path_buf());
    #[cfg(target_os = "macos")]
    {
      self.prefs.document_bookmark = crate::bookmarks::bookmark(path).ok();
    }
    self.prefs.recent.retain(|p| p != path);
    self.prefs.recent.insert(0, path.to_path_buf());
    self.prefs.recent.truncate(10);
    self.prefs.save();
  }

  /// Save to the project's file, or (as, or without one) to a new one.
  pub fn save(&mut self, as_new: bool, _window: &mut Window, cx: &mut Context<Self>) {
    if !as_new && let Some(path) = self.doc.path.clone() {
      self.write_to(path, cx);
      return;
    }
    let dir = self
      .doc
      .path
      .as_ref()
      .and_then(|p| p.parent().map(|d| d.to_path_buf()))
      .or_else(|| std::env::home_dir().map(|h| h.join("Documents")))
      .unwrap_or_default();
    let stem = self
      .doc
      .path
      .as_ref()
      .and_then(|p| p.file_stem())
      .map(|s| s.to_string_lossy().into_owned())
      .unwrap_or_else(|| {
        format!(
          "{}-{}",
          sequence_core::units::terms(self.project().layout.arrangement()).file_stem,
          &now_iso()[..10]
        )
      });
    let picked = cx.prompt_for_new_path(&dir, Some(&format!("{stem}.{PROJECT_EXTENSION}")));
    cx.spawn(async move |this, cx| {
      if let Ok(Ok(Some(path))) = picked.await {
        let _ = this.update(cx, |ws, cx| ws.write_to(path, cx));
      }
    })
    .detach();
  }

  fn write_to(&mut self, path: PathBuf, cx: &mut Context<Self>) {
    let path = if path.extension().is_none() {
      path.with_extension(PROJECT_EXTENSION)
    } else {
      path
    };
    match self.lib.save_file(&path, self.project(), &now_iso()) {
      Ok(()) => {
        self.doc.path = Some(path.clone());
        self.doc.saved_revision = self.history.revision();
        self.remember_document(&path);
        self.prefs.document_edited = false;
        self.prefs.save();
        self.prune_library();
      }
      Err(e) => self.ui.notice = Some(format!("Couldn’t save the project: {e}")),
    }
    cx.notify();
  }

  /// A new, empty project (the current one is kept in its file, if saved).
  pub fn new_project(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
    if !self.keep_current(cx) {
      return;
    }
    self.cancel_drag(cx);
    self.finish_crop(true, cx);
    self.lib.clear();
    self.history.reset(Project::empty());
    self.ui = crate::workspace::Ui::default();
    self.doc = crate::workspace::Document {
      path: None,
      saved_revision: self.history.revision(),
    };
    self.prefs.document = None;
    self.prefs.document_bookmark = None;
    self.prefs.save();
    self.changed(cx);
  }
}

/// Now, as an ISO date (as JavaScript's `toISOString`).
pub fn now_iso() -> String {
  let millis = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map_or(0, |d| d.as_millis() as i64);
  sequence_core::time::iso_from_millis(millis)
}
