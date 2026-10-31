import XCTest

@testable import Sequence

/** Portrait photos, 2:3. */
private func photo(_ id: String) -> PhotoMeta {
    PhotoMeta(id: id, name: "\(id).jpg", pxW: 800, pxH: 1200)
}

/** A 1080 × 1350 sequence with one empty frame and a 54 px border guide. */
private func seq() -> Project {
    .newSequence()
}

private func ids(_ p: Project) -> [[String]] {
    p.frames.map { $0.items.map(\.photoId) }
}

/** The same as src/phone/frameActions.test.ts. */
final class FrameActionTests: XCTestCase {
    func testNewSequence() throws {
        let p = seq()
        XCTAssertEqual(p.page, PageSetup(w: 1080, h: 1350, unit: .px, pxPerUnit: 1))
        XCTAssertEqual(p.frames.count, 1)
        XCTAssertEqual(p.settings.borders, [.even(id: try XCTUnwrap(p.settings.dropBorder), inset: 54)])
        XCTAssertNoThrow(try Project.decode(p.encoded()))
    }

    func testGivesEachPhotoAFrameAfterTheEmptyOne() throws {
        var p = seq()
        p.addPhotos([photo("a"), photo("b")], to: .frames)
        XCTAssertEqual(ids(p), [[], ["a"], ["b"]])
        XCTAssertNoThrow(try p.check())
    }

    func testFillsTheEmptyFramesFirst() {
        var p = seq()
        p.addPhotos([photo("a"), photo("b")], to: .fill)
        XCTAssertEqual(ids(p), [["a"], ["b"]])
    }

    func testFitsInsideTheDropGuideCentered() {
        var p = seq()
        p.addPhotos([photo("a")], to: .fill)
        XCTAssertEqual(p.frames[0].items[0].rect, Rect(x: 126, y: 54, w: 828, h: 1242))
    }

    func testPutsThemOnTheDeskInOrder() {
        var p = seq()
        p.addPhotos([photo("a"), photo("b"), photo("c")], to: .desk)
        XCTAssertEqual(p.deskPhotos, ["a", "b", "c"])
        XCTAssertEqual(p.frames[0].items, [])
    }

    func testPlacesADeskPhotoWhereDropped() throws {
        var p = seq()
        p.addPhotos([photo("a")], to: .desk)
        p.placeAt("a", p.frames[0].id, x: 300, y: 400)
        let item = p.frames[0].items[0]
        XCTAssertEqual(item.rect.midX, 300, accuracy: 1e-9)
        XCTAssertEqual(item.rect.midY, 400, accuracy: 1e-9)
        XCTAssertEqual(p.pile, [])
        XCTAssertNoThrow(try p.check())
    }

    func testKeepsTheDropPointOnTheFrame() {
        var p = seq()
        p.addPhotos([photo("a")], to: .desk)
        p.placeAt("a", p.frames[0].id, x: -500, y: 99999)
        XCTAssertEqual(p.frames[0].items[0].rect.midX, 0)
        XCTAssertEqual(p.frames[0].items[0].rect.midY, 1350)
    }

    func testTakesAPlacedPhotoBackToTheDesk() {
        var p = seq()
        p.addPhotos([photo("a")], to: .fill)
        p.setBorder("a", PhotoBorder(width: 10, color: .black))
        p.toDesk("a")
        XCTAssertEqual(p.frames[0].items, [])
        XCTAssertEqual(p.deskPhotos, ["a"])
        XCTAssertNil(p.pile[0].border)
    }

    func testBackgroundsAndWhiteTakesItOff() {
        var p = seq()
        p.setBackground([p.frames[0].id], .black)
        XCTAssertEqual(p.frames[0].background, .black)
        p.setBackground([p.frames[0].id], .white)
        XCTAssertNil(p.frames[0].background)
    }

    func testBordersAndZeroTakesItOff() {
        var p = seq()
        p.addPhotos([photo("a")], to: .fill)
        p.setBorder("a", PhotoBorder(width: 12, color: .black))
        XCTAssertEqual(p.frames[0].items[0].border, PhotoBorder(width: 12, color: .black))
        p.setBorder("a", PhotoBorder(width: 0, color: .black))
        XCTAssertNil(p.frames[0].items[0].border)
    }

    func testSnapsABorderedPhotoByItsOuterEdge() {
        let border = PhotoBorder(width: 10, color: .white)
        let r = Rect(x: 25, y: 300, w: 400, h: 600)
        XCTAssertEqual(outerRect(r, border), Rect(x: 15, y: 290, w: 420, h: 620))
        XCTAssertEqual(snapPhoto(r, border, GuideLines(xs: [0], ys: []), 20).rect.x, 10)
    }

    func testFitsABorderedPhotoInsideTheBox() {
        var p = seq()
        p.addPhotos([photo("a")], to: .fill)
        p.setBorder("a", PhotoBorder(width: 20, color: .black))
        p.fitPhoto("a", Rect(x: 0, y: 0, w: 1080, h: 1350))
        XCTAssertEqual(p.frames[0].items[0].y, 20)
        XCTAssertEqual(p.frames[0].items[0].h, 1310)
    }

    func testCentersAPhoto() {
        var p = seq()
        p.addPhotos([photo("a")], to: .fill)
        p.updatePlacement("a") {
            $0.x = 0
            $0.y = 0
        }
        p.centerPhoto("a")
        XCTAssertEqual(p.frames[0].items[0].rect.midX, 540)
        XCTAssertEqual(p.frames[0].items[0].rect.midY, 675)
    }

    func testCopiesFramesAfterTheirOriginals() throws {
        var p = seq()
        p.addPhotos([photo("a"), photo("b")], to: .fill)
        p.setBackground([p.frames[1].id], .black)
        p.copyFrames(p.frames.map(\.id), copies: ["a": "a2", "b": "b2"])
        XCTAssertEqual(ids(p), [["a"], ["a2"], ["b"], ["b2"]])
        XCTAssertEqual(p.frames[3].background, .black)
        XCTAssertEqual(p.photos["a2"]?.name, "a copy.jpg")
        XCTAssertNoThrow(try p.check())
    }

    func testDeletesFramesTheirPhotosToTheDesk() {
        var p = seq()
        p.addPhotos([photo("a"), photo("b")], to: .fill)
        p.deleteFrames([p.frames[0].id])
        XCTAssertEqual(ids(p), [["b"]])
        XCTAssertEqual(p.deskPhotos, ["a"])
        p.deleteFrames(p.frames.map(\.id))
        XCTAssertEqual(p.frames.count, 1)
    }

    func testMovesFramesKeepingTheirOrder() {
        var p = seq()
        p.addPhotos([photo("a"), photo("b"), photo("c")], to: .fill)
        p.addFrame()
        let f = p.frames.map(\.id)
        p.moveFrames([f[0], f[1]], to: 3)
        XCTAssertEqual(p.frames.map(\.id), [f[2], f[0], f[1], f[3]])
        p.moveFrames([f[3]], to: 0)
        XCTAssertEqual(p.frames.map(\.id), [f[3], f[2], f[0], f[1]])
    }

    func testFrameSetupResizesAndSetsTheGuides() {
        var p = seq()
        p.addPhotos([photo("a")], to: .fill)
        let square = p.withFrameSetup(FrameSetup(w: 1080, h: 1080, inset: 40, center: false))
        XCTAssertEqual(square.page.h, 1080)
        XCTAssertEqual(square.settings.borders.first?.inset, 40)
        XCTAssertEqual(square.settings.dropBorder, square.settings.borders.first?.id)
        XCTAssertFalse(square.settings.centerV)
        // Kept in proportion to the frame, around the same relative center.
        XCTAssertEqual(square.frames[0].items[0].rect.midY, 540, accuracy: 1e-9)
        XCTAssertEqual(square.frames[0].items[0].h, 1242 * 0.8, accuracy: 1e-9)
        let none = p.withFrameSetup(FrameSetup(w: 1080, h: 1350, inset: 0, center: true))
        XCTAssertEqual(none.settings.borders, [])
        XCTAssertNil(none.settings.dropBorder)
    }

    func testCropFrameSetsTheCropAndThePlacement() throws {
        var p = seq()
        p.addPhotos([photo("a")], to: .fill)
        let whole = p.frames[0].items[0].rect
        let frame = Rect(x: whole.x, y: whole.y + whole.h / 4, w: whole.w, h: whole.h / 2)
        p.setCropFrame("a", frame: frame, whole: whole)
        XCTAssertEqual(p.photos["a"]?.crop, Crop(x: 0, y: 0.25, w: 1, h: 0.5))
        XCTAssertEqual(p.frames[0].items[0].rect, frame)
        p.setCropFrame("a", frame: whole, whole: whole)
        XCTAssertNil(p.photos["a"]?.crop)
    }

    func testSoftPhotos() throws {
        var p = seq()
        p.addPhotos([photo("a")], to: .fill)
        // 800 px wide across 828: enlarged.
        let item = p.frames[0].items[0]
        XCTAssertTrue(isSoft(p.photos["a"], item, p.page))
        XCTAssertEqual(enlargedNote(try XCTUnwrap(p.photos["a"]), item, p.page), "Enlarged 104%: it may look soft.")
    }
}

final class CropTests: XCTestCase {
    func testCleanCrop() {
        XCTAssertNil(cleanCrop(Crop(x: 0, y: 0, w: 1, h: 1)))
        XCTAssertEqual(cleanCrop(Crop(x: -1, y: 0.5, w: 0.001, h: 0.8)), Crop(x: 0, y: 0.2, w: 0.02, h: 0.8))
    }

    func testWholeAndCropFromAreInverses() {
        let frame = Rect(x: 10, y: 20, w: 100, h: 50)
        let crop = Crop(x: 0.25, y: 0.5, w: 0.5, h: 0.25)
        let whole = wholeRect(frame, crop)
        XCTAssertEqual(whole, Rect(x: -40, y: -80, w: 200, h: 200))
        XCTAssertEqual(cropFrom(frame, whole), crop)
    }

    func testPinnedPanKeepsTheCropOnThePhoto() {
        let frame = Rect(x: 0, y: 0, w: 100, h: 100)
        let whole = Rect(x: -50, y: -50, w: 200, h: 200)
        // As far as the frame stays on it.
        XCTAssertEqual(panCrop(frame, whole, 500, 0).x, 0)
        XCTAssertEqual(panCrop(frame, whole, -500, 0).x, -100)
        XCTAssertEqual(panCrop(frame, whole, 20, 0).x, -30)
    }

    func testDraggingAHandleKeepsTheRatio() {
        let whole = Rect(x: 0, y: 0, w: 200, h: 100)
        let start = Rect(x: 50, y: 25, w: 50, h: 50)
        let r = dragCropHandle(start, whole, .se, 30, 0, ratio: 1, min: 10)
        XCTAssertEqual(r.frame.w, r.frame.h, accuracy: 1e-9)
        XCTAssertEqual(r.frame.x, 50)
        // Room only to y = 100 below the anchor.
        XCTAssertLessThanOrEqual(r.frame.bottom, 100 + 1e-9)
    }

    func testFrameToRatio() {
        let whole = Rect(x: 0, y: 0, w: 300, h: 200)
        XCTAssertEqual(frameToRatio(whole, whole, 1), Rect(x: 50, y: 0, w: 200, h: 200))
    }
}

final class LibraryTests: XCTestCase {
    private var root: URL!

    override func setUp() {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: root)
    }

    func testKeepsTheMostRecentlyChangedFirst() throws {
        let lib = Library(root: root)
        let a = try lib.create(name: "A")
        let b = try lib.create(name: "B")
        XCTAssertEqual(lib.list().map(\.id), [b, a])
        try lib.save(id: a, project: lib.load(id: a))
        XCTAssertEqual(lib.list().map(\.name), ["A", "B"])
        try lib.rename(id: a, to: "  ")
        XCTAssertEqual(lib.list().first?.name, untitled)
    }

    func testListsEachProjectsFirstFrames() throws {
        let lib = Library(root: root)
        let id = try lib.create()
        var p = try lib.load(id: id)
        p.addPhotos([photo("a"), photo("b")], to: .frames)
        try lib.save(id: id, project: p)
        let e = try XCTUnwrap(lib.list().first)
        XCTAssertEqual(e.frameCount, 3)
        XCTAssertEqual(e.coverFrames.count, 3)
        XCTAssertEqual(Set(e.coverPhotos.keys), ["a", "b"])
    }

    func testStoresPhotosAndCollectsTheUnused() throws {
        let lib = Library(root: root)
        let data = try XCTUnwrap(UIGraphicsImageRenderer(size: CGSize(width: 30, height: 20)).image { ctx in
            UIColor.red.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 30, height: 20))
        }.jpegData(compressionQuality: 0.9))
        let meta = try XCTUnwrap(lib.photos.add(data: data, name: "red.jpg"))
        XCTAssertEqual(meta.pxW / meta.pxH, 1.5, accuracy: 0.01)
        XCTAssertNotNil(lib.photos.thumb(meta.id))
        let id = try lib.create()
        var p = try lib.load(id: id)
        p.addPhotos([meta], to: .desk)
        try lib.save(id: id, project: p)
        lib.collectGarbage()
        XCTAssertEqual(lib.photos.storedIds(), [meta.id])
        let copy = try lib.duplicate(id: id)
        XCTAssertEqual(lib.photos.storedIds().count, 2)
        try lib.delete(id: id)
        XCTAssertEqual(lib.photos.storedIds().count, 1)
        try lib.delete(id: copy)
        XCTAssertEqual(lib.photos.storedIds(), [])
    }

    func testSaysWhenEachWasEdited() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let at = { (y: Int, m: Int, d: Int, h: Int) in cal.date(from: DateComponents(year: y, month: m, day: d, hour: h))! }
        let now = at(2026, 10, 28, 12)
        XCTAssertEqual(editedLabel(at(2026, 10, 28, 8), now: now, calendar: cal), "Edited today")
        XCTAssertEqual(editedLabel(at(2026, 10, 12, 8), now: now, calendar: cal), "Edited Oct 12")
        XCTAssertEqual(editedLabel(at(2025, 10, 12, 8), now: now, calendar: cal), "Edited Oct 12, 2025")
    }
}

final class StoreTests: XCTestCase {
    func testAGestureIsOneUndoStep() {
        let lib = Library(root: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        let store = ProjectStore(id: "x", project: seq(), library: lib)
        store.begin()
        store.preview { $0.addFrame() }
        store.preview { $0.addFrame() }
        store.end()
        XCTAssertEqual(store.project.frames.count, 2)
        store.undo()
        XCTAssertEqual(store.project.frames.count, 1)
        store.redo()
        XCTAssertEqual(store.project.frames.count, 2)
        store.begin()
        store.preview { $0.addFrame() }
        store.cancel()
        XCTAssertEqual(store.project.frames.count, 2)
    }
}

final class RenderTests: XCTestCase {
    func testPlansAFrameInOutputPixels() {
        var p = seq()
        p.addPhotos([photo("a")], to: .fill)
        p.photos["a"]?.crop = Crop(x: 0, y: 0.5, w: 1, h: 0.5)
        p.updatePlacement("a") {
            $0.x = -100
            $0.border = PhotoBorder(width: 10, color: .black)
        }
        let plan = planFrame(p.frames[0], p.page, p.photos)
        XCTAssertEqual(plan.pxW, 1080)
        XCTAssertEqual(plan.background, .white)
        let d = plan.draws[0]
        XCTAssertEqual(d.dst.x, 0)
        // 100 of 828 cut off on the left: that share of the photo's 800 px.
        XCTAssertEqual(d.src.x, 800 * 100 / 828, accuracy: 1e-9)
        XCTAssertEqual(d.src.y, 600)
        XCTAssertEqual(d.border, PhotoBorder(width: 10, color: .black))
    }

    /** The same as src/instagramImage.test.ts's. */
    func testPostImageLayout() {
        let portrait = postImageLayout(w: 1080, h: 1350, .feed, .crop)
        XCTAssertEqual([portrait.width, portrait.height], [1080, 1350])
        let story = postImageLayout(w: 1080, h: 1920, .feed, .crop)
        XCTAssertEqual([story.width, story.height], [1080, 1350])
        XCTAssertEqual(story.source.y, (1920 - 1350) / 2)
        let expanded = postImageLayout(w: 1080, h: 1920, .feed, .expand)
        // White margins at the sides to 1536 × 1920, then scaled to Instagram's widest.
        XCTAssertEqual([expanded.width, expanded.height], [1440, 1800])
        XCTAssertEqual(expanded.target.w, 1080 * 1440 / 1536, accuracy: 1e-9)
        let asStory = postImageLayout(w: 1080, h: 1920, .story, .crop)
        XCTAssertEqual([asStory.width, asStory.height], [1080, 1920])
        let huge = postImageLayout(w: 4000, h: 3000, .feed, .crop)
        XCTAssertEqual(huge.width, 1440)
    }

    func testRatioLabels() {
        XCTAssertEqual(ratioLabel(0.8), "4:5")
        XCTAssertEqual(ratioLabel(1.91), "1.91:1")
        XCTAssertEqual(hashtagCount("Walks #35mm #film and#not"), 2)
    }

    func testDuplicatingAPlacedPhotoPutsTheCopyOnTheDesk() {
        var p = Project.newSequence()
        let photo = PhotoMeta(id: "a", name: "a.jpg", pxW: 1000, pxH: 1000, crop: Crop(x: 0, y: 0, w: 0.5, h: 0.5))
        p.addPhotos([photo], to: .fill)
        p.duplicatePhoto("a", as: "b")
        XCTAssertEqual(p.frames[0].items.map(\.photoId), ["a"])
        XCTAssertEqual(p.deskPhotos, ["b"])
        XCTAssertEqual(p.photos["b"]?.name, "a copy.jpg")
        XCTAssertEqual(p.photos["b"]?.crop, photo.crop)
    }

    func testRemovingAPhotoTakesItOffTheFrameOrDesk() {
        var p = Project.newSequence()
        p.addPhotos(
            [PhotoMeta(id: "a", name: "a.jpg", pxW: 100, pxH: 100), PhotoMeta(id: "b", name: "b.jpg", pxW: 100, pxH: 100)],
            to: .fill)
        p.removePhoto("a")
        XCTAssertNil(p.photos["a"])
        XCTAssertNil(p.placed("a"))
        p.toDesk("b")
        p.removePhoto("b")
        XCTAssertTrue(p.deskPhotos.isEmpty)
        XCTAssertTrue(p.photos.isEmpty)
    }

    func testABordersFirstColorIsOppositeTheBackground() {
        XCTAssertEqual(Ink.white.opposite, .black)
        XCTAssertEqual(Ink.black.opposite, .white)
    }

    func testAddingPhotosWaitsForBothTheChoiceAndTheReading() {
        var a = AddingPhotos(total: 1)
        XCTAssertNil(a.ready)
        a.to = .desk
        XCTAssertNil(a.ready)
        a.read = []
        XCTAssertEqual(a.ready?.to, .desk)
        var b = AddingPhotos(total: 1)
        b.read = []
        XCTAssertNil(b.ready)
    }

    func testTwoFingersHoldTheFrame() {
        let at = { (zoom: Double, pan: CGSize, x: Double, y: Double) in
            CGPoint(x: 20 + pan.width + x * 2 * zoom, y: 30 + pan.height + y * 2 * zoom)
        }
        let move = { (zoom: Double, pan: CGSize, a: CGPoint, b: CGPoint, a2: CGPoint, b2: CGPoint) in
            anchoredZoom(
                zoom: zoom, pan: pan, fit: 2, baseLeft: 20, baseTop: 30, maxZoom: 6, from: (a, b), to: (a2, b2))
        }
        // Spreading them doubles the size, and what's under each finger stays under it.
        let a = at(1, .zero, 10, 10)
        let b = at(1, .zero, 30, 10)
        let wide = move(1, .zero, a, b, CGPoint(x: a.x - 20, y: a.y), CGPoint(x: b.x + 20, y: b.y))
        XCTAssertEqual(wide.zoom, 2, accuracy: 0.001)
        XCTAssertEqual(at(wide.zoom, wide.pan, 10, 10).x, a.x - 20, accuracy: 0.001)
        XCTAssertEqual(at(wide.zoom, wide.pan, 30, 10).x, b.x + 20, accuracy: 0.001)
        // Moving them together moves the frame, at the same size.
        let moved = move(2, CGSize(width: 5, height: 5), a, b, CGPoint(x: a.x + 30, y: a.y - 12), CGPoint(x: b.x + 30, y: b.y - 12))
        XCTAssertEqual(moved.zoom, 2, accuracy: 0.001)
        XCTAssertEqual(moved.pan.width, 35, accuracy: 0.001)
        XCTAssertEqual(moved.pan.height, -7, accuracy: 0.001)
        // Size stays within its limits.
        XCTAssertEqual(move(1, .zero, a, b, CGPoint(x: a.x + 15, y: a.y), CGPoint(x: b.x - 15, y: b.y)).zoom, 1)
        XCTAssertEqual(move(5, .zero, a, b, CGPoint(x: a.x - 200, y: a.y), CGPoint(x: b.x + 200, y: b.y)).zoom, 6)
    }
}
