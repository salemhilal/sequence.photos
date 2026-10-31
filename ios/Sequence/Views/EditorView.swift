import SwiftUI
import UniformTypeIdentifiers

/** Where in the drawer a placed photo is being dragged to: its left half, or its right. */
enum DrawerDrop {
    case desk, delete
}

/** The show-guides button's icon: a grid, with a slash through it when they're hidden. */
struct GridIcon: View {
    let off: Bool

    var body: some View {
        Image(uiImage: off ? Self.crossedOut : Self.grid)
    }

    private static let grid = drawn(slash: false)
    private static let crossedOut = drawn(slash: true)

    /** One image, slash included: a toolbar keeps only the image of a label's icon. */
    private static func drawn(slash: Bool) -> UIImage {
        let config = UIImage.SymbolConfiguration(pointSize: 20, weight: .regular)
        guard let symbol = UIImage(systemName: "squareshape.split.3x3", withConfiguration: config) else { return UIImage() }
        let inset = 3.0
        let size = CGSize(width: symbol.size.width + 2 * inset, height: symbol.size.height + 2 * inset)
        let image = UIGraphicsImageRenderer(size: size).image { c in
            symbol.withTintColor(.black, renderingMode: .alwaysOriginal).draw(at: CGPoint(x: inset, y: inset))
            guard slash else { return }
            let line = UIBezierPath()
            line.move(to: CGPoint(x: 1, y: 1))
            line.addLine(to: CGPoint(x: size.width - 1, y: size.height - 1))
            line.lineCapStyle = .round
            // Cut out around the slash, so it reads against the grid's lines.
            line.lineWidth = 5.5
            line.stroke(with: .clear, alpha: 1)
            line.lineWidth = 2
            UIColor.black.setStroke()
            line.stroke()
        }
        return image.withRenderingMode(.alwaysTemplate)
    }
}

/** What's selected in the editor, and so what the drawer shows. */
enum Editing: Hashable {
    case none
    case frame
    case photo(String)

    var photoId: String? {
        if case let .photo(id) = self { return id }
        return nil
    }
}

/** A desk photo being dragged onto a frame. */
struct PhotoDrag: Codable, Transferable {
    var id: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .sequencePhoto)
    }
}

extension UTType {
    static let sequencePhoto = UTType(exportedAs: "io.salem.SequencePhotosMobile.photo")
    static let sequenceFrames = UTType(exportedAs: "io.salem.SequencePhotosMobile.frames")
}

/**
 * One frame, edited: photos move and resize (by their corners) with snapping, the desk's
 * photos come on by dragging, and dragged into the drawer they go back or are deleted. Two
 * fingers hold the frame, to zoom and move it. Frames
 * page sideways (a swipe on the background, or the pager); the bars stay put. Below, in a
 * drawer: the desk, or what's selected (the frame, or a photo).
 */
struct EditorView: View {
    @Environment(AppModel.self) private var model
    let id: String
    let frameId: String

    var body: some View {
        if let store = model.store, store.id == id {
            Editor(store: store, startFrame: frameId)
        } else {
            Theme.bg.ignoresSafeArea().onAppear { model.open(id) }
        }
    }
}

private struct Editor: View {
    @Environment(\.dismiss) private var dismiss
    let store: ProjectStore
    @State private var current: String?
    @State private var editing: Editing = .none
    @State private var guides = true
    @State private var drawerOpen = true
    @State private var cropping: String?
    @State private var sizing = false
    @State private var exporting = false
    @State private var previewAt: Int?
    @State private var zoomed = false
    /** Where the drawer's top is on screen, for dropping photos back on the desk. */
    @State private var drawerTop: CGFloat = .infinity
    /** Where in the drawer a placed photo is being dragged, if it is. */
    @State private var overDrawer: DrawerDrop?
    /** A border's thickness being dragged: the photo shows plain, to judge it. */
    @State private var adjustingBorder = false

    init(store: ProjectStore, startFrame: String) {
        self.store = store
        _current = State(initialValue: startFrame)
    }

    private var project: Project { store.project }
    private var frames: [Spread] { project.frames }
    private var index: Int { frames.firstIndex { $0.id == current } ?? 0 }
    private var frame: Spread? { frames.first { $0.id == current } }

    var body: some View {
        VStack(spacing: 0) {
            if let cropping, let frame, frame.items.contains(where: { $0.photoId == cropping }) {
                CropView(store: store, photoId: cropping, frame: frame) {
                    withAnimation(Theme.quick) { self.cropping = nil }
                }
                .transition(.opacity)
            } else {
                pages
                drawer
            }
        }
        .background(Theme.bg)
        .navigationTitle(cropping != nil ? "Crop" : "")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(cropping != nil)
        .toolbar { toolbar }
        .toolbarBackground(Theme.header, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .sheet(isPresented: $sizing) { FrameSettingsSheet(store: store) }
        .sheet(isPresented: $exporting) { ExportView(store: store) }
        .fullScreenCover(item: Binding(get: { previewAt.map(PreviewStart.init) }, set: { previewAt = $0?.index })) {
            PreviewView(project: project, start: $0.index)
        }
        .onChange(of: frames.map(\.id)) { _, ids in
            // Undone past its making, or deleted: back to the grid.
            if let current, !ids.contains(current) { dismiss() }
        }
        .onChange(of: frame?.items.map(\.photoId)) { _, ids in
            // A photo that's left this frame (undone, or moved) isn't selected anymore.
            if let id = editing.photoId, !(ids ?? []).contains(id) { editing = .none }
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if cropping == nil {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Undo", systemImage: "arrow.uturn.backward") { store.undo() }.disabled(!store.canUndo)
                Button("Redo", systemImage: "arrow.uturn.forward") { store.redo() }.disabled(!store.canRedo)
                Button {
                    guides.toggle()
                } label: {
                    Label { Text(guides ? "Hide guides" : "Show guides") } icon: { GridIcon(off: !guides) }
                }
                .accessibilityLabel(guides ? "Hide guides" : "Show guides")
                Menu("More", systemImage: "ellipsis.circle") {
                    Button("Preview", systemImage: "play") { previewAt = index }
                    Button("Frame settings…", systemImage: "aspectratio") { sizing = true }
                    Button("Export…", systemImage: "square.and.arrow.up") { exporting = true }
                }
            }
        }
    }

    /** Every frame, side by side, paging: only the frames slide. */
    private var pages: some View {
        GeometryReader { geo in
            ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(frames) { f in
                        FrameCanvas(
                            store: store, frame: f, editing: f.id == current ? $editing : .constant(.none),
                            guides: guides, drawerTop: drawerTop, overDrawer: $overDrawer, zoomed: $zoomed,
                            plain: f.id == current && adjustingBorder
                        )
                        .frame(width: geo.size.width, height: geo.size.height)
                        .id(f.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $current)
            .scrollIndicators(.hidden)
            .scrollDisabled(zoomed)
            .overlay(alignment: .bottom) { pager }
            // A scroll position set before the first layout moves nothing: go there too.
            .onAppear {
                let start = current
                DispatchQueue.main.async { proxy.scrollTo(start, anchor: .leading) }
            }
            }
        }
        .onChange(of: current) { _, _ in
            editing = .none
            zoomed = false
        }
    }

    private var pager: some View {
        HStack(spacing: 6) {
            pagerButton("Previous frame", icon: "chevron.left", to: index - 1)
            Text("\(index + 1) / \(frames.count)").font(.mono(13)).foregroundStyle(Theme.muted)
                .contentTransition(.numericText())
            pagerButton("Next frame", icon: "chevron.right", to: index + 1)
        }
        .padding(.bottom, 1)
    }

    /** An arrow with a whole fingertip's room to tap, not just its small icon's. */
    private func pagerButton(_ title: String, icon: String, to i: Int) -> some View {
        Button {
            go(i)
        } label: {
            Label(title, systemImage: icon)
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .disabled(!frames.indices.contains(i))
    }

    private func go(_ i: Int) {
        guard frames.indices.contains(i) else { return }
        withAnimation(Theme.drawer) { current = frames[i].id }
    }

    private var drawer: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(Theme.drawer) { drawerOpen.toggle() }
            } label: {
                Capsule().fill(Theme.faint).frame(width: 36, height: 5)
                    .frame(maxWidth: .infinity, minHeight: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(drawerOpen ? "Hide the tools" : "Show the tools")
            .simultaneousGesture(
                DragGesture(minimumDistance: 12).onEnded { v in
                    withAnimation(Theme.drawer) { drawerOpen = v.translation.height < 0 }
                })
            if drawerOpen, let frame {
                Group {
                    switch editing {
                    case let .photo(id):
                        if let item = frame.items.first(where: { $0.photoId == id }) {
                            PhotoPanel(
                                store: store, item: item, background: frame.background ?? .white, editing: $editing,
                                adjustingBorder: $adjustingBorder
                            ) {
                                withAnimation(Theme.quick) { cropping = id }
                            }
                        }
                    case .frame:
                        FramePanel(store: store, frame: frame, index: index)
                    case .none:
                        DeskTray(store: store, frameId: frame.id)
                    }
                }
                .id(editing)
                .transition(.opacity)
                .padding(.bottom, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .background(Theme.panel)
        .overlay {
            if let overDrawer {
                HStack(spacing: 8) {
                    dropZone("To the desk", "tray.and.arrow.down", color: Theme.accent, on: overDrawer == .desk)
                    dropZone("Delete", "trash", color: Theme.danger, on: overDrawer == .delete)
                }
                .padding(8)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.panel)
                .allowsHitTesting(false)
            }
        }
        .background(
            GeometryReader { g in
                Color.clear
                    .onAppear { drawerTop = g.frame(in: .global).minY }
                    .onChange(of: g.frame(in: .global).minY) { _, y in drawerTop = y }
            }
        )
        .animation(Theme.drawer, value: editing)
    }

    /** One half of the drawer, while a photo's dragged over it; lit when it would land there. */
    private func dropZone(_ title: String, _ icon: String, color: Color, on: Bool) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 22))
            Text(title).font(.sans(.subheadline, .medium))
        }
        .foregroundStyle(on ? color : Theme.muted)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(on ? color.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(on ? color : Theme.faint, style: .init(lineWidth: on ? 2 : 1, dash: on ? [] : [6])))
    }
}

/** Room around the frame on the canvas, and under it for the pager, in points. */
private let pad = 20.0
private let pagerRoom = 52.0
/** How near a guide something snaps, in points. */
private let snapPoints = 10.0
private let maxZoom = 6.0

/** One frame on the editor's canvas, fitted, and zoomed while pinched. */
private struct FrameCanvas: View {
    let store: ProjectStore
    let frame: Spread
    @Binding var editing: Editing
    let guides: Bool
    let drawerTop: CGFloat
    @Binding var overDrawer: DrawerDrop?
    @Binding var zoomed: Bool
    /** No selection drawn on the photo (its border's being adjusted). */
    let plain: Bool

    @State private var zoom = 1.0
    @State private var pan = CGSize.zero
    /** Where the frame was, and where the two fingers were, when they came down. */
    @State private var pinchStart: (zoom: Double, pan: CGSize, a: CGPoint, b: CGPoint)?
    @State private var panStart: CGSize?
    @State private var hit: SnapHit?
    @State private var trayOver = false
    /** The photo a finger is moving, and where it started. */
    @State private var moving: (id: String, start: Rect, moved: Bool)?
    @State private var resizing: (id: String, corner: Corner, start: Rect)?

    private var project: Project { store.project }
    private var page: PageSetup { project.page }

    var body: some View {
        GeometryReader { geo in
            let fit = max(0.01, min((geo.size.width - 2 * pad) / page.w, (geo.size.height - pad - pagerRoom) / page.h))
            let scale = fit * zoom
            let baseLeft = (geo.size.width - page.w * fit) / 2
            let baseTop = pad + (geo.size.height - pad - pagerRoom - page.h * fit) / 2
            let left = baseLeft + pan.width
            let top = baseTop + pan.height
            let layout = CanvasLayout(left: left, top: top, scale: scale)

            ZStack(alignment: .topLeading) {
                // The background: a tap here selects the frame (on it) or nothing (off it).
                Color.clear.contentShape(Rectangle())
                    .onTapGesture { at in
                        let u = layout.toUnits(at)
                        withAnimation(Theme.quick) {
                            editing = pageRect(page).contains(u.x, u.y) ? .frame : .none
                        }
                    }
                    .gesture(zoomPan, including: zoom > 1 ? .all : .none)
                    .accessibilityIdentifier("canvas-\(frame.id)")

                FrameView(frame: frame, page: page, photos: project.photos, width: page.w * scale, soft: true)
                    .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
                    .overlay {
                        if editing == .frame {
                            Rectangle().strokeBorder(Theme.accent, lineWidth: 2).padding(-3)
                        }
                    }
                    .overlay(alignment: .topLeading) {
                        if guides || trayOver {
                            FrameGuides(
                                page: page, settings: project.settings, scale: scale, showing: guides, dropping: trayOver, hit: hit)
                        }
                    }
                    .offset(x: left, y: top)
                    .allowsHitTesting(false)

                ForEach(frame.items.sorted { $0.z < $1.z }, id: \.photoId) { item in
                    let r = outerRect(item.rect, item.border)
                    Color.clear.contentShape(Rectangle())
                        .frame(width: r.w * scale, height: r.h * scale)
                        .offset(x: left + r.x * scale, y: top + r.y * scale)
                        .highPriorityGesture(moveGesture(item, layout: layout, width: geo.size.width))
                        .accessibilityElement()
                        .accessibilityLabel(project.photos[item.photoId]?.name ?? "Photo")
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { editing = .photo(item.photoId) }
                }

                if !plain, let id = editing.photoId, let item = frame.items.first(where: { $0.photoId == id }) {
                    selection(item, layout: layout)
                }
            }
            // Pinned to the corner: zoomed past the canvas, centering would shift all of it.
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .clipped()
            .contentShape(Rectangle())
            .background {
                TwoFingers(
                    began: pinchBegan,
                    changed: { a, b in pinchChanged(a, b, fit: fit, baseLeft: baseLeft, baseTop: baseTop) },
                    ended: pinchEnded)
            }
            .dropDestination(for: PhotoDrag.self) { drags, at in
                trayOver = false
                guard let d = drags.first else { return false }
                let u = layout.toUnits(at)
                guard pageRect(page).contains(u.x, u.y) else { return false }
                withAnimation(Theme.quick) {
                    store.apply { $0.placeAt(d.id, frame.id, x: u.x, y: u.y) }
                    editing = .photo(d.id)
                }
                return true
            } isTargeted: { trayOver = $0 }
        }
    }

    private func selection(_ item: Placement, layout: CanvasLayout) -> some View {
        let r = outerRect(item.rect, item.border)
        let s = layout.scale
        return ZStack(alignment: .topLeading) {
            Rectangle().strokeBorder(Theme.accent, lineWidth: 1.5)
                .frame(width: r.w * s, height: r.h * s)
                .allowsHitTesting(false)
            ForEach(Corner.allCases, id: \.self) { c in
                Circle().fill(.white)
                    .overlay(Circle().strokeBorder(Theme.accent, lineWidth: 2))
                    .frame(width: 16, height: 16)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                    .offset(x: (c.west ? 0 : r.w * s) - 22, y: (c.north ? 0 : r.h * s) - 22)
                    .highPriorityGesture(resizeGesture(item, corner: c, scale: s))
                    .accessibilityLabel("Resize from the \(String(describing: c)) corner")
            }
        }
        .offset(x: layout.left + r.x * s, y: layout.top + r.y * s)
    }

    private func moveGesture(_ item: Placement, layout: CanvasLayout, width: Double) -> some Gesture {
        let dropAt = { (at: CGPoint) -> DrawerDrop? in
            at.y < drawerTop ? nil : at.x < width / 2 ? .desk : .delete
        }
        return         DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { v in
                if moving == nil {
                    // A finger left over from two isn't the start of a move.
                    guard pinchStart == nil, hypot(v.translation.width, v.translation.height) <= 6 else { return }
                    moving = (item.photoId, item.rect, false)
                    if editing != .photo(item.photoId) { withAnimation(Theme.quick) { editing = .photo(item.photoId) } }
                }
                guard var m = moving else { return }
                let t = v.translation
                if !m.moved {
                    if hypot(t.width, t.height) <= 6 { return }
                    m.moved = true
                    moving = m
                    store.begin()
                }
                let lines = snapLines(page, project.settings)
                var start = m.start
                start.x += t.width / layout.scale
                start.y += t.height / layout.scale
                let r = snapPhoto(start, item.border, lines, snapPoints / layout.scale)
                hit = r.hit
                store.preview { p in
                    p.updatePlacement(m.id) {
                        $0.x = r.rect.x
                        $0.y = r.rect.y
                    }
                    p.raise(m.id)
                }
                let over = dropAt(v.location)
                if over != overDrawer { withAnimation(Theme.quick) { overDrawer = over } }
            }
            .onEnded { v in
                defer {
                    moving = nil
                    hit = nil
                    overDrawer = nil
                }
                guard let m = moving, m.moved else { return }
                if let drop = dropAt(v.location) {
                    // Dropped on the drawer: off the frame, as part of the same step.
                    store.preview { p in
                        switch drop {
                        case .desk: p.toDesk(m.id)
                        case .delete: p.removePhoto(m.id)
                        }
                    }
                    store.end()
                    withAnimation(Theme.quick) { editing = .none }
                } else {
                    store.end()
                }
            }
    }

    private func resizeGesture(_ item: Placement, corner: Corner, scale: Double) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { v in
                if resizing == nil {
                    guard pinchStart == nil, hypot(v.translation.width, v.translation.height) <= 6 else { return }
                    resizing = (item.photoId, corner, item.rect)
                    store.begin()
                }
                guard let r0 = resizing else { return }
                let lines = snapLines(page, project.settings)
                let r = resizeRect(
                    r0.start, r0.corner, v.translation.width / scale, v.translation.height / scale, lines,
                    snapPoints / scale)
                hit = r.hit
                store.preview { p in p.updatePlacement(r0.id) { $0.rect = r.rect } }
            }
            .onEnded { _ in
                guard resizing != nil else { return }
                resizing = nil
                hit = nil
                store.end()
            }
    }

    /** Two fingers down: they drop whatever the first had started, and the frame stops paging. */
    private func pinchBegan(_ a: CGPoint, _ b: CGPoint) {
        pinchStart = (zoom, pan, a, b)
        if moving?.moved == true || resizing != nil { store.cancel() }
        moving = nil
        resizing = nil
        panStart = nil
        hit = nil
        zoomed = true
    }

    /** The frame follows the fingers, as if each were holding its spot on it. */
    private func pinchChanged(_ a: CGPoint, _ b: CGPoint, fit: Double, baseLeft: Double, baseTop: Double) {
        guard let s = pinchStart else { return }
        let next = anchoredZoom(
            zoom: s.zoom, pan: s.pan, fit: fit, baseLeft: baseLeft, baseTop: baseTop, maxZoom: maxZoom,
            from: (s.a, s.b), to: (a, b))
        zoom = next.zoom
        pan = next.pan
    }

    /** Fingers up: at the fitted size, the frame settles back in place. */
    private func pinchEnded() {
        pinchStart = nil
        if zoom <= 1.01 {
            withAnimation(Theme.quick) {
                zoom = 1
                pan = .zero
            }
            zoomed = false
        }
    }

    /** Zoomed in, a drag on the background pans. */
    private var zoomPan: some Gesture {
        DragGesture()
            .onChanged { v in
                guard pinchStart == nil else { return }
                // Measured from here, so a finger left over from two doesn't make the frame jump.
                if panStart == nil { panStart = CGSize(width: pan.width - v.translation.width, height: pan.height - v.translation.height) }
                guard let s = panStart else { return }
                pan = CGSize(width: s.width + v.translation.width, height: s.height + v.translation.height)
            }
            .onEnded { _ in panStart = nil }
    }
}

/**
 * A frame's guides, over it: the margin, the center lines when `showing`, the margin
 * alone when something's being dropped, and the lines a drag has snapped to.
 */
struct FrameGuides: View {
    let page: PageSetup
    let settings: Settings
    let scale: Double
    let showing: Bool
    var dropping = false
    let hit: SnapHit?

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let g = dropGuide(settings) {
                let b = borderBox(page, g)
                Rectangle()
                    .strokeBorder(dropping ? Theme.accent : Theme.guide, style: .init(lineWidth: dropping ? 2 : 1, dash: dropping ? [] : [4, 3]))
                    .frame(width: b.w * scale, height: b.h * scale)
                    .offset(x: b.x * scale, y: b.y * scale)
            }
            if showing, settings.centerV {
                Rectangle().fill(Theme.guideCenter.opacity(0.35)).frame(width: 1, height: page.h * scale)
                    .offset(x: page.w / 2 * scale - 0.5)
            }
            if showing, settings.centerH {
                Rectangle().fill(Theme.guideCenter.opacity(0.35)).frame(width: page.w * scale, height: 1)
                    .offset(y: page.h / 2 * scale - 0.5)
            }
            ForEach(hit?.xs ?? [], id: \.self) { x in
                Rectangle().fill(Theme.guideHit).frame(width: 1, height: page.h * scale).offset(x: x * scale - 0.5)
            }
            ForEach(hit?.ys ?? [], id: \.self) { y in
                Rectangle().fill(Theme.guideHit).frame(width: page.w * scale, height: 1).offset(y: y * scale - 0.5)
            }
        }
        .frame(width: page.w * scale, height: page.h * scale, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

/** Where the frame is drawn on the canvas: its top-left corner, and points per unit. */
struct CanvasLayout {
    var left: Double
    var top: Double
    var scale: Double

    func toUnits(_ p: CGPoint) -> (x: Double, y: Double) {
        ((p.x - left) / scale, (p.y - top) / scale)
    }
}
