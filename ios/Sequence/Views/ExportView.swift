import SwiftUI
import UniformTypeIdentifiers

/** Where an export goes. */
private enum ExportTo: String {
    case images, instagram
}

/** Export: the frames as images (to Photos, Files, or anywhere through the share sheet), or to Instagram. */
struct ExportView: View {
    @Environment(\.dismiss) private var dismiss
    let store: ProjectStore
    @State private var to: ExportTo
    @State private var locked = false

    init(store: ProjectStore) {
        self.store = store
        _to = State(initialValue: ExportChoices(store.project.export).to == "instagram" ? .instagram : .images)
    }

    var body: some View {
        NavigationStack {
            Group {
                switch to {
                case .images: ImagesExport(store: store)
                case .instagram: InstagramExport(store: store, locked: $locked)
                }
            }
            .safeAreaInset(edge: .top) {
                Picker("Export to", selection: Binding(get: { to }, set: { t in
                    to = t
                    remember { $0.to = t.rawValue }
                })) {
                    Label("Images", systemImage: "photo").tag(ExportTo.images)
                    Label("Instagram", systemImage: "camera").tag(ExportTo.instagram)
                }
                .pickerStyle(.segmented)
                .disabled(locked)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Theme.bg)
            }
            .background(Theme.bg)
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(locked) }
            }
        }
        .interactiveDismissDisabled(locked)
    }

    private func remember(_ change: (inout ExportChoices) -> Void) {
        rememberExport(store, change)
    }
}

/** Keep export choices with the project (not an undo step, as the desktop does). */
func rememberExport(_ store: ProjectStore, _ change: (inout ExportChoices) -> Void) {
    var e = ExportChoices(store.project.export)
    change(&e)
    store.setExport(e.value)
}

/** A frame to choose (or not) in a strip, with its check. */
private struct Pick: View {
    let frame: Spread
    let project: Project
    let width: Double
    let on: Bool
    var name: String?

    var body: some View {
        VStack(spacing: 4) {
            FrameView(frame: frame, page: project.page, photos: project.photos, width: width)
                .opacity(on ? 1 : 0.35)
                .overlay(alignment: .topTrailing) {
                    Image(systemName: on ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(on ? Theme.accent : Theme.muted, on ? Theme.onAccent : .clear)
                        .padding(4)
                }
            if let name { Text(verbatim: name).font(.mono(10)).foregroundStyle(Theme.muted) }
        }
    }
}

private struct ImagesExport: View {
    @Environment(AppModel.self) private var model
    let store: ProjectStore
    @State private var off: Set<String> = []
    @State private var format: String
    @State private var quality: Double
    @State private var making: (done: Int, total: Int)?
    @State private var shared: [URL]?

    init(store: ProjectStore) {
        self.store = store
        let e = ExportChoices(store.project.export)
        _format = State(initialValue: e.format == "png" ? "png" : "jpeg")
        _quality = State(initialValue: e.quality ?? 0.9)
    }

    var body: some View {
        let p = store.project
        let frames = p.frames.filter { !off.contains($0.id) }
        let n = frames.count
        let digits = max(2, String(n).count)
        let ext = format == "png" ? "png" : "jpg"
        let name = { (i: Int) in String(format: "%0\(digits)d.\(ext)", i) }
        Form {
            Section {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(Array(p.frames.enumerated()), id: \.element.id) { i, f in
                            let on = !off.contains(f.id)
                            Button {
                                if on { off.insert(f.id) } else { off.remove(f.id) }
                            } label: {
                                Pick(frame: f, project: p, width: 72, on: on, name: on ? name((frames.firstIndex { $0.id == f.id } ?? 0) + 1) : "—")
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Frame \(i + 1)")
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                }
                .scrollIndicators(.hidden)
            } header: {
                HStack {
                    Text("Frames")
                    Spacer()
                    Button(off.isEmpty ? "Just the first" : "All") {
                        off = off.isEmpty ? Set(p.frames.dropFirst().map(\.id)) : []
                    }
                    .font(.sans(.footnote))
                    .textCase(nil)
                }
            }
            Section {
                Picker("Format", selection: Binding(get: { format }, set: { f in
                    format = f
                    rememberExport(store) { $0.format = f }
                })) {
                    Text("JPEG").tag("jpeg")
                    Text("PNG").tag("png")
                }
                if format == "jpeg" {
                    VStack(alignment: .leading) {
                        HStack {
                            Text("Quality")
                            Spacer()
                            Text(verbatim: "\(Int((quality * 100).rounded()))%").font(.mono(12)).foregroundStyle(Theme.muted)
                        }
                        Slider(value: $quality, in: 0.5...1, step: 0.01) { editing in
                            if !editing { rememberExport(store) { $0.quality = quality } }
                        }
                    }
                } else {
                    LabeledContent("Quality", value: "Lossless")
                }
                LabeledContent("Size") { Text(verbatim: "\(Int(p.page.w)) × \(Int(p.page.h)) px").font(.mono(13)) }
            } footer: {
                Text(
                    n == 0
                        ? "Choose at least one frame."
                        : "\(n) \(format == "png" ? (n == 1 ? "PNG" : "PNGs") : (n == 1 ? "JPEG" : "JPEGs")), \(n > 1 ? "\(name(1)) to \(name(n))" : name(1)). In the share sheet, Save Images puts them in Photos."
                )
            }
        }
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                if let making {
                    ProgressView(value: Double(making.done), total: Double(making.total)) {
                        Text("Making images… \(making.done) of \(making.total)").font(.sans(.footnote))
                    }
                }
                Button {
                    Task { await make(frames, name: name) }
                } label: {
                    Label("Share \(n) \(n == 1 ? "image" : "images")…", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .foregroundStyle(Theme.onAccent)
                .disabled(n == 0 || making != nil)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Theme.panel)
        }
        .sheet(isPresented: Binding(get: { shared != nil }, set: { if !$0 { shared = nil } })) {
            ShareSheet(items: shared ?? [])
                .presentationDetents([.medium, .large])
        }
    }

    /** Make the chosen frames' images (in the background), then open the share sheet. */
    private func make(_ frames: [Spread], name: @escaping (Int) -> String) async {
        let p = store.project
        let photos = model.library.photos
        let type: UTType = format == "png" ? .png : .jpeg
        let quality = quality
        making = (0, frames.count)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Export-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var urls: [URL] = []
        var failed = 0
        for (i, f) in frames.enumerated() {
            let url = dir.appendingPathComponent(name(i + 1))
            let ok = await Task.detached(priority: .userInitiated) { () -> Bool in
                let plan = planFrame(f, p.page, p.photos)
                guard let image = renderPlan(plan, photos: photos, meta: p.photos),
                    let data = encodeImage(image, as: type, quality: quality)
                else { return false }
                return (try? data.write(to: url)) != nil
            }.value
            if ok { urls.append(url) } else { failed += 1 }
            making = (i + 1, frames.count)
        }
        making = nil
        if failed > 0 { model.notice = "Couldn’t make \(failed) of the images." }
        if !urls.isEmpty { shared = urls }
    }
}

/** iOS's share sheet, for files. */
struct ShareSheet: UIViewControllerRepresentable {
    let items: [URL]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ c: UIActivityViewController, context: Context) {}
}

private struct InstagramExport: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let store: ProjectStore
    @Binding var locked: Bool
    @State private var instagram = Instagram.shared
    @State private var kind: PostKind
    @State private var fit: PostFit
    @State private var caption: String
    @State private var chosen: [String]
    @State private var shown = 0
    @State private var step: PostStep?
    @State private var task: Task<Void, Never>?
    @State private var result: (ok: Bool, message: String, link: URL?)?

    init(store: ProjectStore, locked: Binding<Bool>) {
        self.store = store
        _locked = locked
        let e = ExportChoices(store.project.export)
        _kind = State(initialValue: e.postKind == "story" ? .story : .feed)
        _fit = State(initialValue: e.fit == "expand" ? .expand : .crop)
        _caption = State(initialValue: e.caption ?? "")
        let frames = store.project.frames
        // Saved choices are "<frame id>:whole", as the web app keys slides.
        let was = Set((e.chosen ?? []).map { $0.replacingOccurrences(of: ":whole", with: "") })
        let kept = frames.map(\.id).filter(was.contains)
        _chosen = State(
            initialValue: kept.isEmpty
                ? Array(frames.filter { !$0.items.isEmpty }.prefix(PostLimits.maxItems).map(\.id)) : kept)
    }

    private var slides: [Spread] { store.project.frames.filter { chosen.contains($0.id) } }
    private var ready: Bool { instagram.connection?.ready == true }
    private var posting: Bool { step != nil }

    private var problem: String? {
        if slides.isEmpty { return "Choose at least one slide to post." }
        if kind == .feed, caption.count > PostLimits.captionLength {
            return "Captions can be up to \(PostLimits.captionLength.formatted()) characters."
        }
        if kind == .feed, hashtagCount(caption) > PostLimits.hashtags { return "Instagram allows up to \(PostLimits.hashtags) hashtags." }
        return nil
    }

    var body: some View {
        let p = store.project
        let size = (w: p.page.w * p.page.pxPerUnit, h: p.page.h * p.page.pxPerUnit)
        let ratio = targetRatio(w: size.w, h: size.h, kind)
        Form {
            Section {
                if let c = instagram.connection, c.ready {
                    HStack(spacing: 10) {
                        Text(c.username.prefix(1).uppercased()).font(.sans(.subheadline, .bold))
                            .frame(width: 30, height: 30).background(Theme.control, in: Circle())
                        Text(verbatim: "@\(c.username)").font(.mono(13))
                        Spacer()
                        Menu("More", systemImage: "ellipsis") {
                            Button("Disconnect", role: .destructive) { instagram.disconnect() }
                        }
                        .labelStyle(.iconOnly)
                    }
                } else {
                    Button(instagram.busy ? "Opening Instagram…" : instagram.connection == nil ? "Connect Instagram" : "Reconnect Instagram") {
                        instagram.connect()
                    }
                    .disabled(instagram.busy)
                    .frame(maxWidth: .infinity)
                }
                Picker("Post as", selection: $kind) {
                    Text("Feed post").tag(PostKind.feed)
                    Text("Stories").tag(PostKind.story)
                }
                .pickerStyle(.segmented)
                .disabled(posting)
            } footer: {
                if !ready {
                    Text(instagram.message ?? "Posting goes through your Instagram account. It needs a Business or Creator account.")
                        .foregroundStyle(instagram.message == nil ? Theme.muted : Theme.warn)
                }
            }
            Section {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(Array(p.frames.enumerated()), id: \.element.id) { i, f in
                            let on = chosen.contains(f.id)
                            Button {
                                if on { chosen.removeAll { $0 == f.id } } else if chosen.count < PostLimits.maxItems { chosen.append(f.id) }
                            } label: {
                                Pick(frame: f, project: p, width: 44, on: on)
                            }
                            .buttonStyle(.plain)
                            .disabled(posting || (!on && chosen.count >= PostLimits.maxItems))
                            .accessibilityLabel("Slide \(i + 1)")
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                }
                .scrollIndicators(.hidden)
            } header: {
                HStack {
                    Text("Slides")
                    Spacer()
                    Text("\(slides.count) of \(PostLimits.maxItems) chosen")
                        .foregroundStyle(slides.count >= PostLimits.maxItems ? Theme.warn : Theme.muted)
                        .textCase(nil)
                }
            }
            if !slides.isEmpty {
                Section {
                    let at = min(shown, slides.count - 1)
                    Group {
                        if kind == .story {
                            StoryPreview(frame: slides[at], project: p, at: at, count: slides.count, username: instagram.connection?.username ?? "you")
                        } else {
                            PostPreview(frame: slides[at], project: p, at: at, count: slides.count, caption: caption)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation(Theme.quick) { shown = (at + 1) % slides.count } }
                    .accessibilityLabel(kind == .story ? "Next story" : "Next slide")
                    .accessibilityAddTraits(.isButton)
                }
                .listRowBackground(Color.clear)
            }
            if !postFits(w: size.w, h: size.h, kind) {
                Section {
                    Picker("Fit", selection: $fit) {
                        Text("Crop to \(ratioLabel(ratio))").tag(PostFit.crop)
                        Text("Expand to \(ratioLabel(ratio))").tag(PostFit.expand)
                    }
                    .pickerStyle(.segmented)
                    .disabled(posting)
                } header: {
                    Text("Size")
                } footer: {
                    Text("Instagram takes \(kind == .feed ? "feed posts" : "stories") up to \(ratioLabel(ratio)) from here.")
                }
            }
            if kind == .feed {
                Section {
                    TextField("Write a caption…", text: $caption, axis: .vertical)
                        .lineLimit(3...8)
                        .disabled(posting)
                } header: {
                    Text("Caption")
                } footer: {
                    Text(verbatim: "\(caption.count.formatted()) / \(PostLimits.captionLength.formatted()) characters, \(hashtagCount(caption)) / \(PostLimits.hashtags) hashtags")
                        .font(.mono(11))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom) { foot }
        .onChange(of: [kind.rawValue, fit.rawValue, caption] + chosen) { _, _ in
            rememberExport(store) {
                $0.postKind = kind.rawValue
                $0.fit = fit.rawValue
                $0.caption = caption.isEmpty ? nil : caption
                $0.chosen = chosen.map { "\($0):whole" }
            }
        }
        .onChange(of: posting) { _, now in locked = now }
        .onDisappear { task?.cancel() }
    }

    private var foot: some View {
        VStack(spacing: 8) {
            if let step {
                Text(step.label).font(.sans(.footnote)).foregroundStyle(Theme.muted)
            } else if let result {
                HStack(spacing: 6) {
                    Text(result.message).font(.sans(.footnote)).foregroundStyle(result.ok ? Theme.text : Theme.danger)
                    if let link = result.link { Button("View on Instagram") { openURL(link) }.font(.sans(.footnote)) }
                }
            }
            if ready, let problem, !posting { Text(problem).font(.sans(.footnote)).foregroundStyle(Theme.warn) }
            if posting {
                Button("Cancel") { task?.cancel() }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    .disabled({ if case .publishing = step { return true } else { return false } }())
            } else {
                Button {
                    post()
                } label: {
                    Text("Post to Instagram").frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .foregroundStyle(Theme.onAccent)
                .disabled(!ready || problem != nil)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Theme.panel)
    }

    private func post() {
        let p = store.project
        let slides = self.slides
        let kind = self.kind
        let fit = self.fit
        let caption = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        let photos = model.library.photos
        result = nil
        step = .preparing(done: 0, total: slides.count)
        task = Task {
            do {
                let connection = try await instagram.fresh()
                let size = (w: p.page.w * p.page.pxPerUnit, h: p.page.h * p.page.pxPerUnit)
                let layout = postImageLayout(w: size.w, h: size.h, kind, fit)
                var images: [Data] = []
                for (i, f) in slides.enumerated() {
                    try Task.checkCancellation()
                    step = .preparing(done: i, total: slides.count)
                    let image = await Task.detached(priority: .userInitiated) {
                        renderPostImage(f, p.page, p.photos, store: photos, layout: layout)
                    }.value
                    guard let image else { throw InstagramError(message: "A slide is too detailed to fit Instagram’s 8 MB limit.") }
                    images.append(image)
                }
                let poster = InstagramPoster(connection: connection) { Instagram.shared.markNeedsReconnect() }
                let link = try await poster.post(images, kind: kind, caption: caption) { step = $0 }
                rememberExport(store) { $0.caption = nil }
                self.caption = ""
                result = (true, "Posted to Instagram.", link)
            } catch is CancellationError {
                result = (false, InstagramError.cancelledPost.message, nil)
            } catch {
                result = (false, error.localizedDescription.isEmpty ? "Couldn’t post to Instagram." : error.localizedDescription, nil)
            }
            step = nil
        }
    }
}

/** A feed post as Instagram shows it: the slide, its place in the carousel, and the caption. */
private struct PostPreview: View {
    let frame: Spread
    let project: Project
    let at: Int
    let count: Int
    let caption: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            FrameView(frame: frame, page: project.page, photos: project.photos, width: 240)
                .overlay(alignment: .topTrailing) {
                    if count > 1 {
                        Text(verbatim: "\(at + 1)/\(count)").font(.sans(.caption2, .bold)).padding(.horizontal, 7).padding(.vertical, 3)
                            .background(.black.opacity(0.6), in: Capsule()).foregroundStyle(.white).padding(8)
                    }
                }
                .id(frame.id)
                .transition(.opacity)
            if count > 1 {
                HStack(spacing: 4) {
                    ForEach(0..<count, id: \.self) { i in
                        Circle().fill(i == at ? Theme.accent : Theme.faint).frame(width: 5, height: 5)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            if !caption.isEmpty {
                Text(caption).font(.sans(.footnote)).lineLimit(3)
            }
        }
        .frame(width: 240)
    }
}

/** A story as Instagram shows it: a tall dark screen, progress bars, the account, the slide. */
private struct StoryPreview: View {
    let frame: Spread
    let project: Project
    let at: Int
    let count: Int
    let username: String

    private let w = 210.0
    private var h: Double { w * 16 / 9 }

    var body: some View {
        ZStack(alignment: .top) {
            Color(hex: 0x111111)
            FrameView(frame: frame, page: project.page, photos: project.photos, width: min(w, h * project.page.w / project.page.h))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .id(frame.id)
                .transition(.opacity)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 3) {
                    ForEach(0..<count, id: \.self) { i in
                        Capsule().fill(.white.opacity(i <= at ? 0.95 : 0.35)).frame(height: 2)
                    }
                }
                HStack(spacing: 6) {
                    Text(username.prefix(1).uppercased()).font(.sans(.caption2, .bold))
                        .frame(width: 22, height: 22).background(Theme.control, in: Circle())
                    Text(verbatim: username).font(.sans(.caption, .semibold)).foregroundStyle(.white)
                }
            }
            .padding(10)
        }
        .frame(width: w, height: h)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
