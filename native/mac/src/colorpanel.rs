//! The system's color panel, as the web app's color inputs open it in the Mac app: a
//! color picked there (or with its eyedropper) is heard as it changes, for as long as the
//! panel is open and no other color is being picked.

use std::cell::Cell;
use std::time::Duration;

use gpui_kit::*;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSColor, NSColorPanel, NSColorSpace};

thread_local! {
  /// Which pick the panel is for: a new one stops hearing for the one before.
  static PICK: Cell<u64> = const { Cell::new(0) };
}

/// How often the open panel is read.
const POLL: Duration = Duration::from_millis(80);

/// The panel's color, as sRGB bytes.
fn read(panel: &NSColorPanel) -> Option<[u8; 3]> {
  let c = panel.color().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
  let b = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
  Some([b(c.redComponent()), b(c.greenComponent()), b(c.blueComponent())])
}

/// Open the color panel at `initial`, and hear each color picked in it until it's closed
/// (or another pick starts).
pub fn pick(initial: [u8; 3], cx: &mut App, on_change: impl Fn([u8; 3], &mut App) + 'static) {
  let Some(mtm) = MainThreadMarker::new() else { return };
  let panel = NSColorPanel::sharedColorPanel(mtm);
  let f = |v: u8| f64::from(v) / 255.0;
  let color = NSColor::colorWithSRGBRed_green_blue_alpha(f(initial[0]), f(initial[1]), f(initial[2]), 1.0);
  panel.setShowsAlpha(false);
  panel.setContinuous(true);
  panel.setColor(&color);
  panel.orderFront(None);
  let id = PICK.with(|p| {
    p.set(p.get() + 1);
    p.get()
  });
  let mut last = initial;
  cx.spawn(async move |cx| {
    loop {
      cx.background_executor().timer(POLL).await;
      if PICK.with(|p| p.get()) != id {
        break;
      }
      let Some(mtm) = MainThreadMarker::new() else { break };
      let panel = NSColorPanel::sharedColorPanel(mtm);
      if !panel.isVisible() {
        break;
      }
      if let Some(now) = read(&panel)
        && now != last
      {
        last = now;
        cx.update(|cx| on_change(now, cx));
      }
    }
  })
  .detach();
}
