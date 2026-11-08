//! Ids for each kind of thing in a project (`src/ids.ts`). Each kind is its own type, so
//! one can't be passed where another is expected; fresh ones are UUIDs, as
//! `crypto.randomUUID()` makes them.

use serde::{Deserialize, Serialize};

macro_rules! id {
  ($(#[$doc:meta])* $name:ident) => {
    $(#[$doc])*
    #[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
    #[serde(transparent)]
    pub struct $name(pub String);

    impl $name {
      /// A fresh one.
      pub fn new() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
      }
    }

    impl Default for $name {
      fn default() -> Self {
        Self::new()
      }
    }

    impl From<&str> for $name {
      fn from(s: &str) -> Self {
        Self(s.to_owned())
      }
    }

    impl std::fmt::Display for $name {
      fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
      }
    }
  };
}

id!(
  /// A photo's.
  PhotoId
);
id!(
  /// A spread's or a frame's.
  SpreadId
);
id!(
  /// A border guide's or a line guide's.
  GuideId
);
