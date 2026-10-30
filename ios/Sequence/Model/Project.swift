import Foundation

// The saved project, as the web and Mac app save it (src/types.ts, schema 7), so a project
// can travel between them. Positions on pages are in the page's unit; the desk is in inches.
// The iPhone app only makes sequences of frames in pixels, but reads (and writes back,
// unchanged) anything a schema 7 project holds.

/** The schema this app reads and writes (src/types.ts's CURRENT_SCHEMA). */
let currentSchema = 7

/** The colors a page's background and a photo's border come in, for now. */
enum Ink: String, Codable, CaseIterable {
    case white, black
}

/** A rectangle within a photo, in fractions of its upright width and height (0 to 1). */
struct Crop: Codable, Equatable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

/** A border around a placed photo, outside its edges, in the page's unit. */
struct PhotoBorder: Codable, Equatable {
    var width: Double
    var color: Ink
}

struct PhotoMeta: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    /** Pixel dimensions of the original, upright. */
    var pxW: Double
    var pxH: Double
    /** The part of the original that shows, wherever the photo is; none is the whole photo. */
    var crop: Crop?

    init(id: String, name: String, pxW: Double, pxH: Double, crop: Crop? = nil) {
        self.id = id
        self.name = name
        self.pxW = pxW
        self.pxH = pxH
        self.crop = crop
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        pxW = try c.decode(Double.self, forKey: .pxW)
        pxH = try c.decode(Double.self, forKey: .pxH)
        // A damaged crop is left out (the whole photo shows), as the web app does.
        crop = (try? c.decodeIfPresent(Crop.self, forKey: .crop)).flatMap { cleanCrop($0) }
    }
}

struct Placement: Codable, Equatable {
    var photoId: String
    var x: Double
    var y: Double
    var w: Double
    var h: Double
    /** Stacking order; the most recently touched photo has the highest z. */
    var z: Double
    var border: PhotoBorder?

    init(photoId: String, x: Double, y: Double, w: Double, h: Double, z: Double, border: PhotoBorder? = nil) {
        self.photoId = photoId
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.z = z
        self.border = border
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        photoId = try c.decode(String.self, forKey: .photoId)
        x = try c.decode(Double.self, forKey: .x)
        y = try c.decode(Double.self, forKey: .y)
        w = try c.decode(Double.self, forKey: .w)
        h = try c.decode(Double.self, forKey: .h)
        z = try c.decode(Double.self, forKey: .z)
        // A damaged border is left out.
        border = (try? c.decodeIfPresent(PhotoBorder.self, forKey: .border)).flatMap { $0.width > 0 ? $0 : nil }
    }

    var rect: Rect {
        get { Rect(x: x, y: y, w: w, h: h) }
        set {
            x = newValue.x
            y = newValue.y
            w = newValue.w
            h = newValue.h
        }
    }
}

enum SpreadKind: String, Codable {
    case first, middle, last, frame
}

/** A book's spread or a sequence's frame: its photos, and the color behind them. */
struct Spread: Codable, Equatable, Identifiable {
    var kind: SpreadKind
    var id: String
    var items: [Placement]
    /** None is white. */
    var background: Ink?

    init(kind: SpreadKind = .frame, id: String = newId(), items: [Placement] = [], background: Ink? = nil) {
        self.kind = kind
        self.id = id
        self.items = items
        self.background = background
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(SpreadKind.self, forKey: .kind)
        id = try c.decode(String.self, forKey: .id)
        items = try c.decode([Placement].self, forKey: .items)
        // White is kept as none; an unknown color too.
        let ink = try? c.decodeIfPresent(Ink.self, forKey: .background)
        background = ink == .black ? .black : nil
    }
}

enum Unit: String, Codable {
    case inches = "in"
    case px
}

/** One page's size, its unit, and its resolution (dpi for inches, density for pixels). */
struct PageSetup: Codable, Equatable {
    var w: Double
    var h: Double
    var unit: Unit
    var pxPerUnit: Double
}

/** A book (first, middle, and last spreads) or a sequence of frames. */
enum Layout: Equatable {
    case spreads(first: Spread, spreads: [Spread], last: Spread)
    case frames([Spread])
}

extension Layout: Codable {
    private enum Keys: String, CodingKey {
        case kind, firstSpread, spreads, lastSpread, frames
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "spreads":
            self = .spreads(
                first: try c.decode(Spread.self, forKey: .firstSpread),
                spreads: try c.decode([Spread].self, forKey: .spreads),
                last: try c.decode(Spread.self, forKey: .lastSpread))
        case "frames":
            let frames = try c.decode([Spread].self, forKey: .frames)
            if frames.isEmpty {
                throw DecodingError.dataCorruptedError(forKey: .frames, in: c, debugDescription: "No frames")
            }
            self = .frames(frames)
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "Unknown layout")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case let .spreads(first, spreads, last):
            try c.encode("spreads", forKey: .kind)
            try c.encode(first, forKey: .firstSpread)
            try c.encode(spreads, forKey: .spreads)
            try c.encode(last, forKey: .lastSpread)
        case let .frames(frames):
            try c.encode("frames", forKey: .kind)
            try c.encode(frames, forKey: .frames)
        }
    }
}

/** A border guide: a box inset from every page's edges, the same all round or per edge. */
struct BorderGuide: Codable, Equatable, Identifiable {
    enum Kind: String, Codable {
        case even, edges
    }

    var id: String
    var kind: Kind
    var inset: Double?
    var top: Double?
    var bottom: Double?
    var inside: Double?
    var outside: Double?

    static func even(id: String = newId(), inset: Double) -> BorderGuide {
        BorderGuide(id: id, kind: .even, inset: inset)
    }

    /** Its distances from each edge: inside is a frame's right edge, outside its left. */
    var edges: (top: Double, bottom: Double, inside: Double, outside: Double) {
        switch kind {
        case .even:
            let i = inset ?? 0
            return (i, i, i, i)
        case .edges:
            return (top ?? 0, bottom ?? 0, inside ?? 0, outside ?? 0)
        }
    }
}

/** A straight guide across every page. */
struct LineGuide: Codable, Equatable, Identifiable {
    enum Axis: String, Codable {
        case vertical, horizontal
    }

    var id: String
    var axis: Axis
    /** A vertical guide's distance from a frame's left edge; a horizontal one's from its top. */
    var at: Double
}

struct Settings: Codable, Equatable {
    var centerV: Bool
    var centerH: Bool
    var keepRelative: Bool
    var borders: [BorderGuide]
    var lines: [LineGuide]
    /** The border guide photos dropped on a page fit inside; none means the largest. */
    var dropBorder: String?

    private enum CodingKeys: String, CodingKey {
        case centerV, centerH, keepRelative, borders, lines, dropBorder
    }

    init(
        centerV: Bool, centerH: Bool, keepRelative: Bool, borders: [BorderGuide], lines: [LineGuide],
        dropBorder: String?
    ) {
        self.centerV = centerV
        self.centerH = centerH
        self.keepRelative = keepRelative
        self.borders = borders
        self.lines = lines
        self.dropBorder = dropBorder
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(centerV, forKey: .centerV)
        try c.encode(centerH, forKey: .centerH)
        try c.encode(keepRelative, forKey: .keepRelative)
        try c.encode(borders, forKey: .borders)
        try c.encode(lines, forKey: .lines)
        // Saved as null, not left out, as the web app saves it.
        try c.encode(dropBorder, forKey: .dropBorder)
    }
}

struct Project: Codable, Equatable {
    var schemaVersion: Int
    var photos: [String: PhotoMeta]
    /** Photos on the desk; in desk inches (the desk isn't a page). */
    var pile: [Placement]
    var page: PageSetup
    var layout: Layout
    var settings: Settings
    var nextZ: Double
    /**
     * How it was last set up to export. Kept as it came (the web app's choices are richer),
     * and read and changed through `ExportChoices`.
     */
    var export: JSONValue?

    /** The project's spreads or frames, in order. */
    var spreads: [Spread] {
        switch layout {
        case let .spreads(first, spreads, last): return [first] + spreads + [last]
        case let .frames(frames): return frames
        }
    }

    /** The sequence's frames (the phone only makes sequences; a book has none). */
    var frames: [Spread] {
        get {
            if case let .frames(frames) = layout { return frames }
            return []
        }
        set {
            if case .frames = layout, !newValue.isEmpty { layout = .frames(newValue) }
        }
    }

    /** The next stacking order, taken. */
    mutating func takeZ() -> Double {
        let z = nextZ
        nextZ += 1
        return z
    }
}

/** A new id, as the web app makes them (a UUID string). */
func newId() -> String {
    UUID().uuidString.lowercased()
}

/** Why a saved project couldn't be read. */
enum ProjectError: LocalizedError {
    case newer
    case older(Int)
    case damaged(String)

    var errorDescription: String? {
        switch self {
        case .newer: return "This project was saved by a newer version of Sequence."
        case let .older(v):
            return "This project was saved by an older version of Sequence (format \(v)). Open it in Sequence on the web or Mac, then save it again."
        case let .damaged(why): return "This project is damaged (\(why))."
        }
    }
}

extension Project {
    /** A project read from saved JSON, checked: the right schema, and every placement's photo real. */
    static func decode(_ data: Data) throws -> Project {
        let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        let version = raw?["schemaVersion"] as? Int ?? 0
        if version > currentSchema { throw ProjectError.newer }
        if version < currentSchema { throw ProjectError.older(version) }
        let project: Project
        do {
            project = try JSONDecoder().decode(Project.self, from: data)
        } catch {
            throw ProjectError.damaged(String(describing: error))
        }
        try project.check()
        return project
    }

    /** Fails on what decoding can't see: a photo placed twice, or a placement of no photo. */
    func check() throws {
        var placed = Set<String>()
        for p in pile + spreads.flatMap(\.items) {
            if photos[p.photoId] == nil { throw ProjectError.damaged("no photo \(p.photoId)") }
            if !placed.insert(p.photoId).inserted { throw ProjectError.damaged("\(p.photoId) placed twice") }
            if !(p.w > 0 && p.h > 0) { throw ProjectError.damaged("a photo with no size") }
        }
        for (key, photo) in photos where key != photo.id {
            throw ProjectError.damaged("photo \(key) filed under another id")
        }
        if !(page.w > 0 && page.h > 0 && page.pxPerUnit > 0) { throw ProjectError.damaged("the page") }
    }

    /** As saved: JSON the web and Mac app read. */
    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
}
