//! The Export page's Instagram destination, as state and actions (`InstagramPost.tsx`,
//! `instagram.ts`): the account, the post being written (kept with the project, outside
//! undo), connecting through the browser, and posting in the background.

use std::sync::Arc;

use gpui_kit::component::input::{InputEvent, TextareaState};
use gpui_kit::*;
use sequence_core::instagram::{
  Connection, PostStep, SIGN_IN_IN_BROWSER, SignInReturn, add_tag, limits, move_tag, parse_sign_in_return,
  post_image_layout, sign_in_error_message, slide_size,
};
use sequence_core::model::{ExportState, InstagramState};
use sequence_core::render_plan::{OutputPage, Per, first_non_empty, output_pages, plan_page, slide_key};
use sequence_core::{PostFit, PostKind, Tag};

use crate::export::PREVIEWS_NOTICE;
use crate::instagram::{self as ig, Cancel, Failure, Pending, Post};
use crate::workspace::{Page, Workspace};

/// Where a post has got.
#[derive(Clone, Debug, Default)]
pub enum Status {
  #[default]
  Idle,
  Posting(PostStep),
  /// Posted, with its link if Instagram gave one.
  Done(Option<String>),
  Failed(String),
}

/// A tag being typed: on which slide, and where (in fractions of its image).
pub struct DraftTag {
  pub key: String,
  pub x: f64,
  pub y: f64,
  pub input: Entity<gpui_kit::component::input::InputState>,
}

/// Instagram's own state: the account, signing in, and the post under way.
#[derive(Default)]
pub struct InstagramUi {
  pub connection: Option<Connection>,
  pub pending: Option<Pending>,
  /// A sign-in started from Export comes back to it.
  pub return_to_export: bool,
  pub connecting: bool,
  /// What the Connect button has to say (and whether it's a warning).
  pub message: Option<(String, bool)>,
  /// The profile picture, for the connection's token it was fetched with.
  pub picture: Option<(String, Option<Arc<Image>>)>,
  /// The post being written, as saved with the project.
  pub post: Option<InstagramState>,
  pub status: Status,
  pub cancel: Option<Cancel>,
  /// Photos that went out at preview size.
  pub previews: usize,
  /// The slide the preview shows.
  pub index: usize,
  pub caption: Option<Entity<TextareaState>>,
  pub draft: Option<DraftTag>,
}

impl Workspace {
  /// Whether a post is under way (the page can't be left meanwhile).
  pub fn posting(&self) -> bool {
    matches!(self.ig.status, Status::Posting(_))
  }

  /// Whether the connection can post.
  pub fn instagram_ready(&self) -> bool {
    self
      .ig
      .connection
      .as_ref()
      .is_some_and(|c| !c.needs_reconnect && c.expires_at > ig::now_s())
  }

  /// Every page or frame, in order: spreads are torn into their pages.
  pub fn all_slides(&self) -> Vec<OutputPage<'_>> {
    output_pages(self.project(), Per::Page)
  }

  /// The post as it was left, else the defaults: the first 10 slides with photos.
  pub fn post_state(&mut self) -> InstagramState {
    if let Some(p) = &self.ig.post {
      return p.clone();
    }
    let project = self.project();
    let saved = project
      .export
      .as_ref()
      .and_then(|e| e.instagram.clone())
      .unwrap_or_default();
    let keys: Vec<String> = output_pages(project, Per::Page).iter().map(slide_key).collect();
    let kept: Vec<String> = saved
      .chosen
      .clone()
      .unwrap_or_default()
      .into_iter()
      .filter(|k| keys.contains(k))
      .collect();
    let chosen = if kept.is_empty() {
      first_non_empty(&output_pages(project, Per::Page), &project.sheet(), limits::MAX_ITEMS)
    } else {
      kept
    };
    let state = InstagramState {
      kind: Some(saved.kind.unwrap_or(PostKind::Feed)),
      fit: Some(saved.fit.unwrap_or(PostFit::Crop)),
      caption: saved.caption,
      chosen: Some(chosen),
      tags: saved.tags,
    };
    self.ig.post = Some(state.clone());
    state
  }

  /// Change the post; `save` keeps it with the project (not while a tag's being dragged).
  pub fn set_post(&mut self, save: bool, cx: &mut Context<Self>, change: impl FnOnce(&mut InstagramState)) {
    let mut p = self.post_state();
    change(&mut p);
    self.ig.post = Some(p);
    if save {
      self.save_post(cx);
    }
    cx.notify();
  }

  /// Keep the post with the project, with empty tag lists and caption left out.
  pub fn save_post(&mut self, cx: &mut Context<Self>) {
    let Some(mut p) = self.ig.post.clone() else { return };
    if let Some(tags) = &mut p.tags {
      tags.retain(|_, list| !list.is_empty());
      if tags.is_empty() {
        p.tags = None;
      }
    }
    if p.caption.as_deref() == Some("") {
      p.caption = None;
    }
    self.save_export_state(cx, |s: &mut ExportState| s.instagram = Some(p));
  }

  /// The slides chosen, in the document's order.
  pub fn chosen_slides(&mut self) -> Vec<String> {
    let chosen = self.post_state().chosen.unwrap_or_default();
    self
      .all_slides()
      .iter()
      .map(slide_key)
      .filter(|k| chosen.contains(k))
      .collect()
  }

  pub fn toggle_slide(&mut self, key: String, cx: &mut Context<Self>) {
    let keys: Vec<String> = self.all_slides().iter().map(slide_key).collect();
    self.set_post(true, cx, |p| {
      let mut chosen: Vec<String> = p.chosen.take().unwrap_or_default();
      chosen.retain(|k| keys.contains(k));
      if let Some(i) = chosen.iter().position(|k| *k == key) {
        chosen.remove(i);
      } else if chosen.len() < limits::MAX_ITEMS {
        chosen.push(key);
      }
      p.chosen = Some(chosen);
    });
  }

  pub fn tags_on(&mut self, key: &str) -> Vec<Tag> {
    self
      .post_state()
      .tags
      .and_then(|t| t.get(key).cloned())
      .unwrap_or_default()
  }

  fn set_tags(&mut self, key: &str, save: bool, cx: &mut Context<Self>, change: impl FnOnce(&[Tag]) -> Vec<Tag>) {
    let key = key.to_string();
    self.set_post(save, cx, |p| {
      let tags = p.tags.get_or_insert_with(Default::default);
      let next = change(tags.get(&key).map_or(&[][..], Vec::as_slice));
      tags.insert(key, next);
    });
  }

  pub fn add_tag(&mut self, key: &str, tag: Tag, cx: &mut Context<Self>) {
    self.set_tags(key, true, cx, |t| add_tag(t, tag));
  }

  pub fn remove_tag(&mut self, key: &str, username: &str, cx: &mut Context<Self>) {
    self.set_tags(key, true, cx, |t| {
      t.iter().filter(|x| x.username != username).cloned().collect()
    });
  }

  pub fn move_tag(&mut self, key: &str, username: &str, x: f64, y: f64, save: bool, cx: &mut Context<Self>) {
    self.set_tags(key, save, cx, |t| move_tag(t, username, x, y));
  }

  /// Start typing a tag at a spot on a slide.
  pub fn start_tag(&mut self, key: String, x: f64, y: f64, window: &mut Window, cx: &mut Context<Self>) {
    if self.posting() || self.tags_on(&key).len() >= limits::MAX_TAGS {
      return;
    }
    let input = cx.new(|cx| gpui_kit::component::input::InputState::new(window, cx).placeholder("Username"));
    cx.subscribe_in(&input, window, |ws, state, ev: &InputEvent, _, cx| match ev {
      InputEvent::PressEnter { .. } | InputEvent::Blur => {
        let text = state.read(cx).value().to_string();
        ws.commit_tag(&text, cx);
      }
      _ => {}
    })
    .detach();
    input.update(cx, |s, cx| s.focus(window, cx));
    self.ig.draft = Some(DraftTag { key, x, y, input });
    cx.notify();
  }

  fn commit_tag(&mut self, text: &str, cx: &mut Context<Self>) {
    let Some(d) = self.ig.draft.take() else { return };
    if let Some(username) = sequence_core::instagram::username_of(text) {
      self.add_tag(
        &d.key,
        Tag {
          username,
          x: d.x,
          y: d.y,
        },
        cx,
      );
    }
    cx.notify();
  }

  /// Escape while typing a tag: drop it.
  pub fn cancel_tag(&mut self, cx: &mut Context<Self>) -> bool {
    let had = self.ig.draft.take().is_some();
    if had {
      cx.notify();
    }
    had
  }

  /// The caption's text box, made with the page.
  pub fn caption_input(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<TextareaState> {
    if let Some(c) = &self.ig.caption {
      return c.clone();
    }
    let text = self.post_state().caption.unwrap_or_default();
    let c = cx.new(|cx| {
      TextareaState::new(window, cx)
        .rows(6)
        .placeholder("Write a caption…")
        .default_value(text)
    });
    cx.subscribe_in(&c, window, |ws, state, ev: &InputEvent, _, cx| {
      if matches!(ev, InputEvent::Change) {
        let text = state.read(cx).value().to_string();
        ws.set_post(true, cx, |p| p.caption = Some(text));
      }
    })
    .detach();
    self.ig.caption = Some(c.clone());
    c
  }

  // --- The account ------------------------------------------------------------------------

  /// Start connecting: open Instagram's sign-in page in the browser.
  pub fn connect_instagram(&mut self, return_to_export: bool, cx: &mut Context<Self>) {
    let server = ig::server_url(&self.prefs.server_url);
    let (url, pending) = ig::plan_sign_in(&server);
    self.ig.pending = Some(pending);
    self.ig.return_to_export = return_to_export;
    cx.open_url(&url);
    self.ig.message = Some((SIGN_IN_IN_BROWSER.into(), false));
    cx.notify();
  }

  /// A `sequence-photos://instagram#…` link: finish (or report) the sign-in this app started.
  pub fn finish_sign_in(&mut self, url: &str, cx: &mut Context<Self>) {
    let Some(fragment) = url.split_once('#').map(|(_, f)| f) else {
      return;
    };
    let Some(back) = parse_sign_in_return(fragment) else {
      return;
    };
    let pending = self.ig.pending.take();
    let state = match &back {
      SignInReturn::Connected { state, .. } | SignInReturn::Error { state, .. } => state,
    };
    let Some(pending) = pending.filter(|p| &p.state == state) else {
      self.say_signed_in(Some(sequence_core::instagram::OTHER_SIGN_IN.into()), true, cx);
      return;
    };
    let sealed = match back {
      SignInReturn::Error { error, .. } => {
        self.say_signed_in(sign_in_error_message(error).map(String::from), true, cx);
        return;
      }
      SignInReturn::Connected { sealed, .. } => sealed,
    };
    self.ig.connecting = true;
    cx.notify();
    let task = cx
      .background_executor()
      .spawn(async move { ig::redeem(&pending, &sealed) });
    cx.spawn(async move |this, cx| {
      let result = task.await;
      let _ = this.update(cx, |ws, cx| {
        ws.ig.connecting = false;
        match result {
          Ok(c) => {
            let text = format!("Connected to Instagram as @{}.", c.username);
            ws.set_connection(Some(c));
            ws.say_signed_in(Some(text), false, cx);
          }
          Err(m) => ws.say_signed_in(Some(m), true, cx),
        }
      });
    })
    .detach();
  }

  /// What a sign-in came to: in the notice, and beside the Connect button. From Export,
  /// back to Export on Instagram.
  fn say_signed_in(&mut self, text: Option<String>, warn: bool, cx: &mut Context<Self>) {
    self.ig.message = text.clone().map(|t| (t, warn));
    if let Some(t) = text {
      self.ui.notice = Some(t);
    }
    if std::mem::take(&mut self.ig.return_to_export) {
      self.pick_destination(sequence_core::model::ExportDestination::Instagram, cx);
      self.go_to(Page::Export, cx);
    }
    cx.notify();
  }

  pub fn set_connection(&mut self, c: Option<Connection>) {
    ig::save_connection(c.as_ref());
    self.ig.connection = c;
    self.ig.picture = None;
  }

  /// Forget the connection (Instagram's own settings revoke Sequence's access).
  pub fn disconnect_instagram(&mut self, cx: &mut Context<Self>) {
    self.set_connection(None);
    self.ig.message = None;
    cx.notify();
  }

  fn mark_needs_reconnect(&mut self) {
    if let Some(c) = self.ig.connection.clone()
      && !c.needs_reconnect
    {
      self.set_connection(Some(Connection {
        needs_reconnect: true,
        ..c
      }));
    }
  }

  /// The profile picture while connected: asked for once per connection.
  pub fn profile_picture(&mut self, cx: &mut Context<Self>) -> Option<Arc<Image>> {
    if !self.instagram_ready() {
      return None;
    }
    let token = self.ig.connection.as_ref()?.token.clone();
    match &self.ig.picture {
      Some((t, pic)) if *t == token => return pic.clone(),
      _ => {}
    }
    self.ig.picture = Some((token.clone(), None));
    let task = cx.background_executor().spawn({
      let token = token.clone();
      async move { ig::profile_picture(&token) }
    });
    cx.spawn(async move |this, cx| {
      let bytes = task.await;
      let _ = this.update(cx, |ws, cx| {
        if let Some(b) = bytes {
          let format = if b.starts_with(&[0x89, b'P']) {
            ImageFormat::Png
          } else {
            ImageFormat::Jpeg
          };
          ws.ig.picture = Some((token, Some(Arc::new(Image::from_bytes(format, b)))));
          cx.notify();
        }
      });
    })
    .detach();
    None
  }

  // --- Posting ------------------------------------------------------------------------------

  /// What's in the way of posting, if anything.
  pub fn post_problem(&mut self) -> Option<String> {
    if !self.instagram_ready() {
      return None;
    }
    let p = self.post_state();
    let caption = p.caption.unwrap_or_default();
    let feed = p.kind != Some(PostKind::Story);
    if self.chosen_slides().is_empty() {
      Some("Choose at least one slide to post.".into())
    } else if feed && caption.chars().count() > limits::CAPTION_LENGTH {
      Some(format!(
        "Captions can be up to {} characters.",
        crate::views::instagram::grouped(limits::CAPTION_LENGTH)
      ))
    } else if feed && sequence_core::instagram::hashtag_count(&caption) > limits::HASHTAGS {
      Some(format!("Instagram allows up to {} hashtags.", limits::HASHTAGS))
    } else {
      None
    }
  }

  /// Post the chosen slides: make their images, then hand them over and publish, with each
  /// step in the panel.
  pub fn post_to_instagram(&mut self, cx: &mut Context<Self>) {
    if self.posting() || self.post_problem().is_some() {
      return;
    }
    // The tour's sample book isn't posted to the user's account.
    if self.touring() {
      self.ig.status = Status::Failed("Finish the tour to post your own work.".into());
      cx.notify();
      return;
    }
    let Some(connection) = self.ig.connection.clone() else {
      return;
    };
    let p = self.post_state();
    let kind = p.kind.unwrap_or(PostKind::Feed);
    let fit = p.fit.unwrap_or(PostFit::Crop);
    let keys = self.chosen_slides();
    let tags: Vec<Vec<Tag>> = keys.iter().map(|k| self.tags_on(k)).collect();
    let caption = p.caption.unwrap_or_default().trim().to_string();
    let project = self.project().clone();
    let source = self.source();
    let cancel = Cancel::default();
    self.ig.cancel = Some(cancel.clone());
    self.ig.previews = 0;
    self.ig.status = Status::Posting(PostStep::Preparing {
      done: 0,
      total: keys.len(),
    });
    cx.notify();

    enum Event {
      Step(PostStep),
      Connection(Connection),
      Previews(usize),
    }
    let (tx, mut rx) = futures::channel::mpsc::unbounded::<Event>();
    let task = cx.background_executor().spawn(async move {
      let c = ig::fresh_connection(&connection, ig::now_s())?;
      if c != connection {
        let _ = tx.unbounded_send(Event::Connection(c.clone()));
      }
      let needed = if kind == PostKind::Story { keys.len() as i64 } else { 1 };
      ig::check_quota(&c, needed, &cancel)?;
      let sheet = project.sheet();
      let size = slide_size(&sheet);
      let layout = post_image_layout(size, kind, fit);
      let pages = output_pages(&project, Per::Page);
      let slides: Vec<&OutputPage> = keys
        .iter()
        .filter_map(|k| pages.iter().find(|p| slide_key(p) == *k))
        .collect();
      let mut images = Vec::new();
      let mut previews = 0;
      for (i, slide) in slides.iter().enumerate() {
        if cancel_requested(&cancel) {
          return Err(Failure::Cancelled);
        }
        let _ = tx.unbounded_send(Event::Step(PostStep::Preparing {
          done: i,
          total: slides.len(),
        }));
        // No more pixels than the post needs.
        let scale = 1f64.min(layout.target.w / layout.source.w);
        let plan = plan_page(slide, &sheet, &project.photos, Some(sheet.px_per_unit * scale));
        let k = plan.px_per_unit / sheet.px_per_unit;
        let Some((jpeg, p)) = crate::imageio::post_image(&plan, &project.photos, |id| source.paths(id), &layout, k)
        else {
          return Err(Failure::Other(
            "A slide is too detailed to fit Instagram’s 8 MB limit.".into(),
          ));
        };
        images.push(jpeg);
        previews += p;
      }
      if previews > 0 {
        let _ = tx.unbounded_send(Event::Previews(previews));
      }
      let post = Post {
        images,
        tags,
        kind,
        caption,
      };
      let step = |s: PostStep| {
        let _ = tx.unbounded_send(Event::Step(s));
      };
      ig::publish(&c, &post, &step, &cancel)
    });
    cx.spawn(async move |this, cx| {
      use futures::StreamExt;
      while let Some(ev) = rx.next().await {
        let _ = this.update(cx, |ws, cx| {
          match ev {
            Event::Step(s) => ws.ig.status = Status::Posting(s),
            Event::Connection(c) => ws.set_connection(Some(c)),
            Event::Previews(n) => ws.ig.previews = n,
          }
          cx.notify();
        });
      }
      let result = task.await;
      let _ = this.update(cx, |ws, cx| {
        ws.ig.cancel = None;
        match result {
          Ok(link) => {
            // Posted: the next post starts fresh, not with this one's caption, slides, and tags.
            let p = ws.post_state();
            ws.ig.post = Some(InstagramState {
              kind: p.kind,
              fit: p.fit,
              ..Default::default()
            });
            ws.save_export_state(cx, |s| {
              s.instagram = Some(InstagramState {
                kind: p.kind,
                fit: p.fit,
                ..Default::default()
              })
            });
            ws.ig.caption = None;
            ws.ig.status = Status::Done(link);
          }
          Err(e) => {
            if matches!(e, Failure::Reconnect(_)) {
              ws.mark_needs_reconnect();
            }
            ws.ig.status = Status::Failed(e.message());
          }
        }
        cx.notify();
      });
    })
    .detach();
  }

  /// Stop a post before it publishes.
  pub fn cancel_post(&mut self, cx: &mut Context<Self>) {
    if let Some(c) = &self.ig.cancel {
      c.cancel();
    }
    cx.notify();
  }

  /// After posting: back to writing a post, or to the desk.
  pub fn finish_post(&mut self, cx: &mut Context<Self>) {
    self.ig.status = Status::Idle;
    self.go_to(Page::Desk, cx);
  }

  /// Said with a post that's done: some photos went at preview size.
  pub fn post_previews_notice(&self) -> Option<&'static str> {
    (self.ig.previews > 0).then_some(PREVIEWS_NOTICE)
  }
}

fn cancel_requested(c: &Cancel) -> bool {
  // A check that doesn't wait.
  c.is_cancelled()
}
