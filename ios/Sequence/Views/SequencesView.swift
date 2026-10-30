import SwiftUI

/** Sequences: every project on the phone, most recently changed first. */
struct SequencesView: View {
    @Environment(AppModel.self) private var model
    @Binding var path: [Route]
    @State private var renaming: LibraryEntry?
    @State private var newName = ""
    @State private var deleting: LibraryEntry?

    var body: some View {
        List {
            ForEach(model.entries) { e in
                Button {
                    path.append(.frames(e.id))
                } label: {
                    SequenceRow(entry: e)
                }
                .listRowBackground(Theme.bg)
                .contextMenu {
                    Button("Rename", systemImage: "pencil") { startRename(e) }
                    Button("Duplicate", systemImage: "plus.square.on.square") { model.duplicate(e.id) }
                    Button("Delete", systemImage: "trash", role: .destructive) { deleting = e }
                }
                .swipeActions {
                    Button("Delete", systemImage: "trash") { deleting = e }.tint(Theme.danger)
                    Button("Rename", systemImage: "pencil") { startRename(e) }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .overlay {
            if model.entries.isEmpty {
                ContentUnavailableView {
                    Label("No sequences yet", systemImage: "square.stack")
                } actions: {
                    Button("New sequence", systemImage: "plus", action: create).buttonStyle(.bordered)
                }
            }
        }
        .navigationTitle("Sequences")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New sequence", systemImage: "plus", action: create)
            }
        }
        .onAppear { model.close() }
        .alert("Rename sequence", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { if let e = renaming { model.rename(e.id, to: newName) } }
        }
        .confirmationDialog(
            "Delete “\(deleting?.name ?? "")”? Its frames and photos go too. This can’t be undone.",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible
        ) {
            Button("Delete sequence", role: .destructive) { if let e = deleting { model.delete(e.id) } }
        }
    }

    private func create() {
        if let id = model.create() { path.append(.frames(id)) }
    }

    private func startRename(_ e: LibraryEntry) {
        newName = e.name
        renaming = e
    }
}

/** A sequence in the list: its first frames, its name, size, and when it was edited. */
struct SequenceRow: View {
    let entry: LibraryEntry

    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: 4) {
                ForEach(entry.coverFrames) { f in
                    FrameView(
                        frame: f, page: entry.page, photos: entry.coverPhotos,
                        width: entry.page.w >= entry.page.h ? 80 : 50 * entry.page.w / entry.page.h)
                }
            }
            .frame(minWidth: 60, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name).font(.body.weight(.medium)).foregroundStyle(Theme.text)
                Text(
                    verbatim: "\(entry.frameCount) \(entry.frameCount == 1 ? "frame" : "frames") · \(Int(entry.page.w)) × \(Int(entry.page.h)) px"
                )
                .font(.mono(12)).foregroundStyle(Theme.muted)
                Text(editedLabel(entry.updated)).font(.caption).foregroundStyle(Theme.faint)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}
