import PhotosUI
import SwiftUI

/**
 * A sequence's frames, as the sidebar shows them on the desktop: tap one to edit it, hold it
 * for its menu or drag it to move it, Select to duplicate or delete several. Photos come in
 * from +.
 */
struct FramesView: View {
    @Environment(AppModel.self) private var model
    let id: String
    @Binding var path: [Route]

    var body: some View {
        if let store = model.store, store.id == id {
            FramesGrid(store: store, path: $path)
        } else {
            Theme.bg.ignoresSafeArea().onAppear { model.open(id) }
        }
    }
}

private struct FramesGrid: View {
    @Environment(AppModel.self) private var model
    let store: ProjectStore
    @Binding var path: [Route]
    @State private var selecting = false
    @State private var selected: [String] = []
    @State private var picking = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var camera = false
    @State private var adding: AddingPhotos?
    @State private var addingTask: Task<Void, Never>?
    /** Asking where photos go. */
    @State private var asking = false
    @State private var confirmDelete = false
    @State private var renaming = false
    @State private var refitting = false
    @State private var newName = ""
    @State private var sizing = false
    @State private var exporting = false
    @State private var previewAt: Int?
    @State private var dropTarget: String?

    private var project: Project { store.project }
    private var frames: [Spread] { project.frames }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: "\(Int(project.page.w)) × \(Int(project.page.h)) px frames")
                    .font(.mono(12)).foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 14) {
                ForEach(Array(frames.enumerated()), id: \.element.id) { i, f in
                    cell(f, index: i)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
            .animation(Theme.quick, value: frames.map(\.id))
        }
        .background(Theme.bg)
        .navigationTitle(model.name(store.id))
        .navigationBarTitleDisplayMode(.large)
        // Stored photos no project uses yet would be cleared away on leaving.
        .navigationBarBackButtonHidden(selecting || adding != nil)
        .toolbar { toolbar }
        .safeAreaInset(edge: .bottom) { bottomBar }
        .photosPicker(isPresented: $picking, selection: $picked, matching: .images, photoLibrary: .shared())
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            read(items)
        }
        .onAppear {
            if let start = model.startingPhotos, start.sequence == store.id {
                model.startingPhotos = nil
                read(start.items, to: start.to)
            }
        }
        .fullScreenCover(isPresented: $camera) {
            CameraPicker { data in
                camera = false
                if let data, let meta = model.library.photos.add(data: data, name: "Photo.jpg") {
                    adding = AddingPhotos(total: 1, read: [meta])
                    asking = true
                }
            }
            .ignoresSafeArea()
        }
        .confirmationDialog(
            addTitle, isPresented: $asking, titleVisibility: .visible
        ) {
            addChoices
        }
        .onChange(of: asking) { _, now in
            // Dismissed without a choice (a choice's action may come just after this).
            guard !now else { return }
            Task { @MainActor in
                await Task.yield()
                if adding?.to == nil { cancelAdding() }
            }
        }
        .confirmationDialog(
            "Delete \(selected.count) \(selected.count == 1 ? "frame" : "frames")? Their photos go to the desk.",
            isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                store.apply { $0.deleteFrames(selected) }
                selected = []
            }
        }
        .alert("Refit all photos", isPresented: $refitting) {
            Button("Fit to the frame") { withAnimation(Theme.quick) { store.apply { $0.refitAll(toMargin: false) } } }
            if dropGuide(project.settings) != nil {
                Button("Fit to the margin") { withAnimation(Theme.quick) { store.apply { $0.refitAll(toMargin: true) } } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every photo on a frame is resized and centered. Photos on the desk stay as they are.")
        }
        .alert("Rename sequence", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { model.rename(store.id, to: newName) }
        }
        .sheet(isPresented: $sizing) { FrameSettingsSheet(store: store) }
        .sheet(isPresented: $exporting) { ExportView(store: store) }
        .fullScreenCover(item: Binding(get: { previewAt.map(PreviewStart.init) }, set: { previewAt = $0?.index })) {
            PreviewView(project: project, start: $0.index)
        }
        .overlay {
            if let adding, adding.to != nil {
                ProgressView("Adding \(min(adding.done + 1, adding.total)) of \(adding.total)…")
                    .padding(20).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if selecting {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") { withAnimation(Theme.quick) { selecting = false; selected = [] } }
            }
            ToolbarItem(placement: .principal) {
                Text(selected.isEmpty ? "Select frames" : "\(selected.count) selected").font(.sans(.headline, .semibold))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(selected.count == frames.count ? "None" : "All") {
                    selected = selected.count == frames.count ? [] : frames.map(\.id)
                }
            }
        } else {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Preview", systemImage: "play") { previewAt = 0 }
                Button("Export", systemImage: "square.and.arrow.up") { exporting = true }
                Menu("More", systemImage: "ellipsis.circle") {
                    Button("Frame settings…", systemImage: "aspectratio") { sizing = true }
                    Button("Refit all photos…", systemImage: "arrow.up.left.and.arrow.down.right") { refitting = true }
                        .disabled(frames.allSatisfy(\.items.isEmpty))
                    Button("Rename…", systemImage: "pencil") {
                        newName = model.name(store.id)
                        renaming = true
                    }
                    Divider()
                    Button("Undo", systemImage: "arrow.uturn.backward") { store.undo() }.disabled(!store.canUndo)
                    Button("Redo", systemImage: "arrow.uturn.forward") { store.redo() }.disabled(!store.canRedo)
                }
            }
        }
    }

    private var bottomBar: some View {
        HStack {
            if selecting {
                Button("Duplicate", systemImage: "plus.square.on.square") { duplicate() }
                    .disabled(selected.isEmpty)
                Spacer()
                Text("Hold and drag to move").font(.sans(.caption)).foregroundStyle(Theme.muted)
                Spacer()
                Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
                    .tint(Theme.danger)
                    .disabled(selected.isEmpty || selected.count >= frames.count)
            } else {
                Button("Select") { withAnimation(Theme.quick) { selecting = true; selected = [] } }
                Spacer()
                Text("\(frames.count) \(frames.count == 1 ? "frame" : "frames")")
                    .font(.mono(12)).foregroundStyle(Theme.muted)
                Spacer()
                Menu {
                    Button("Add photos", systemImage: "photo.on.rectangle") { picking = true }
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button("Take photo", systemImage: "camera") { camera = true }
                    }
                    Button("Add an empty frame", systemImage: "rectangle.badge.plus") {
                        store.apply { $0.addFrame() }
                    }
                } label: {
                    Image(systemName: "plus").font(.sans(.title3))
                }
                .disabled(adding != nil)
                .accessibilityLabel("Add")
            }
        }
        .labelStyle(.titleAndIcon)
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(Theme.panel)
    }

    private func cell(_ f: Spread, index i: Int) -> some View {
        let on = selecting && selected.contains(f.id)
        return VStack(spacing: 6) {
            ZStack(alignment: .topTrailing) {
                FittedFrame(frame: f, page: project.page, photos: project.photos, soft: true)
                    .aspectRatio(project.page.w / project.page.h, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .contentShape(.contextMenuPreview, Rectangle())
                    // A black frame's edge, against the dark behind it.
                    .overlay(Rectangle().strokeBorder(.white.opacity(0.1), lineWidth: 1))
                    .overlay(Rectangle().strokeBorder(on ? Theme.accent : .clear, lineWidth: 2.5).padding(-4))
                if selecting {
                    Image(systemName: on ? "checkmark.circle.fill" : "circle")
                        .font(.sans(.title3))
                        .foregroundStyle(on ? Theme.onAccent : .white, on ? Theme.accent : .clear)
                        .background(on ? .clear : Color.black.opacity(0.4), in: Circle())
                        .padding(6)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .overlay(alignment: .leading) {
                if dropTarget == f.id {
                    Capsule().fill(Theme.accent).frame(width: 3).offset(x: -9).padding(.vertical, 4)
                }
            }
            Text(String(format: "%02d", i + 1)).font(.mono(12)).foregroundStyle(on ? Theme.accent : Theme.muted)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if selecting {
                selected = selected.contains(f.id) ? selected.filter { $0 != f.id } : selected + [f.id]
            } else {
                path.append(.editor(store.id, frame: f.id))
            }
        }
        .draggable(FrameDrag(ids: selecting && selected.contains(f.id) ? selectedInOrder : [f.id])) {
            FrameView(frame: f, page: project.page, photos: project.photos, width: 120)
                .overlay(alignment: .topTrailing) {
                    let n = selecting && selected.contains(f.id) ? selected.count : 1
                    if n > 1 {
                        Text("\(n)").font(.sans(.caption, .bold)).padding(6).background(Theme.accent, in: Circle())
                            .foregroundStyle(Theme.onAccent).offset(x: 8, y: -8)
                    }
                }
                .environment(model)
        }
        .dropDestination(for: FrameDrag.self) { drags, _ in
            guard let d = drags.first else { return false }
            store.apply { $0.moveFrames(d.ids, to: i) }
            return true
        } isTargeted: { on in
            if on { dropTarget = f.id } else if dropTarget == f.id { dropTarget = nil }
        }
        .accessibilityElement(children: .ignore)
        .contextMenu {
            if !selecting {
                Button("Preview from here", systemImage: "play") { previewAt = i }
                Button("Duplicate", systemImage: "plus.square.on.square") { duplicate([f.id]) }
                Button(role: .destructive) {
                    withAnimation(Theme.quick) { store.apply { $0.deleteFrames([f.id]) } }
                } label: {
                    Label("Delete", systemImage: "trash")
                    if !f.items.isEmpty { Text("Its photos go to the desk") }
                }
                .disabled(frames.count == 1)
            }
        }
        .accessibilityLabel("Frame \(i + 1)")
        .accessibilityIdentifier("frame-\(f.id)")
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
    }

    private var selectedInOrder: [String] {
        frames.map(\.id).filter(selected.contains)
    }

    private var addTitle: String {
        let n = adding?.total ?? 0
        return "Add \(n) \(n == 1 ? "photo" : "photos")"
    }

    @ViewBuilder private var addChoices: some View {
        let n = adding?.total ?? 0
        let empty = frames.filter(\.items.isEmpty).count
        let filled = min(empty, n)
        Button("\(n == 1 ? "A new frame" : "A frame for each") (\(frameRange(frames.count + 1, n)))") { choose(.frames) }
        if empty > 0 {
            Button(
                n > filled
                    ? "Fill empty frames first (\(filled) empty, then \(frameRange(frames.count + 1, n - filled).lowercased()))"
                    : "Fill empty frames first (\(filled) of the \(empty) empty)"
            ) { choose(.fill) }
        }
        Button("To the desk") { choose(.desk) }
        Button("Cancel", role: .cancel) { cancelAdding() }
    }

    /** Start reading photos right away, while asking where they go (unless that's known). */
    private func read(_ items: [PhotosPickerItem], to: AddTo? = nil) {
        let job = AddingPhotos(total: items.count, to: to)
        adding = job
        if to == nil {
            // Asked once the picker's gone: a dialog can't open while it's still closing.
            Task {
                try? await Task.sleep(for: .milliseconds(450))
                if adding?.id == job.id { asking = true }
            }
        }
        addingTask = Task {
            let result = await importPicked(items, into: model.library.photos) { done, _ in
                if adding?.id == job.id { adding?.done = done }
            }
            guard adding?.id == job.id else { return }
            if result.failed > 0 {
                model.notice = "Couldn’t read \(result.failed) \(result.failed == 1 ? "photo" : "photos")."
            }
            adding?.read = result.photos
            finishAdding()
        }
    }

    private func choose(_ to: AddTo) {
        adding?.to = to
        finishAdding()
    }

    /** Add the photos, once they're read and it's known where they go. */
    private func finishAdding() {
        guard let ready = adding?.ready else { return }
        adding = nil
        asking = false
        if !ready.photos.isEmpty { withAnimation(Theme.quick) { store.apply { $0.addPhotos(ready.photos, to: ready.to) } } }
    }

    private func cancelAdding() {
        addingTask?.cancel()
        adding = nil
    }

    private func duplicate(_ frameIds: [String]? = nil) {
        let chosen = frameIds ?? selected
        let ids = frames.filter { chosen.contains($0.id) }.flatMap(\.items).map(\.photoId)
        var copies: [String: String] = [:]
        for photoId in ids {
            let copy = newId()
            if model.library.photos.copy(photoId, to: copy) { copies[photoId] = copy }
        }
        withAnimation(Theme.quick) { store.apply { $0.copyFrames(chosen, copies: copies) } }
        if frameIds == nil { selected = [] }
    }
}

/** Frames being dragged to a new place in the grid. */
struct FrameDrag: Codable, Transferable {
    var ids: [String]

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .sequenceFrames)
    }
}

/** Where the preview starts. */
struct PreviewStart: Identifiable {
    let index: Int
    var id: Int { index }
}
