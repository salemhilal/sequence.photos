//! Small controls shared by the panels and the Settings window, in the web app's look
//! (`Segmented.tsx`, the checkboxes and help text in `styles.css`).

use std::rc::Rc;

use gpui_kit::*;

use crate::assets::icon;
use crate::theme::Theme;

/// A row of choices, one on.
pub fn segmented<T: Copy + PartialEq + 'static>(
  id: &'static str,
  options: &[(T, &str)],
  value: T,
  theme: &Theme,
  on: impl Fn(T, &mut Window, &mut App) + 'static,
) -> Div {
  let on = Rc::new(on);
  let mut row = div().flex().p(px(2.0)).gap(px(2.0)).rounded(px(4.0)).bg(theme.track);
  for (i, &(v, label)) in options.iter().enumerate() {
    let on = on.clone();
    let chosen = v == value;
    let mut b = div()
      .id((id, i))
      .flex_1()
      .flex()
      .justify_center()
      .h(px(22.0))
      .items_center()
      .px(px(8.0))
      .rounded(px(3.0))
      .text_color(if chosen { theme.text } else { theme.muted })
      .child(label.to_string())
      .on_click(move |_, window, cx| on(v, window, cx));
    if chosen {
      b = b.bg(theme.control).shadow_xs();
    }
    row = row.child(b);
  }
  row
}

/// A labelled row of the panel.
pub fn field_row(label: impl Into<SharedString>, theme: &Theme, content: impl IntoElement) -> Div {
  div()
    .flex()
    .items_start()
    .gap(px(8.0))
    .child(
      div()
        .w(px(78.0))
        .flex_none()
        .pt(px(4.0))
        .text_color(theme.muted)
        .child(label.into()),
    )
    .child(div().flex_1().min_w_0().child(content))
}

pub fn help(text: impl Into<SharedString>, theme: &Theme) -> Div {
  div().text_color(theme.muted).text_size(px(11.0)).child(text.into())
}

/// A checkbox and its label.
pub fn check(id: impl Into<ElementId>, label: &'static str, on: bool, theme: &Theme) -> Stateful<Div> {
  let mut b = div()
    .w(px(14.0))
    .h(px(14.0))
    .flex()
    .items_center()
    .justify_center()
    .rounded(px(3.0))
    .border_1()
    .border_color(theme.border_strong)
    .bg(theme.control);
  if on {
    b = b
      .bg(theme.accent)
      .border_color(theme.accent)
      .child(svg().path(icon("check")).size(px(11.0)).text_color(theme.on_accent));
  }
  div()
    .id(id)
    .flex()
    .items_center()
    .gap(px(6.0))
    .px(px(4.0))
    .py(px(2.0))
    .rounded(px(3.0))
    .child(b)
    .child(label)
}
