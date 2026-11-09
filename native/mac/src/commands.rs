//! Every command, with its shortcut and its place in the menu bar (`src/commands.ts`,
//! `src/platform/macos/menu.ts`), and the document's commands: new, open, save.

use std::path::PathBuf;

use gpui_kit::*;
use sequence_core::Project;
use sequence_core::actions as act;
use sequence_core::project_file::PROJECT_EXTENSION;

use crate::theme::ThemePref;
use crate::workspace::{ContextMenu, Page, Workspace};
use sequence_core::PhotoId;

actions!(
  sequence,
  [
    About,
    OpenSettings,
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
    ShowLayout,
    HideApp,
    HideOthers,
    ShowAll,
    TakeTour,
    OpenGitHub,
  ]
);

use gpui_kit::component::input::{Copy as CopyItems, Cut, Paste as PasteItems};

/// The shortcuts, in the workspace's key context.
pub fn key_bindings() -> Vec<KeyBinding> {
  let w = Some("Workspace");
  vec![
    KeyBinding::new("cmd-q", Quit, None),
    KeyBinding::new("cmd-,", OpenSettings, None),
    KeyBinding::new("cmd-o", OpenProject, None),
    KeyBinding::new("cmd-s", SaveProject, None),
    KeyBinding::new("cmd-shift-s", SaveProjectAs, None),
    KeyBinding::new("cmd-i", AddPhotos, None),
    KeyBinding::new("cmd-z", Undo, None),
    KeyBinding::new("cmd-shift-z", Redo, None),
    KeyBinding::new("cmd-y", Redo, None),
    KeyBinding::new("cmd-a", SelectAll, w),
    KeyBinding::new("cmd-d", Duplicate, w),
    KeyBinding::new("cmd-c", CopyItems, w),
    KeyBinding::new("cmd-v", PasteItems, w),
    KeyBinding::new("alt-cmd-p", ShowLayout, None),
    KeyBinding::new("cmd-h", HideApp, None),
    KeyBinding::new("alt-cmd-h", HideOthers, None),
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

/// What the menu bar's wording follows.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct MenuState {
  pub sidebar_open: bool,
  pub guides_shown: bool,
  pub arrangement: sequence_core::Arrangement,
}

/// The menu bar. macOS titles the first menu with the app's name.
pub fn menus(state: MenuState) -> Vec<Menu> {
  let spreads = sequence_core::units::terms(state.arrangement).spreads;
  let spreads = format!("{}{}", spreads[..1].to_uppercase(), &spreads[1..]);
  vec![
    Menu::new("Sequence").items([
      MenuItem::action("About Sequence", About),
      MenuItem::separator(),
      MenuItem::action("Settings…", OpenSettings),
      MenuItem::separator(),
      MenuItem::os_submenu("Services", SystemMenuType::Services),
      MenuItem::separator(),
      MenuItem::action("Hide Sequence", HideApp),
      MenuItem::action("Hide Others", HideOthers),
      MenuItem::action("Show All", ShowAll),
      MenuItem::separator(),
      MenuItem::action("Quit Sequence", Quit),
    ]),
    Menu::new("File").items([
      MenuItem::action("New Project…", NewProject),
      MenuItem::action("Open…", OpenProject),
      MenuItem::action("Save", SaveProject),
      MenuItem::action("Save As…", SaveProjectAs),
      MenuItem::action("Close Window", CloseWindow),
      MenuItem::separator(),
      MenuItem::action("Add Photos…", AddPhotos),
      MenuItem::separator(),
      MenuItem::action("Export…", ShowExport),
    ]),
    Menu::new("Edit").items([
      MenuItem::action("Undo", Undo),
      MenuItem::action("Redo", Redo),
      MenuItem::separator(),
      MenuItem::action("Cut", Cut),
      MenuItem::action("Copy", CopyItems),
      MenuItem::action("Paste", PasteItems),
      MenuItem::action("Duplicate", Duplicate),
      MenuItem::action("Delete", Delete),
      MenuItem::separator(),
      MenuItem::action("Select All", SelectAll),
    ]),
    Menu::new("View").items([
      MenuItem::action("Desk", ShowDesk),
      MenuItem::action("Preview", ShowPreview),
      MenuItem::action("Export", ShowExport),
      MenuItem::separator(),
      MenuItem::action("Layout…", ShowLayout),
      MenuItem::action(
        if state.guides_shown {
          "Hide Guides"
        } else {
          "Show Guides"
        },
        ToggleGuides,
      ),
      MenuItem::action(
        format!("{} {spreads}", if state.sidebar_open { "Hide" } else { "Show" }),
        ToggleSidebar,
      ),
      MenuItem::separator(),
      MenuItem::action("Tidy Up", Tidy),
      MenuItem::action("Zoom In", ZoomIn),
      MenuItem::action("Zoom Out", ZoomOut),
      MenuItem::action("Zoom to Fit", ZoomToFit),
      MenuItem::separator(),
      MenuItem::action("Enter Full Screen", ToggleFullScreen),
    ]),
    Menu::new("Window").items([MenuItem::action("Minimize", Minimize), MenuItem::action("Zoom", Zoom)]),
    Menu::new("Help").items([
      MenuItem::action("Take the Tour", TakeTour),
      MenuItem::action("Sequence on GitHub", OpenGitHub),
    ]),
  ]
}

/// What a context menu's item does.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MenuAction {
  Tidy,
  DeskColor(u32),
  CustomColor,
  QuickLook,
  Copy,
  Duplicate,
  ToDesk,
  Crop,
  /// Crop to a shape (width / height).
  CropTo(f64),
  ResetCrop,
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
      .on_action(cx.listener(|ws, _: &CopyItems, _, cx| ws.copy_photos(cx)))
      .on_action(cx.listener(|ws, _: &PasteItems, _, cx| {
        if ws.ui.page == Page::Desk {
          ws.paste(cx);
        }
      }))
      .on_action(cx.listener(|ws, _: &ShowLayout, _, cx| {
        if !ws.posting() {
          ws.go_to(Page::Desk, cx);
          ws.open_layout(cx);
        }
      }))
      .on_action(cx.listener(|ws, _: &Delete, _, cx| {
        if ws.desk_keys() {
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
      .on_key_down(cx.listener(|ws, ev: &KeyDownEvent, window, cx| ws.key_down(ev, window, cx)))
      .on_key_up(cx.listener(|ws, ev: &KeyUpEvent, window, cx| ws.key_up(ev, window, cx)))
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

  /// In the Layout view: Esc and Delete work on guides, arrows flip the preview; page
  /// switches close it first.
  pub fn bind_layout_commands(&mut self, root: Stateful<Div>, cx: &mut Context<Self>) -> Stateful<Div> {
    root
      .on_action(cx.listener(|ws, _: &Undo, _, cx| ws.undo(cx)))
      .on_action(cx.listener(|ws, _: &Redo, _, cx| ws.redo(cx)))
      .on_action(cx.listener(|ws, _: &Escape, window, cx| ws.layout_escape(window, cx)))
      .on_action(cx.listener(|ws, _: &Delete, _, cx| ws.remove_selected_guide(cx)))
      .on_action(cx.listener(|ws, _: &NudgeLeft, _, cx| ws.layout_go(-1, cx)))
      .on_action(cx.listener(|ws, _: &NudgeRight, _, cx| ws.layout_go(1, cx)))
      .on_action(
        cx.listener(|ws, _: &ShowPreview, window, cx| {
          ws.close_layout(window, cx, |ws, cx| ws.go_to(Page::Preview, cx))
        }),
      )
      .on_action(
        cx.listener(|ws, _: &ShowExport, window, cx| ws.close_layout(window, cx, |ws, cx| ws.go_to(Page::Export, cx))),
      )
      .on_action(cx.listener(|ws, _: &SaveProject, window, cx| ws.save(false, window, cx)))
      .on_action(cx.listener(|ws, _: &SaveProjectAs, window, cx| ws.save(true, window, cx)))
      .on_action(cx.listener(|ws, _: &ToggleGuides, _, cx| {
        ws.ui.guides_hidden = !ws.ui.guides_hidden;
        cx.notify();
      }))
      .on_action(cx.listener(|_, _: &Minimize, window, _| window.minimize_window()))
      .on_action(cx.listener(|_, _: &Zoom, window, _| window.zoom_window()))
      .on_action(cx.listener(|_, _: &ToggleFullScreen, window, _| window.toggle_fullscreen()))
  }

  /// Arrow keys: in Preview, turn pages; elsewhere nudge.
  fn arrow(&mut self, dx: f64, dy: f64, big: bool, cx: &mut Context<Self>) {
    // Quick Look browses its photos; a menu takes nothing.
    if let Some((ids, i)) = &mut self.ui.quick_look {
      let step = if dx != 0.0 { dx } else { dy } as isize;
      *i = (*i as isize + step).clamp(0, ids.len() as isize - 1) as usize;
      self.ui.ql = Default::default();
      cx.notify();
      return;
    }
    if self.ui.context_menu.is_some() {
      return;
    }
    if self.touring() && dy == 0.0 && dx != 0.0 && self.ui.page != Page::Preview {
      let step = self.tour.as_ref().map_or(0, |t| t.step) as isize + dx as isize;
      self.tour_go(step.max(0) as usize, cx);
      return;
    }
    match self.ui.page {
      Page::Preview => {
        if dx != 0.0 {
          self.preview_go(dx as isize, cx);
        } else if dy != 0.0 {
          self.preview_go(dy as isize, cx);
        }
      }
      Page::Desk => self.nudge(dx, dy, big, cx),
      Page::Export => {
        if dx != 0.0 {
          self.page_export(dx as isize, cx);
        }
      }
    }
  }

  /// Escape: end a gesture, close what's open, or clear the selection.
  fn escape(&mut self, window: &mut Window, cx: &mut Context<Self>) {
    if self.cancel_drag(cx) || self.cancel_tag(cx) {
      return;
    }
    if self.touring() {
      self.end_tour(cx);
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
  /// Keys the workspace handles itself (not as actions), only while it has the keyboard:
  /// none of them while a text field does.
  fn key_down(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
    // Any key but ⌘ itself hides the shortcut badges.
    if self.ui.hints {
      self.ui.hints = false;
      self.ui.hint_press += 1;
      cx.notify();
    }
    if !self.focus.is_focused(window) {
      return;
    }
    let key = ev.keystroke.key.as_str();
    let m = ev.keystroke.modifiers;
    let plain = !m.modified();
    if self.ui.page == Page::Preview && self.ui.quick_look.is_none() {
      // Space, Page Down and Up, Home and End turn pages; F goes fullscreen.
      let total = self.project().layout.all().len() as isize;
      match key {
        "space" if !m.platform && !m.control && !m.alt => {
          self.preview_go(if m.shift { -1 } else { 1 }, cx);
        }
        "pagedown" => self.preview_go(1, cx),
        "pageup" => self.preview_go(-1, cx),
        "home" => self.preview_go(-total, cx),
        "end" => self.preview_go(total, cx),
        "f" if plain => {
          let on = !self.ui.presenting;
          self.present(on, window, cx);
        }
        _ => return,
      }
      cx.stop_propagation();
      return;
    }
    if key == "space" && plain {
      if !ev.is_held {
        self.ui.space_down = Some(std::time::Instant::now());
        self.ui.space_panned = false;
      }
      cx.stop_propagation();
    } else if key == "c" && plain && self.desk_keys() {
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

  /// Whether the desk's (and the editor's) keys act: on the desk, with nothing over it.
  pub fn desk_keys(&self) -> bool {
    self.ui.page == Page::Desk
      && self.ui.quick_look.is_none()
      && self.ui.context_menu.is_none()
      && self.ui.layout.is_none()
      && self.ui.cropping.is_none()
  }

  fn key_up(&mut self, ev: &KeyUpEvent, window: &mut Window, cx: &mut Context<Self>) {
    if ev.keystroke.key != "space" || !self.focus.is_focused(window) {
      return;
    }
    let down = self.ui.space_down.take();
    if let Some(at) = down
      && !self.ui.space_panned
      && at.elapsed() < std::time::Duration::from_millis(400)
      && (self.ui.page == Page::Desk || self.ui.quick_look.is_some())
    {
      self.quick_look(cx);
    }
  }

  /// Quick Look the selection (on the desk, or the editor's photo).
  fn quick_look(&mut self, cx: &mut Context<Self>) {
    self.ui.ql = Default::default();
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

  /// The app's theme (Settings).
  pub fn set_theme(&mut self, theme: ThemePref, cx: &mut Context<Self>) {
    self.prefs.theme = theme;
    self.prefs.save();
    cx.notify();
  }

  /// The desk's color (Settings, and the desk's menu).
  pub fn set_desk_color(&mut self, color: u32, cx: &mut Context<Self>) {
    self.prefs.desk_color = color & 0xff_ffff;
    self.prefs.save();
    cx.notify();
  }

  pub fn set_status_bar(&mut self, on: bool, cx: &mut Context<Self>) {
    self.prefs.status_bar = on;
    self.prefs.save();
    cx.notify();
  }

  /// The server for posting to Instagram ("" for Sequence's).
  pub fn set_server_url(&mut self, url: String, cx: &mut Context<Self>) {
    self.prefs.server_url = if url == crate::config::server_url() {
      String::new()
    } else {
      url
    };
    self.prefs.save();
    cx.notify();
  }

  pub fn set_shortcut_badges(&mut self, on: bool, cx: &mut Context<Self>) {
    self.prefs.shortcut_badges = on;
    self.prefs.save();
    cx.notify();
  }

  pub fn tidy(&mut self, cx: &mut Context<Self>) {
    let ids = self.ui.selection.clone();
    let visible = self.visible();
    self.apply(cx, |d| act::tidy_pile(d, &ids, visible));
  }

  pub fn run_menu(&mut self, menu: &ContextMenu, action: MenuAction, window: &mut Window, cx: &mut Context<Self>) {
    self.ui.context_menu = None;
    self.ui.menu_sub = false;
    let photo = match menu {
      ContextMenu::Photo { photo, .. } => Some(photo.clone()),
      ContextMenu::Desk { .. } => None,
    };
    let name = photo
      .as_ref()
      .and_then(|p| self.project().photos.get(p))
      .map_or("Photo".to_string(), |m| m.name.clone());
    let one: Vec<PhotoId> = photo.iter().cloned().collect();
    let visible = self.visible();
    match action {
      MenuAction::Tidy => self.tidy(cx),
      MenuAction::DeskColor(c) => self.set_desk_color(c, cx),
      MenuAction::CustomColor => window.dispatch_action(Box::new(OpenSettings), cx),
      MenuAction::QuickLook => self.ui.quick_look = Some((one, 0)),
      MenuAction::Copy => {
        let keep = std::mem::take(&mut self.ui.selection);
        let editor = self.ui.editor_selected.take();
        let editing = self.ui.editing.take();
        self.ui.selection = one;
        self.copy_photos(cx);
        (self.ui.selection, self.ui.editor_selected, self.ui.editing) = (keep, editor, editing);
        self.ui.notice = Some(format!("Copied {name}"));
      }
      MenuAction::Duplicate => {
        let made = self.duplicate(&one, cx);
        let on_desk: Vec<PhotoId> = made
          .into_iter()
          .filter(|id| self.project().pile.iter().any(|p| &p.photo_id == id))
          .collect();
        if !on_desk.is_empty() {
          self.ui.selection = on_desk;
        }
      }
      MenuAction::ToDesk => self.apply(cx, |d| {
        for id in &one {
          act::put_in_pile(d, id, None, visible);
        }
      }),
      MenuAction::Crop => {
        if let Some(p) = &photo {
          self.crop_anywhere(p, cx);
        }
      }
      MenuAction::CropTo(ratio) => {
        if let Some(p) = &photo
          && let Some(meta) = self.project().photos.get(p).cloned()
        {
          let crop = sequence_core::crop::crop_to_ratio(&meta, ratio);
          self.apply(cx, |d| act::set_crop(d, p, crop));
        }
      }
      MenuAction::ResetCrop => {
        if let Some(p) = &photo {
          self.apply(cx, |d| act::set_crop(d, p, None));
        }
      }
      MenuAction::Delete => {
        self.delete_photos(&one, cx);
        self.ui.notice = Some(format!("Deleted {name}. Undo to bring it back."));
      }
    }
    cx.notify();
  }

  /// A photo's context menu, at the pointer.
  pub fn photo_menu(&mut self, photo: PhotoId, ev: &MouseDownEvent, cx: &mut Context<Self>) {
    if self.ui.cropping.is_some() {
      return;
    }
    self.ui.menu_sub = false;
    self.ui.context_menu = Some(ContextMenu::Photo {
      x: f64::from(ev.position.x),
      y: f64::from(ev.position.y),
      photo,
    });
    cx.notify();
  }

  /// Crop mode on a photo: on the desk where it is, or for one on a page, in its spread's editor.
  pub fn crop_anywhere(&mut self, photo: &PhotoId, cx: &mut Context<Self>) {
    match act::locate(self.project(), photo) {
      Some((act::Location::Desk, _)) => {
        self.ui.editing = None;
        self.start_crop(photo, cx);
      }
      Some((act::Location::Spread(s), _)) => {
        self.open_editor(s, cx);
        self.ui.editor_selected = Some(photo.clone());
        self.start_crop(photo, cx);
      }
      None => {}
    }
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

  /// Open a project file into the window, replacing what's there (after asking, when
  /// that has changes that aren't in a file).
  pub fn open_path(&mut self, path: PathBuf, cx: &mut Context<Self>) {
    if self.posting() {
      return;
    }
    self.leave_tour(cx);
    let name = path
      .file_name()
      .map(|n| n.to_string_lossy().into_owned())
      .unwrap_or_default();
    self.confirm_replace(
      "Replace your current project?",
      format!("“{name}”"),
      "Replace",
      cx,
      move |ws, cx| ws.open_now(path, cx),
    );
  }

  fn open_now(&mut self, path: PathBuf, cx: &mut Context<Self>) {
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

  /// Whether the project is safe in its file (or empty), so replacing it loses nothing.
  pub fn project_is_safe(&self) -> bool {
    self.project().photos.is_empty() || (self.doc.path.is_some() && !self.edited())
  }

  /// Ask a question in a sheet on the main window, then hear which answer was picked.
  pub fn ask(
    &mut self,
    title: String,
    detail: String,
    answers: Vec<&'static str>,
    cx: &mut Context<Self>,
    then: impl FnOnce(&mut Self, usize, &mut Context<Self>) + 'static,
  ) {
    let Some(handle) = self.window_handle else { return };
    let this = cx.entity().downgrade();
    // Deferred: the window may be busy with the event that asked.
    cx.defer(move |cx| {
      let Ok(answer) = handle.update(cx, |_, window, cx| {
        window.prompt(PromptLevel::Info, &title, Some(&detail), &answers, cx)
      }) else {
        return;
      };
      cx.spawn(async move |cx| {
        if let Ok(i) = answer.await {
          let _ = this.update(cx, |ws, cx| then(ws, i, cx));
        }
      })
      .detach();
    });
  }

  /// Before another project replaces this one (`confirmReplace`): go ahead when it's safe in
  /// its file; otherwise ask to replace it, save it first, or cancel.
  fn confirm_replace(
    &mut self,
    title: &str,
    what: String,
    label: &'static str,
    cx: &mut Context<Self>,
    then: impl FnOnce(&mut Self, &mut Context<Self>) + 'static,
  ) {
    if self.project_is_safe() {
      then(self, cx);
      return;
    }
    let n = self.project().photos.len();
    let detail = format!(
      "{what} will replace the project you’re working on ({n} photo{}). Changes that aren’t saved to its file will be lost. To keep them, save first.",
      if n == 1 { "" } else { "s" }
    );
    self.ask(
      title.into(),
      detail,
      vec![label, "Save First", "Cancel"],
      cx,
      move |ws, i, cx| match i {
        0 => then(ws, cx),
        1 => ws.save_then(false, cx, then),
        _ => {}
      },
    );
  }

  /// The window's name for the project: its file's, or Untitled.
  pub fn document_name(&self) -> String {
    self
      .doc
      .path
      .as_ref()
      .and_then(|p| p.file_stem())
      .map_or("Untitled".into(), |s| s.to_string_lossy().into_owned())
  }

  /// Quit, or close the main window: first asking to save changes that aren't in a file.
  pub fn request_quit(&mut self, cx: &mut Context<Self>) {
    // Mid-tour, the sample project is showing: bring back the user's before judging it.
    self.leave_tour(cx);
    let quit = |ws: &mut Self, cx: &mut Context<Self>| {
      ws.save_to_library();
      cx.quit();
    };
    if self.project_is_safe() {
      quit(self, cx);
      return;
    }
    self.ask(
      format!("Save changes to “{}”?", self.document_name()),
      "Unsaved changes are kept in the app for next time, but they’re only safe once they’re in a file.".into(),
      vec!["Save", "Don’t Save", "Cancel"],
      cx,
      move |ws, i, cx| match i {
        0 => ws.save_then(false, cx, quit),
        1 => quit(ws, cx),
        _ => {}
      },
    );
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
    self.save_then(as_new, cx, |_, _| {});
  }

  /// Save (to its file, or one chosen), then carry on if it saved.
  pub fn save_then(
    &mut self,
    as_new: bool,
    cx: &mut Context<Self>,
    then: impl FnOnce(&mut Self, &mut Context<Self>) + 'static,
  ) {
    self.leave_tour(cx);
    if !as_new && let Some(path) = self.doc.path.clone() {
      if self.write_to(path, cx) {
        then(self, cx);
      }
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
        let _ = this.update(cx, |ws, cx| {
          if ws.write_to(path, cx) {
            then(ws, cx);
          }
        });
      }
    })
    .detach();
  }

  /// Save to a file; whether it worked.
  fn write_to(&mut self, path: PathBuf, cx: &mut Context<Self>) -> bool {
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
        cx.notify();
        true
      }
      Err(e) => {
        self.ui.notice = Some(format!("Couldn’t save the project: {e}"));
        cx.notify();
        false
      }
    }
  }

  /// A new, empty project (after asking, when this one's changes aren't in a file).
  pub fn new_project(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
    if self.posting() {
      return;
    }
    self.leave_tour(cx);
    self.confirm_replace(
      "Start a new project?",
      "A new project".into(),
      "New Project",
      cx,
      |ws, cx| ws.new_now(cx),
    );
  }

  fn new_now(&mut self, cx: &mut Context<Self>) {
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

/// The local time of day, as "18:23".
pub fn local_time_hm() -> String {
  #[cfg(target_os = "macos")]
  {
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map_or(0, |d| d.as_secs() as libc::time_t);
    // SAFETY: localtime_r fills the tm it's given from a valid time.
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    if !unsafe { libc::localtime_r(&now, &mut tm) }.is_null() {
      return format!("{:02}:{:02}", tm.tm_hour, tm.tm_min);
    }
  }
  now_iso()[11..16].to_string()
}

/// How long ⌘ is held before the shortcut badges show.
const HINT_DELAY: std::time::Duration = std::time::Duration::from_millis(250);

impl Workspace {
  /// ⌘ alone, held a moment: the shortcut badges (unless turned off in Settings). Anything
  /// else hides them.
  pub fn modifiers_changed(&mut self, m: Modifiers, cx: &mut Context<Self>) {
    self.ui.hint_press += 1;
    self.ui.hints = false;
    let alone = m.platform && !m.shift && !m.alt && !m.control && !m.function;
    if !alone || !self.prefs.shortcut_badges {
      return;
    }
    let press = self.ui.hint_press;
    cx.spawn(async move |this, cx| {
      cx.background_executor().timer(HINT_DELAY).await;
      let _ = this.update(cx, |ws, cx| {
        if ws.ui.hint_press == press && ws.ui.cmd_held {
          ws.ui.hints = true;
          cx.notify();
        }
      });
    })
    .detach();
  }
}
