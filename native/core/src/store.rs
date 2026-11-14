//! The project with its undo history (`src/store.ts`). `apply` records a change; `begin`,
//! `preview`, and `end` wrap a gesture (a drag) so it records one step. Times are passed in
//! (milliseconds, from any fixed start), as there's no clock to read on the web.

use std::collections::VecDeque;
use std::sync::Arc;

use crate::model::Project;

const HISTORY_LIMIT: usize = 200;
/// Changes with the same key this close together (ms) are one step.
const COALESCE_MS: f64 = 1000.0;

/// A project and its history. Projects are shared, so keeping one in the history, or
/// handing the present to a view for a frame, costs no copy.
pub struct History {
  past: VecDeque<Arc<Project>>,
  future: Vec<Arc<Project>>,
  present: Arc<Project>,
  /// The project a gesture started from, and the revision then.
  gesture_base: Option<(Arc<Project>, u64)>,
  last_coalesce: Option<(String, f64)>,
  revision: u64,
}

impl History {
  pub fn new(project: Project) -> Self {
    Self {
      past: VecDeque::new(),
      future: Vec::new(),
      present: Arc::new(project),
      gesture_base: None,
      last_coalesce: None,
      revision: 0,
    }
  }

  /// Bumped on every change, so views and saving can tell the project changed.
  pub fn revision(&self) -> u64 {
    self.revision
  }

  pub fn project(&self) -> &Project {
    &self.present
  }

  /// The present, shared: for a view to read without copying it.
  pub fn shared(&self) -> Arc<Project> {
    self.present.clone()
  }

  /// The project a gesture started from (or the present, outside a gesture).
  pub fn gesture_start(&self) -> &Project {
    self.gesture_base.as_ref().map_or(&*self.present, |(p, _)| &**p)
  }

  pub fn in_gesture(&self) -> bool {
    self.gesture_base.is_some()
  }

  pub fn can_undo(&self) -> bool {
    !self.past.is_empty()
  }

  pub fn can_redo(&self) -> bool {
    !self.future.is_empty()
  }

  /// A new project, with no history.
  pub fn reset(&mut self, project: Project) {
    self.past.clear();
    self.future.clear();
    self.gesture_base = None;
    self.last_coalesce = None;
    self.present = Arc::new(project);
    self.revision += 1;
  }

  /// Record a change. Not during a gesture: its preview would drop it (callers wait for
  /// the gesture to end).
  pub fn apply(&mut self, recipe: impl FnOnce(&mut Project)) {
    self.apply_with(None, recipe);
  }

  /// Record a change; changes with the same key (and the time now, in ms) within a second
  /// are one step.
  pub fn apply_with(&mut self, coalesce: Option<(&str, f64)>, recipe: impl FnOnce(&mut Project)) {
    if self.in_gesture() {
      return;
    }
    let mut next = Project::clone(&self.present);
    recipe(&mut next);
    if next == *self.present {
      return;
    }
    let next = Arc::new(next);
    let joins = match (coalesce, &self.last_coalesce) {
      (Some((k, now)), Some((last, at))) => k == last && now - at < COALESCE_MS,
      _ => false,
    };
    if !joins {
      let prev = std::mem::replace(&mut self.present, next);
      self.push(prev);
    } else {
      self.present = next;
    }
    self.last_coalesce = coalesce.map(|(k, now)| (k.to_string(), now));
    self.future.clear();
    self.revision += 1;
  }

  /// Replace the whole project as one undoable step (opening a file into the window).
  pub fn replace(&mut self, project: Project) {
    self.cancel();
    let prev = std::mem::replace(&mut self.present, Arc::new(project));
    self.push(prev);
    self.future.clear();
    self.last_coalesce = None;
    self.revision += 1;
  }

  /// Change the present without recording history (raising a clicked photo).
  /// Not a step, and not an edit either: the revision doesn't change.
  pub fn silent(&mut self, recipe: impl FnOnce(&mut Project)) {
    recipe(Arc::make_mut(&mut self.present));
  }

  /// Start a gesture (one already under way goes on).
  pub fn begin(&mut self) {
    if self.gesture_base.is_none() {
      self.gesture_base = Some((self.present.clone(), self.revision));
    }
  }

  /// The gesture's result so far, starting over from the project as it was at `begin`.
  pub fn preview(&mut self, recipe: impl FnOnce(&mut Project)) {
    let mut next = self.gesture_start().clone();
    recipe(&mut next);
    self.present = Arc::new(next);
    self.revision += 1;
  }

  /// Finish a gesture as one step (none if it changed nothing).
  pub fn end(&mut self) {
    let Some((base, rev)) = self.gesture_base.take() else {
      return;
    };
    if base == self.present {
      self.present = base;
      self.revision = rev;
    } else {
      self.push(base);
      self.future.clear();
      self.last_coalesce = None;
      self.revision += 1;
    }
  }

  /// Put back the project as the gesture found it.
  pub fn cancel(&mut self) {
    if let Some((base, rev)) = self.gesture_base.take() {
      self.present = base;
      self.revision = rev;
    }
  }

  /// Undo, keeping the Export choices as they are now: they're saved with the project but
  /// aren't edits to undo.
  pub fn undo(&mut self) {
    self.cancel();
    let Some(mut prev) = self.past.pop_back() else { return };
    Arc::make_mut(&mut prev).export = self.present.export.clone();
    let now = std::mem::replace(&mut self.present, prev);
    self.future.push(now);
    self.last_coalesce = None;
    self.revision += 1;
  }

  pub fn redo(&mut self) {
    self.cancel();
    let Some(mut next) = self.future.pop() else { return };
    Arc::make_mut(&mut next).export = self.present.export.clone();
    let now = std::mem::replace(&mut self.present, next);
    self.past.push_back(now);
    self.last_coalesce = None;
    self.revision += 1;
  }

  /// Every project still reachable through undo and redo (to keep their photos' files).
  pub fn all_projects(&self) -> impl Iterator<Item = &Project> {
    self
      .past
      .iter()
      .chain(std::iter::once(&self.present))
      .chain(self.future.iter())
      .chain(self.gesture_base.iter().map(|(p, _)| p))
      .map(|p| &**p)
  }

  fn push(&mut self, p: Arc<Project>) {
    self.past.push_back(p);
    if self.past.len() > HISTORY_LIMIT {
      self.past.pop_front();
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn undo_and_redo_steps() {
    let mut h = History::new(Project::empty());
    h.apply(|p| p.next_z = 5.0);
    h.apply(|p| p.next_z = 6.0);
    assert_eq!(h.project().next_z, 6.0);
    h.undo();
    assert_eq!(h.project().next_z, 5.0);
    h.redo();
    assert_eq!(h.project().next_z, 6.0);
    // No change, no step.
    h.apply(|_| {});
    h.undo();
    h.undo();
    assert_eq!(h.project().next_z, 1.0);
    assert!(!h.can_undo());
  }

  #[test]
  fn a_gesture_is_one_step() {
    let mut h = History::new(Project::empty());
    h.begin();
    h.preview(|p| p.next_z = 2.0);
    h.preview(|p| p.next_z = 3.0);
    h.end();
    assert_eq!(h.project().next_z, 3.0);
    h.undo();
    assert_eq!(h.project().next_z, 1.0);
  }

  #[test]
  fn coalesced_changes_are_one_step() {
    let mut h = History::new(Project::empty());
    h.apply_with(Some(("nudge", 0.0)), |p| p.next_z = 2.0);
    h.apply_with(Some(("nudge", 500.0)), |p| p.next_z = 3.0);
    h.apply_with(Some(("nudge", 2000.0)), |p| p.next_z = 4.0);
    h.undo();
    assert_eq!(h.project().next_z, 3.0);
    h.undo();
    assert_eq!(h.project().next_z, 1.0);
  }

  #[test]
  fn a_cancelled_gesture_leaves_no_trace() {
    let mut h = History::new(Project::empty());
    let rev = h.revision();
    h.begin();
    h.preview(|p| p.next_z = 2.0);
    h.cancel();
    assert_eq!((h.project().next_z, h.revision()), (1.0, rev));
    h.begin();
    h.preview(|p| p.next_z = 1.0);
    h.end();
    assert_eq!(h.revision(), rev);
    assert!(!h.can_undo());
  }
}
