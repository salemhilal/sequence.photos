//! Number fields (`NumberField.tsx`): a text input per value, kept across frames by what
//! it edits. A value is committed on Return or when the field loses focus; until then the
//! field keeps what's typed, and it follows the project whenever it isn't being edited.

use std::collections::HashMap;

use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::GuideId;

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
}

impl Fields {
  /// Forget fields for things that went away (a removed guide).
  pub fn retain(&mut self, keep: impl Fn(&Field) -> bool) {
    self.inputs.retain(|f, _| keep(f));
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
    let state = match self.fields.inputs.get(&field) {
      Some(s) => s.clone(),
      None => {
        let s = cx.new(|cx| InputState::new(window, cx).default_value(text.clone()));
        let f = field.clone();
        cx.subscribe_in(&s, window, move |ws, state, ev: &InputEvent, window, cx| {
          if matches!(ev, InputEvent::PressEnter { .. } | InputEvent::Blur) {
            let typed = state.read(cx).value().to_string();
            ws.field_committed(f.clone(), &typed, window, cx);
          }
        })
        .detach();
        self.fields.inputs.insert(field.clone(), s.clone());
        s
      }
    };
    // Follow the project while it isn't being typed in.
    let focused = state.read(cx).focus_handle(cx).is_focused(window);
    if !focused && state.read(cx).value().as_ref() != text {
      state.update(cx, |s, cx| s.set_value(text, window, cx));
    }
    let mut row = div().flex().items_center().gap(px(6.0)).min_w_0();
    if let Some(l) = label {
      row = row.child(div().w(px(52.0)).flex_none().text_color(theme.muted).child(l));
    }
    row
      .child(
        div()
          .flex_1()
          .min_w_0()
          .when(!enabled, |d| d.opacity(0.5))
          .child(Input::new(&state).disabled(!enabled)),
      )
      .into_any_element()
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
