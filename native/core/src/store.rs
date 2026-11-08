//! The project with its undo history (`src/store.ts`). `apply` records a change; `begin`,
//! `preview`, and `end` wrap a gesture (a drag) so it records one step.

use std::time::{Duration, Instant};

use crate::model::Project;

const HISTORY_LIMIT: usize = 200;
const COALESCE: Duration = Duration::from_millis(1000);

/// A project and its history.
pub struct History {
  past: Vec<Project>,
  future: Vec<Project>,
  present: Project,
  gesture_base: Option<Project>,
  last_coalesce: Option<(String, Instant)>,
  /// Bumped on every change, so views and saving can tell the project changed.
  pub revision: u64,
}

impl History {
  pub fn new(project: Project) -> Self {
    Self {
      past: Vec::new(),
      future: Vec::new(),
      present: project,
      gesture_base: None,
      last_coalesce: None,
      revision: 0,
    }
  }

  pub fn project(&self) -> &Project {
    &self.present
  }

  /// The project a gesture started from (or the present, outside a gesture).
  pub fn gesture_start(&self) -> &Project {
    self.gesture_base.as_ref().unwrap_or(&self.present)
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
    self.present = project;
    self.revision += 1;
  }

  /// Record a change. Changes with the same `coalesce` key within a second are one step.
  pub fn apply(&mut self, recipe: impl FnOnce(&mut Project)) {
    self.apply_with(None, recipe);
  }

  pub fn apply_with(&mut self, coalesce: Option<&str>, recipe: impl FnOnce(&mut Project)) {
    let mut next = self.present.clone();
    recipe(&mut next);
    if next == self.present {
      return;
    }
    let now = Instant::now();
    let joins = match (coalesce, &self.last_coalesce) {
      (Some(k), Some((last, at))) => k == last && now.duration_since(*at) < COALESCE,
      _ => false,
    };
    if !joins {
      let prev = std::mem::replace(&mut self.present, next);
      self.push(prev);
    } else {
      self.present = next;
    }
    self.last_coalesce = coalesce.map(|k| (k.to_string(), now));
    self.future.clear();
    self.revision += 1;
  }

  /// Replace the whole project as one undoable step (opening a file into the window).
  pub fn replace(&mut self, project: Project) {
    let prev = std::mem::replace(&mut self.present, project);
    self.push(prev);
    self.future.clear();
    self.last_coalesce = None;
    self.revision += 1;
  }

  /// Change the present without recording history (raising a clicked photo).
  pub fn silent(&mut self, recipe: impl FnOnce(&mut Project)) {
    let before = self.revision;
    recipe(&mut self.present);
    self.revision = before + 1;
  }

  pub fn begin(&mut self) {
    self.gesture_base = Some(self.present.clone());
  }

  /// The gesture's result so far, starting over from the project as it was at `begin`.
  pub fn preview(&mut self, recipe: impl FnOnce(&mut Project)) {
    let mut next = self.gesture_start().clone();
    recipe(&mut next);
    self.present = next;
    self.revision += 1;
  }

  pub fn end(&mut self) {
    if let Some(base) = self.gesture_base.take()
      && base != self.present
    {
      self.push(base);
      self.future.clear();
      self.last_coalesce = None;
    }
    self.revision += 1;
  }

  pub fn cancel(&mut self) {
    if let Some(base) = self.gesture_base.take() {
      self.present = base;
    }
    self.revision += 1;
  }

  /// Undo, keeping the Export choices as they are now: they're saved with the project but
  /// aren't edits to undo.
  pub fn undo(&mut self) {
    let Some(mut prev) = self.past.pop() else { return };
    prev.export = self.present.export.clone();
    let now = std::mem::replace(&mut self.present, prev);
    self.future.push(now);
    self.last_coalesce = None;
    self.revision += 1;
  }

  pub fn redo(&mut self) {
    let Some(mut next) = self.future.pop() else { return };
    next.export = self.present.export.clone();
    let now = std::mem::replace(&mut self.present, next);
    self.past.push(now);
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
      .chain(self.gesture_base.iter())
  }

  fn push(&mut self, p: Project) {
    self.past.push(p);
    if self.past.len() > HISTORY_LIMIT {
      self.past.remove(0);
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
    h.apply_with(Some("nudge"), |p| p.next_z = 2.0);
    h.apply_with(Some("nudge"), |p| p.next_z = 3.0);
    h.undo();
    assert_eq!(h.project().next_z, 1.0);
  }
}
