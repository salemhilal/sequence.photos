import Foundation

// What the phone does to a sequence's frames and photos (src/phone/frameActions.ts), as
// changes to a Project, so it's tested apart from the screens.

/** Where photos being added go: a new frame each, the empty frames first, or the desk. */
enum AddTo: String {
    case frames, fill, desk
}

/** Instagram's portrait size: where a new sequence starts. */
let newPage = PageSetup(w: 1080, h: 1350, unit: .px, pxPerUnit: 1)

/** A new project's name, until it's renamed. */
let untitled = "Untitled sequence"

/** The desk's resolution: how many photo pixels make a desk inch, and the largest a photo shows. */
private let deskPPI = 96.0
private let deskPhotoPx = 480.0

extension Project {
    /** A sequence of one empty frame, at Instagram's portrait size, with a border guide 5% in. */
    static func newSequence(_ page: PageSetup = newPage) -> Project {
        let guide = BorderGuide.even(inset: (page.w * 0.05).rounded())
        return Project(
            schemaVersion: currentSchema, photos: [:], pile: [], page: page, layout: .frames([Spread()]),
            settings: Settings(
                centerV: true, centerH: true, keepRelative: true, borders: [guide], lines: [], dropBorder: guide.id),
            nextZ: 1, export: nil)
    }

    func frameIndex(_ id: String) -> Int? {
        frames.firstIndex { $0.id == id }
    }

    func frame(_ id: String) -> Spread? {
        frames.first { $0.id == id }
    }

    /** Where a photo is: its frame's index and its index there, if it's on one. */
    func placed(_ photoId: String) -> (frame: Int, item: Int)? {
        for (f, frame) in frames.enumerated() {
            if let i = frame.items.firstIndex(where: { $0.photoId == photoId }) { return (f, i) }
        }
        return nil
    }

    func placement(_ photoId: String) -> Placement? {
        placed(photoId).map { frames[$0.frame].items[$0.item] }
    }

    /** The desk's photos, in the order they arrived there. */
    var deskPhotos: [String] {
        pile.sorted { $0.z < $1.z }.map(\.photoId)
    }

    /** Add an empty frame before `index` (at the end, past the last); returns its id. */
    @discardableResult
    mutating func addFrame(at index: Int = .max) -> String {
        let frame = Spread()
        var all = frames
        all.insert(frame, at: Swift.min(index, all.count))
        frames = all
        return frame.id
    }

    /** Take a photo off whatever frame it's on, and off the desk. */
    private mutating func takeOff(_ photoId: String) {
        pile.removeAll { $0.photoId == photoId }
        frames = frames.map { f in
            var f = f
            f.items.removeAll { $0.photoId == photoId }
            return f
        }
    }

    /** Put a photo on a frame, fitted to the drop guide and centered, from wherever it was. */
    mutating func placeOnFrame(_ photoId: String, _ frameId: String) {
        guard let photo = photos[photoId], let f = frameIndex(frameId) else { return }
        let r = fitCentered(photo, dropBox(page, settings), center: pageRect(page))
        takeOff(photoId)
        let z = takeZ()
        frames[f].items.append(Placement(photoId: photoId, x: r.x, y: r.y, w: r.w, h: r.h, z: z))
    }

    /** Drop a photo on a frame centered at a point (in the frame's units), fitted to the drop guide. */
    mutating func placeAt(_ photoId: String, _ frameId: String, x: Double, y: Double) {
        guard let photo = photos[photoId], let f = frameIndex(frameId) else { return }
        let fit = fitCentered(photo, dropBox(page, settings))
        let cx = Swift.min(page.w, Swift.max(0, x))
        let cy = Swift.min(page.h, Swift.max(0, y))
        takeOff(photoId)
        let z = takeZ()
        frames[f].items.append(Placement(photoId: photoId, x: cx - fit.w / 2, y: cy - fit.h / 2, w: fit.w, h: fit.h, z: z))
    }

    /** Add new photos to the project, and put them where asked. */
    mutating func addPhotos(_ new: [PhotoMeta], to: AddTo) {
        for p in new { photos[p.id] = p }
        var empty = to == .fill ? frames.filter(\.items.isEmpty).map(\.id) : []
        for p in new {
            if to == .desk {
                toDesk(p.id)
                continue
            }
            let id = empty.isEmpty ? addFrame() : empty.removeFirst()
            placeOnFrame(p.id, id)
        }
    }

    /** A photo back to the desk (dragged into the tray), without its border. */
    mutating func toDesk(_ photoId: String) {
        guard let photo = photos[photoId] else { return }
        if pile.contains(where: { $0.photoId == photoId }) { return }
        takeOff(photoId)
        let size = visibleSize(photo)
        let long = Swift.min(Swift.max(size.w, size.h), deskPhotoPx) / deskPPI
        let aspect = size.w / size.h
        let w = aspect >= 1 ? long : long * aspect
        let h = aspect >= 1 ? long / aspect : long
        // In a row along the desk: the phone's desk is a strip, so where doesn't matter.
        let x = (pile.map(\.rect.right).max() ?? 0) + 0.2
        let z = takeZ()
        pile.append(Placement(photoId: photoId, x: x, y: 0, w: w, h: h, z: z))
    }

    /** Change a placed photo where it is. */
    mutating func updatePlacement(_ photoId: String, _ change: (inout Placement) -> Void) {
        guard let at = placed(photoId) else { return }
        var all = frames
        change(&all[at.frame].items[at.item])
        frames = all
    }

    /** Bring a placed photo to the top of its frame. */
    mutating func raise(_ photoId: String) {
        guard let at = placed(photoId) else { return }
        let items = frames[at.frame].items
        if items[at.item].z >= items.map(\.z).max() ?? 0 { return }
        let z = takeZ()
        updatePlacement(photoId) { $0.z = z }
    }

    /** Frames' backgrounds (white, the default, is none). */
    mutating func setBackground(_ frameIds: [String], _ ink: Ink) {
        frames = frames.map { f in
            var f = f
            if frameIds.contains(f.id) { f.background = ink == .white ? nil : ink }
            return f
        }
    }

    /** A photo's border, or none. */
    mutating func setBorder(_ photoId: String, _ border: PhotoBorder?) {
        updatePlacement(photoId) { $0.border = border.flatMap { $0.width > 0 ? $0 : nil } }
    }

    /** Fit a placed photo, border and all, into `box` (the frame, or a guide), centered there. */
    mutating func fitPhoto(_ photoId: String, _ box: Rect) {
        guard let photo = photos[photoId], let p = placement(photoId) else { return }
        let b = p.border?.width ?? 0
        let inner = Rect(x: box.x + b, y: box.y + b, w: Swift.max(1, box.w - 2 * b), h: Swift.max(1, box.h - 2 * b))
        updatePlacement(photoId) { $0.rect = fitCentered(photo, inner) }
    }

    /** Center a placed photo on its frame. */
    mutating func centerPhoto(_ photoId: String) {
        let page = self.page
        updatePlacement(photoId) {
            $0.x = (page.w - $0.w) / 2
            $0.y = (page.h - $0.h) / 2
        }
    }

    /**
     * Crop a placed photo to `frame` of the whole photo at `whole` (both in the frame's
     * units): the placement becomes the frame (or the whole photo, if that's all of it).
     */
    mutating func setCropFrame(_ photoId: String, frame: Rect, whole: Rect) {
        guard var photo = photos[photoId], placed(photoId) != nil else { return }
        let crop = cleanCrop(cropFrom(frame, whole))
        photo.crop = crop
        photos[photoId] = photo
        updatePlacement(photoId) { $0.rect = crop == nil ? whole : frame }
    }

    /** A copy of a placed photo (`copy` its new id, its image already stored), just down and right of it, on top. */
    mutating func duplicatePhoto(_ photoId: String, as copy: String) {
        guard var meta = photos[photoId], let at = placed(photoId) else { return }
        meta.id = copy
        meta.name = copyName(meta.name)
        photos[copy] = meta
        var item = frames[at.frame].items[at.item]
        let step = page.w / 40
        item.photoId = copy
        item.x += step
        item.y += step
        item.z = takeZ()
        var all = frames
        all[at.frame].items.append(item)
        frames = all
    }

    /** Delete frames, their photos going to the desk; the first is kept if all were asked for. */
    mutating func deleteFrames(_ ids: [String]) {
        let all = frames
        var kept = all.filter { !ids.contains($0.id) }
        if kept.isEmpty, let first = all.first { kept = [first] }
        let keptIds = Set(kept.map(\.id))
        let gone = all.filter { !keptIds.contains($0.id) }.flatMap { $0.items.sorted { $0.z < $1.z } }.map(\.photoId)
        layout = .frames(kept)
        for id in gone { toDesk(id) }
    }

    /** Remove a photo from the project altogether. */
    mutating func removePhoto(_ photoId: String) {
        takeOff(photoId)
        photos[photoId] = nil
    }

    /** Move frames to before position `to` (in the order before the move), keeping their order. */
    mutating func moveFrames(_ ids: [String], to: Int) {
        let all = frames
        let moving = all.filter { ids.contains($0.id) }
        let before = all.prefix(Swift.min(to, all.count)).filter { !ids.contains($0.id) }.count
        var rest = all.filter { !ids.contains($0.id) }
        rest.insert(contentsOf: moving, at: before)
        frames = rest
    }

    /** Copies of frames, each just after its original, with copies of their photos (`copies`: from → new id). */
    @discardableResult
    mutating func copyFrames(_ ids: [String], copies: [String: String]) -> [String] {
        var all = frames
        var made: [String] = []
        for i in all.indices.reversed() where ids.contains(all[i].id) {
            let f = all[i]
            var items: [Placement] = []
            for item in f.items {
                guard let id = copies[item.photoId], var meta = photos[item.photoId] else { continue }
                meta.id = id
                meta.name = copyName(meta.name)
                photos[id] = meta
                var copy = item
                copy.photoId = id
                copy.z = takeZ()
                items.append(copy)
            }
            let frame = Spread(items: items, background: f.background)
            all.insert(frame, at: i + 1)
            made.insert(frame.id, at: 0)
        }
        frames = all
        return made
    }

    /**
     * The sequence at a new frame size, with one border guide `inset` in (none at 0) that
     * photos drop in, and the center lines on or off. Photos keep their place and size
     * relative to the frame: scaled by the smaller change, around the same relative center.
     */
    func withFrameSetup(_ s: FrameSetup) -> Project {
        var p = self
        let sx = s.w / page.w
        let sy = s.h / page.h
        let f = Swift.min(sx, sy)
        if sx != 1 || sy != 1 {
            p.frames = frames.map { frame in
                var frame = frame
                frame.items = frame.items.map { item in
                    var item = item
                    let cx = item.rect.midX * sx
                    let cy = item.rect.midY * sy
                    item.w *= f
                    item.h *= f
                    item.x = cx - item.w / 2
                    item.y = cy - item.h / 2
                    if var b = item.border {
                        b.width *= f
                        item.border = b
                    }
                    return item
                }
                return frame
            }
            p.settings.lines = settings.lines.map { l in
                var l = l
                l.at *= l.axis == .vertical ? sx : sy
                return l
            }
        }
        p.page.w = s.w
        p.page.h = s.h
        let inset = Swift.max(0, Swift.min(s.inset, Swift.min(s.w, s.h) / 2 - 1))
        if inset > 0 {
            let id = settings.borders.first?.id ?? settings.dropBorder ?? newId()
            p.settings.borders = [.even(id: id, inset: inset)]
            p.settings.dropBorder = id
        } else {
            p.settings.borders = []
            p.settings.dropBorder = nil
        }
        p.settings.centerV = s.center
        p.settings.centerH = s.center
        return p
    }

    var frameSetup: FrameSetup {
        let g = settings.borders.first
        return FrameSetup(
            w: page.w, h: page.h, inset: g.map { $0.kind == .even ? ($0.inset ?? 0) : ($0.top ?? 0) } ?? 0,
            center: settings.centerV && settings.centerH)
    }
}

/** What the frame size sheet sets: the size, the border guide's distance in, and the center lines. */
struct FrameSetup: Equatable {
    var w: Double
    var h: Double
    var inset: Double
    var center: Bool
}

/** The sizes a sequence offers, all in pixels. */
let frameSizes: [(label: String, w: Double, h: Double)] = [
    ("Instagram portrait", 1080, 1350),
    ("Square", 1080, 1080),
    ("Instagram landscape", 1080, 566),
    ("Story", 1080, 1920),
    ("Slides", 1920, 1080),
]

/** "name copy.jpg" for a copy of "name.jpg". */
func copyName(_ name: String) -> String {
    if let dot = name.lastIndex(of: "."), dot > name.startIndex {
        return "\(name[..<dot]) copy\(name[dot...])"
    }
    return "\(name) copy"
}

// Resolution (src/resolution.ts): whether a photo has enough pixels for where it's placed.

/** The photo's pixels per output pixel it covers, on its thinner axis; 1 or more is enough. */
func coverage(_ photo: PhotoMeta, _ item: Placement, pxPerUnit: Double) -> Double {
    let s = visibleSize(photo)
    return Swift.min(s.w / (item.w * pxPerUnit), s.h / (item.h * pxPerUnit))
}

/** Whether a placed photo is enlarged past its own pixels (a hair under, from rounding, isn't). */
func isSoft(_ photo: PhotoMeta?, _ item: Placement, _ page: PageSetup) -> Bool {
    guard let photo else { return false }
    return coverage(photo, item, pxPerUnit: page.pxPerUnit) < 0.99
}

/** How much a photo is enlarged, as a sentence, when it is. */
func enlargedNote(_ photo: PhotoMeta, _ item: Placement, _ page: PageSetup) -> String? {
    let c = coverage(photo, item, pxPerUnit: page.pxPerUnit)
    guard c < 0.99 else { return nil }
    return "Enlarged \(Int((100 / c).rounded()))%: it may look soft."
}
