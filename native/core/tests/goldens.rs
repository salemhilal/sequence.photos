//! The TypeScript's golden files (shared/goldens/, written by src/goldens.test.ts): this
//! port must make the same from the same inputs.

use serde_json::Value;

use sequence_core::schema::{migrate_project, to_json};

fn goldens(file: &str) -> Vec<Value> {
  let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../shared/goldens/");
  let text = std::fs::read_to_string(format!("{path}{file}")).expect("golden file");
  serde_json::from_str::<Value>(&text)
    .expect("golden JSON")
    .as_array()
    .cloned()
    .expect("a list of cases")
}

/// Numbers as f64 everywhere (JavaScript has no integers), so 2 and 2.0 compare equal.
fn numbers(v: &Value) -> Value {
  match v {
    Value::Number(n) => n.as_f64().map(Value::from).unwrap_or(Value::Null),
    Value::Array(a) => Value::Array(a.iter().map(numbers).collect()),
    Value::Object(m) => Value::Object(m.iter().map(|(k, v)| (k.clone(), numbers(v))).collect()),
    other => other.clone(),
  }
}

/// A project with its border guides' ids replaced by their position, and the drop guide's
/// by its (upgrading makes fresh ids, which differ from run to run).
fn without_ids(mut v: Value) -> Value {
  let Some(settings) = v.get_mut("settings").and_then(Value::as_object_mut) else {
    return v;
  };
  let mut ids = Vec::new();
  if let Some(borders) = settings.get_mut("borders").and_then(Value::as_array_mut) {
    for (i, b) in borders.iter_mut().enumerate() {
      ids.push(b["id"].clone());
      b["id"] = Value::from(i);
    }
  }
  if let Some(drop) = settings.get_mut("dropBorder")
    && let Some(i) = ids.iter().position(|id| id == drop)
  {
    *drop = Value::from(i);
  }
  v
}

/// Damage an upgrade step runs into is reported in each language's own words.
fn from_a_step(message: &str) -> bool {
  message.starts_with("Damaged project (version ")
}

#[test]
fn schema_matches_the_typescript() {
  let cases = goldens("schema.json");
  assert!(cases.len() > 20, "too few cases: {}", cases.len());
  let mut failures = Vec::new();
  for case in &cases {
    let name = case["name"].as_str().unwrap_or("?");
    let got = migrate_project(&case["input"]);
    match (got, case.get("output"), case.get("error").and_then(Value::as_str)) {
      (Ok(project), Some(expected), _) => {
        let got = without_ids(numbers(&to_json(&project)));
        let expected = without_ids(numbers(expected));
        if got != expected {
          failures.push(format!("{name}:\n  got      {got}\n  expected {expected}"));
        }
      }
      (Err(e), None, Some(expected)) => {
        let e = e.to_string();
        if e != expected && !from_a_step(&e) && !from_a_step(expected) {
          failures.push(format!("{name}: got error {e:?}, expected {expected:?}"));
        }
      }
      (Ok(_), None, Some(expected)) => failures.push(format!("{name}: opened, expected {expected:?}")),
      (Err(e), Some(_), _) => failures.push(format!("{name}: {e}")),
      _ => failures.push(format!("{name}: a case with neither output nor error")),
    }
  }
  assert!(
    failures.is_empty(),
    "{} of {} differ:\n{}",
    failures.len(),
    cases.len(),
    failures.join("\n")
  );
}

#[test]
fn saved_projects_come_back_the_same() {
  for case in goldens("schema.json") {
    let Some(output) = case.get("output") else { continue };
    let project = migrate_project(output).expect("a migrated project opens again");
    assert_eq!(numbers(&to_json(&project)), numbers(output), "{}", case["name"]);
  }
}

mod geometry_and_render {
  use super::*;
  use sequence_core::geometry::*;
  use sequence_core::render_plan::{Per, fit_pixels, output_pages, plan_page, slide_key};
  use sequence_core::{PhotoMeta, Sheet, Spread};
  use serde::de::DeserializeOwned;

  fn de<T: DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))
  }

  fn json(v: impl serde::Serialize) -> Value {
    numbers(&serde_json::to_value(v).expect("serializable"))
  }

  /// Equal, allowing for the last bits of a float (the two languages can order operations
  /// differently in the standard library's math).
  fn close(a: &Value, b: &Value) -> bool {
    match (a, b) {
      (Value::Number(x), Value::Number(y)) => {
        let (x, y) = (x.as_f64().unwrap_or(f64::NAN), y.as_f64().unwrap_or(f64::NAN));
        x == y || (x - y).abs() <= 1e-9 * x.abs().max(y.abs()).max(1.0)
      }
      (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(a, b)| close(a, b)),
      (Value::Object(x), Value::Object(y)) => {
        x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| close(v, w)))
      }
      _ => a == b,
    }
  }

  fn compare(file: &str, run: impl Fn(&Value) -> Value) {
    let cases = goldens(file);
    let mut failures = Vec::new();
    for case in &cases {
      let got = run(&case["input"]);
      let expected = numbers(&case["output"]);
      if !close(&got, &expected) {
        failures.push(format!("{}:\n  got      {got}\n  expected {expected}", case["name"]));
      }
    }
    assert!(
      failures.is_empty(),
      "{} of {} differ:\n{}",
      failures.len(),
      cases.len(),
      failures.join("\n")
    );
  }

  fn snapped((rect, hit): (Rect, SnapFeedback)) -> Value {
    serde_json::json!({ "rect": json(rect), "hit": json(hit) })
  }

  #[test]
  fn geometry_matches_the_typescript() {
    compare("geometry.json", |input| match input["op"].as_str() {
      Some("guides") => {
        let sheet: Sheet = de(&input["sheet"]);
        let spread: Spread = de(&input["spread"]);
        let drop: Vec<Rect> = page_sides(spread.kind)
          .iter()
          .map(|&side| drop_box(side, &sheet))
          .collect();
        serde_json::json!({
          "guides": json(spread_guides(&spread, &sheet)),
          "snap": json(snap_lines(&spread, &sheet)),
          "drop": json(drop),
        })
      }
      Some("relayout") => json(relayout_rect(
        de(&input["rect"]),
        &de(&input["from"]),
        &de(&input["to"]),
      )),
      Some("snapMove") => snapped(snap_move(
        de(&input["rect"]),
        &de(&input["lines"]),
        input["threshold"].as_f64().unwrap_or(0.0),
      )),
      Some("resize") => {
        let f = |k: &str| input[k].as_f64().unwrap_or(f64::NAN);
        let lines: GuideLines = de(&input["lines"]);
        snapped(resize_rect(
          de(&input["rect"]),
          de(&input["corner"]),
          f("dx"),
          f("dy"),
          input["lock"].as_bool().unwrap_or(false),
          Some(&lines),
          f("threshold"),
          f("min"),
        ))
      }
      Some("fit") => {
        let photo: PhotoMeta = de(&input["photo"]);
        let (w, h) = pile_size(&photo);
        serde_json::json!({
          "fit": json(fit_centered(&photo, de(&input["box"]), None)),
          "pile": { "w": w, "h": h },
        })
      }
      other => panic!("unknown op {other:?}"),
    });
  }

  #[test]
  fn render_plans_match_the_typescript() {
    compare("render.json", |input| {
      let project = migrate_project(&input["project"]).expect("a project");
      let per = if input["per"] == "spread" {
        Per::Spread
      } else {
        Per::Page
      };
      let ppu = input["pxPerUnit"].as_f64();
      let sheet = project.sheet();
      let plans: Vec<Value> = output_pages(&project, per)
        .iter()
        .map(|p| {
          let plan = plan_page(p, &sheet, &project.photos, ppu);
          serde_json::json!({ "key": slide_key(p), "fit": fit_pixels(&plan, 1_000_000.0), "plan": json(plan) })
        })
        .collect();
      numbers(&Value::Array(plans))
    });
  }
}
