import SwiftUI

/** The largest a side gets, and the smallest, in pixels. */
private let maxSide = 8000.0
private let minSide = 100.0

private func clampSide(_ n: Double) -> Double {
    (max(minSide, min(maxSide, n.isFinite ? n : 0))).rounded()
}

/** A frame's shape and its guides, empty: what the settings make, before there's a sequence. */
struct FramePreview: View {
    let setup: FrameSetup
    private let box = 140.0

    var body: some View {
        let s = min(box / setup.w, box / setup.h)
        ZStack {
            Color.white
            Rectangle()
                .strokeBorder(Theme.guideHit, style: .init(lineWidth: 1, dash: [4, 3]))
                .padding(setup.inset * s)
            if setup.center {
                Rectangle().fill(Theme.guideCenter).frame(width: 1)
                Rectangle().fill(Theme.guideCenter).frame(height: 1)
            }
        }
        .frame(width: setup.w * s, height: setup.h * s)
        .animation(Theme.quick, value: setup)
        .accessibilityHidden(true)
    }
}

/** A frame's size (a preset or custom) and guides, below whatever's shown on `top`. */
struct FrameSettingsForm<Top: View>: View {
    @Binding var setup: FrameSetup
    @ViewBuilder let top: Top
    @State private var custom: Bool

    init(setup: Binding<FrameSetup>, @ViewBuilder top: () -> Top) {
        _setup = setup
        self.top = top()
        let s = setup.wrappedValue
        _custom = State(initialValue: !frameSizes.contains { $0.w == s.w && $0.h == s.h })
    }

    var body: some View {
        Form {
            top
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
                            Text(verbatim: "\(Int(s.w)) × \(Int(s.h))").font(.mono(13)).foregroundStyle(Theme.muted)
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
                    Text("Margin")
                    Spacer()
                    NumberField(label: "px", value: setup.inset) { setup.inset = max(0, $0.rounded()) }
                        .frame(width: 110)
                }
                Toggle("Center lines", isOn: $setup.center).tint(Theme.accent)
            } header: {
                Text("Guides")
            } footer: {
                Text("Photos dropped on a frame fit inside the margin. Applies to every frame.")
            }
        }
    }
}

/** Frame settings for an open sequence: its frames as they'd be; Apply makes it one undo step. */
struct FrameSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let store: ProjectStore
    @State private var setup: FrameSetup

    init(store: ProjectStore) {
        self.store = store
        _setup = State(initialValue: store.project.frameSetup)
    }

    var body: some View {
        let preview = store.project.withFrameSetup(setup)
        let thumb = min(64, 64 * setup.w / setup.h)
        NavigationStack {
            FrameSettingsForm(setup: $setup) {
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
            }
            .navigationTitle("Frame settings")
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
