//! Small controls shared by the panels and the Settings window, in the web app's look
//! (`Segmented.tsx`, the checkboxes and help text in `styles.css`).

use std::rc::Rc;

use gpui_kit::*;

use crate::assets::icon;
use crate::theme::Theme;

/// A row of choices, one on: its raised highlight slides to the choice picked.
pub fn segmented<T: Copy + PartialEq + 'static>(
  id: &'static str,
  options: &[(T, &str)],
  value: T,
  theme: &Theme,
  on: impl Fn(T, &mut Window, &mut App) + 'static,
) -> Div {
  let on = Rc::new(on);
  let n = options.len().max(1);
  let chosen = options.iter().position(|(v, _)| *v == value);
  let mut row = div()
    .relative()
    .flex()
    .p(px(2.0))
    .gap(px(2.0))
    .rounded(px(4.0))
    .bg(theme.track);
  // The highlight, under the labels, gliding from the last choice to this one.
  if let Some(to) = chosen {
    let slide = crate::motion::slide(id, to);
    let control = theme.control;
    let pill = div()
      .absolute()
      .top(px(2.0))
      .bottom(px(2.0))
      .w(relative(1.0 / n as f32))
      .px(px(1.0))
      .child(div().size_full().rounded(px(3.0)).bg(control).shadow_xs());
    row = row.child(div().absolute().top_0().bottom_0().left(px(2.0)).right(px(2.0)).child(
      pill.left(relative(slide.to as f32 / n as f32)).with_animation(
        SharedString::from(format!("{id}-slide-{}", slide.n)),
        crate::motion::ease(crate::motion::TOGGLE),
        move |el, t| el.left(relative(slide.at(t) / n as f32)),
      ),
    ));
  }
  for (i, &(v, label)) in options.iter().enumerate() {
    let on = on.clone();
    let on_it = Some(i) == chosen;
    row = row.child(
      div()
        .id((id, i))
        .relative()
        .flex_1()
        .flex()
        .justify_center()
        .h(px(22.0))
        .items_center()
        .px(px(8.0))
        .rounded(px(3.0))
        .text_color(if on_it { theme.text } else { theme.muted })
        .child(label.to_string())
        .on_click(move |_, window, cx| on(v, window, cx)),
    );
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

/// A radio button and its label: one choice of several.
pub fn radio(id: impl Into<ElementId>, label: &'static str, on: bool, theme: &Theme) -> Stateful<Div> {
  let mut b = div()
    .size(px(14.0))
    .flex()
    .items_center()
    .justify_center()
    .rounded_full()
    .border_1()
    .border_color(theme.border_strong)
    .bg(theme.control);
  if on {
    b = b
      .bg(theme.accent)
      .border_color(theme.accent)
      .child(div().size(px(5.0)).rounded_full().bg(theme.on_accent));
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

/// ‹ 2 / 6 › below a spread or page (`Pager`): Layout's and Export's previews, and the
/// spread editor. `extra` follows the count (an export page's size). `go` hears -1 or 1.
pub fn pager(
  id: &'static str,
  at: usize,
  count: usize,
  extra: String,
  theme: &Theme,
  go: impl Fn(isize, &mut Window, &mut App) + 'static,
) -> Div {
  let go = Rc::new(go);
  let (back, on) = (go.clone(), go);
  div()
    .absolute()
    .left_0()
    .right_0()
    .bottom(px(12.0))
    .flex()
    .justify_center()
    .child(
      div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(6.0))
        .py(px(2.0))
        .rounded(px(3.0))
        .bg(theme.panel)
        .shadow_sm()
        .child(super::icon_button(
          (id, 0usize),
          "chevron-left",
          theme,
          at > 0,
          false,
          move |_, w, cx| back(-1, w, cx),
        ))
        .child(
          div()
            .font_family(crate::assets::MONO)
            .text_size(px(11.0))
            .text_color(theme.muted)
            .child(format!("{} / {count}{extra}", at + 1)),
        )
        .child(super::icon_button(
          (id, 1usize),
          "chevron-right",
          theme,
          at + 1 < count,
          false,
          move |_, w, cx| on(1, w, cx),
        )),
    )
}
