//! The window: the project with its history, the photos' library, and what the window
//! shows (the web app's `ui.ts`). The views draw from it (`views/`); pointer gestures are
//! worked out here, in window pixels, against the places the last frame drew things
//! (`Frames`), as the web app's `hitTest` does against the DOM.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Instant;

use gpui_kit::*;
use sequence_core::actions::{self as act, DropTarget, PhotoCopy};
use sequence_core::desk::{DeskView, view_to_fit};
use sequence_core::geometry::{Corner, GuideLines, Rect, intersects, resize_rect, snap_lines, snap_move};
use sequence_core::store::History;
use sequence_core::units::units;
use sequence_core::{PageSide, PhotoId, Project, SpreadId};

use crate::library::{Library, is_image_name};
use crate::prefs::Prefs;
use crate::theme::{Theme, desk_is_light};

/// Under the toolbar: the desk, Preview, or Export.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
  Desk,
  Preview,
  Export,
}

/// The dialogs over a page (to come: Layout, Settings, About).
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Modal {
  Layout,
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

/// Where photos are dragged from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
  Desk,
  Editor,
  Sidebar,
  /// The editor's strip of desk photos.
  Strip,
}

/// Which surface a resize happens on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Surface {
  Desk,
  Editor,
}

/// A gesture under way, from a press to its release.
pub enum Drag {
  Pan {
    start: (f64, f64),
    view0: DeskView,
    editor: bool,
  },
  Marquee {
    start: (f64, f64),
    initial: Vec<PhotoId>,
  },
  Photos {
    from: Source,
    start: (f64, f64),
    clicked: PhotoId,
    /// The photos dragged (copies' ids when Option-dragging).
    ids: Vec<PhotoId>,
    copies: Vec<PhotoCopy>,
    picked: Vec<PhotoId>,
    toggle: bool,
    was_selected: bool,
    before: Vec<PhotoId>,
    moved: bool,
    ghost_w: f64,
    ghost_h: f64,
    start_rect: Rect,
  },
  Resize {
    surface: Surface,
    photo: PhotoId,
    corner: Corner,
    start: (f64, f64),
    rect0: Rect,
    moved: bool,
  },
  Spreads {
    spread: SpreadId,
    start: (f64, f64),
    mods: Modifiers,
    ids: Option<Vec<SpreadId>>,
    drop_index: Option<usize>,
  },
  SidebarWidth {
    start: f64,
    w0: f64,
  },
}

/// A spread's picture in the sidebar, as last drawn.
#[derive(Clone, Debug)]
pub struct Cell {
  pub id: SpreadId,
  pub index: usize,
  /// The row (picture and label), in window pixels.
  pub row: Rect,
  /// Each page, in window pixels.
  pub pages: Vec<(PageSide, Rect)>,
  /// Pixels per unit.
  pub scale: f64,
}

/// The spread editor's stage, as last drawn.
#[derive(Clone, Debug)]
pub struct EditorFrame {
  pub stage: Rect,
  pub scale: f64,
  pub pages: Vec<(PageSide, Rect)>,
  pub strip: Rect,
}

/// Where things were drawn, in window pixels, for the pointer's gestures.
#[derive(Clone, Debug, Default)]
pub struct Frames {
  pub window: Rect,
  pub main: Rect,
  pub desk: Rect,
  pub sidebar: Option<Rect>,
  pub sidebar_list: Rect,
  pub cells: Vec<Cell>,
  pub gaps: Vec<(usize, Rect)>,
  pub editor: Option<EditorFrame>,
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
  pub quick_look: Option<(Vec<PhotoId>, usize)>,
  pub context_menu: Option<ContextMenu>,
  pub busy: Option<String>,
  pub hint: Option<String>,
  pub space_down: Option<Instant>,
  pub space_panned: bool,
  pub cmd_held: bool,
  pub fitted_once: bool,
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
      quick_look: None,
      context_menu: None,
      busy: None,
      hint: None,
      space_down: None,
      space_panned: false,
      cmd_held: false,
      fitted_once: false,
    }
  }
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
}

/// The editor's zoom range, from fitting the spread.
pub const EDITOR_MIN_ZOOM: f64 = 0.5;
pub const EDITOR_MAX_ZOOM: f64 = 8.0;
/// Pointer travel under this is a click.
const DRAG_THRESHOLD: f64 = 4.0;
/// The largest a dragged photo's ghost gets.
const GHOST_MAX: f64 = 140.0;
/// Snapping reach in the editor, in screen pixels.
pub const SNAP_PX: f64 = 8.0;
/// The smallest a desk photo gets when resized, in inches.
const MIN_DESK_PHOTO: f64 = 0.2;

pub struct Workspace {
  pub history: History,
  pub lib: Library,
  pub ui: Ui,
  pub prefs: Prefs,
  pub doc: Document,
  pub drag: Option<Drag>,
  pub frames: Frames,
  pub focus: FocusHandle,
  saved_to_library: u64,
}

fn p(point: Point<Pixels>) -> (f64, f64) {
  (f64::from(point.x), f64::from(point.y))
}

fn inside(r: &Rect, (x, y): (f64, f64)) -> bool {
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

impl Workspace {
  pub fn new(lib: Library, prefs: Prefs, cx: &mut Context<Self>) -> Self {
    let project = lib.load_project().unwrap_or_else(Project::empty);
    let mut ws = Self {
      history: History::new(project),
      lib,
      ui: Ui::default(),
      prefs,
      doc: Document::default(),
      drag: None,
      frames: Frames::default(),
      focus: cx.focus_handle(),
      saved_to_library: 0,
    };
    ws.doc.path = ws.prefs.document.clone();
    ws.doc.saved_revision = if ws.prefs.document_edited { u64::MAX } else { 0 };
    ws
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
    self.history.revision != self.doc.saved_revision
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
    self.ui.spread_selection.retain(|id| project.find_spread(id).is_some());
    if let Some(id) = &self.ui.editing
      && project.find_spread(id).is_none()
    {
      self.ui.editing = None;
    }
    if !self.history.in_gesture() && self.saved_to_library != self.history.revision {
      self.saved_to_library = self.history.revision;
      if self.lib.save_project(project).is_err() {
        self.ui.notice = Some("Couldn’t keep a copy of your work in the app’s storage.".into());
      }
      self.prefs.document_edited = self.edited();
      self.prefs.save();
    }
    cx.notify();
  }

  /// Make a change as one undo step.
  pub fn apply(&mut self, cx: &mut Context<Self>, recipe: impl FnOnce(&mut Project)) {
    self.history.apply(recipe);
    self.changed(cx);
  }

  pub fn undo(&mut self, cx: &mut Context<Self>) {
    self.history.cancel();
    self.history.undo();
    self.changed(cx);
  }

  pub fn redo(&mut self, cx: &mut Context<Self>) {
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
    let files: Vec<PathBuf> = expand(paths)
      .into_iter()
      .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(is_image_name))
      .collect();
    if files.is_empty() {
      return;
    }
    self.ui.busy = Some(format!(
      "Adding {} photo{}…",
      files.len(),
      if files.len() == 1 { "" } else { "s" }
    ));
    cx.notify();
    let dir = self.lib.dir.clone();
    let task = cx.background_executor().spawn(async move {
      let mut lib = Library::at(dir);
      lib.import(&files)
    });
    cx.spawn(async move |this, cx| {
      let imported = task.await;
      let _ = this.update(cx, |ws, cx| {
        ws.ui.busy = None;
        let visible = ws.visible();
        let mut bounds = None;
        ws.history
          .apply(|d| bounds = act::add_photos_to_pile(d, imported.photos, visible));
        if let Some(b) = bounds {
          let desk = &ws.frames.desk;
          ws.ui.view = view_to_fit(b, desk.w, desk.h);
        }
        if !imported.failed.is_empty() {
          let n = imported.failed.len();
          let names = imported.failed.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
          ws.ui.notice = Some(format!(
            "Couldn't read {n} file{}: {names}{}",
            if n > 1 { "s" } else { "" },
            if n > 3 { "…" } else { "" }
          ));
        }
        ws.changed(cx);
      });
    })
    .detach();
  }

  /// Copy duplicated photos' files, once the project refers to them.
  pub fn store_copies(&mut self, copies: &[PhotoCopy]) {
    for c in copies {
      self.lib.copy(&c.from, &c.id);
    }
  }

  /// Duplicate photos: new, independent photos, down and right of the originals.
  pub fn duplicate(&mut self, ids: &[PhotoId], cx: &mut Context<Self>) -> Vec<PhotoId> {
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
    self.apply(cx, |d| act::place_copies(d, &copies, act::DUPLICATE_OFFSET, visible));
    copies.into_iter().map(|c| c.id).collect()
  }

  /// Delete photos from the project.
  pub fn delete_photos(&mut self, ids: &[PhotoId], cx: &mut Context<Self>) {
    let ids = ids.to_vec();
    self.apply(cx, |d| act::delete_photos(d, &ids));
  }

  /// Remove photos' files that no project in the history refers to.
  pub fn prune_library(&mut self) {
    let keep: HashSet<PhotoId> = self
      .history
      .all_projects()
      .flat_map(|p| p.photos.keys().cloned())
      .collect();
    self.lib.prune(&keep);
  }

  /// What a point in the window is over, for dropping photos.
  pub fn target_at(&self, at: (f64, f64)) -> Option<DropTarget> {
    if let Some(e) = &self.frames.editor {
      if inside(&e.strip, at) {
        return Some(DropTarget::Strip);
      }
      let spread = self.ui.editing.clone()?;
      for (side, r) in &e.pages {
        if inside(r, at) {
          return Some(DropTarget::Page { spread, side: *side });
        }
      }
      return None;
    }
    if self.frames.sidebar.as_ref().is_some_and(|s| inside(s, at)) {
      if !inside(&self.frames.sidebar_list, at) {
        return None;
      }
      for (i, r) in &self.frames.gaps {
        if inside(r, at) {
          return Some(DropTarget::Insert(*i));
        }
      }
      for c in &self.frames.cells {
        for (side, r) in &c.pages {
          if inside(r, at) {
            return Some(DropTarget::Page {
              spread: c.id.clone(),
              side: *side,
            });
          }
        }
      }
      return None;
    }
    inside(&self.frames.desk, at).then_some(DropTarget::Desk)
  }

  /// A window point on the desk, in desk inches.
  pub fn to_desk(&self, (x, y): (f64, f64)) -> (f64, f64) {
    self.ui.view.to_desk(x - self.frames.desk.x, y - self.frames.desk.y)
  }

  // Pressing.

  /// Space held (to pan) or a middle button: the press pans.
  fn pans(&self, ev: &MouseDownEvent) -> bool {
    ev.button == MouseButton::Middle || (ev.button == MouseButton::Left && self.ui.space_down.is_some())
  }

  /// A press on the desk's background: pan, or select with a marquee.
  pub fn desk_down(&mut self, ev: &MouseDownEvent, cx: &mut Context<Self>) {
    self.ui.context_menu = None;
    let at = p(ev.position);
    if self.pans(ev) {
      self.ui.space_panned = true;
      self.drag = Some(Drag::Pan {
        start: at,
        view0: self.ui.view,
        editor: false,
      });
      return;
    }
    if ev.button != MouseButton::Left {
      return;
    }
    let additive = ev.modifiers.shift || ev.modifiers.platform;
    let initial = if additive {
      self.ui.selection.clone()
    } else {
      Vec::new()
    };
    if !additive {
      self.ui.selection.clear();
    }
    self.ui.spread_selection.clear();
    self.drag = Some(Drag::Marquee { start: at, initial });
    cx.notify();
  }

  /// A press on a photo (on the desk, in the editor, or in the sidebar's pictures).
  pub fn photo_down(&mut self, from: Source, photo: PhotoId, ev: &MouseDownEvent, cx: &mut Context<Self>) {
    self.ui.context_menu = None;
    if from == Source::Desk && self.pans(ev) {
      return self.desk_down(ev, cx);
    }
    if ev.button != MouseButton::Left {
      return;
    }
    let at = p(ev.position);
    if ev.click_count == 2 && matches!(from, Source::Desk | Source::Editor) {
      self.drag = None;
      self.start_crop(&photo, cx);
      return;
    }
    let toggle = from == Source::Desk && (ev.modifiers.shift || ev.modifiers.platform);
    let before = self.ui.selection.clone();
    let was_selected = before.contains(&photo);
    let picked: Vec<PhotoId> = match from {
      Source::Desk => {
        if !was_selected {
          if toggle {
            self.ui.selection.push(photo.clone());
          } else {
            self.ui.selection = vec![photo.clone()];
          }
        }
        self.ui.spread_selection.clear();
        self.ui.selection.clone()
      }
      Source::Editor => {
        self.ui.editor_selected = Some(photo.clone());
        vec![photo.clone()]
      }
      Source::Sidebar | Source::Strip => vec![photo.clone()],
    };
    let copies = if ev.modifiers.alt && matches!(from, Source::Desk | Source::Editor) {
      act::copies_of(&picked)
    } else {
      Vec::new()
    };
    let ids = if copies.is_empty() {
      picked.clone()
    } else {
      copies.iter().map(|c| c.id.clone()).collect()
    };
    let rect = act::locate(self.project(), &photo)
      .map(|(_, p)| Rect::from(&p))
      .unwrap_or_default();
    let k = match from {
      Source::Desk => self.ui.view.scale(),
      Source::Editor => self.frames.editor.as_ref().map_or(1.0, |e| e.scale),
      Source::Sidebar => self
        .frames
        .cells
        .iter()
        .find(|c| c.pages.iter().any(|(_, r)| inside(r, at)))
        .map_or(1.0, |c| c.scale),
      Source::Strip => self.ui.view.scale(),
    };
    let gw = GHOST_MAX.min(rect.w * k).max(24.0);
    self.drag = Some(Drag::Photos {
      from,
      start: at,
      clicked: photo,
      ids,
      copies,
      picked,
      toggle,
      was_selected,
      before,
      moved: false,
      ghost_w: gw,
      ghost_h: gw * rect.h / rect.w.max(1e-9),
      start_rect: rect,
    });
    cx.notify();
  }

  /// A press on a selected photo's corner.
  pub fn handle_down(&mut self, surface: Surface, photo: PhotoId, corner: Corner, ev: &MouseDownEvent) {
    if ev.button != MouseButton::Left {
      return;
    }
    let Some((_, place)) = act::locate(self.project(), &photo) else {
      return;
    };
    self.drag = Some(Drag::Resize {
      surface,
      photo,
      corner,
      start: p(ev.position),
      rect0: Rect::from(&place),
      moved: false,
    });
  }

  /// A press on a spread's row in the sidebar: a click selects; a drag moves it.
  pub fn spread_down(&mut self, spread: SpreadId, ev: &MouseDownEvent, cx: &mut Context<Self>) {
    self.ui.context_menu = None;
    if ev.button != MouseButton::Left {
      return;
    }
    if ev.click_count == 2 {
      self.drag = None;
      self.open_editor(spread, cx);
      return;
    }
    self.drag = Some(Drag::Spreads {
      spread,
      start: p(ev.position),
      mods: ev.modifiers,
      ids: None,
      drop_index: None,
    });
  }

  pub fn sidebar_resize_down(&mut self, ev: &MouseDownEvent) {
    self.drag = Some(Drag::SidebarWidth {
      start: f64::from(ev.position.x),
      w0: self.prefs.sidebar_width,
    });
  }

  /// A press on the editor's stage, off the photos: deselect, or pan.
  pub fn stage_down(&mut self, ev: &MouseDownEvent, cx: &mut Context<Self>) {
    if self.pans(ev) {
      self.drag = Some(Drag::Pan {
        start: p(ev.position),
        view0: self.ui.editor_view,
        editor: true,
      });
      return;
    }
    if ev.button == MouseButton::Left {
      self.ui.editor_selected = None;
      cx.notify();
    }
  }

  // Moving.

  pub fn pointer_move(&mut self, ev: &MouseMoveEvent, cx: &mut Context<Self>) {
    let at = p(ev.position);
    let Some(mut drag) = self.drag.take() else { return };
    let threshold_passed = |start: (f64, f64)| (at.0 - start.0).hypot(at.1 - start.1) >= DRAG_THRESHOLD;
    match &mut drag {
      Drag::Pan { start, view0, editor } => {
        let (dx, dy) = (at.0 - start.0, at.1 - start.1);
        let v = if *editor {
          &mut self.ui.editor_view
        } else {
          &mut self.ui.view
        };
        v.pan_x = view0.pan_x + dx;
        v.pan_y = view0.pan_y + dy;
      }
      Drag::Marquee { start, initial } => {
        let d = &self.frames.desk;
        let m = Rect::new(
          start.0.min(at.0).max(d.x),
          start.1.min(at.1).max(d.y),
          (at.0 - start.0).abs(),
          (at.1 - start.1).abs(),
        );
        let a = self.to_desk((m.x, m.y));
        let b = self.to_desk((m.x + m.w, m.y + m.h));
        let bx = Rect::new(a.0, a.1, b.0 - a.0, b.1 - a.1);
        let mut sel = initial.clone();
        for item in &self.history.project().pile {
          if intersects(&Rect::from(item), &bx) && !sel.contains(&item.photo_id) {
            sel.push(item.photo_id.clone());
          }
        }
        self.ui.selection = sel;
        self.ui.marquee = Some(m);
      }
      Drag::Photos {
        from,
        start,
        ids,
        copies,
        picked,
        moved,
        ghost_w,
        ghost_h,
        start_rect,
        clicked,
        ..
      } => {
        if !*moved {
          if !threshold_passed(*start) {
            self.drag = Some(drag);
            return;
          }
          *moved = true;
          self.history.begin();
          for c in copies.iter() {
            self.lib.share_thumb(&c.from, &c.id);
          }
          if !copies.is_empty() {
            match from {
              Source::Desk => self.ui.selection = ids.clone(),
              Source::Editor => self.ui.editor_selected = ids.first().cloned(),
              Source::Sidebar | Source::Strip => {}
            }
          }
        }
        let target = self.target_at(at);
        let (dx, dy) = (at.0 - start.0, at.1 - start.1);
        let visible = self.visible();
        let copies = copies.clone();
        let ids_now = ids.clone();
        match from {
          Source::Desk => {
            let k = self.ui.view.scale();
            let set: HashSet<PhotoId> = ids_now.iter().cloned().collect();
            self.history.preview(|d| {
              act::place_copies(d, &copies, 0.0, visible);
              let mut order: Vec<usize> = (0..d.pile.len()).collect();
              order.sort_by(|&a, &b| d.pile[a].z.total_cmp(&d.pile[b].z));
              for i in order {
                if set.contains(&d.pile[i].photo_id) {
                  d.pile[i].x += dx / k;
                  d.pile[i].y += dy / k;
                  d.pile[i].z = d.next_z;
                  d.next_z += 1.0;
                }
              }
            });
          }
          Source::Editor => {
            let (scale, lines) = self.editor_snap_lines();
            let id = ids_now.first().cloned().unwrap_or_else(|| clicked.clone());
            let moved_r = Rect::new(
              start_rect.x + dx / scale,
              start_rect.y + dy / scale,
              start_rect.w,
              start_rect.h,
            );
            let (r, hit) = if ev.modifiers.alt && copies.is_empty() {
              (moved_r, GuideLines::default())
            } else {
              snap_move(moved_r, &lines, SNAP_PX / scale)
            };
            self.ui.snap_hit = Some(hit);
            self.history.preview(|d| {
              act::place_copies(d, &copies, 0.0, visible);
              let z = act::bump_z(d);
              if let Some(item) = act::placement_mut(d, &id) {
                item.x = r.x;
                item.y = r.y;
                item.z = z;
              }
            });
          }
          Source::Sidebar | Source::Strip => {}
        }
        let over_home = match from {
          Source::Desk => target == Some(DropTarget::Desk),
          Source::Editor => matches!(target, Some(DropTarget::Page { .. })),
          Source::Sidebar | Source::Strip => false,
        };
        self.ui.ghost = (!over_home).then(|| Ghost {
          photo: picked.first().cloned().unwrap_or_else(|| clicked.clone()),
          count: ids.len(),
          x: at.0,
          y: at.1,
          w: *ghost_w,
          h: *ghost_h,
        });
        self.ui.hover = if over_home { None } else { target };
      }
      Drag::Resize {
        surface,
        photo,
        corner,
        start,
        rect0,
        moved,
      } => {
        if !*moved {
          if !threshold_passed(*start) {
            self.drag = Some(drag);
            return;
          }
          *moved = true;
          self.history.begin();
        }
        let lock = !ev.modifiers.shift;
        let (r, hit) = match surface {
          Surface::Desk => {
            let k = self.ui.view.scale();
            resize_rect(
              *rect0,
              *corner,
              (at.0 - start.0) / k,
              (at.1 - start.1) / k,
              lock,
              None,
              0.0,
              MIN_DESK_PHOTO,
            )
          }
          Surface::Editor => {
            let (scale, lines) = self.editor_snap_lines();
            let min = units(self.project().page.unit).min_photo;
            let lines = (!ev.modifiers.alt).then_some(&lines);
            resize_rect(
              *rect0,
              *corner,
              (at.0 - start.0) / scale,
              (at.1 - start.1) / scale,
              lock,
              lines,
              SNAP_PX / scale,
              min,
            )
          }
        };
        if *surface == Surface::Editor {
          self.ui.snap_hit = Some(hit);
        }
        let id = photo.clone();
        self.history.preview(|d| {
          if let Some(item) = act::placement_mut(d, &id) {
            item.x = r.x;
            item.y = r.y;
            item.w = r.w;
            item.h = r.h;
          }
        });
      }
      Drag::Spreads {
        spread,
        start,
        ids,
        drop_index,
        ..
      } => {
        if ids.is_none() && !threshold_passed(*start) {
          self.drag = Some(drag);
          return;
        }
        let project = self.history.project();
        let all = project.layout.all();
        let Some(this) = all.iter().find(|s| &s.id == spread) else {
          self.drag = Some(drag);
          return;
        };
        if !act::is_movable(this.kind) {
          self.drag = Some(drag);
          return;
        }
        if ids.is_none() {
          if !self.ui.spread_selection.contains(spread) {
            self.ui.spread_selection = vec![spread.clone()];
          }
          let chosen = &self.ui.spread_selection;
          *ids = Some(
            all
              .iter()
              .filter(|s| chosen.contains(&s.id) && act::is_movable(s.kind))
              .map(|s| s.id.clone())
              .collect(),
          );
          self.ui.selection.clear();
        }
        let book = matches!(project.layout, sequence_core::Layout::Spreads { .. });
        let total = all.len();
        let mut best: Option<(usize, Rect, f64)> = None;
        for c in &self.frames.cells {
          let r = c.row;
          let dx = (r.x - at.0).max(0.0).max(at.0 - (r.x + r.w));
          let dy = (r.y - at.1).max(0.0).max(at.1 - (r.y + r.h));
          let dist = dx.hypot(dy);
          if best.as_ref().is_none_or(|b| dist < b.2) {
            best = Some((c.index, r, dist));
          }
        }
        if let Some((idx, r, _)) = best {
          let before = at.1 < r.y + r.h / 2.0;
          let at_i = if before { idx } else { idx + 1 };
          let di = if book { at_i.max(1).min(total - 1) } else { at_i };
          *drop_index = Some(di);
          self.ui.reorder = Some((ids.clone().unwrap_or_default(), di));
        }
      }
      Drag::SidebarWidth { start, w0 } => {
        let max = (self.frames.window.w - 160.0).max(crate::prefs::SIDEBAR_MIN_WIDTH);
        self.prefs.sidebar_width = (*w0 - (at.0 - *start)).max(crate::prefs::SIDEBAR_MIN_WIDTH).min(max);
      }
    }
    self.drag = Some(drag);
    cx.notify();
  }

  /// The editor's snapping lines (guides hidden: only the page's edges), and its scale.
  fn editor_snap_lines(&self) -> (f64, GuideLines) {
    let scale = self.frames.editor.as_ref().map_or(1.0, |e| e.scale);
    let project = self.project();
    let Some(spread) = self.ui.editing.as_ref().and_then(|id| project.find_spread(id)) else {
      return (scale, GuideLines::default());
    };
    let mut sheet = project.sheet();
    if self.ui.guides_hidden {
      sheet.center_h = false;
      sheet.center_v = false;
      sheet.borders.clear();
      sheet.lines.clear();
    }
    (scale, snap_lines(spread, &sheet))
  }

  // Releasing.

  pub fn pointer_up(&mut self, ev: &MouseUpEvent, cx: &mut Context<Self>) {
    let at = p(ev.position);
    let Some(drag) = self.drag.take() else { return };
    self.ui.marquee = None;
    self.ui.ghost = None;
    self.ui.hover = None;
    self.ui.snap_hit = None;
    self.ui.reorder = None;
    match drag {
      Drag::Photos {
        from,
        clicked,
        ids,
        copies,
        picked,
        toggle,
        was_selected,
        before,
        moved,
        ..
      } => {
        if !moved {
          match from {
            Source::Desk => {
              if toggle && was_selected {
                self.ui.selection = before.into_iter().filter(|id| id != &clicked).collect();
              } else if !toggle {
                self.ui.selection = vec![clicked.clone()];
              }
              self.history.silent(|d| act::raise(d, &clicked));
            }
            Source::Editor => self.history.silent(|d| act::raise(d, &clicked)),
            Source::Strip => {}
            Source::Sidebar => {
              // A click on a photo in a spread's picture selects the spread.
              if let Some(c) = self
                .frames
                .cells
                .iter()
                .find(|c| c.pages.iter().any(|(_, r)| inside(r, at)))
              {
                let id = c.id.clone();
                self.select_spread(id, ev.modifiers);
              }
            }
          }
          self.changed(cx);
          return;
        }
        let target = self.target_at(at);
        let visible = self.visible();
        let home = match from {
          Source::Desk => target == Some(DropTarget::Desk),
          Source::Editor => matches!(target, Some(DropTarget::Page { .. })) || target.is_none(),
          Source::Sidebar | Source::Strip => false,
        };
        if home {
          self.history.end();
        } else if let Some(t) = target {
          let point = (t == DropTarget::Desk).then(|| self.to_desk(at));
          let c = copies.clone();
          let ids2 = ids.clone();
          self.history.preview(|d| {
            act::place_copies(d, &c, 0.0, visible);
            act::drop_photos(d, &t, &ids2, point, visible);
          });
          self.history.end();
          match from {
            Source::Desk => self.ui.selection.clear(),
            Source::Editor => self.ui.editor_selected = None,
            Source::Sidebar | Source::Strip => {}
          }
          if t == DropTarget::Desk {
            self.ui.selection = ids.clone();
          }
        } else {
          self.history.cancel();
          if !copies.is_empty() && from == Source::Desk {
            self.ui.selection = picked;
          }
          self.changed(cx);
          return;
        }
        self.store_copies(&copies);
        self.changed(cx);
      }
      Drag::Resize { moved, .. } => {
        if moved {
          self.history.end();
        }
        self.changed(cx);
      }
      Drag::Spreads {
        spread,
        mods,
        ids,
        drop_index,
        ..
      } => match (ids, drop_index) {
        (Some(ids), Some(i)) => {
          self.apply(cx, |d| act::move_spreads(d, &ids, i));
        }
        (None, _) => {
          self.select_spread(spread, mods);
          cx.notify();
        }
        _ => cx.notify(),
      },
      Drag::Pan { .. } | Drag::Marquee { .. } | Drag::SidebarWidth { .. } => {
        if matches!(drag, Drag::SidebarWidth { .. }) {
          self.prefs.save();
        }
        cx.notify();
      }
    }
  }

  /// Escape, mid-gesture: put things back.
  pub fn cancel_drag(&mut self, cx: &mut Context<Self>) -> bool {
    let Some(drag) = self.drag.take() else { return false };
    if matches!(
      drag,
      Drag::Photos { moved: true, .. } | Drag::Resize { moved: true, .. }
    ) {
      self.history.cancel();
    }
    self.ui.marquee = None;
    self.ui.ghost = None;
    self.ui.hover = None;
    self.ui.snap_hit = None;
    self.ui.reorder = None;
    cx.notify();
    true
  }

  /// Select a spread as clicked: alone, toggled (⌘), or a range from the last (Shift).
  pub fn select_spread(&mut self, id: SpreadId, mods: Modifiers) {
    let ids: Vec<SpreadId> = self.project().layout.all().iter().map(|s| s.id.clone()).collect();
    if mods.shift
      && let Some(anchor) = &self.ui.spread_anchor
      && let (Some(a), Some(b)) = (ids.iter().position(|i| i == anchor), ids.iter().position(|i| i == &id))
    {
      self.ui.spread_selection = ids[a.min(b)..=a.max(b)].to_vec();
      self.ui.selection.clear();
      return;
    }
    self.ui.spread_anchor = Some(id.clone());
    if mods.platform {
      if let Some(i) = self.ui.spread_selection.iter().position(|s| s == &id) {
        self.ui.spread_selection.remove(i);
      } else {
        self.ui.spread_selection.push(id);
      }
    } else {
      self.ui.spread_selection = vec![id];
    }
    self.ui.selection.clear();
  }

  // Scrolling and pinching.

  pub fn desk_scroll(&mut self, ev: &ScrollEvent, cx: &mut Context<Self>) {
    let d = ev.delta.pixel_delta(px(16.0));
    let (sx, sy) = (
      f64::from(ev.position.x) - self.frames.desk.x,
      f64::from(ev.position.y) - self.frames.desk.y,
    );
    self.ui.view = self.ui.view.wheeled(
      -f64::from(d.x),
      -f64::from(d.y),
      ev.modifiers.platform || ev.modifiers.control,
      sx,
      sy,
      sequence_core::desk::MIN_ZOOM,
      sequence_core::desk::MAX_ZOOM,
    );
    cx.notify();
  }

  pub fn desk_pinch(&mut self, ev: &PinchEvent, cx: &mut Context<Self>) {
    let (sx, sy) = (
      f64::from(ev.position.x) - self.frames.desk.x,
      f64::from(ev.position.y) - self.frames.desk.y,
    );
    self.ui.view = self.ui.view.pinched(1.0 + f64::from(ev.delta), sx, sy);
    cx.notify();
  }

  /// The editor's stage: from where the spread's center sits before panning.
  fn stage_point(&self, ev: Point<Pixels>) -> (f64, f64) {
    let Some(e) = &self.frames.editor else {
      return (0.0, 0.0);
    };
    (
      f64::from(ev.x) - e.stage.x - e.stage.w / 2.0,
      f64::from(ev.y) - e.stage.y - (e.stage.h - crate::views::editor::PAGER_PX) / 2.0,
    )
  }

  pub fn editor_scroll(&mut self, ev: &ScrollEvent, cx: &mut Context<Self>) {
    let d = ev.delta.pixel_delta(px(16.0));
    let (sx, sy) = self.stage_point(ev.position);
    self.ui.editor_view = self.ui.editor_view.wheeled(
      -f64::from(d.x),
      -f64::from(d.y),
      ev.modifiers.platform || ev.modifiers.control,
      sx,
      sy,
      EDITOR_MIN_ZOOM,
      EDITOR_MAX_ZOOM,
    );
    cx.notify();
  }

  pub fn editor_pinch(&mut self, ev: &PinchEvent, cx: &mut Context<Self>) {
    let (sx, sy) = self.stage_point(ev.position);
    let v = self.ui.editor_view;
    let z = sequence_core::desk::clamp(v.zoom * (1.0 + f64::from(ev.delta)), EDITOR_MIN_ZOOM, EDITOR_MAX_ZOOM);
    self.ui.editor_view = v.zoomed_around(z, sx, sy);
    cx.notify();
  }

  pub fn sidebar_scroll(&mut self, ev: &ScrollEvent, cx: &mut Context<Self>) {
    let d = ev.delta.pixel_delta(px(16.0));
    self.ui.sidebar_scroll = (self.ui.sidebar_scroll - f64::from(d.y)).max(0.0);
    cx.notify();
  }

  // Pages and modes.

  pub fn open_editor(&mut self, id: SpreadId, cx: &mut Context<Self>) {
    self.ui.editing = Some(id);
    self.ui.editor_selected = None;
    self.ui.editor_view = FITTED;
    self.ui.page = Page::Desk;
    cx.notify();
  }

  pub fn close_editor(&mut self, cx: &mut Context<Self>) {
    self.ui.editing = None;
    self.ui.editor_selected = None;
    cx.notify();
  }

  /// Move the editor to the spread `delta` along.
  pub fn editor_go(&mut self, delta: isize, cx: &mut Context<Self>) {
    let Some(cur) = self.ui.editing.clone() else { return };
    let all: Vec<SpreadId> = self.project().layout.all().iter().map(|s| s.id.clone()).collect();
    let Some(i) = all.iter().position(|s| s == &cur) else {
      return;
    };
    let j = i as isize + delta;
    if j >= 0 && (j as usize) < all.len() {
      self.open_editor(all[j as usize].clone(), cx);
    }
  }

  pub fn start_crop(&mut self, photo: &PhotoId, cx: &mut Context<Self>) {
    // Crop mode comes in the next pass; for now a double-click selects.
    let _ = photo;
    cx.notify();
  }

  pub fn go_to(&mut self, page: Page, cx: &mut Context<Self>) {
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
      self.history.apply_with(Some(&key), |d| {
        if let Some(item) = act::placement_mut(d, &id) {
          item.x += dx * n;
          item.y += dy * n;
        }
      });
      self.changed(cx);
      return;
    }
    if self.ui.selection.is_empty() {
      return;
    }
    // On the desk, a screen step at the current zoom.
    let n = (if big { 10.0 } else { 1.0 }) / self.ui.view.scale();
    let ids: HashSet<PhotoId> = self.ui.selection.iter().cloned().collect();
    self.history.apply_with(Some("nudge:desk"), |d| {
      for item in d.pile.iter_mut().filter(|i| ids.contains(&i.photo_id)) {
        item.x += dx * n;
        item.y += dy * n;
      }
    });
    self.changed(cx);
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
