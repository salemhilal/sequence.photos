//! The app's motion, in one place: how long things take, and the bookkeeping that lets a
//! control's highlight slide from where it was to where it is now (GPUI animates an
//! element when it first appears, so each move is drawn as a new element, from → to).

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::Duration;

use gpui_kit::{Animation, ease_out_quint};

/// A toggle's highlight sliding to the choice picked.
pub const TOGGLE: Duration = Duration::from_millis(180);
/// A selection's frame fading in or out.
pub const FADE: Duration = Duration::from_millis(110);
/// A menu or Quick Look appearing.
pub const POP: Duration = Duration::from_millis(140);
/// Preview turning to the next spread or the one before.
pub const TURN: Duration = Duration::from_millis(220);
/// Spreads gliding to their new places in the sidebar.
pub const GLIDE: Duration = Duration::from_millis(200);

thread_local! {
  static SLIDES: RefCell<HashMap<String, Slide>> = RefCell::new(HashMap::new());
}

/// A highlight's move: from which choice to which, and which move it is (for its id).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slide {
  pub from: usize,
  pub to: usize,
  pub n: u64,
}

impl Slide {
  /// Where the highlight is, `t` (0 to 1) of the way.
  pub fn at(&self, t: f32) -> f32 {
    self.from as f32 + (self.to as f32 - self.from as f32) * t
  }
}

/// The highlight of the control `key` now on choice `to`: a new move when it changed.
pub fn slide(key: &str, to: usize) -> Slide {
  SLIDES.with(|s| {
    let mut s = s.borrow_mut();
    let e = s.entry(key.to_string()).or_insert(Slide { from: to, to, n: 0 });
    if e.to != to {
      *e = Slide {
        from: e.to,
        to,
        n: e.n + 1,
      };
    }
    *e
  })
}

/// An animation of `d`, easing out.
pub fn ease(d: Duration) -> Animation {
  Animation::new(d).with_easing(ease_out_quint())
}
