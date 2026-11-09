//! Pointer gestures: a press picks what a drag will do (pan, select, move photos, resize,
//! reorder spreads, crop), moves preview it as one history gesture, and the release (or
//! Escape) finishes it.

use std::collections::HashSet;

use gpui_kit::*;
use sequence_core::actions::{self as act, DropTarget, PhotoCopy};
use sequence_core::desk::DeskView;
use sequence_core::geometry::{Corner, GuideLines, Rect, intersects, resize_rect, snap_lines, snap_move};
use sequence_core::units::units;
use sequence_core::{PhotoId, SpreadId};

use super::frames::{inside, p};
use super::{Ghost, Workspace};
use crate::crop::CropGrip;

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
    surface: Surface,
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
  Guide(crate::layout::GuideDrag),
  Crop {
    grip: CropGrip,
    start: (f64, f64),
    frame0: Rect,
    whole0: Rect,
  },
  /// A person's tag on an Instagram slide, moved within its image (`size`, in pixels).
  Tag {
    key: String,
    username: String,
    start: (f64, f64),
    at0: (f64, f64),
    size: (f64, f64),
  },
}

/// Pointer travel under this is a click.
const DRAG_THRESHOLD: f64 = 4.0;
/// The largest a dragged photo's ghost gets.
const GHOST_MAX: f64 = 140.0;
/// Snapping reach in the editor, in screen pixels.
pub const SNAP_PX: f64 = 8.0;
/// The smallest a desk photo gets when resized, in inches.
const MIN_DESK_PHOTO: f64 = 0.2;

impl Workspace {
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
        surface: Surface::Desk,
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
      // As tall as the strip's photos.
      Source::Strip => 72.0 / rect.h.max(1e-9),
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
        surface: Surface::Editor,
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
      Drag::Tag {
        key,
        username,
        start,
        at0,
        size,
      } => {
        let x = at0.0 + (at.0 - start.0) / size.0;
        let y = at0.1 + (at.1 - start.1) / size.1;
        let (key, username) = (key.clone(), username.clone());
        self.move_tag(&key, &username, x, y, false, cx);
      }
      Drag::Pan { start, view0, surface } => {
        let (dx, dy) = (at.0 - start.0, at.1 - start.1);
        let v = match surface {
          Surface::Editor => &mut self.ui.editor_view,
          Surface::Desk => &mut self.ui.view,
        };
        v.pan_x = view0.pan_x + dx;
        v.pan_y = view0.pan_y + dy;
      }
      Drag::Marquee { start, initial } => {
        // Both corners held to the desk, then the box between them.
        let d = &self.frames.desk;
        let hold = |(x, y): (f64, f64)| (x.max(d.x).min(d.x + d.w), y.max(d.y).min(d.y + d.h));
        let (a, b) = (hold(*start), hold(at));
        let m = Rect::new(a.0.min(b.0), a.1.min(b.1), (a.0 - b.0).abs(), (a.1 - b.1).abs());
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
          let before = if self.frames.sidebar_grid {
            at.0 < r.x + r.w / 2.0
          } else {
            at.1 < r.y + r.h / 2.0
          };
          let at_i = if before { idx } else { idx + 1 };
          let di = if book { at_i.max(1).min(total - 1) } else { at_i };
          *drop_index = Some(di);
          self.ui.reorder = Some((ids.clone().unwrap_or_default(), di));
        }
      }
      Drag::Guide(g) => self.guide_drag(g, at, ev.modifiers),
      Drag::Crop {
        grip,
        start,
        frame0,
        whole0,
      } => {
        let (grip, start, frame0, whole0) = (*grip, *start, *frame0, *whole0);
        self.crop_drag(grip, start, frame0, whole0, at, ev.modifiers);
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
  pub fn editor_snap_lines(&self) -> (f64, GuideLines) {
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
    self.clear_drag_feedback();
    match drag {
      Drag::Tag { .. } => {
        self.save_post();
        cx.notify();
      }
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
            // A click places the photo on the first empty page, or the right page.
            Source::Strip => {
              if let Some(id) = self.ui.editing.clone()
                && let Some(spread) = self.project().find_spread(&id)
              {
                let sheet = self.project().sheet();
                let side = sequence_core::geometry::page_sides(spread.kind)[0];
                let taken = spread
                  .items
                  .iter()
                  .any(|i| sequence_core::geometry::side_at(&sheet, i.x + i.w / 2.0) == side);
                let pick = if spread.kind == sequence_core::SpreadKind::Middle && taken {
                  sequence_core::PageSide::Right
                } else {
                  side
                };
                self.apply(cx, |d| act::put_on_page(d, std::slice::from_ref(&clicked), &id, pick));
                return;
              }
            }
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
      Drag::Crop { .. } => cx.notify(),
      Drag::Guide(g) => self.guide_up(g, at, ev.modifiers, cx),
      Drag::Pan { .. } | Drag::Marquee { .. } | Drag::SidebarWidth { .. } => {
        if matches!(drag, Drag::SidebarWidth { .. }) {
          self.prefs.save();
        }
        cx.notify();
      }
    }
  }

  /// What shows only while dragging.
  fn clear_drag_feedback(&mut self) {
    self.ui.marquee = None;
    self.ui.ghost = None;
    self.ui.hover = None;
    self.ui.snap_hit = None;
    self.ui.reorder = None;
  }

  /// Escape, mid-gesture: put things back.
  pub fn cancel_drag(&mut self, cx: &mut Context<Self>) -> bool {
    let Some(drag) = self.drag.take() else { return false };
    if let Drag::Crop { frame0, whole0, .. } = drag {
      self.cancel_crop_drag(frame0, whole0);
    }
    if matches!(
      drag,
      Drag::Photos { moved: true, .. } | Drag::Resize { moved: true, .. }
    ) || matches!(&drag, Drag::Guide(g) if g.moved)
    {
      self.history.cancel();
    }
    self.ui.guide_label = None;
    self.clear_drag_feedback();
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
}
