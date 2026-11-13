//! The web app's look (`src/styles.css`): gray steps for the window, panels, headers, and
//! controls; a photographic middle gray for the desk; amber for selection; blue for guides.

use gpui_kit::{Hsla, Rgba, WindowAppearance, rgb, rgba};

/// The colors, in light or dark (all of the web app's tokens, some not drawn yet).
#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub struct Theme {
  pub bg: Hsla,
  pub panel: Hsla,
  pub header: Hsla,
  pub control: Hsla,
  pub inset: Hsla,
  pub track: Hsla,
  pub divider: Hsla,
  pub desk: Hsla,
  pub text: Hsla,
  pub muted: Hsla,
  pub hover: Hsla,
  pub fill: Hsla,
  pub border: Hsla,
  pub border_strong: Hsla,
  pub accent: Hsla,
  pub on_accent: Hsla,
  pub accent_ink: Hsla,
  pub accent_soft: Hsla,
  pub guide: Hsla,
  pub guide_hit: Hsla,
  pub guide_center: Hsla,
  pub page: Hsla,
  pub page_edge: Hsla,
  pub warn: Hsla,
  pub danger: Hsla,
  /// A slider's knob (`--knob`).
  pub knob: Hsla,
}

fn c(v: Rgba) -> Hsla {
  v.into()
}

impl Theme {
  pub fn light() -> Self {
    Self {
      bg: c(rgb(0xe3e3e3)),
      panel: c(rgb(0xf0f0f0)),
      header: c(rgb(0xe8e8e8)),
      control: c(rgb(0xfbfbfb)),
      inset: c(rgb(0xe6e6e6)),
      track: c(rgba(0x00000014)),
      divider: c(rgb(0xc6c6c6)),
      desk: c(rgb(0x787878)),
      text: c(rgb(0x1c1c1c)),
      muted: c(rgb(0x6b6b6b)),
      hover: c(rgba(0x0000000f)),
      fill: c(rgba(0x0000000d)),
      border: c(rgba(0x00000017)),
      border_strong: c(rgba(0x0000002e)),
      accent: c(rgb(0xe0a13a)),
      on_accent: c(rgb(0x1f1606)),
      accent_ink: c(rgb(0x94600f)),
      accent_soft: c(rgba(0xe0a13a33)),
      guide: c(rgba(0x4ab2d680)),
      guide_hit: c(rgb(0x1f9fcc)),
      guide_center: c(rgba(0xce46aa8c)),
      page: c(rgb(0xffffff)),
      page_edge: c(rgba(0x00000047)),
      warn: c(rgb(0xa8620a)),
      danger: c(rgb(0xc2412d)),
      knob: c(rgb(0xffffff)),
    }
  }

  pub fn dark() -> Self {
    Self {
      bg: c(rgb(0x1b1b1b)),
      panel: c(rgb(0x242424)),
      header: c(rgb(0x2c2c2c)),
      control: c(rgb(0x333333)),
      inset: c(rgb(0x181818)),
      track: c(rgb(0x181818)),
      divider: c(rgb(0x0e0e0e)),
      text: c(rgb(0xe6e6e6)),
      muted: c(rgb(0x8e8e8e)),
      hover: c(rgba(0xffffff12)),
      fill: c(rgba(0xffffff0f)),
      border: c(rgba(0xffffff14)),
      border_strong: c(rgba(0xffffff29)),
      accent_ink: c(rgb(0xe0a13a)),
      accent_soft: c(rgba(0xe0a13a2e)),
      page: c(rgb(0xefede8)),
      warn: c(rgb(0xf0a44b)),
      danger: c(rgb(0xf07a62)),
      knob: c(rgb(0xcfcfcf)),
      ..Self::light()
    }
  }

  /// The theme for a window's appearance (or a forced one).
  pub fn for_appearance(appearance: WindowAppearance, pref: ThemePref) -> Self {
    let dark = match pref {
      ThemePref::Light => false,
      ThemePref::Dark => true,
      ThemePref::System => matches!(appearance, WindowAppearance::Dark | WindowAppearance::VibrantDark),
    };
    if dark { Self::dark() } else { Self::light() }
  }
}

impl Theme {
  /// Whether this is the dark theme.
  pub fn is_dark(&self) -> bool {
    self.bg == Self::dark().bg
  }

  /// Give the components the app borrows (text fields, the slider) its colors, in light
  /// or dark, rather than their library's own.
  pub fn apply_to_components(&self, cx: &mut gpui_kit::App) {
    use gpui_kit::component::theme::{Theme as Components, ThemeMode};
    let t = *self;
    Components::change(if t.is_dark() { ThemeMode::Dark } else { ThemeMode::Light }, None, cx);
    Components::update(cx, |c| {
      c.colors.background = t.control;
      c.colors.input = t.border_strong;
      c.colors.border = t.border_strong;
      c.colors.foreground = t.text;
      c.colors.muted_foreground = t.muted;
      c.colors.ring = t.accent;
      c.colors.caret = t.text;
      c.colors.selection = t.accent.opacity(0.35);
      c.colors.accent = t.hover;
      c.colors.primary = t.accent;
      c.colors.popover = t.panel;
      c.colors.popover_foreground = t.text;
    });
  }
}

/// The theme setting.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePref {
  #[default]
  System,
  Light,
  Dark,
}

/// Desk colors, darkest to lightest, all neutral (`src/deskColor.ts`).
pub const DESK_COLORS: &[(&str, u32)] = &[
  ("Black", 0x000000),
  ("Dark gray", 0x3b3b3b),
  ("Neutral gray", 0x787878),
  ("Light gray", 0xb3b3b3),
  ("White", 0xffffff),
];

/// The default desk color.
pub const DEFAULT_DESK: u32 = 0x787878;

/// Whether text on a desk of this color should be dark (WCAG luminance over 0.3).
pub fn desk_is_light(color: u32) -> bool {
  let ch = |shift: u32| {
    let v = f64::from((color >> shift) & 0xff) / 255.0;
    if v <= 0.03928 {
      v / 12.92
    } else {
      ((v + 0.055) / 1.055).powf(2.4)
    }
  };
  0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0) > 0.3
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn light_and_dark_desks() {
    assert!(desk_is_light(0xffffff));
    assert!(!desk_is_light(0x3b3b3b));
  }
}
