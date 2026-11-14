import XCTest

/**
 * The App Store's screenshots, taken by scripts/ios-screenshots.mjs, which fills the library
 * first and says where they go. Skipped in every other test run.
 */
final class ScreenshotTests: XCTestCase {
    func testTakesTheScreenshots() throws {
        guard let path = ProcessInfo.processInfo.environment["SCREENSHOT_DIR"] else {
            throw XCTSkip("Only for scripts/ios-screenshots.mjs")
        }
        let dir = URL(fileURLWithPath: path, isDirectory: true)
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        func shot(_ name: String) throws {
            // Past any transition, and the photos loaded.
            Thread.sleep(forTimeInterval: 1.5)
            try XCUIScreen.main.screenshot().pngRepresentation.write(to: dir.appendingPathComponent("\(name).png"))
        }

        let sequence = app.buttons.matching(NSPredicate(format: "label CONTAINS 'City walks'")).firstMatch
        XCTAssertTrue(sequence.waitForExistence(timeout: 10))
        sequence.tap()

        XCTAssertTrue(app.buttons["Frame 1"].firstMatch.waitForExistence(timeout: 5))
        try shot("1-frames")

        // The editor, with a photo waiting on the desk.
        app.buttons["Frame 1"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Next frame"].waitForExistence(timeout: 5))
        try shot("2-editor")

        // A photo selected, with its tools.
        app.buttons["Next frame"].tap()
        Thread.sleep(forTimeInterval: 1)
        let photo = app.descendants(matching: .any)["taxi.jpg"].firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 5))
        photo.tap()
        XCTAssertTrue(app.buttons["Crop"].waitForExistence(timeout: 5))
        try shot("3-photo")

        app.buttons["Crop"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
        try shot("4-crop")
        app.buttons["Cancel"].tap()

        app.buttons["More"].firstMatch.tap()
        app.buttons["Preview"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Close the preview"].waitForExistence(timeout: 5))
        app.swipeLeft()
        try shot("5-preview")
        app.buttons["Close the preview"].tap()
        XCTAssertTrue(app.buttons["Close the preview"].waitForNonExistence(timeout: 5))

        // Back on the frames' grid, for its export button.
        app.buttons["BackButton"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Export"].waitForExistence(timeout: 5))
        app.buttons["Export"].tap()
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 5))
        try shot("6-export")
    }
}
