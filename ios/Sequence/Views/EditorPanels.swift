import PhotosUI
import SwiftUI

/** The widest border the slider gives, as a share of the frame's width. */
private let maxBorderShare = 0.06

/** A panel's row: a label on the left, things on the right. */
private struct PanelRow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 10) { content }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
    }
}

/** White or black, as swatches. */
struct InkPicker: View {
    let label: String
    @Binding var ink: Ink
    var showNames = true

    var body: some View {
        Picker(label, selection: $ink) {
            ForEach(Ink.allCases, id: \.self) { i in
                Text(showNames ? (i == .white ? "White" : "Black") : (i == .white ? "○" : "●")).tag(i)
            }
        }
        .pickerStyle(.segmented)
    }
}

/**
 * The desk, under the frame: photos not on any frame. Drag one up onto the frame to place it
 * (the tray scrolls sideways; a press lifts a photo).
 */
struct DeskTray: View {
    @Environment(AppModel.self) private var model
    let store: ProjectStore
    @State private var picking = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var importing = false

    var body: some View {
        let ids = store.project.deskPhotos
        VStack(alignment: .leading, spacing: 6) {
            PanelRow {
                Text("Desk").font(.subheadline.weight(.semibold))
                    + Text(" · \(ids.count)").font(.subheadline).foregroundColor(Theme.muted)
                Spacer()
                if importing { ProgressView().controlSize(.small) }
                Button("Add photos", systemImage: "plus") { picking = true }.font(.subheadline)
            }
            ScrollView(.horizontal) {
                LazyHStack(spacing: 8) {
                    if ids.isEmpty {
                        Text("Photos not on a frame wait here.")
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .frame(height: 108)
                    }
                    ForEach(ids, id: \.self) { id in
                        TrayPhoto(id: id, photo: store.project.photos[id])
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
            .frame(height: 108)
            .accessibilityLabel("Desk")
            Text("Drag a photo onto the frame to place it. Drag a placed photo down here to take it off.")
                .font(.footnote).foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
                .fixedSize(horizontal: false, vertical: true)
        }
        .photosPicker(isPresented: $picking, selection: $picked, matching: .images, photoLibrary: .shared())
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            Task {
                importing = true
                let r = await importPicked(items, into: model.library.photos) { _, _ in }
                importing = false
                if r.failed > 0 { model.notice = "Couldn’t read \(r.failed) \(r.failed == 1 ? "photo" : "photos")." }
                withAnimation(Theme.quick) { store.apply { $0.addPhotos(r.photos, to: .desk) } }
            }
        }
    }
}

/** A desk photo in the tray, as cropped; pressed, it lifts to be dragged onto the frame. */
private struct TrayPhoto: View {
    let id: String
    let photo: PhotoMeta?

    var body: some View {
        let size: (w: Double, h: Double) = photo.map(visibleSize) ?? (2, 3)
        let crop = photo.map(cropOf) ?? .whole
        let w = 108 * min(1.5, size.w / size.h)
        let whole = wholeRect(Rect(x: 0, y: 0, w: w, h: 108), crop)
        PhotoImage(id: id)
            .frame(width: whole.w, height: whole.h)
            .offset(x: whole.x, y: whole.y)
            .frame(width: w, height: 108, alignment: .topLeading)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .contentShape(.dragPreview, RoundedRectangle(cornerRadius: 4))
            .draggable(PhotoDrag(id: id))
            .accessibilityLabel(photo?.name ?? "Photo")
    }
}

/** The frame selected: its background, for it or every frame. */
struct FramePanel: View {
    let store: ProjectStore
    let frame: Spread
    let index: Int

    var body: some View {
        let p = store.project
        let ink = frame.background ?? .white
        let everyFrame = p.frames.allSatisfy { ($0.background ?? .white) == ink }
        VStack(alignment: .leading, spacing: 6) {
            PanelRow {
                Text("Frame \(String(format: "%02d", index + 1))").font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(Int(p.page.w)) × \(Int(p.page.h)) px").font(.mono(12)).foregroundStyle(Theme.muted)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Background").font(.footnote).foregroundStyle(Theme.muted)
                InkPicker(
                    label: "Background",
                    ink: Binding(get: { ink }, set: { v in store.apply { $0.setBackground([frame.id], v) } }))
            }
            .padding(.horizontal, 16)
            Button("Use on every frame") { store.apply { $0.setBackground($0.frames.map(\.id), ink) } }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)
                .disabled(everyFrame)
                .padding(.horizontal, 16)
                .padding(.top, 4)
            Text("Tap outside the frame for the desk.")
                .font(.footnote).foregroundStyle(Theme.muted)
                .padding(.horizontal, 16)
        }
    }
}

/** A photo selected: its detail, place and size, border, and what can be done with it. */
struct PhotoPanel: View {
    @Environment(AppModel.self) private var model
    let store: ProjectStore
    let item: Placement
    @Binding var editing: Editing
    let onCrop: () -> Void
    @State private var lock = true
    @State private var fitting = false
    /** The color a border gets: its own, or the one last picked. */
    @State private var picked: Ink = .white

    var body: some View {
        let p = store.project
        let id = item.photoId
        let border = item.border?.width ?? 0
        let maxBorder = (p.page.w * maxBorderShare).rounded()
        let color = item.border?.color ?? picked
        VStack(alignment: .leading, spacing: 4) {
            PanelRow {
                Text(p.photos[id]?.name ?? "Photo").font(.mono(12).weight(.medium)).lineLimit(1).truncationMode(.middle)
                Spacer()
                if let photo = p.photos[id], let note = enlargedNote(photo, item, p.page) {
                    Text(note).font(.footnote).foregroundStyle(Theme.warn).lineLimit(1)
                }
            }
            PanelRow {
                NumberField(label: "X", value: item.x) { v in setBox(\.x, v) }
                NumberField(label: "Y", value: item.y) { v in setBox(\.y, v) }
                NumberField(label: "W", value: item.w) { v in setSize(w: v) }
                NumberField(label: "H", value: item.h) { v in setSize(h: v) }
                Button {
                    lock.toggle()
                } label: {
                    Image(systemName: lock ? "link" : "link.badge.plus")
                        .foregroundStyle(lock ? Theme.accent : Theme.muted)
                }
                .accessibilityLabel("Keep proportions")
                .accessibilityAddTraits(lock ? .isSelected : [])
            }
            PanelRow {
                Text("Border").font(.footnote).foregroundStyle(Theme.muted)
                Slider(
                    value: Binding(
                        get: { min(border, maxBorder) },
                        set: { w in store.preview { $0.setBorder(id, w > 0 ? PhotoBorder(width: w, color: color) : nil) } }),
                    in: 0...max(1, maxBorder), step: 1
                ) { began in
                    if began { store.begin() } else { store.end() }
                }
                .accessibilityLabel("Border width")
                Text("\(Int(border.rounded())) px").font(.mono(12)).frame(width: 46, alignment: .trailing)
                InkPicker(
                    label: "Border color", ink: Binding(get: { color }, set: { v in
                        picked = v
                        let w = border > 0 ? border : (p.page.w / 90).rounded()
                        store.apply { $0.setBorder(id, PhotoBorder(width: w, color: v)) }
                    }), showNames: false
                )
                .frame(width: 84)
            }
            HStack(spacing: 0) {
                tool("Crop", "crop", action: onCrop)
                tool("Fit", "arrow.up.left.and.arrow.down.right") { fitting = true }
                tool("Center", "scope") { withAnimation(Theme.quick) { store.apply { $0.centerPhoto(id) } } }
                tool("Duplicate", "plus.square.on.square") { duplicate(id) }
            }
            .padding(.horizontal, 8)
            .padding(.top, 4)
        }
        .confirmationDialog("Fit", isPresented: $fitting) {
            Button("Fit the frame") { withAnimation(Theme.quick) { store.apply { $0.fitPhoto(id, pageRect($0.page)) } } }
            if let g = dropGuide(p.settings) {
                Button("Fit the border guide") {
                    withAnimation(Theme.quick) { store.apply { $0.fitPhoto(id, borderBox($0.page, g)) } }
                }
            }
        }
    }

    private func tool(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 20))
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.text)
    }

    private func setBox(_ key: WritableKeyPath<Placement, Double>, _ v: Double) {
        store.apply { $0.updatePlacement(item.photoId) { $0[keyPath: key] = v } }
    }

    private func setSize(w: Double? = nil, h: Double? = nil) {
        let lock = self.lock
        store.apply {
            $0.updatePlacement(item.photoId) { it in
                let aspect = it.w / it.h
                if let w {
                    it.w = max(10, w)
                    if lock { it.h = it.w / aspect }
                }
                if let h {
                    it.h = max(10, h)
                    if lock { it.w = it.h * aspect }
                }
            }
        }
    }

    private func duplicate(_ id: String) {
        let copy = newId()
        guard model.library.photos.copy(id, to: copy) else { return }
        withAnimation(Theme.quick) {
            store.apply { $0.duplicatePhoto(id, as: copy) }
            editing = .photo(copy)
        }
    }
}

/** A number in the frame's units, typed in; set when it's done. */
struct NumberField: View {
    let label: String
    let value: Double
    let onChange: (Double) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(Theme.muted)
            TextField(label, text: $text)
                .font(.mono(12))
                .keyboardType(.numbersAndPunctuation)
                .submitLabel(.done)
                .focused($focused)
                .onSubmit(commit)
        }
        .padding(.horizontal, 6)
        .frame(height: 32)
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 6))
        .onAppear { text = Self.format(value) }
        .onChange(of: value) { _, v in if !focused { text = Self.format(v) } }
        .onChange(of: focused) { _, f in if !f { commit() } }
        .accessibilityLabel(label)
    }

    private func commit() {
        if let v = Double(text.replacingOccurrences(of: ",", with: "")), v.isFinite, abs(v - value) > 1e-9 {
            onChange(v)
        } else {
            text = Self.format(value)
        }
    }

    static func format(_ v: Double) -> String {
        String(Int(v.rounded()))
    }
}
