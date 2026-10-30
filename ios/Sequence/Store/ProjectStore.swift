import Foundation
import Observation

/**
 * The open project, with undo and redo. A gesture changes the project many times as it
 * goes (`preview`) but makes one undo step (`begin` … `end`); everything else is one step
 * each (`apply`). Saved a moment after it changes, and when the app goes to the background.
 */
@Observable
final class ProjectStore {
    let id: String
    private(set) var project: Project
    private(set) var past: [Project] = []
    private(set) var future: [Project] = []
    /** Where a gesture started, while one is going. */
    private var gestureStart: Project?
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private let library: Library

    private static let undoLimit = 100

    init(id: String, project: Project, library: Library) {
        self.id = id
        self.project = project
        self.library = library
    }

    var canUndo: Bool { !past.isEmpty }
    var canRedo: Bool { !future.isEmpty }

    /** Change the project as one undo step. */
    func apply(_ change: (inout Project) -> Void) {
        var next = project
        change(&next)
        replace(next)
    }

    /** Put in a new project as one undo step. */
    func replace(_ next: Project) {
        guard next != project else { return }
        past.append(project)
        if past.count > Self.undoLimit { past.removeFirst() }
        future = []
        project = next
        changed()
    }

    /**
     * Keep how the project was last exported: saved, but not an undo step (undo leaves it as
     * it is, as the desktop does).
     */
    func setExport(_ value: JSONValue) {
        guard project.export != value else { return }
        project.export = value
        past = past.map { var p = $0; p.export = value; return p }
        future = future.map { var p = $0; p.export = value; return p }
        if var start = gestureStart {
            start.export = value
            gestureStart = start
        }
        changed()
    }

    /** Start a gesture: its changes are one undo step, made when it ends. */
    func begin() {
        if gestureStart == nil { gestureStart = project }
    }

    /** A gesture's change so far, shown but not yet an undo step. */
    func preview(_ change: (inout Project) -> Void) {
        begin()
        var next = gestureStart ?? project
        change(&next)
        project = next
    }

    /** End a gesture, making its change one undo step. */
    func end() {
        guard let start = gestureStart else { return }
        gestureStart = nil
        guard project != start else { return }
        past.append(start)
        if past.count > Self.undoLimit { past.removeFirst() }
        future = []
        changed()
    }

    /** Stop a gesture, undoing what it did. */
    func cancel() {
        guard let start = gestureStart else { return }
        gestureStart = nil
        project = start
    }

    func undo() {
        guard let last = past.popLast() else { return }
        future.append(project)
        project = last
        changed()
    }

    func redo() {
        guard let next = future.popLast() else { return }
        past.append(project)
        project = next
        changed()
    }

    private func changed() {
        saveTask?.cancel()
        saveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.save()
        }
    }

    /** Save now (if there's anything not yet saved). */
    func save() {
        saveTask?.cancel()
        saveTask = nil
        try? library.save(id: id, project: project)
    }

    /** Every project the store holds (now, and in its history): photos any of them uses stay stored. */
    var allProjects: [Project] {
        past + [project] + future
    }
}
