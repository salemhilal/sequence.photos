import SwiftUI

/** The largest a side gets, and the smallest, in pixels. */
private let maxSide = 8000.0
private let minSide = 100.0

private func clampSide(_ n: Double) -> Double {
    (max(minSide, min(maxSide, n.isFinite ? n : 0))).rounded()
}

/** Frame size: a preset or a custom size, and the guides; Apply makes it one undo step. */
struct FrameSizeSheet: View {
    @Environment(\.dismiss) private var dismiss
    let store: ProjectStore
    @State private var setup: FrameSetup
    @State private var custom: Bool

    init(store: ProjectStore) {
        self.store = store
        let s = store.project.frameSetup
        _setup = State(initialValue: s)
        _custom = State(initialValue: !frameSizes.contains { $0.w == s.w && $0.h == s.h })
    }

    var body: some View {
        let preview = store.project.withFrameSetup(setup)
        let thumb = min(64, 64 * setup.w / setup.h)
        NavigationStack {
            Form {
                Section {
                    ScrollView(.horizontal) {
                        HStack(alignment: .bottom, spacing: 6) {
                            ForEach(preview.frames) { f in
                                FrameView(frame: f, page: preview.page, photos: preview.photos, width: thumb)
                            }
                        }
                        .animation(Theme.quick, value: setup)
                    }
                    .scrollIndicators(.hidden)
                    .listRowBackground(Color.clear)
                }
                Section("Size") {
                    ForEach(frameSizes, id: \.label) { s in
                        let on = !custom && s.w == setup.w && s.h == setup.h
                        Button {
                            custom = false
                            setup.w = s.w
                            setup.h = s.h
                        } label: {
                            HStack {
                                Text(s.label).foregroundStyle(Theme.text)
                                Spacer()
                                Text("\(Int(s.w)) × \(Int(s.h))").font(.mono(13)).foregroundStyle(Theme.muted)
                                Image(systemName: "checkmark").foregroundStyle(Theme.accent).opacity(on ? 1 : 0)
                            }
                        }
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                    Button {
                        custom = true
                    } label: {
                        HStack {
                            Text("Custom").foregroundStyle(Theme.text)
                            Spacer()
                            Image(systemName: "checkmark").foregroundStyle(Theme.accent).opacity(custom ? 1 : 0)
                        }
                    }
                    if custom {
                        HStack {
                            NumberField(label: "W", value: setup.w) { setup.w = clampSide($0) }
                            NumberField(label: "H", value: setup.h) { setup.h = clampSide($0) }
                        }
                    }
                }
                Section {
                    HStack {
                        Text("Border")
                        Spacer()
                        NumberField(label: "px", value: setup.inset) { setup.inset = max(0, $0.rounded()) }
                            .frame(width: 110)
                    }
                    Toggle("Center lines", isOn: $setup.center)
                } header: {
                    Text("Guides")
                } footer: {
                    Text("Photos dropped on a frame fit inside the border. Applies to every frame, as one undo step.")
                }
            }
            .navigationTitle("Frame size")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        if setup != store.project.frameSetup {
                            withAnimation(Theme.quick) { store.replace(preview) }
                        }
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.large])
    }
}
