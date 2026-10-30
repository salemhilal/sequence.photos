import Foundation

/** A project in the list: enough to show it without loading it. */
struct LibraryEntry: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    /** When it last changed. */
    var updated: Date
    var page: PageSetup
    var frameCount: Int
    /** Its first few frames and their photos, for the list's thumbnails. */
    var coverFrames: [Spread]
    var coverPhotos: [String: PhotoMeta]

    static let coverCount = 3

    init(id: String, name: String, project: Project, updated: Date) {
        self.id = id
        self.name = name
        self.updated = updated
        page = project.page
        frameCount = project.spreads.count
        coverFrames = Array(project.spreads.prefix(Self.coverCount))
        var photos: [String: PhotoMeta] = [:]
        for f in coverFrames {
            for i in f.items { photos[i.photoId] = project.photos[i.photoId] }
        }
        coverPhotos = photos
    }
}

/** The list with `entry` in it (replacing the one with its id), most recently changed first. */
func withEntry(_ list: [LibraryEntry], _ entry: LibraryEntry) -> [LibraryEntry] {
    ([entry] + list.filter { $0.id != entry.id }).sorted { $0.updated > $1.updated }
}

/** "Edited today", "Edited Oct 12", or with the year if it isn't this one. */
func editedLabel(_ updated: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
    if calendar.isDate(updated, inSameDayAs: now) { return "Edited today" }
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US")
    f.calendar = calendar
    f.timeZone = calendar.timeZone
    f.dateFormat = calendar.component(.year, from: updated) == calendar.component(.year, from: now) ? "MMM d" : "MMM d, yyyy"
    return "Edited \(f.string(from: updated))"
}

/**
 * The phone's projects, as files in the app's Application Support folder: a list
 * (`index.json`), each project's JSON (`Projects/<id>.json`, as the web and Mac app save
 * it), and the photos they share (see PhotoStore).
 */
final class Library {
    let root: URL
    let photos: PhotoStore

    init(root: URL) {
        self.root = root
        photos = PhotoStore(root: root.appendingPathComponent("Photos", isDirectory: true))
        try? FileManager.default.createDirectory(at: projectsDir, withIntermediateDirectories: true)
    }

    /** The app's own library; with `-uiTesting`, a fresh one each launch. */
    static func standard() -> Library {
        let fm = FileManager.default
        if ProcessInfo.processInfo.arguments.contains("-uiTesting") {
            let dir = fm.temporaryDirectory.appendingPathComponent("ui-\(UUID().uuidString)", isDirectory: true)
            return Library(root: dir)
        }
        let support = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? fm.temporaryDirectory
        return Library(root: support.appendingPathComponent("Library", isDirectory: true))
    }

    private var indexURL: URL { root.appendingPathComponent("index.json") }
    private var projectsDir: URL { root.appendingPathComponent("Projects", isDirectory: true) }
    private func projectURL(_ id: String) -> URL { projectsDir.appendingPathComponent("\(id).json") }

    private var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        return e
    }

    private var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }

    func list() -> [LibraryEntry] {
        guard let data = try? Data(contentsOf: indexURL) else { return [] }
        return (try? decoder.decode([LibraryEntry].self, from: data)) ?? []
    }

    private func putList(_ list: [LibraryEntry]) throws {
        try encoder.encode(list).write(to: indexURL, options: .atomic)
    }

    /** Start a project and list it; returns its id. */
    @discardableResult
    func create(page: PageSetup = newPage, name: String = untitled) throws -> String {
        let id = newId()
        let project = Project.newSequence(page)
        try project.encoded().write(to: projectURL(id), options: .atomic)
        try putList(withEntry(list(), LibraryEntry(id: id, name: name, project: project, updated: Date())))
        return id
    }

    func load(id: String) throws -> Project {
        try Project.decode(Data(contentsOf: projectURL(id)))
    }

    /** Save a project and its entry in the list. */
    func save(id: String, project: Project) throws {
        try project.encoded().write(to: projectURL(id), options: .atomic)
        let name = list().first { $0.id == id }?.name ?? untitled
        try putList(withEntry(list(), LibraryEntry(id: id, name: name, project: project, updated: Date())))
    }

    func rename(id: String, to name: String) throws {
        var all = list()
        guard let i = all.firstIndex(where: { $0.id == id }) else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        all[i].name = trimmed.isEmpty ? untitled : trimmed
        try putList(all)
    }

    func delete(id: String, keeping open: [Project] = []) throws {
        try? FileManager.default.removeItem(at: projectURL(id))
        try putList(list().filter { $0.id != id })
        collectGarbage(keeping: open)
    }

    /** A copy of a project, photos and all, named "… copy"; returns its id. */
    @discardableResult
    func duplicate(id: String) throws -> String {
        var project = try load(id: id)
        var copies: [String: String] = [:]
        for photoId in project.photos.keys {
            let copy = newId()
            if photos.copy(photoId, to: copy) { copies[photoId] = copy }
        }
        project = project.renamingPhotos(copies)
        let newID = newId()
        try project.encoded().write(to: projectURL(newID), options: .atomic)
        let name = list().first { $0.id == id }.map { "\($0.name) copy" } ?? untitled
        try putList(withEntry(list(), LibraryEntry(id: newID, name: name, project: project, updated: Date())))
        return newID
    }

    /**
     * Delete stored photos no project uses anymore. `keeping` are projects not (yet) saved
     * that still count: the open one's undo history. Photos being added are stored before any
     * project refers to them, so this isn't run while they are.
     */
    func collectGarbage(keeping: [Project] = []) {
        var live = Set<String>()
        for p in keeping { live.formUnion(p.photos.keys) }
        for e in list() {
            if let p = try? load(id: e.id) { live.formUnion(p.photos.keys) }
        }
        for id in photos.storedIds() where !live.contains(id) { photos.delete(id) }
    }
}

extension Project {
    /** The project with photos given new ids (`ids`: old → new), everywhere they're placed. */
    func renamingPhotos(_ ids: [String: String]) -> Project {
        var p = self
        p.photos = Dictionary(uniqueKeysWithValues: photos.map { key, meta in
            var meta = meta
            meta.id = ids[key] ?? key
            return (meta.id, meta)
        })
        let renamed = { (items: [Placement]) in
            items.map { i -> Placement in
                var i = i
                i.photoId = ids[i.photoId] ?? i.photoId
                return i
            }
        }
        p.pile = renamed(pile)
        switch layout {
        case let .frames(frames):
            p.layout = .frames(frames.map { f in
                var f = f
                f.items = renamed(f.items)
                return f
            })
        case let .spreads(first, spreads, last):
            let r = { (s: Spread) -> Spread in
                var s = s
                s.items = renamed(s.items)
                return s
            }
            p.layout = .spreads(first: r(first), spreads: spreads.map(r), last: r(last))
        }
        return p
    }
}
