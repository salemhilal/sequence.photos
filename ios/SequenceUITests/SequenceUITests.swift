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
        app.buttons["New sequence"].firstMatch.tap()
        app.buttons["Create"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["1 frame"].waitForExistence(timeout: 5))
        app.buttons["Add"].tap()
        app.buttons["Add an empty frame"].tap()
        XCTAssertTrue(app.staticTexts["2 frames"].waitForExistence(timeout: 5))
    }

    func testOpensTheFrameTapped() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["No sequences yet"].waitForExistence(timeout: 10))
        app.buttons["New sequence"].firstMatch.tap()
        app.buttons["Create"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["1 frame"].waitForExistence(timeout: 5))
        for _ in 0..<3 {
            app.buttons["Add"].tap()
            app.buttons["Add an empty frame"].tap()
        }
        XCTAssertTrue(app.staticTexts["4 frames"].waitForExistence(timeout: 5))
        let frameIds = (1...4).map {
            app.buttons["Frame \($0)"].firstMatch.identifier.replacingOccurrences(of: "frame-", with: "canvas-")
        }
        for n in [2, 3] {
            app.buttons["Frame \(n)"].firstMatch.tap()
            XCTAssertTrue(app.staticTexts["\(n) / 4"].waitForExistence(timeout: 5))
            sleep(1)
            XCTAssertTrue(app.staticTexts["\(n) / 4"].exists, "Settled on another frame")
            // The counter follows the state; what's on screen has to as well.
            let onScreen = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'canvas-'"))
                .allElementsBoundByIndex.filter { $0.frame.minX >= 0 && $0.frame.minX < 10 }
            XCTAssertEqual(onScreen.count, 1)
            XCTAssertEqual(onScreen.first?.identifier, frameIds[n - 1], "Showing another frame")
            app.buttons["BackButton"].firstMatch.tap()
            XCTAssertTrue(app.staticTexts["4 frames"].waitForExistence(timeout: 5))
        }
    }

    func testNamesANewSequence() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["No sequences yet"].waitForExistence(timeout: 10))
        app.buttons["New sequence"].firstMatch.tap()
        let name = app.textFields["Name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("City walks")
        XCTAssertTrue(app.buttons["Choose photos"].exists || app.staticTexts["Choose photos"].exists)
        app.buttons["Create"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["1 frame"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["City walks"].exists)
    }

    func testHoldingAFrameDeletesIt() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["No sequences yet"].waitForExistence(timeout: 10))
        app.buttons["New sequence"].firstMatch.tap()
        app.buttons["Create"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["1 frame"].waitForExistence(timeout: 5))
        app.buttons["Add"].tap()
        app.buttons["Add an empty frame"].tap()
        XCTAssertTrue(app.staticTexts["2 frames"].waitForExistence(timeout: 5))
        app.buttons["Frame 2"].firstMatch.press(forDuration: 1)
        let delete = app.buttons["Delete"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        XCTAssertTrue(app.staticTexts["1 frame"].waitForExistence(timeout: 5))
    }
}
