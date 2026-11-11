//! The window: the project with its history, the photos' library, and what the window
//! shows (the web app's `ui.ts`). The views draw from it (`views/`); pointer gestures are
//! worked out here, in window pixels, against the places the last frame drew things
//! (`Frames`), as the web app's `hitTest` does against the DOM.
//!
//! Split by concern: `frames` (where things were drawn, and what's under a point),
//! `gestures` (presses, drags, releases), and `navigation` (scrolling, zooming, the editor).

mod frames;
pub mod gestures;
mod navigation;

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Instant;

use gpui_kit::*;
use sequence_core::actions::{self as act, DropTarget, PhotoCopy};
use sequence_core::desk::{DeskView, view_to_fit};
use sequence_core::geometry::{GuideLines, Rect};
use sequence_core::store::History;
use sequence_core::units::units;
use sequence_core::{PhotoId, Project, SpreadId};

pub use frames::{Cell, EditorFrame, Frames};
pub use gestures::{Drag, SNAP_PX, Source, Surface};

use crate::crop::Cropping;
use crate::fields::Fields;
use crate::layout::LayoutState;
use crate::library::{Imported, Library, is_image_name};
use crate::prefs::Prefs;
use crate::theme::{Theme, desk_is_light};
use sequence_core::page_setup::PageRun;

/// Under the toolbar: the desk, Preview, or Export.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
  Desk,
  Preview,
  Export,
}

/// The dialogs over a page (to come: Settings, About).
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Modal {
  Settings,
  About,
}

/// A right-click menu, where it opened.
#[derive(Clone, Debug, PartialEq)]
pub enum ContextMenu {
  Desk { x: f64, y: f64 },
  Photo { x: f64, y: f64, photo: PhotoId },
}

/// A photo following the pointer while it's dragged off its place.
#[derive(Clone, Debug)]
pub struct Ghost {
  pub photo: PhotoId,
  pub count: usize,
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
}

/// What the window shows that isn't the project (selection, pages, the desk's view).
pub struct Ui {
  pub selection: Vec<PhotoId>,
  pub spread_selection: Vec<SpreadId>,
  pub spread_anchor: Option<SpreadId>,
  pub editing: Option<SpreadId>,
  pub editor_selected: Option<PhotoId>,
  pub editor_view: DeskView,
  pub page: Page,
  pub modal: Option<Modal>,
  pub view: DeskView,
  pub sidebar_scroll: f64,
  pub strip_scroll: f64,
  pub hover: Option<DropTarget>,
  pub hover_photo: Option<PhotoId>,
  pub notice: Option<String>,
  pub guides_hidden: bool,
  pub marquee: Option<Rect>,
  pub snap_hit: Option<GuideLines>,
  pub ghost: Option<Ghost>,
  pub reorder: Option<(Vec<SpreadId>, usize)>,
  pub preview_index: usize,
  pub presenting: bool,
  /// Presenting has reached fullscreen (so leaving fullscreen ends it).
  pub presented_full: bool,
  /// When the pointer last moved over the presentation (its controls show a moment after).
  pub preview_moved: Option<Instant>,
  pub quick_look: Option<(Vec<PhotoId>, usize)>,
  /// Quick Look's view (actual pixels, panned, a press under way).
  pub ql: QuickLookView,
  /// The window's pixels per point, as last drawn.
  pub scale_factor: f64,
  pub context_menu: Option<ContextMenu>,
  /// Files dragged over the desk include a project (so dropping opens it).
  pub file_drop_project: bool,
  /// Photos being added: how many done, of how many.
  pub import_progress: Option<(usize, usize)>,
  /// The Layout view's tab, as last left.
  pub layout_tab: crate::layout::LayoutTab,
  /// Quit was asked for while work was under way: it happens once that's done.
  pub quit_waiting: bool,
  /// The last save to the app's storage failed.
  pub save_failed: bool,
  /// The status bar's zoom menu is open.
  pub zoom_menu: bool,
  /// The notice a timer's been started for.
  pub notice_timed: Option<String>,
  /// The context menu's Crop to submenu is open.
  pub menu_sub: bool,
  pub busy: Option<String>,
  pub hint: Option<String>,
  pub space_down: Option<Instant>,
  pub space_panned: bool,
  pub cmd_held: bool,
  /// Shortcut badges showing (⌘ held a moment).
  pub hints: bool,
  /// Counts ⌘ presses, so a badge timer from an earlier press does nothing.
  pub hint_press: u64,
  pub fitted_once: bool,
  pub cropping: Option<Cropping>,
  /// The Layout view, while it's open, and the label beside a guide being dragged.
  pub layout: Option<LayoutState>,
  pub guide_label: Option<(String, f64, f64)>,
  /// The Export page's own state.
  pub export: crate::export::ExportUi,
  /// The editor's Keep proportions, and the box a hovered Fit button means (spread units).
  pub keep_proportions: bool,
  pub fit_glow: Option<Rect>,
}

impl Default for Ui {
  fn default() -> Self {
    Self {
      selection: Vec::new(),
      spread_selection: Vec::new(),
      spread_anchor: None,
      editing: None,
      editor_selected: None,
      editor_view: FITTED,
      page: Page::Desk,
      modal: None,
      view: DeskView::default(),
      sidebar_scroll: 0.0,
      strip_scroll: 0.0,
      hover: None,
      hover_photo: None,
      notice: None,
      guides_hidden: false,
      marquee: None,
      snap_hit: None,
      ghost: None,
      reorder: None,
      preview_index: 0,
      presenting: false,
      presented_full: false,
      preview_moved: None,
      quick_look: None,
      ql: QuickLookView::default(),
      scale_factor: 2.0,
      context_menu: None,
      menu_sub: false,
      import_progress: None,
      zoom_menu: false,
      save_failed: false,
      quit_waiting: false,
      layout_tab: crate::layout::LayoutTab::Page,
      notice_timed: None,
      file_drop_project: false,
      busy: None,
      hint: None,
      space_down: None,
      space_panned: false,
      cmd_held: false,
      hints: false,
      hint_press: 0,
      fitted_once: false,
      cropping: None,
      layout: None,
      guide_label: None,
      export: Default::default(),
      keep_proportions: true,
      fit_glow: None,
    }
  }
}

type Point2 = (f64, f64);

/// Quick Look's view of its photo.
#[derive(Clone, Copy, Debug, Default)]
pub struct QuickLookView {
  pub zoomed: bool,
  pub pan: (f64, f64),
  /// A press on the image: where, the pan then, and whether it's moved.
  pub drag: Option<(Point2, Point2, bool)>,
}

/// The editor's stage fitting the spread, unpanned.
pub const FITTED: DeskView = DeskView {
  zoom: 1.0,
  pan_x: 0.0,
  pan_y: 0.0,
};

/// The open document: its file, and the revision last saved there.
#[derive(Default)]
pub struct Document {
  pub path: Option<PathBuf>,
  pub saved_revision: u64,
  /// Bumped when another project replaces this one, so a save that finishes after can
  /// tell the project it saved is gone.
  pub generation: u64,
}

pub struct Workspace {
  pub history: History,
  pub lib: Library,
  pub ui: Ui,
  pub prefs: Prefs,
  pub doc: Document,
  pub drag: Option<Drag>,
  pub frames: Frames,
  pub focus: FocusHandle,
  /// The Layout view's run of page changes, and the number fields' inputs.
  pub page_run: PageRun,
  pub fields: Fields,
  /// Instagram: the account, signing in, and the post being written.
  pub ig: crate::posting::InstagramUi,
  /// The library's project is from a newer version: nothing else shows, and nothing's saved.
  pub outdated: bool,
  /// The tour, while it runs (with the user's work set aside).
  pub tour: Option<crate::tour::Tour>,
  /// Photos copied with ⌘C.
  pub copied: crate::clipboard::Copied,
  /// Whether the components were last given the dark theme.
  pub component_theme: Option<bool>,
  /// The menu bar's wording, as last set.
  pub menu_state: Option<crate::commands::MenuState>,
  /// The main window, for asking questions in it.
  pub window_handle: Option<AnyWindowHandle>,
  saved_to_library: u64,
  /// A save to the library is coming (saves wait a moment, so held keys don't write each step).
  save_scheduled: bool,
  /// A change outside undo is waiting for the library's save.
  unsaved_silent: bool,
  /// Imports under way, and finished ones waiting for a gesture to end.
  importing: usize,
  imported: Vec<Imported>,
}

/// Milliseconds since the app started, for coalescing changes in the history.
pub fn now_ms() -> f64 {
  static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
  START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

/// How long the library's save waits after a change.
const SAVE_DELAY: std::time::Duration = std::time::Duration::from_millis(300);

impl Workspace {
  pub fn new(lib: Library, prefs: Prefs, cx: &mut Context<Self>) -> Self {
    let mut newer = false;
    let (project, unreadable) = match lib.load_project() {
      Ok(p) => (p.unwrap_or_else(Project::empty), None),
      Err(crate::library::Unloadable::SetAside(aside)) => (Project::empty(), Some(aside)),
      Err(crate::library::Unloadable::Newer) => {
        newer = true;
        (Project::empty(), None)
      }
    };
    let mut ws = Self {
      history: History::new(project),
      lib,
      ui: Ui::default(),
      prefs,
      doc: Document::default(),
      drag: None,
      frames: Frames::default(),
      focus: cx.focus_handle(),
      page_run: PageRun::default(),
      fields: Fields::default(),
      ig: crate::posting::InstagramUi {
        connection: crate::instagram::load_connection(),
        ..Default::default()
      },
      window_handle: None,
      menu_state: None,
      component_theme: None,
      tour: None,
      outdated: false,
      copied: Default::default(),
      saved_to_library: 0,
      save_scheduled: false,
      unsaved_silent: false,
      importing: 0,
      imported: Vec::new(),
    };
    let unreadable_aside = unreadable.is_some();
    if let Some(aside) = unreadable {
      ws.ui.notice = Some(format!(
        "The last project couldn’t be read, so it was kept aside as {}.",
        aside
          .file_name()
          .map(|n| n.to_string_lossy().into_owned())
          .unwrap_or_default()
      ));
    }
    ws.outdated = newer;
    // The file is this project's only if the project could be read.
    ws.doc.path = if unreadable_aside {
      None
    } else {
      ws.prefs.document.clone()
    };
    ws.doc.saved_revision = if ws.prefs.document_edited { u64::MAX } else { 0 };
    ws
  }

  /// What the window shows, as new (for another project).
  pub fn reset_ui(&mut self) {
    // The window's scale and the Layout view's tab aren't the project's.
    let (scale_factor, layout_tab) = (self.ui.scale_factor, self.ui.layout_tab);
    self.ui = Ui {
      scale_factor,
      layout_tab,
      ..Ui::default()
    };
  }

  pub fn project(&self) -> &Project {
    self.history.project()
  }

  pub fn theme(&self, window: &Window) -> Theme {
    Theme::for_appearance(window.appearance(), self.prefs.theme)
  }

  /// Whether the desk's color wants dark text on it.
  pub fn desk_light(&self) -> bool {
    desk_is_light(self.prefs.desk_color)
  }

  /// Whether there are unsaved changes (for the title and closing).
  pub fn edited(&self) -> bool {
    self.history.revision() != self.doc.saved_revision
  }

  /// The visible desk, in desk inches.
  pub fn visible(&self) -> Rect {
    self
      .ui
      .view
      .visible(self.frames.desk.w.max(1.0), self.frames.desk.h.max(1.0))
  }

  /// After any change: keep the project in the library (so it survives a quit), drop
  /// selections of things that went away, and redraw.
  pub fn changed(&mut self, cx: &mut Context<Self>) {
    let project = self.history.project();
    self.ui.selection.retain(|id| project.photos.contains_key(id));
    // Quick Look closes when its photo goes away (an undo, say).
    if let Some((ids, i)) = &self.ui.quick_look
      && ids.get(*i).is_none_or(|id| !project.photos.contains_key(id))
    {
      self.ui.quick_look = None;
    }
    self.ui.spread_selection.retain(|id| project.find_spread(id).is_some());
    if let Some(id) = &self.ui.editing
      && project.find_spread(id).is_none()
    {
      self.ui.editing = None;
    }
    if !self.history.in_gesture() {
      // Imports that finished mid-gesture land now.
      for imported in std::mem::take(&mut self.imported) {
        self.place_imported(imported);
      }
      if self.saved_to_library != self.history.revision() {
        self.schedule_save(cx);
      }
    }
    cx.notify();
  }

  /// Save to the library a moment from now (held keys and typing don't write each step).
  /// Changes outside undo (the Export page's choices) count too.
  pub fn schedule_save(&mut self, cx: &mut Context<Self>) {
    self.unsaved_silent = true;
    if self.save_scheduled {
      return;
    }
    self.save_scheduled = true;
    cx.spawn(async move |this, cx| {
      cx.background_executor().timer(SAVE_DELAY).await;
      let _ = this.update(cx, |ws, _| ws.save_to_library());
    })
    .detach();
  }

  /// Keep the project in the library now (if it changed, and no gesture is under way).
  pub fn save_to_library(&mut self) {
    self.save_scheduled = false;
    // The tour's sample project is never kept, nor anything over a newer version's project.
    if self.tour.is_some()
      || self.outdated
      || self.history.in_gesture()
      || (self.saved_to_library == self.history.revision() && !self.unsaved_silent)
    {
      return;
    }
    self.unsaved_silent = false;
    self.saved_to_library = self.history.revision();
    // Until a save works again, a bar offers to save to a file instead.
    self.ui.save_failed = self.lib.save_project(self.history.project()).is_err();
    self.prefs.document_edited = self.edited();
    self.prefs.save();
  }

  /// Make a change as one undo step.
  pub fn apply(&mut self, cx: &mut Context<Self>, recipe: impl FnOnce(&mut Project)) {
    self.history.apply(recipe);
    self.changed(cx);
  }

  /// Make a change that joins the last one with the same key, if it was just now.
  pub fn apply_coalesced(&mut self, key: &str, cx: &mut Context<Self>, recipe: impl FnOnce(&mut Project)) {
    self.history.apply_with(Some((key, now_ms())), recipe);
    self.changed(cx);
  }

  pub fn undo(&mut self, cx: &mut Context<Self>) {
    self.cancel_drag(cx);
    self.history.undo();
    self.changed(cx);
  }

  pub fn redo(&mut self, cx: &mut Context<Self>) {
    self.cancel_drag(cx);
    self.history.redo();
    self.changed(cx);
  }

  /// Zoom the desk to show every photo on it (or reset it, with none).
  pub fn fit_desk(&mut self) {
    let d = &self.frames.desk;
    self.ui.view = match act::pile_bounds(self.project()) {
      Some(b) => view_to_fit(b, d.w, d.h),
      None => DeskView::default(),
    };
  }

  /// Zoom the desk about its center.
  pub fn zoom_desk(&mut self, factor: f64) {
    let d = &self.frames.desk;
    let z = sequence_core::desk::clamp(
      self.ui.view.zoom * factor,
      sequence_core::desk::MIN_ZOOM,
      sequence_core::desk::MAX_ZOOM,
    );
    self.ui.view = self.ui.view.zoomed_around(z, d.w / 2.0, d.h / 2.0);
  }

  /// Add photos from files: decoded in the background, then put on the desk in a grid.
  pub fn add_photos(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
    if self.outdated {
      return;
    }
    // The tour ends first (once nothing's working on its sample), so they're the user's.
    if self.touring() && self.is_working() {
      self.when_quiet(cx, move |ws, cx| ws.add_photos(paths, cx));
      return;
    }
    self.leave_tour(cx);
    let files: Vec<PathBuf> = expand(paths)
      .into_iter()
      .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(is_image_name))
      .collect();
    if files.is_empty() {
      return;
    }
    self.ui.import_progress = Some((0, files.len()));
    cx.notify();
    let dir = self.lib.dir.clone();
    let epoch = self.lib.epoch;
    self.importing += 1;
    let (tx, mut rx) = futures::channel::mpsc::unbounded::<(usize, usize)>();
    let task = cx.background_executor().spawn(async move {
      crate::library::import_files(&dir, &files, |done, total| {
        let _ = tx.unbounded_send((done, total));
      })
    });
    cx.spawn(async move |this, cx| {
      use futures::StreamExt;
      while let Some(p) = rx.next().await {
        let _ = this.update(cx, |ws, cx| {
          if ws.importing == 1 {
            ws.ui.import_progress = Some(p);
            cx.notify();
          }
        });
      }
      let imported = task.await;
      let _ = this.update(cx, |ws, cx| {
        ws.importing -= 1;
        if ws.importing == 0 {
          ws.ui.import_progress = None;
        }
        if ws.lib.epoch != epoch {
          // Another project opened meanwhile: these photos were for the one before.
          ws.lib.discard(imported.photos.into_iter().map(|p| p.id));
          cx.notify();
          return;
        }
        ws.imported.push(imported);
        ws.changed(cx);
      });
    })
    .detach();
  }

  /// Whether anything that mustn't overlap a save, an open, or a new project is under way:
  /// a save, open, export or import (`ui.busy`, imports).
  pub fn is_working(&self) -> bool {
    self.ui.busy.is_some() || self.is_importing()
  }

  /// Run `f` once nothing's working (now, if nothing is): one thing at a time.
  pub fn when_quiet(&mut self, cx: &mut Context<Self>, f: impl FnOnce(&mut Self, &mut Context<Self>) + 'static) {
    if !self.is_working() {
      f(self, cx);
      return;
    }
    cx.spawn(async move |this, cx| {
      cx.background_executor()
        .timer(std::time::Duration::from_millis(200))
        .await;
      let _ = this.update(cx, |ws, cx| ws.when_quiet(cx, f));
    })
    .detach();
  }

  /// Whether photos are being read in.
  pub fn is_importing(&self) -> bool {
    self.importing > 0
  }

  /// Make `count` test images (Settings → Advanced) and add them like any photos. Not while
  /// photos are being added.
  #[cfg(target_os = "macos")]
  pub fn add_test_images(&mut self, count: usize, cx: &mut Context<Self>) {
    use sequence_core::test_images::{MAX_TEST_IMAGES, Rng, gradient_image, test_image_name};
    if self.importing > 0 || !(1..=MAX_TEST_IMAGES).contains(&count) {
      return;
    }
    self.ui.busy = Some("Making test images…".into());
    self.importing += 1;
    cx.notify();
    let dir = std::env::temp_dir().join(format!("Sequence test images {}", now_ms()));
    let seed = now_ms() as u64;
    let task = cx.background_executor().spawn(async move {
      std::fs::create_dir_all(&dir).ok()?;
      let mut rng = Rng::new(seed);
      let mut paths = Vec::with_capacity(count);
      for i in 1..=count {
        let img = gradient_image(&mut rng);
        let jpeg = crate::imageio::encode_jpeg(&img.rgb, img.width, img.height, 0.9)?;
        let path = dir.join(test_image_name(i, count));
        std::fs::write(&path, jpeg).ok()?;
        paths.push(path);
      }
      Some(paths)
    });
    cx.spawn(async move |this, cx| {
      let paths = task.await;
      let _ = this.update(cx, |ws, cx| {
        ws.importing -= 1;
        ws.ui.busy = None;
        match paths {
          Some(paths) => ws.add_photos(paths, cx),
          None => {
            ws.ui.notice = Some("Couldn’t make the test images.".into());
            cx.notify();
          }
        }
      });
    })
    .detach();
  }

  /// Put photos just read on the desk, in a grid, and show them.
  fn place_imported(&mut self, imported: Imported) {
    let visible = self.visible();
    let mut bounds = None;
    self
      .history
      .apply(|d| bounds = act::add_photos_to_pile(d, imported.photos, visible));
    if let Some(b) = bounds {
      let desk = &self.frames.desk;
      self.ui.view = view_to_fit(b, desk.w, desk.h);
    }
    if !imported.failed.is_empty() {
      let n = imported.failed.len();
      let names = imported.failed.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
      self.ui.notice = Some(format!(
        "Couldn’t read {n} file{}: {names}{}",
        if n > 1 { "s" } else { "" },
        if n > 3 { "…" } else { "" }
      ));
    }
  }

  /// Copy duplicated photos' files, once the project refers to them.
  pub fn store_copies(&mut self, copies: &[PhotoCopy]) {
    let failed: Vec<PhotoId> = copies
      .iter()
      .filter(|c| !self.lib.copy(&c.from, &c.id))
      .map(|c| c.id.clone())
      .collect();
    if !failed.is_empty() {
      // A copy without its file can't be saved: take it back out.
      self.history.silent(|d| act::delete_photos(d, &failed));
      self.ui.notice = Some("Couldn’t copy a photo in the app’s storage.".into());
    }
  }

  /// Duplicate photos: new, independent photos, down and right of the originals.
  pub fn duplicate(&mut self, ids: &[PhotoId], cx: &mut Context<Self>) -> Vec<PhotoId> {
    self.duplicate_by(ids, act::DUPLICATE_OFFSET, cx)
  }

  /// Copies of photos, `offset` inches from them (on a page, at the same spot).
  pub fn duplicate_by(&mut self, ids: &[PhotoId], offset: f64, cx: &mut Context<Self>) -> Vec<PhotoId> {
    let ids: Vec<PhotoId> = ids
      .iter()
      .filter(|id| self.project().photos.contains_key(*id))
      .cloned()
      .collect();
    if ids.is_empty() {
      return ids;
    }
    let copies = act::copies_of(&ids);
    self.store_copies(&copies);
    let visible = self.visible();
    self.apply(cx, |d| act::place_copies(d, &copies, offset, visible));
    copies.into_iter().map(|c| c.id).collect()
  }

  /// Delete photos from the project.
  pub fn delete_photos(&mut self, ids: &[PhotoId], cx: &mut Context<Self>) {
    let ids = ids.to_vec();
    self.apply(cx, |d| act::delete_photos(d, &ids));
  }

  /// Remove photos' files that no project in the history refers to.
  pub fn prune_library(&mut self) {
    // An import under way has files no project refers to yet; the tour's project isn't the user's.
    if self.importing > 0 || !self.imported.is_empty() || self.tour.is_some() {
      return;
    }
    let keep: HashSet<PhotoId> = self
      .history
      .all_projects()
      .flat_map(|p| p.photos.keys().cloned())
      .collect();
    self.lib.prune(&keep);
  }

  pub fn go_to(&mut self, page: Page, cx: &mut Context<Self>) {
    // A post under way can't be left.
    if self.posting() && page != Page::Export {
      return;
    }
    if page != self.ui.page {
      // The post is read from the project again when Export opens next.
      self.ig.post = None;
      self.ig.caption = None;
      self.ig.draft = None;
      if !self.posting() {
        self.ig.status = crate::posting::Status::Idle;
      }
    }
    // Preview opens at the spread being edited.
    if page == Page::Preview
      && self.ui.page != Page::Preview
      && let Some(id) = &self.ui.editing
      && let Some(i) = self.project().layout.all().iter().position(|s| &s.id == id)
    {
      self.ui.preview_index = i;
    }
    self.ui.page = page;
    self.ui.modal = None;
    self.ui.presenting = false;
    cx.notify();
  }

  /// Delete or put back what's selected: photos on the desk leave the project; in the
  /// editor, the selected photo goes back to the desk; spreads go, their photos to the desk.
  pub fn delete_selection(&mut self, cx: &mut Context<Self>) {
    let visible = self.visible();
    if self.ui.editing.is_some() {
      if let Some(id) = self.ui.editor_selected.take() {
        self.apply(cx, |d| act::put_in_pile(d, &id, None, visible));
      }
      return;
    }
    if !self.ui.spread_selection.is_empty() {
      let ids = self.ui.spread_selection.clone();
      self.apply(cx, |d| act::delete_spreads(d, &ids, visible));
      return;
    }
    if !self.ui.selection.is_empty() {
      let ids = std::mem::take(&mut self.ui.selection);
      self.delete_photos(&ids, cx);
    }
  }

  /// Arrow keys: nudge what's selected (on the desk or in the editor), or move through
  /// spreads in the editor when nothing is.
  pub fn nudge(&mut self, dx: f64, dy: f64, big: bool, cx: &mut Context<Self>) {
    if self.ui.editing.is_some() {
      let Some(id) = self.ui.editor_selected.clone() else {
        if dx != 0.0 {
          self.editor_go(dx.signum() as isize, cx);
        }
        return;
      };
      let u = units(self.project().page.unit);
      let n = if big { u.nudge_big } else { u.nudge };
      let key = format!("nudge:{id}");
      self.apply_coalesced(&key, cx, |d| {
        if let Some(item) = act::placement_mut(d, &id) {
          item.x += dx * n;
          item.y += dy * n;
        }
      });
      return;
    }
    if self.ui.selection.is_empty() {
      return;
    }
    // On the desk, an eighth of an inch, or an inch with Shift.
    let n = if big { 1.0 } else { 0.125 };
    let ids: HashSet<PhotoId> = self.ui.selection.iter().cloned().collect();
    self.apply_coalesced("nudge:desk", cx, |d| {
      for item in d.pile.iter_mut().filter(|i| ids.contains(&i.photo_id)) {
        item.x += dx * n;
        item.y += dy * n;
      }
    });
  }
}

/// Folders dropped or picked are read for the images in them (one level down).
fn expand(paths: Vec<PathBuf>) -> Vec<PathBuf> {
  let mut out = Vec::new();
  for p in paths {
    if p.is_dir() {
      if let Ok(entries) = std::fs::read_dir(&p) {
        let mut v: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
        v.sort();
        out.extend(v);
      }
    } else {
      out.push(p);
    }
  }
  out
}
