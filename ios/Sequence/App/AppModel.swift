import Foundation
import Observation
import PhotosUI
import SwiftUI

/** Photos chosen when making a sequence, and where they go. */
struct StartingPhotos {
    let sequence: String
    let items: [PhotosPickerItem]
    let to: AddTo
}

/** The app's state: the list of sequences, and the one open, if any. */
@Observable
final class AppModel {
    let library: Library
    private(set) var entries: [LibraryEntry] = []
    /** The open sequence. */
    private(set) var store: ProjectStore?
    /** Something went wrong, to say. */
    var notice: String?
    /** Photos chosen for a sequence just made, which its frames screen brings in. */
    var startingPhotos: StartingPhotos?

    init(library: Library) {
        self.library = library
        refresh()
    }

    func refresh() {
        entries = library.list()
    }

    /** Open a sequence for editing (saving the one open, if another). */
    @discardableResult
    func open(_ id: String) -> ProjectStore? {
        if let store, store.id == id { return store }
        close()
        do {
            store = ProjectStore(id: id, project: try library.load(id: id), library: library)
        } catch {
            notice = error.localizedDescription
        }
        return store
    }

    /** Close the open sequence, saved. */
    func close() {
        guard let was = store else { return }
        was.save()
        store = nil
        refresh()
        library.collectGarbage()
    }

    /** Start a new sequence, with photos to bring in once it's open; returns its id. */
    func create(name: String, photos: [PhotosPickerItem] = [], to: AddTo = .fill) -> String? {
        do {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            let id = try library.create(name: trimmed.isEmpty ? untitled : trimmed)
            refresh()
            if !photos.isEmpty { startingPhotos = StartingPhotos(sequence: id, items: photos, to: to) }
            return id
        } catch {
            notice = "Couldn’t start a sequence: \(error.localizedDescription)"
            return nil
        }
    }

    func rename(_ id: String, to name: String) {
        try? library.rename(id: id, to: name)
        refresh()
    }

    func delete(_ id: String) {
        if store?.id == id { store = nil }
        try? library.delete(id: id)
        refresh()
    }

    func duplicate(_ id: String) {
        store?.save()
        do {
            try library.duplicate(id: id)
        } catch {
            notice = "Couldn’t duplicate it: \(error.localizedDescription)"
        }
        refresh()
    }

    func name(_ id: String) -> String {
        entries.first { $0.id == id }?.name ?? untitled
    }
}
