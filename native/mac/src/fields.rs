//! Number fields (`NumberField.tsx`): a text input per value, kept across frames by what
//! it edits. A value is committed on Return or when the field loses focus; until then the
//! field keeps what's typed, and it follows the project whenever it isn't being edited.

use std::collections::HashMap;

use gpui_kit::component::Sizable as _;
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::GuideId;

use crate::assets::MONO;
use crate::theme::Theme;
use crate::workspace::Workspace;

/// What a number field edits.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Field {
  /// The Page tab's width and height, and its dpi.
  PageW,
  PageH,
  Dpi,
  /// A border guide's distance from an edge (top, bottom, inside, outside).
  Border(GuideId, usize),
  /// A line guide's distance.
  Line(GuideId),
  /// The Export page's dpi (inches projects' photos) and a pixel project's printed dpi.
  ExportDpi,
  PrintAt,
  /// The editor's selected photo: its X, Y, W, H (0 to 3).
  Item(usize),
}

/// The fields' inputs, by what they edit.
#[derive(Default)]
pub struct Fields {
  inputs: HashMap<Field, Entity<InputState>>,
  /// What each field last showed of the project (or had committed): text that's still the
  /// same when the field is left wasn't edited, so nothing is committed.
  shown: HashMap<Field, String>,
  /// The photo the editor's X, Y, W, H fields are for. It stays the photo they were typed
  /// for while one has the keyboard, so a value left by clicking another photo isn't given
  /// to that one.
  pub item_for: Option<sequence_core::PhotoId>,
}

impl Fields {
  /// Forget fields for things that went away (a removed guide).
  pub fn retain(&mut self, keep: impl Fn(&Field) -> bool) {
    self.inputs.retain(|f, _| keep(f));
    self.shown.retain(|f, _| keep(f));
  }
}

impl Fields {
  /// Whether one of the editor's X, Y, W, H fields has the keyboard.
  pub fn item_focused(&self, window: &Window, cx: &App) -> bool {
    self
      .inputs
      .iter()
      .any(|(f, s)| matches!(f, Field::Item(_)) && s.read(cx).focus_handle(cx).is_focused(window))
  }
}

/// A number typed in a field: the first number in it (a unit after it is fine).
pub fn parse_number(text: &str) -> Option<f64> {
  let t = text.trim();
  let end = t
    .char_indices()
    .find(|&(i, c)| !(c.is_ascii_digit() || c == '.' || (i == 0 && (c == '-' || c == '+'))))
    .map_or(t.len(), |(i, _)| i);
  t[..end].parse::<f64>().ok().filter(|n| n.is_finite())
}

impl Workspace {
  /// How much a number field's value steps by: the unit's step for a distance, one for a dpi.
  pub fn field_step(&self, field: &Field) -> f64 {
    let unit = match (field, &self.ui.layout) {
      (Field::Dpi | Field::ExportDpi | Field::PrintAt, _) => return 1.0,
      (Field::PageW | Field::PageH, Some(l)) => l.draft.page.unit,
      _ => self.project().page.unit,
    };
    sequence_core::units::units(unit).field_step
  }

  /// A number field showing `text` (the value, formatted), with a label before it.
  #[allow(clippy::too_many_arguments)] // a field's own settings, plus GPUI's window and context
  pub fn number_field(
    &mut self,
    field: Field,
    label: Option<&'static str>,
    text: String,
    enabled: bool,
    theme: &Theme,
    window: &mut Window,
    cx: &mut Context<Self>,
  ) -> AnyElement {
    // "10 in": the number in the field, the unit after it (`.num-suffix`).
    let (text, suffix) = match text.rsplit_once(' ') {
      Some((n, u)) if parse_number(n).is_some() && parse_number(u).is_none() => (n.to_string(), Some(u.to_string())),
      _ => (text, None),
    };
    let shown = text.clone();
    let state = match self.fields.inputs.get(&field) {
      Some(s) => s.clone(),
      None => {
        let s = cx.new(|cx| InputState::new(window, cx).default_value(text.clone()));
        let f = field.clone();
        cx.subscribe_in(&s, window, move |ws, state, ev: &InputEvent, window, cx| {
          if matches!(ev, InputEvent::PressEnter { .. } | InputEvent::Blur) {
            let typed = state.read(cx).value().to_string();
            // Left as it was: committing the rounded number it shows would change the value.
            if ws.fields.shown.get(&f) == Some(&typed) {
              return;
            }
            ws.fields.shown.insert(f.clone(), typed.clone());
            ws.field_committed(f.clone(), &typed, window, cx);
          }
        })
        .detach();
        self.fields.inputs.insert(field.clone(), s.clone());
        self.fields.shown.insert(field.clone(), text.clone());
        s
      }
    };
    // Follow the project while it isn't being typed in.
    let focused = state.read(cx).focus_handle(cx).is_focused(window);
    if !focused && state.read(cx).value().as_ref() != text {
      self.fields.shown.insert(field.clone(), text.clone());
      state.update(cx, |s, cx| s.set_value(text, window, cx));
    }
    // As the web's `.num-field`: a recessed box, the label and unit inside it in mono (drag
    // either sideways to scrub the value), the value in mono too. A word for a label (Photos
    // at) sits before the box instead.
    let focused_ring = focused;
    let scrub = parse_number(&shown).filter(|_| enabled);
    let scrubber = |el: Div, cx: &mut Context<Self>| -> Div {
      let Some(value) = scrub else { return el };
      let f = field.clone();
      el.cursor(CursorStyle::ResizeLeftRight).on_mouse_down(
        MouseButton::Left,
        cx.listener(move |ws, ev: &MouseDownEvent, _, _| {
          let step = ws.field_step(&f);
          ws.drag = Some(crate::workspace::Drag::Scrub {
            field: f.clone(),
            start: f64::from(ev.position.x),
            value0: value,
            step,
            last: value,
            moved: false,
          });
        }),
      )
    };
    let mono = |el: Div| {
      el.flex_none()
        .font_family(MONO)
        .text_size(px(11.0))
        .text_color(theme.muted)
    };
    let inside = label.filter(|l| l.chars().count() <= 2);
    let mut field_box = div()
      .flex()
      .flex_1()
      .items_center()
      .gap(px(4.0))
      .min_w_0()
      .h(px(24.0))
      .px(px(6.0))
      .rounded(px(3.0))
      .bg(theme.inset)
      .border_1()
      .border_color(if focused_ring { theme.accent } else { theme.border })
      .when(!enabled, |d| d.opacity(0.5));
    if let Some(l) = inside {
      field_box = field_box.child(scrubber(mono(div().min_w(px(12.0)).child(l)), cx));
    }
    field_box = field_box.child(
      div().flex_1().min_w_0().font_family(MONO).text_size(px(12.0)).child(
        Input::new(&state)
          .appearance(false)
          .small()
          .font_family(MONO)
          .text_size(px(12.0))
          .disabled(!enabled),
      ),
    );
    if let Some(u) = suffix {
      field_box = field_box.child(scrubber(mono(div().child(u)), cx));
    }
    let mut row = div().flex().items_center().gap(px(6.0)).min_w_0();
    if let Some(l) = label.filter(|l| l.chars().count() > 2) {
      row = row.child(div().w(px(72.0)).flex_none().text_color(theme.muted).child(l));
    }
    row.child(field_box).into_any_element()
  }
}

#[cfg(test)]
mod tests {
  use super::parse_number;

  #[test]
  fn numbers_as_typed() {
    assert_eq!(parse_number(" 10.5 "), Some(10.5));
    assert_eq!(parse_number("8 in"), Some(8.0));
    assert_eq!(parse_number("-0.25"), Some(-0.25));
    assert_eq!(parse_number("abc"), None);
    assert_eq!(parse_number(""), None);
  }
}
