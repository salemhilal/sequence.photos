import PhotosUI
import SwiftUI

/** Sequences: every project on the phone, most recently changed first. */
struct SequencesView: View {
    @Environment(AppModel.self) private var model
    @Binding var path: [Route]
    @State private var renaming: LibraryEntry?
    @State private var newName = ""
    @State private var deleting: LibraryEntry?
    @State private var creating = false
    /** The sequence just made: opened once the sheet has gone. */
    @State private var made: String?

    var body: some View {
        List {
            ForEach(model.entries) { e in
                Button {
                    path.append(.frames(e.id))
                } label: {
                    SequenceRow(entry: e)
                        .padding(.horizontal, 16)
                        // Every divider the full width, whatever the thumbnails' widths.
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                        .alignmentGuide(.listRowSeparatorTrailing) { $0.width }
                }
                .listRowInsets(EdgeInsets())
                .listRowSeparator(e.id == model.entries.first?.id ? .hidden : .visible, edges: .top)
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
                    Button("New sequence", systemImage: "plus", action: { creating = true }).buttonStyle(.bordered)
                }
            }
        }
        .navigationTitle("Sequences")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New sequence", systemImage: "plus", action: { creating = true })
            }
        }
        .onAppear { model.close() }
        .sheet(isPresented: $creating, onDismiss: {
            if let made { path.append(.frames(made)) }
            made = nil
        }) {
            NewSequenceSheet { made = $0 }
        }
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

    private func startRename(_ e: LibraryEntry) {
        newName = e.name
        renaming = e
    }
}

/** A new sequence: its name, and photos to start with. */
private struct NewSequenceSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let onMade: (String) -> Void
    @State private var name = ""
    @State private var photos: [PhotosPickerItem] = []
    @State private var to = AddTo.fill
    @State private var setup = Project.newSequence(newPage).frameSetup
    @FocusState private var naming: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField(untitled, text: $name)
                        .focused($naming)
                        .submitLabel(.done)
                        .accessibilityLabel("Name")
                }
                Section("Photos") {
                    PhotosPicker(selection: $photos, matching: .images, photoLibrary: .shared()) {
                        HStack {
                            Text(photos.isEmpty ? "Choose photos" : "\(photos.count) \(photos.count == 1 ? "photo" : "photos") chosen")
                            Spacer()
                            Image(systemName: "photo.on.rectangle").foregroundStyle(Theme.muted)
                        }
                    }
                }
                if !photos.isEmpty {
                    Section {
                        Picker("Put them", selection: $to) {
                            Text(photos.count == 1 ? "On a frame" : "A frame for each").tag(AddTo.fill)
                            Text("On the desk").tag(AddTo.desk)
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }
                }
                Section("Frame") {
                    FramePreview(setup: setup)
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
                Section {
                    NavigationLink {
                        FrameSettingsForm(setup: $setup) {
                            Section {
                                FramePreview(setup: setup)
                                    .frame(maxWidth: .infinity)
                                    .listRowBackground(Color.clear)
                            }
                        }
                        .navigationTitle("Frame settings")
                        .navigationBarTitleDisplayMode(.inline)
                    } label: {
                        HStack {
                            Text("Frame settings")
                            Spacer()
                            Text(verbatim: "\(Int(setup.w)) × \(Int(setup.h)) px").font(.mono(12)).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.panel)
            .navigationTitle("New sequence")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        if let id = model.create(name: name, setup: setup, photos: photos, to: to) { onMade(id) }
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.large])
        .onAppear { naming = true }
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
                Text(entry.name).font(.sans(.body, .medium)).foregroundStyle(Theme.text)
                Text(
                    verbatim: "\(entry.frameCount) \(entry.frameCount == 1 ? "frame" : "frames"), \(Int(entry.page.w)) × \(Int(entry.page.h)) px"
                )
                .font(.mono(12)).foregroundStyle(Theme.muted)
                Text(editedLabel(entry.updated)).font(.sans(.caption)).foregroundStyle(Theme.faint)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}
