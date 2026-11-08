//! Upgrading saved projects (`src/schema.ts`). Projects are saved in exported files, so the
//! app must read every shape Sequence has ever saved. Each step turns one version into the
//! next; then the whole project is checked (`validate`).

use serde_json::{Map, Value, json};

use crate::GuideId;
use crate::model::{CURRENT_SCHEMA, Project};
use crate::units::DEFAULT_DPI;
use crate::validate::{InvalidProject, validate_project};

/// Why a saved project can't be opened.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadError {
  /// Saved by a newer version of Sequence.
  Newer,
  Invalid(InvalidProject),
}

impl std::fmt::Display for LoadError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      LoadError::Newer => f.write_str("This project was saved by a newer version of Sequence."),
      LoadError::Invalid(e) => e.fmt(f),
    }
  }
}

impl std::error::Error for LoadError {}

type Raw = Map<String, Value>;

fn object(v: &Value) -> Raw {
  v.as_object().cloned().unwrap_or_default()
}

/// The fields of `from` over `onto`, as `{ ...onto, ...from }` does (nothing, if it isn't an object).
fn spread_over(onto: &mut Raw, from: Option<&Value>) {
  if let Some(Value::Object(m)) = from {
    for (k, v) in m {
      onto.insert(k.clone(), v.clone());
    }
  }
}

/// One step: version n's shape to n + 1's. An error means the project is damaged.
fn step(version: u32, project: Value) -> Result<Value, String> {
  let mut p = object(&project);
  match version {
    // 0 → 1: projects from before versioning. Fill in any missing settings, as version 1 had them.
    0 => {
      let mut v1 = object(&json!({
        "centerV": true, "centerH": true, "keepRelative": true,
        "pageW": 10, "pageH": 8, "borders": [0.5, 1.25],
      }));
      spread_over(&mut v1, p.get("settings"));
      p.insert("settings".into(), Value::Object(v1));
    }
    // 1 → 2: guides get ids, line guides arrive, the drop guide is the largest; the spreads'
    // list becomes the first spread, the ones between, and the last.
    1 => {
      let mut settings = p
        .get("settings")
        .and_then(Value::as_object)
        .cloned()
        .ok_or("settings")?;
      let insets = settings
        .get("borders")
        .and_then(Value::as_array)
        .ok_or("settings.borders")?;
      let borders: Vec<Value> = insets
        .iter()
        .map(|inset| json!({ "id": GuideId::new().0, "kind": "even", "inset": inset }))
        .collect();
      // The smallest inset is the largest box; the first of equals.
      let mut largest: Option<&Value> = None;
      for b in &borders {
        let inset = b["inset"].as_f64().unwrap_or(f64::NAN);
        if largest.is_none_or(|a| inset < a["inset"].as_f64().unwrap_or(f64::NAN)) {
          largest = Some(b);
        }
      }
      let drop = largest.map_or(Value::Null, |b| b["id"].clone());
      let mut list = p
        .remove("spreads")
        .and_then(|s| s.as_array().cloned())
        .ok_or("spreads")?;
      let first = if list.is_empty() { None } else { Some(list.remove(0)) };
      let last = list.pop();
      let with_kind = |s: Value, kind: &str| {
        let mut s = object(&s);
        s.insert("kind".into(), kind.into());
        Value::Object(s)
      };
      if let Some(first) = first {
        p.insert("firstSpread".into(), with_kind(first, "first"));
      }
      p.insert(
        "spreads".into(),
        Value::Array(list.into_iter().map(|s| with_kind(s, "middle")).collect()),
      );
      if let Some(last) = last {
        p.insert("lastSpread".into(), with_kind(last, "last"));
      }
      settings.insert("borders".into(), Value::Array(borders));
      settings.insert("lines".into(), json!([]));
      settings.insert("dropBorder".into(), drop);
      p.insert("settings".into(), Value::Object(settings));
    }
    // 2 → 3: every project so far is a print book; its spreads and page size become a print layout.
    2 => {
      let mut settings = p
        .get("settings")
        .and_then(Value::as_object)
        .cloned()
        .ok_or("settings")?;
      let mut page = Raw::new();
      if let Some(w) = settings.remove("pageW") {
        page.insert("w".into(), w);
      }
      if let Some(h) = settings.remove("pageH") {
        page.insert("h".into(), h);
      }
      let mut layout = Raw::new();
      layout.insert("kind".into(), "print".into());
      layout.insert("page".into(), Value::Object(page.clone()));
      for k in ["firstSpread", "spreads", "lastSpread"] {
        if let Some(v) = p.remove(k) {
          layout.insert(k.into(), v);
        }
      }
      settings.insert(
        "sizes".into(),
        json!({ "print": page, "digital": { "w": 1080, "h": 1350 } }),
      );
      p.insert("layout".into(), Value::Object(layout));
      p.insert("settings".into(), Value::Object(settings));
    }
    // 3 → 4: a print book becomes spreads in inches at 300 dpi, a digital sequence frames in
    // pixels at 1×; the page size moves out of the layout to the project.
    3 => {
      let mut settings = p.get("settings").map(object).unwrap_or_default();
      settings.remove("sizes");
      let mut layout = p.get("layout").map(object).unwrap_or_default();
      let kind = layout.remove("kind");
      let (size_key, kind, unit, ppu) = match kind.as_ref().and_then(Value::as_str) {
        Some("print") => ("page", "spreads", "in", json!(DEFAULT_DPI as u32)),
        Some("digital") => ("frame", "frames", "px", json!(1)),
        // Anything else is damage, which validation reports.
        _ => return Ok(project),
      };
      let mut page = layout.remove(size_key).map(|v| object(&v)).unwrap_or_default();
      page.insert("unit".into(), unit.into());
      page.insert("pxPerUnit".into(), ppu);
      let mut l = Raw::new();
      l.insert("kind".into(), kind.into());
      l.extend(layout);
      p.insert("page".into(), Value::Object(page));
      p.insert("layout".into(), Value::Object(l));
      p.insert("settings".into(), Value::Object(settings));
    }
    // 4 → 5: Export choices; 5 → 6: crops; 6 → 7: backgrounds and borders. None to fill in.
    4..=6 => return Ok(project),
    _ => return Err(format!("no upgrade from version {version}")),
  }
  Ok(Value::Object(p))
}

/// The shape version of saved data; projects from before versioning have none (version 0).
pub fn schema_version_of(project: &Value) -> f64 {
  project.get("schemaVersion").and_then(Value::as_f64).unwrap_or(0.0)
}

/// Upgrade saved data to the current shape, then check all of it.
pub fn migrate_project(stored: &Value) -> Result<Project, LoadError> {
  let found = schema_version_of(stored);
  if found > f64::from(CURRENT_SCHEMA) {
    return Err(LoadError::Newer);
  }
  if found.fract() != 0.0 || found < 0.0 {
    return Err(LoadError::Invalid(InvalidProject(format!(
      "no upgrade from version {found}"
    ))));
  }
  let mut version = found as u32;
  let mut project = stored.clone();
  while version < CURRENT_SCHEMA {
    project =
      step(version, project).map_err(|e| LoadError::Invalid(InvalidProject(format!("version {version}: {e}"))))?;
    version += 1;
  }
  if let Value::Object(m) = &mut project {
    m.insert("schemaVersion".into(), json!(CURRENT_SCHEMA));
  }
  validate_project(&project).map_err(LoadError::Invalid)
}

/// A project as saved (`project.json`).
pub fn to_json(project: &Project) -> Value {
  serde_json::to_value(project).unwrap_or(Value::Null)
}
