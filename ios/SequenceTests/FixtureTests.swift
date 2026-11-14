import XCTest

@testable import Sequence

/** The shared fixtures (shared/fixtures), which the web app's tests read too: both read them the same. */
final class FixtureTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let bundle = Bundle(for: Self.self)
        let url = try XCTUnwrap(bundle.url(forResource: name, withExtension: "json", subdirectory: "fixtures"))
        return try Data(contentsOf: url)
    }

    private func object(_ data: Data) throws -> NSDictionary {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }

    func testReadsAndWritesEachFixtureUnchanged() throws {
        for name in ["frames", "book"] {
            let data = try fixture(name)
            let project = try Project.decode(data)
            XCTAssertEqual(try object(project.encoded()), try object(data), name)
        }
    }

    func testReadsAFrameSequence() throws {
        let p = try Project.decode(try fixture("frames"))
        XCTAssertEqual(p.page, PageSetup(w: 1080, h: 1350, unit: .px, pxPerUnit: 1))
        XCTAssertEqual(p.frames.map(\.id), ["f1", "f2", "f3"])
        XCTAssertEqual(p.frames[1].background, .black)
        XCTAssertEqual(p.frames[1].items.first?.border, PhotoBorder(width: 24, color: .white))
        XCTAssertEqual(ExportChoices(p.export).caption, "Walks #35mm")
        XCTAssertNotNil(p.photos.values.first { $0.crop != nil })
    }

    func testRefusesOtherSchemas() throws {
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: try fixture("frames")) as? [String: Any])
        raw["schemaVersion"] = currentSchema + 1
        XCTAssertThrowsError(try Project.decode(JSONSerialization.data(withJSONObject: raw))) { e in
            guard case ProjectError.newer = e else { return XCTFail("\(e)") }
        }
        raw["schemaVersion"] = 6
        XCTAssertThrowsError(try Project.decode(JSONSerialization.data(withJSONObject: raw))) { e in
            guard case ProjectError.older(6) = e else { return XCTFail("\(e)") }
        }
    }

    func testRefusesAPhotoPlacedTwice() throws {
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: try fixture("frames")) as? [String: Any])
        var layout = try XCTUnwrap(raw["layout"] as? [String: Any])
        var frames = try XCTUnwrap(layout["frames"] as? [[String: Any]])
        let items = try XCTUnwrap(frames[0]["items"] as? [[String: Any]])
        frames[1]["items"] = items
        layout["frames"] = frames
        raw["layout"] = layout
        XCTAssertThrowsError(try Project.decode(JSONSerialization.data(withJSONObject: raw)))
    }
}
