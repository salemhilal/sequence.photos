//! Crop mode (`CropFrame.tsx`), over a photo on the desk or in the spread editor: the whole
//! photo shows, dimmed outside the crop. Drag the frame's edges and corners to crop, or
//! inside it to move the crop (⌘, or pinned: the photo moves behind it). Return, Done, or a
//! press elsewhere keeps the crop as one undo step; Esc puts it back.
//!
//! The crop is previewed in the project as it's made (one history gesture from start to
//! finish), so every view shows it.

use gpui_kit::*;
use sequence_core::PhotoId;
use sequence_core::actions::{self as act, Location};
use sequence_core::crop::{
  CropDrag, CropHandle, crop_of, drag_crop_handle, frame_to_ratio, move_crop, pan_crop, whole_rect,
};
use sequence_core::geometry::Rect;
use sequence_core::units::units;

use crate::workspace::{Drag, SNAP_PX, Surface, Workspace};

/// The smallest a crop leaves a desk photo's side, in inches.
const MIN_DESK_CROP: f64 = 0.2;

/// A photo being cropped.
#[derive(Clone, Debug)]
pub struct Cropping {
  pub photo: PhotoId,
  pub surface: Surface,
  /// Where the whole photo is, in the surface's units. It moves only when the photo is
  /// dragged behind its frame.
  pub whole: Rect,
  /// The shape kept (width over height), or none for any.
  pub ratio: Option<f64>,
  /// Pinned, the frame stays put and dragging moves the photo behind it.
  pub pinned: bool,
}

/// What a crop drag holds: a handle, or the inside of the frame.
#[derive(Clone, Copy, Debug)]
pub enum CropGrip {
  Handle(CropHandle),
  /// Inside the frame: the crop moves over the photo, or the photo behind the crop.
  Inside {
    move_photo: bool,
  },
}

/// A shape the crop bar offers, as width over height; none is any.
pub struct Shape {
  pub label: &'static str,
  pub ratio: Option<f64>,
}

impl Workspace {
  /// Start cropping a photo where it is now (the desk, or the spread being edited).
  pub fn start_crop(&mut self, photo: &PhotoId, cx: &mut Context<Self>) {
    if self.ui.cropping.is_some() {
      self.finish_crop(true, cx);
    }
    let project = self.project();
    let Some(meta) = project.photos.get(photo) else { return };
    let Some((loc, place)) = act::locate(project, photo) else {
      return;
    };
    let surface = match (&loc, &self.ui.editing) {
      (Location::Desk, None) => Surface::Desk,
      (Location::Spread(s), Some(e)) if s == e => Surface::Editor,
      _ => return,
    };
    let whole = whole_rect(Rect::from(&place), crop_of(meta));
    self.history.begin();
    match surface {
      Surface::Desk => self.ui.selection = vec![photo.clone()],
      Surface::Editor => self.ui.editor_selected = Some(photo.clone()),
    }
    self.ui.cropping = Some(Cropping {
      photo: photo.clone(),
      surface,
      whole,
      ratio: None,
      pinned: false,
    });
    self.drag = None;
    cx.notify();
  }

  /// Leave crop mode, keeping the crop or putting it back.
  pub fn finish_crop(&mut self, keep: bool, cx: &mut Context<Self>) {
    if self.ui.cropping.take().is_none() {
      return;
    }
    if matches!(self.drag, Some(Drag::Crop { .. })) {
      self.drag = None;
    }
    if keep {
      self.history.end();
    } else {
      self.history.cancel();
    }
    self.ui.snap_hit = None;
    self.changed(cx);
  }

  /// A press anywhere (seen before what's pressed): off the cropped photo and its bar, it
  /// keeps the crop.
  pub fn crop_press(&mut self, ev: &MouseDownEvent, cx: &mut Context<Self>) {
    if self.ui.cropping.is_none() {
      return;
    }
    let (x, y) = (f64::from(ev.position.x), f64::from(ev.position.y));
    let on = |r: Option<Rect>| r.is_some_and(|r| x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    if !on(self.frames.crop_zone) && !on(self.frames.crop_bar.get()) {
      self.finish_crop(true, cx);
    }
  }

  /// The crop's frame now (the photo's placement), in the surface's units.
  pub fn crop_frame(&self) -> Option<Rect> {
    let c = self.ui.cropping.as_ref()?;
    act::locate(self.project(), &c.photo).map(|(_, p)| Rect::from(&p))
  }

  /// Show a frame over the whole photo at `whole`, in the project.
  fn show_crop(&mut self, frame: Rect, whole: Rect) {
    let Some(c) = &mut self.ui.cropping else { return };
    c.whole = whole;
    let id = c.photo.clone();
    self.history.preview(|d| act::set_crop_frame(d, &id, frame, whole));
  }

  /// Screen pixels per unit on a surface.
  pub fn surface_scale(&self, surface: Surface) -> f64 {
    match surface {
      Surface::Desk => self.ui.view.scale(),
      Surface::Editor => self.frames.editor.as_ref().map_or(1.0, |e| e.scale),
    }
  }

  /// A rect in a surface's units, in window pixels.
  pub fn surface_to_window(&self, surface: Surface, r: Rect) -> Rect {
    match surface {
      Surface::Desk => {
        let s = self.ui.view.to_screen(r);
        Rect::new(s.x + self.frames.desk.x, s.y + self.frames.desk.y, s.w, s.h)
      }
      Surface::Editor => {
        let Some(e) = &self.frames.editor else { return r };
        Rect::new(
          e.origin.0 + r.x * e.scale,
          e.origin.1 + r.y * e.scale,
          r.w * e.scale,
          r.h * e.scale,
        )
      }
    }
  }

  /// The shapes the crop bar offers.
  pub fn crop_shapes(&self) -> Vec<Shape> {
    let Some(c) = &self.ui.cropping else { return Vec::new() };
    let sheet = self.project().sheet();
    let page = if self.project().layout.arrangement() == sequence_core::Arrangement::Frames {
      "Frame"
    } else {
      "Page"
    };
    vec![
      Shape {
        label: "Original",
        ratio: Some(c.whole.w / c.whole.h),
      },
      Shape {
        label: "1:1",
        ratio: Some(1.0),
      },
      Shape {
        label: "4:5",
        ratio: Some(4.0 / 5.0),
      },
      Shape {
        label: "3:2",
        ratio: Some(3.0 / 2.0),
      },
      Shape {
        label: page,
        ratio: Some(sheet.page_w / sheet.page_h),
      },
      Shape {
        label: "Free",
        ratio: None,
      },
    ]
  }

  /// Keep a shape from the bar (and fit the frame to it), or none for any.
  pub fn choose_crop_shape(&mut self, ratio: Option<f64>, cx: &mut Context<Self>) {
    let Some(c) = &mut self.ui.cropping else { return };
    c.ratio = ratio;
    let whole = c.whole;
    if let (Some(r), Some(frame)) = (ratio, self.crop_frame()) {
      self.show_crop(frame_to_ratio(frame, whole, r), whole);
    }
    cx.notify();
  }

  /// Show all of the photo again.
  pub fn reset_crop(&mut self, cx: &mut Context<Self>) {
    let Some(c) = &mut self.ui.cropping else { return };
    c.ratio = None;
    let whole = c.whole;
    self.show_crop(whole, whole);
    cx.notify();
  }

  pub fn toggle_crop_pin(&mut self, cx: &mut Context<Self>) {
    if let Some(c) = &mut self.ui.cropping {
      c.pinned = !c.pinned;
      cx.notify();
    }
  }

  /// A press on a crop handle or inside the frame.
  pub fn crop_down(&mut self, grip: CropGrip, ev: &MouseDownEvent) {
    if ev.button != MouseButton::Left {
      return;
    }
    let (Some(c), Some(frame)) = (&self.ui.cropping, self.crop_frame()) else {
      return;
    };
    let grip = match grip {
      CropGrip::Inside { .. } => CropGrip::Inside {
        move_photo: c.pinned || ev.modifiers.platform || ev.modifiers.control,
      },
      g => g,
    };
    self.drag = Some(Drag::Crop {
      grip,
      start: (f64::from(ev.position.x), f64::from(ev.position.y)),
      frame0: frame,
      whole0: c.whole,
    });
  }

  /// A crop drag, with the pointer at `at` (window pixels).
  pub fn crop_drag(
    &mut self,
    grip: CropGrip,
    start: (f64, f64),
    frame0: Rect,
    whole0: Rect,
    at: (f64, f64),
    mods: Modifiers,
  ) {
    let Some(c) = &self.ui.cropping else { return };
    let surface = c.surface;
    let ratio = c.ratio;
    let scale = self.surface_scale(surface);
    let (dx, dy) = ((at.0 - start.0) / scale, (at.1 - start.1) / scale);
    let lines = match surface {
      Surface::Editor if !mods.alt => Some(self.editor_snap_lines().1),
      _ => None,
    };
    let threshold = SNAP_PX / scale;
    let (frame, whole, hit) = match grip {
      CropGrip::Handle(h) => {
        let min = match surface {
          Surface::Desk => MIN_DESK_CROP,
          Surface::Editor => units(self.project().page.unit).min_photo,
        };
        // Shift keeps the shape it has; a shape from the bar is kept anyway.
        let keep = ratio.or(mods.shift.then(|| frame0.w / frame0.h));
        let o = CropDrag {
          ratio: keep,
          min,
          lines: lines.as_ref(),
          threshold,
        };
        let (f, hit) = drag_crop_handle(frame0, whole0, h, dx, dy, o);
        (f, whole0, Some(hit))
      }
      CropGrip::Inside { move_photo: true } => (frame0, pan_crop(frame0, whole0, dx, dy), None),
      CropGrip::Inside { move_photo: false } => {
        let (f, hit) = move_crop(frame0, whole0, dx, dy, lines.as_ref(), threshold);
        (f, whole0, Some(hit))
      }
    };
    if surface == Surface::Editor {
      self.ui.snap_hit = hit;
    }
    self.show_crop(frame, whole);
  }

  /// Escape mid-drag: back to where the drag started (still cropping).
  pub fn cancel_crop_drag(&mut self, frame0: Rect, whole0: Rect) {
    self.show_crop(frame0, whole0);
    self.ui.snap_hit = None;
  }

  /// The status bar's hint while cropping.
  pub fn crop_hint(&self) -> Option<String> {
    let c = self.ui.cropping.as_ref()?;
    Some(if c.pinned {
      "Crop pinned: drag to move the photo in it · Return to finish, Esc to cancel".into()
    } else {
      format!(
        "Drag the edges to crop · drag inside to move the crop, ⌘-drag to move the photo · Shift keeps the shape{} · Return to finish, Esc to cancel",
        if c.surface == Surface::Editor {
          " · Option: no snapping"
        } else {
          ""
        }
      )
    })
  }
}
