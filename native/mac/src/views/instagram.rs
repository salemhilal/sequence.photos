//! The Export page's Instagram destination (`InstagramPost.tsx`): a preview of the post as
//! Instagram shows it (a feed post's carousel, or stories), where people are tagged, beside
//! the account, the post's settings, the slides to post, and the caption.

use gpui_kit::component::input::{Input, Textarea};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use sequence_core::geometry::Rect;
use sequence_core::instagram::{
  PostImageLayout, fits, hashtag_count, limits, post_image_layout, ratio_label, slide_size, target_ratio,
};
use sequence_core::model::Unit;
use sequence_core::render_plan::{OutputPage, Per, output_pages, page_region, slide_key};
use sequence_core::{Arrangement, PostFit, PostKind, Tag};

use super::controls::{check, help, segmented};
use super::paint::{SpreadPicture, Tip as _, boxed, x};
use super::text_button;
use crate::assets::{MONO, icon};
use crate::posting::Status;
use crate::theme::Theme;
use crate::workspace::Workspace;

/// Thumbnails' height in the slide picker.
const THUMB_H: f64 = 64.0;
/// Instagram's color for hashtags and mentions.
const INSTAGRAM_LINK: u32 = 0x00376b;

fn section(title: Option<&'static str>, theme: &Theme) -> Div {
  div()
    .flex()
    .flex_col()
    .gap(px(8.0))
    .p(px(12.0))
    .border_b_1()
    .border_color(theme.divider)
    .when_some(title, |d, t| {
      d.child(div().font_weight(FontWeight::SEMIBOLD).text_color(theme.text).child(t))
    })
}

fn warn(text: impl Into<SharedString>, theme: &Theme) -> Div {
  div().text_size(px(12.0)).text_color(theme.warn).child(text.into())
}

/// A count with its thousands grouped: 2,200.
pub fn grouped(n: usize) -> String {
  let s = n.to_string();
  let mut out = String::new();
  for (i, ch) in s.chars().enumerate() {
    if i > 0 && (s.len() - i).is_multiple_of(3) {
      out.push(',');
    }
    out.push(ch);
  }
  out
}

impl Workspace {
  /// A page, drawn at `scale` (pixels per unit) with its top left at `origin`, clipped to it.
  fn slide_picture(&mut self, page: &OutputPage, scale: f64, origin: (f64, f64), theme: &Theme) -> Vec<AnyElement> {
    let project = self.history.shared();
    let sheet = project.sheet();
    let region = page_region(page, &sheet);
    let pic = SpreadPicture {
      spread: page.spread,
      sheet: &sheet,
      scale,
      origin: (origin.0 - region.x * scale, origin.1 - region.y * scale),
      clip: true,
    };
    let mut out = pic.page_elements(theme, None);
    out.push(pic.photo_elements(&mut self.lib, &project, theme));
    out
  }

  /// How the post will look on Instagram, on the stage.
  pub fn instagram_stage(&mut self, stage_w: f64, stage_h: f64, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
    let main = self.frames.main;
    let project = self.history.shared();
    let sheet = project.sheet();
    let post = self.post_state();
    let kind = post.kind.unwrap_or(PostKind::Feed);
    let fit = post.fit.unwrap_or(PostFit::Crop);
    let layout = post_image_layout(slide_size(&sheet), kind, fit);
    let keys = self.chosen_slides();
    let all = output_pages(&project, Per::Page);
    let slides: Vec<OutputPage> = keys
      .iter()
      .filter_map(|k| all.iter().find(|p| slide_key(p) == *k).cloned())
      .collect();
    let mut stage = div()
      .absolute()
      .left_0()
      .top_0()
      .w(x(stage_w))
      .h(x(stage_h))
      .bg(rgb(self.prefs.desk_color))
      .overflow_hidden();
    if slides.is_empty() {
      return stage
        .flex()
        .items_center()
        .justify_center()
        .child(div().text_color(theme.muted).child("Nothing to preview."))
        .into_any_element();
    }
    self.ig.index = self.ig.index.min(slides.len() - 1);
    let at = self.ig.index;
    let total = slides.len();
    let story = kind == PostKind::Story;

    // The media box: the image's shape in the feed; a phone screen (9:16) for stories.
    let aspect = if story {
      9.0 / 16.0
    } else {
      layout.width / layout.height
    };
    let max_w: f64 = if story { 340.0 } else { 440.0 };
    let reserve: f64 = if story { 40.0 } else { 190.0 };
    let w = 160f64.max(max_w.min(stage_w - 80.0).min((stage_h - reserve) * aspect));
    let h = w / aspect;
    let image_w = if story {
      w.min(h * layout.width / layout.height)
    } else {
      w
    };
    let image_h = image_w * layout.height / layout.width;

    let username = self
      .ig
      .connection
      .as_ref()
      .map_or("you".to_string(), |c| c.username.clone());
    let picture = self.profile_picture(cx);
    let initial = username.chars().next().unwrap_or('?').to_uppercase().to_string();
    let avatar = move || {
      let a = div()
        .size(px(32.0))
        .rounded_full()
        .overflow_hidden()
        .flex()
        .items_center()
        .justify_center()
        .bg(rgb(0xdbdbdb))
        .text_color(rgb(0x262626))
        .font_weight(FontWeight::SEMIBOLD);
      match picture.clone() {
        Some(p) => a.child(img(p).size_full().object_fit(ObjectFit::Cover)),
        None => a.child(initial.clone()),
      }
    };
    let head = |light: bool| {
      div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(12.0))
        .py(px(10.0))
        .text_color(if light { rgb(0xffffff) } else { rgb(0x262626) })
        .font_weight(FontWeight::SEMIBOLD)
        .text_size(px(13.0))
        .child(avatar())
        .child(username.clone())
    };

    // The card or screen, centered, in the stage's pixels.
    let (card_w, card_h) = if story { (w, h) } else { (w, h + 52.0 + 90.0) };
    let left = (stage_w - card_w) / 2.0;
    let top = ((stage_h - card_h) / 2.0).max(12.0);
    let media_top = if story { top } else { top + 52.0 };
    // The image inside the media box (stories center it on the screen).
    let image = Rect::new(
      left + (w - image_w) / 2.0,
      media_top + (h - image_h) / 2.0,
      image_w,
      image_h,
    );
    let slide = slides[at];
    let key = slide_key(&slide);
    let image_el = self.tag_layer(&slide, &key, &layout, image, (main.x, main.y), &sheet, theme, cx);

    let arrows = |el: Div, cx: &mut Context<Self>| {
      el.when(at > 0, |d| {
        d.child(div().absolute().left(px(8.0)).top(x(h / 2.0 - 13.0)).child(round_arrow(
          "ig-prev",
          "chevron-left",
          cx.listener(move |ws, _, _, cx| {
            ws.ig.index = at.saturating_sub(1);
            cx.notify();
          }),
        )))
      })
      .when(at + 1 < total, |d| {
        d.child(
          div()
            .absolute()
            .right(px(8.0))
            .top(x(h / 2.0 - 13.0))
            .child(round_arrow(
              "ig-next",
              "chevron-right",
              cx.listener(move |ws, _, _, cx| {
                ws.ig.index = (at + 1).min(total - 1);
                cx.notify();
              }),
            )),
        )
      })
    };

    if story {
      let mut bars = div()
        .absolute()
        .top(px(8.0))
        .left(px(8.0))
        .right(px(8.0))
        .flex()
        .gap(px(3.0));
      for i in 0..total {
        bars = bars.child(div().flex_1().h(px(2.0)).rounded(px(1.0)).bg(if i <= at {
          rgba(0xffffffff)
        } else {
          rgba(0xffffff66)
        }));
      }
      let screen = boxed(Rect::new(left, top, w, h))
        .rounded(px(12.0))
        .overflow_hidden()
        .bg(rgb(0x000000))
        .shadow_lg()
        .child(bars)
        .child(div().absolute().top(px(14.0)).left_0().child(head(true)));
      // The arrows over the image, so the tag layer under them doesn't take their clicks.
      let overlay = arrows(boxed(Rect::new(left, top, w, h)), cx);
      stage = stage.child(screen).child(image_el).child(overlay);
    } else {
      let mut card = boxed(Rect::new(left, top, w, card_h))
        .rounded(px(8.0))
        .overflow_hidden()
        .bg(rgb(0xffffff))
        .border_1()
        .border_color(rgb(0xdbdbdb))
        .shadow_md()
        .child(head(false));
      // Hairlines above and below the image, as Instagram's app draws them, so a white
      // edge still shows where the post starts and ends.
      let media = div().relative().w(x(w)).h(x(h)).bg(rgb(0xffffff));
      // Over the image: the count and the arrows (the tag layer would take their clicks).
      // With hairlines above and below the image, as Instagram's app draws them, so a white
      // edge still shows where the post starts and ends.
      let line: Hsla = rgb(0xdbdbdb).into();
      let mut over = boxed(Rect::new(left, media_top, w, h))
        .child(div().absolute().top_0().left_0().right_0().h(px(1.0)).bg(line))
        .child(div().absolute().bottom_0().left_0().right_0().h(px(1.0)).bg(line));
      if total > 1 {
        over = over.child(
          div()
            .absolute()
            .top(px(10.0))
            .right(px(10.0))
            .px(px(8.0))
            .py(px(2.0))
            .rounded(px(10.0))
            .bg(rgba(0x000000aa))
            .text_color(rgb(0xffffff))
            .text_size(px(12.0))
            .child(format!("{}/{total}", at + 1)),
        );
      }
      card = card.child(media);
      let over = arrows(over, cx);
      let mut dots = div().flex().justify_center().gap(px(4.0)).py(px(8.0)).h(px(22.0));
      if total > 1 {
        for i in 0..total {
          dots = dots.child(
            div()
              .size(px(6.0))
              .rounded_full()
              .bg(if i == at { rgb(0x0095f6) } else { rgb(0xc7c7c7) }),
          );
        }
      }
      card = card.child(dots).child(
        div()
          .px(px(12.0))
          .text_size(px(13.0))
          .text_color(rgb(0x262626))
          .line_height(px(18.0))
          .max_h(px(60.0))
          .overflow_hidden()
          .child(caption_text(&username, post.caption.as_deref().unwrap_or(""))),
      );
      stage = stage.child(card).child(image_el).child(over);
    }
    stage.into_any_element()
  }

  /// A slide's image with the people tagged on it: click a spot to tag someone there, drag a
  /// tag to move it, × to remove it. `image` is in the stage's pixels; `offset`, the stage's
  /// place in the window.
  #[allow(clippy::too_many_arguments)]
  fn tag_layer(
    &mut self,
    slide: &OutputPage,
    key: &str,
    layout: &PostImageLayout,
    image: Rect,
    offset: (f64, f64),
    sheet: &sequence_core::Sheet,
    theme: &Theme,
    cx: &mut Context<Self>,
  ) -> AnyElement {
    let k = image.w / layout.width;
    let s = k * (layout.target.w / layout.source.w);
    let origin = (
      layout.target.x * k - layout.source.x * s,
      layout.target.y * k - layout.source.y * s,
    );
    let mut el = boxed(image).overflow_hidden().bg(rgb(0xffffff));
    for e in self.slide_picture(slide, s * sheet.px_per_unit, origin, theme) {
      el = el.child(e);
    }
    let editable = !self.posting();
    let tags = self.tags_on(key);
    let full = tags.len() >= limits::MAX_TAGS;
    let window_rect = Rect::new(image.x + offset.0, image.y + offset.1, image.w, image.h);
    let k1 = key.to_string();
    let mut layer = div()
      .id("tag-layer")
      .absolute()
      .size_full()
      .when(editable && !full, |d| d.cursor_crosshair())
      .when(editable, |d| {
        d.tip(
          if full {
            format!("Up to {} people per image", limits::MAX_TAGS)
          } else {
            "Click to tag someone here".to_string()
          },
          cx.entity().downgrade(),
        )
      })
      .on_mouse_down(
        MouseButton::Left,
        cx.listener(move |ws, ev: &MouseDownEvent, window, cx| {
          if !editable || full {
            return;
          }
          let (px_, py_) = (f64::from(ev.position.x), f64::from(ev.position.y));
          let fx = (px_ - window_rect.x) / window_rect.w;
          let fy = (py_ - window_rect.y) / window_rect.h;
          ws.start_tag(k1.clone(), fx, fy, window, cx);
          cx.stop_propagation();
        }),
      );
    for t in tags {
      layer = layer.child(self.tag_chip(key, &t, image, window_rect, editable, cx));
    }
    if let Some(d) = &self.ig.draft
      && d.key == key
    {
      layer = layer.child(
        div()
          .absolute()
          .left(x((d.x * image.w - 60.0).clamp(4.0, (image.w - 124.0).max(4.0))))
          .top(x((d.y * image.h + 6.0).clamp(4.0, (image.h - 32.0).max(4.0))))
          .w(px(120.0))
          .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
          .child(Input::new(&d.input)),
      );
    }
    el.child(layer).into_any_element()
  }

  fn tag_chip(
    &mut self,
    key: &str,
    t: &Tag,
    image: Rect,
    window_rect: Rect,
    editable: bool,
    cx: &mut Context<Self>,
  ) -> Div {
    let (k1, k2) = (key.to_string(), key.to_string());
    let (u1, u2) = (t.username.clone(), t.username.clone());
    let (x0, y0) = (t.x, t.y);
    // Centered under its spot, but kept inside the image (as Instagram shows it).
    let chip_w = 16.0 + t.username.chars().count() as f64 * 7.2 + if editable { 15.0 } else { 0.0 };
    let chip_h = 22.0;
    let cx_ = (t.x * image.w - chip_w / 2.0).clamp(4.0, (image.w - chip_w - 4.0).max(4.0));
    let cy_ = (t.y * image.h + 6.0).clamp(4.0, (image.h - chip_h - 4.0).max(4.0));
    div().absolute().left(x(cx_)).top(x(cy_)).child(
      div()
        .id(SharedString::from(format!("tag-{}", t.username)))
        .whitespace_nowrap()
        .flex()
        .items_center()
        .gap(px(4.0))
        .px(px(8.0))
        .py(px(3.0))
        .rounded(px(4.0))
        .bg(rgba(0x000000cc))
        .text_color(rgb(0xffffff))
        .text_size(px(12.0))
        .font_weight(FontWeight::SEMIBOLD)
        .when(editable, |d| d.cursor_move())
        .on_mouse_down(
          MouseButton::Left,
          cx.listener(move |ws, ev: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            if !editable {
              return;
            }
            ws.drag = Some(crate::workspace::gestures::Drag::Tag {
              key: k1.clone(),
              username: u1.clone(),
              start: (f64::from(ev.position.x), f64::from(ev.position.y)),
              at0: (x0, y0),
              size: (window_rect.w, window_rect.h),
            });
          }),
        )
        .child(t.username.clone())
        .when(editable, |d| {
          d.child(
            div()
              .id(SharedString::from(format!("untag-{}", t.username)))
              .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
              .on_click(cx.listener(move |ws, _, _, cx| ws.remove_tag(&k2, &u2, cx)))
              .child(svg().path(icon("x")).size(px(11.0)).text_color(rgb(0xffffff))),
          )
        }),
    )
  }

  /// The panel's sections for Instagram, after the destination picker.
  pub fn instagram_panel(
    &mut self,
    mut panel: Stateful<Div>,
    theme: &Theme,
    window: &mut Window,
    cx: &mut Context<Self>,
  ) -> Stateful<Div> {
    let project = self.history.shared();
    let sheet = project.sheet();
    let post = self.post_state();
    let kind = post.kind.unwrap_or(PostKind::Feed);
    let fit = post.fit.unwrap_or(PostFit::Crop);
    let size = slide_size(&sheet);
    let posting = self.posting();
    let ready = self.instagram_ready();
    let chosen = self.chosen_slides();

    if sheet.unit == Unit::In {
      panel = panel.child(section(None, theme).child(help(
        "Pages are measured in inches, so each slide is made at Instagram’s size.",
        theme,
      )));
    }

    // The account.
    let mut account = section(Some("Account"), theme);
    if ready {
      let name = self
        .ig
        .connection
        .as_ref()
        .map(|c| c.username.clone())
        .unwrap_or_default();
      account = account.child(div().font_family(MONO).child(format!("@{name}")));
    } else {
      let known = self.ig.connection.as_ref().map(|c| c.username.clone());
      account = account.child(help(
        match &known {
          Some(u) => format!("Connect @{u} again to keep posting."),
          None => "Posting goes through your Instagram account. It needs a Business or Creator account.".into(),
        },
        theme,
      ));
      let label = if self.ig.connecting {
        "Opening Instagram…"
      } else if known.is_some() {
        "Reconnect Instagram"
      } else {
        "Connect Instagram"
      };
      account = account.child(div().child(text_button(
        "ig-connect",
        label,
        theme,
        false,
        cx.listener(|ws, _, _, cx| ws.connect_instagram(true, cx)),
      )));
      if let Some((text, is_warn)) = &self.ig.message {
        account = account.child(if *is_warn {
          warn(text.clone(), theme)
        } else {
          help(text.clone(), theme)
        });
      }
    }
    panel = panel.child(account);

    // Feed or stories.
    let n = chosen.len();
    let ws = cx.entity().downgrade();
    panel = panel.child(
      section(Some("Post as"), theme)
        .child(segmented(
          "ig-kind",
          &[(PostKind::Feed, "Feed post"), (PostKind::Story, "Stories")],
          kind,
          theme,
          move |k, _, cx| {
            let _ = ws.update(cx, |ws, cx| {
              if !ws.posting() {
                ws.set_post(true, cx, |p| p.kind = Some(k));
              }
            });
          },
        ))
        .child(help(
          match kind {
            PostKind::Feed if n > 1 => format!("A carousel of {n} slides."),
            PostKind::Feed => "A single image.".into(),
            PostKind::Story => format!("{n} {}, one per slide.", if n == 1 { "story" } else { "stories" }),
          },
          theme,
        )),
    );

    // Shapes Instagram doesn't take.
    if !fits(size, kind) {
      let ratio = target_ratio(size, kind);
      let tall = size.0 / size.1 < ratio;
      let r = ratio_label(size.0 / size.1);
      let ws = cx.entity().downgrade();
      let crop = format!("Crop to {}", ratio_label(ratio));
      let expand = format!("Expand to {}", ratio_label(ratio));
      panel = panel.child(
        section(Some("Size"), theme)
          .child(help(
            if kind == PostKind::Feed {
              format!(
                "These pages have an aspect ratio of {r}. Instagram’s upload API only takes feed posts from {} (tall) to {} (wide), even where the Instagram app takes others.",
                ratio_label(limits::MIN_RATIO),
                ratio_label(limits::MAX_RATIO)
              )
            } else {
              format!("These pages have an aspect ratio of {r}, too tall for stories through Instagram’s upload API.")
            },
            theme,
          ))
          .child(segmented(
            "ig-fit",
            &[(PostFit::Crop, crop.as_str()), (PostFit::Expand, expand.as_str())],
            fit,
            theme,
            move |f, _, cx| {
              let _ = ws.update(cx, |ws, cx| {
                if !ws.posting() {
                  ws.set_post(true, cx, |p| p.fit = Some(f));
                }
              });
            },
          ))
          .child(help(
            if fit == PostFit::Crop {
              format!("Trims the {} of each slide.", if tall { "top and bottom" } else { "sides" })
            } else {
              format!("Adds white margins at the {}.", if tall { "sides" } else { "top and bottom" })
            },
            theme,
          )),
      );
    }

    // The slides.
    let all = output_pages(&project, Per::Page);
    let all_owned: Vec<OutputPage> = all.clone();
    let mut slides_sec = section(Some("Slides"), theme);
    if sheet.arrangement == Arrangement::Spreads {
      slides_sec = slides_sec.child(warn(
        format!(
          "Spreads are posted as their pages: {} slides. Photos across the gutter continue onto the next slide.",
          all.len()
        ),
        theme,
      ));
    }
    let full = n >= limits::MAX_ITEMS;
    let mut grid = div().flex().flex_wrap().gap(px(6.0));
    let scale = THUMB_H / sheet.page_h;
    let thumb_w = sheet.page_w * scale;
    for (i, page) in all_owned.iter().enumerate() {
      let key = slide_key(page);
      let on = chosen.contains(&key);
      let mut pic = div().relative().w(x(thumb_w)).h(x(THUMB_H)).overflow_hidden();
      for e in self.slide_picture(page, scale, (0.0, 0.0), theme) {
        pic = pic.child(e);
      }
      let can = !posting && (on || !full);
      let k = key.clone();
      grid = grid.child(
        div()
          .id(SharedString::from(format!("slide-{key}")))
          .flex()
          .flex_col()
          .gap(px(3.0))
          .p(px(3.0))
          .rounded(px(4.0))
          .border_1()
          .border_color(if on { theme.accent } else { theme.border })
          .when(!on, |d| d.opacity(0.6))
          .child(pic)
          .child(
            div()
              .flex()
              .items_center()
              .gap(px(4.0))
              .font_family(MONO)
              .text_size(px(10.0))
              .child(check(SharedString::from(format!("slide-check-{key}")), "", on, theme))
              .child(format!("{:02}", i + 1)),
          )
          .when(can, |d| {
            d.on_click(cx.listener(move |ws, _, _, cx| ws.toggle_slide(k.clone(), cx)))
          }),
      );
    }
    slides_sec = slides_sec.child(grid);
    let count = format!(
      "{n} of {} chosen.{}",
      limits::MAX_ITEMS,
      if full {
        format!(" Instagram takes up to {} at a time.", limits::MAX_ITEMS)
      } else {
        String::new()
      }
    );
    slides_sec = slides_sec.child(if full { warn(count, theme) } else { help(count, theme) });
    panel = panel.child(slides_sec);

    // People.
    let tagged: usize = chosen.iter().map(|k| self.tags_on(k).len()).sum();
    panel = panel.child(section(Some("People"), theme).child(help(
      format!(
        "{}{}",
        if kind == PostKind::Feed {
          "Click a slide in the preview to tag someone there."
        } else {
          "Click a story in the preview to mention someone there."
        },
        if tagged > 0 {
          format!(" {tagged} tagged.")
        } else {
          String::new()
        }
      ),
      theme,
    )));

    // The caption.
    if kind == PostKind::Feed {
      let caption = post.caption.unwrap_or_default();
      let input = self.caption_input(window, cx);
      let tags = hashtag_count(&caption);
      // Counted as the web app (and Instagram's limit) does: in UTF-16 units.
      let len = caption.encode_utf16().count();
      let over = len > limits::CAPTION_LENGTH || tags > limits::HASHTAGS;
      let counts = format!(
        "{} / {}{}",
        grouped(len),
        grouped(limits::CAPTION_LENGTH),
        if tags > 0 {
          format!(" · {tags} / {} hashtags", limits::HASHTAGS)
        } else {
          String::new()
        }
      );
      panel = panel.child(
        section(Some("Caption"), theme)
          .child(Textarea::new(&input).text_size(px(12.0)).disabled(posting))
          .child(
            div()
              .font_family(MONO)
              .text_size(px(11.0))
              .text_color(if over { theme.warn } else { theme.muted })
              .child(counts),
          ),
      );
    }

    // Posting.
    let mut actions = section(None, theme);
    match self.ig.status.clone() {
      Status::Done(link) => {
        actions = actions.child(div().font_weight(FontWeight::SEMIBOLD).child("Posted to Instagram."));
        if let Some(n) = self.post_previews_notice() {
          actions = actions.child(warn(n, theme));
        }
        if let Some(link) = link {
          actions = actions.child(text_button(
            "ig-view",
            "View on Instagram",
            theme,
            false,
            move |_, _, cx| cx.open_url(&link),
          ));
        }
        actions = actions.child(text_button(
          "ig-done",
          "Done",
          theme,
          false,
          cx.listener(|ws, _, _, cx| ws.finish_post(cx)),
        ));
      }
      status => {
        let problem = if posting { None } else { self.post_problem() };
        let label = if posting { "Posting…" } else { "Post to Instagram" };
        let enabled = !posting && ready && problem.is_none();
        let mut button = text_button(
          "ig-post",
          label,
          theme,
          true,
          cx.listener(move |ws, _, _, cx| {
            if enabled {
              ws.post_to_instagram(cx);
            }
          }),
        )
        .justify_center();
        if !enabled {
          button = button.opacity(0.5);
        }
        actions = actions.child(button);
        if let Status::Posting(step) = status {
          if !matches!(step, sequence_core::instagram::PostStep::Publishing { .. }) {
            actions = actions.child(text_button(
              "ig-cancel",
              "Cancel",
              theme,
              false,
              cx.listener(|ws, _, _, cx| ws.cancel_post(cx)),
            ));
          }
          actions = actions.child(help(step.label(), theme));
        }
        if let Status::Failed(m) = &self.ig.status {
          actions = actions.child(warn(m.clone(), theme));
        }
        if let Some(p) = problem {
          actions = actions.child(warn(p, theme));
        }
      }
    }
    // Kept at the panel's foot, as on the web.
    panel
      .child(div().flex_1().min_h(px(8.0)))
      .child(actions.border_b_0().border_t_1())
  }
}

/// The preview's ‹ › buttons.
fn round_arrow(
  id: &'static str,
  name: &'static str,
  click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
  div()
    .id(id)
    .size(px(26.0))
    .rounded_full()
    .flex()
    .items_center()
    .justify_center()
    .bg(rgba(0xffffffdd))
    .shadow_sm()
    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
    .on_click(click)
    .child(svg().path(icon(name)).size(px(14.0)).text_color(rgb(0x262626)))
}

/// A caption with the username first and its hashtags and mentions in Instagram's link color.
fn caption_text(username: &str, text: &str) -> StyledText {
  let full = format!("{username} {text}");
  let mut highlights = vec![(
    0..username.len(),
    HighlightStyle {
      font_weight: Some(FontWeight::SEMIBOLD),
      ..Default::default()
    },
  )];
  let link: Hsla = rgb(INSTAGRAM_LINK).into();
  let base = username.len() + 1;
  let chars: Vec<(usize, char)> = text.char_indices().collect();
  let mut i = 0;
  while i < chars.len() {
    let (start, c) = chars[i];
    let at_word = i == 0 || chars[i - 1].1.is_whitespace();
    if (c == '#' || c == '@') && at_word {
      let mut j = i + 1;
      while j < chars.len() && (chars[j].1.is_alphanumeric() || chars[j].1 == '_' || chars[j].1 == '.') {
        j += 1;
      }
      if j > i + 1 {
        let end = chars.get(j).map_or(text.len(), |c| c.0);
        highlights.push((
          base + start..base + end,
          HighlightStyle {
            color: Some(link),
            ..Default::default()
          },
        ));
        i = j;
        continue;
      }
    }
    i += 1;
  }
  StyledText::new(full).with_highlights(highlights)
}
