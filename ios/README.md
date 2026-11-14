# Sequence for iPhone (native)

The iPhone app in SwiftUI: sequences of frames, the frames grid, a frame's editor with the
desk in a drawer below it, crop (with the pin), a preview, and export as images or to
Instagram. Paging, gestures, drag and drop, sheets, and motion are iOS's own.

It's `io.salem.SequencePhotosMobile`, iPhone only, portrait, iOS 17 and later, version 1.0.0
(`project.yml`).

```bash
brew install xcodegen
cd ios && xcodegen generate          # makes Sequence.xcodeproj from project.yml
open Sequence.xcodeproj              # run it from Xcode, or:
xcodebuild test -scheme Sequence -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

`xcode-select -p` must be Xcode, not the Command Line Tools (or set `DEVELOPER_DIR`).
The Xcode project is generated and not committed: change `project.yml`, not the project.

## Where things are

- `Sequence/Model/`: the project as the web and Mac apps save it (`Project.swift`, schema 7:
  Codable types that read and write the same JSON), and what the phone does to it, as pure
  functions: geometry and snapping, crop, frame actions, resolution.
- `Sequence/Store/`: the open project with undo (`ProjectStore`; a gesture is one step), and
  the library on disk (`Library`, `PhotoStore`): Application Support/Library holds
  `index.json`, `Projects/<id>.json`, and `Photos/` (each original and a 1400 px copy to show),
  shared between projects and collected when none uses them.
- `Sequence/Render/`: the render plan (src/renderPlan.ts) drawn with Core Graphics, and
  Instagram's image shapes and sizes.
- `Sequence/Instagram/`: sign-in (ASWebAuthenticationSession; the server's `mac` client,
  whose return URL `sequence-photos://instagram` the session catches), the connection in the
  Keychain, and posting (src/instagramPost.ts).
- `Sequence/Views/`: the screens. `Theme.swift` has the colors and fonts.
- `Sequence/Fonts/`: Inter Tight and IBM Plex Mono, as the web app has them (made from its
  @fontsource packages by `node scripts/ios-fonts.mjs`; OFL).
- `SequenceTests/`: unit tests, including the fixtures in `shared/fixtures/` that the web
  app's tests read too (`src/fixtures.test.ts`): both apps read and write them the same.
- `SequenceUITests/`: UI tests (launched with `-uiTesting`: a fresh library each time, and no
  Instagram connection).

The format is the web app's: a change to the saved project (`src/schema.ts`) means changing
`Project.swift` and the fixtures too.
