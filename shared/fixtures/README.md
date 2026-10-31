# Shared project fixtures

Saved projects (schema 7, `src/types.ts`) that both apps must read and write unchanged: the
web and Mac app's tests (`src/fixtures.test.ts`) and the iPhone app's
(`ios/SequenceTests/FixtureTests.swift`) load each one and check it comes back the same.
Change them only along with `CURRENT_SCHEMA`.

- `frames.json`: a sequence of frames in pixels, as the iPhone app makes them: a crop, a
  border, a black frame, a photo on the desk, and Export choices.
- `book.json`: a book of spreads in inches, as the web and Mac app make them: every guide
  kind, a photo across the gutter.
