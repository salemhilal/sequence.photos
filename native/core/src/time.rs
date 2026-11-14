//! Dates as the project file writes them: ISO 8601 in UTC, as JavaScript's `toISOString`.

/// A time (milliseconds since 1970, UTC) as `YYYY-MM-DDTHH:MM:SS.mmmZ`.
pub fn iso_from_millis(millis: i64) -> String {
  let ms = millis.rem_euclid(1000);
  let s = millis.div_euclid(1000);
  let days = s.div_euclid(86400);
  let rem = s.rem_euclid(86400);
  // Civil from days (Howard Hinnant's algorithm).
  let z = days + 719_468;
  let era = z.div_euclid(146_097);
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
  let y = yoe + era * 400;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let d = doy - (153 * mp + 2) / 5 + 1;
  let m = if mp < 10 { mp + 3 } else { mp - 9 };
  let y = if m <= 2 { y + 1 } else { y };
  format!(
    "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{ms:03}Z",
    rem / 3600,
    (rem % 3600) / 60,
    rem % 60
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn formats_as_javascript_does() {
    assert_eq!(iso_from_millis(0), "1970-01-01T00:00:00.000Z");
    // new Date(1709251199999).toISOString(): the last moment of a leap February.
    assert_eq!(iso_from_millis(1_709_251_199_999), "2024-02-29T23:59:59.999Z");
    assert_eq!(iso_from_millis(951_782_400_000), "2000-02-29T00:00:00.000Z");
    assert_eq!(iso_from_millis(-1), "1969-12-31T23:59:59.999Z");
  }
}
