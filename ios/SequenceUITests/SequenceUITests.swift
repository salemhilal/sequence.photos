import XCTest

final class SequenceUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting"]
        app.launch()
        return app
    }

    func testStartsASequenceAndAddsFrames() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["No sequences yet"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["New sequence"].tap()
        XCTAssertTrue(app.staticTexts["1 frame"].waitForExistence(timeout: 5))
        app.buttons["Add"].tap()
        app.buttons["Add an empty frame"].tap()
        XCTAssertTrue(app.staticTexts["2 frames"].waitForExistence(timeout: 5))
    }
}
