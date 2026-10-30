import SwiftUI
import UniformTypeIdentifiers

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
 * photos come on by dragging, and go back by dragging into the drawer. Pinch zooms. Frames
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
    /** A placed photo being dragged over the drawer. */
    @State private var overDrawer = false

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
        .sheet(isPresented: $sizing) { FrameSizeSheet(store: store) }
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
                Button(guides ? "Hide guides" : "Show guides", systemImage: guides ? "eye" : "eye.slash") {
                    guides.toggle()
                }
                Menu("More", systemImage: "ellipsis.circle") {
                    Button("Preview", systemImage: "play") { previewAt = index }
                    Button("Frame size…", systemImage: "aspectratio") { sizing = true }
                    Button("Export…", systemImage: "square.and.arrow.up") { exporting = true }
                }
            }
        }
    }

    /** Every frame, side by side, paging: only the frames slide. */
    private var pages: some View {
        GeometryReader { geo in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(frames) { f in
                        FrameCanvas(
                            store: store, frame: f, editing: f.id == current ? $editing : .constant(.none),
                            guides: guides, drawerTop: drawerTop, overDrawer: $overDrawer, zoomed: $zoomed
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
        }
        .onChange(of: current) { _, _ in
            editing = .none
            zoomed = false
        }
    }

    private var pager: some View {
        HStack(spacing: 18) {
            Button("Previous frame", systemImage: "chevron.left") { go(index - 1) }.disabled(index == 0)
            Text("\(index + 1) / \(frames.count)").font(.mono(13)).foregroundStyle(Theme.muted)
                .contentTransition(.numericText())
            Button("Next frame", systemImage: "chevron.right") { go(index + 1) }.disabled(index >= frames.count - 1)
        }
        .labelStyle(.iconOnly)
        .padding(.bottom, 12)
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
                            PhotoPanel(store: store, item: item, editing: $editing) {
                                withAnimation(Theme.quick) { cropping = id }
                            }
                        }
                    case .frame:
                        FramePanel(store: store, frame: frame, index: index)
                    case .none:
                        DeskTray(store: store)
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
            if overDrawer {
                Text("Put it back on the desk")
                    .font(.sans(.subheadline, .medium))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.panel.opacity(0.92))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.accent, style: .init(lineWidth: 2, dash: [6])).padding(8))
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
    @Binding var overDrawer: Bool
    @Binding var zoomed: Bool

    @State private var zoom = 1.0
    @State private var pan = CGSize.zero
    @State private var pinchStart: (zoom: Double, pan: CGSize)?
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

                FrameView(frame: frame, page: page, photos: project.photos, width: page.w * scale, soft: true)
                    .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
                    .overlay {
                        if editing == .frame {
                            Rectangle().strokeBorder(Theme.accent, lineWidth: 2).padding(-3)
                        }
                    }
                    .overlay(alignment: .topLeading) { guideLayer(scale: scale) }
                    .offset(x: left, y: top)
                    .allowsHitTesting(false)

                ForEach(frame.items.sorted { $0.z < $1.z }, id: \.photoId) { item in
                    let r = outerRect(item.rect, item.border)
                    Color.clear.contentShape(Rectangle())
                        .frame(width: r.w * scale, height: r.h * scale)
                        .offset(x: left + r.x * scale, y: top + r.y * scale)
                        .highPriorityGesture(moveGesture(item, layout: layout))
                        .accessibilityElement()
                        .accessibilityLabel(project.photos[item.photoId]?.name ?? "Photo")
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { editing = .photo(item.photoId) }
                }

                if let id = editing.photoId, let item = frame.items.first(where: { $0.photoId == id }) {
                    selection(item, layout: layout)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
            .contentShape(Rectangle())
            .simultaneousGesture(pinch(fit: fit, baseLeft: baseLeft, baseTop: baseTop))
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

    @ViewBuilder private func guideLayer(scale: Double) -> some View {
        if guides || trayOver {
            ZStack(alignment: .topLeading) {
                if let g = dropGuide(project.settings) {
                    let b = borderBox(page, g)
                    Rectangle()
                        .strokeBorder(trayOver ? Theme.accent : Theme.guide, style: .init(lineWidth: trayOver ? 2 : 1, dash: trayOver ? [] : [4, 3]))
                        .frame(width: b.w * scale, height: b.h * scale)
                        .offset(x: b.x * scale, y: b.y * scale)
                }
                if guides, project.settings.centerV {
                    Rectangle().fill(Theme.guideCenter.opacity(0.35)).frame(width: 1, height: page.h * scale)
                        .offset(x: page.w / 2 * scale - 0.5)
                }
                if guides, project.settings.centerH {
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

    private func moveGesture(_ item: Placement, layout: CanvasLayout) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { v in
                if moving == nil {
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
                overDrawer = v.location.y >= drawerTop
            }
            .onEnded { v in
                defer {
                    moving = nil
                    hit = nil
                    overDrawer = false
                }
                guard let m = moving, m.moved else { return }
                if v.location.y >= drawerTop {
                    // Dropped on the drawer: back to the desk, as part of the same step.
                    store.preview { p in
                        p.updatePlacement(m.id) { $0.rect = Rect(x: m.start.x, y: m.start.y, w: m.start.w, h: m.start.h) }
                        p.toDesk(m.id)
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
                resizing = nil
                hit = nil
                store.end()
            }
    }

    /** Two fingers zoom the frame (not the photos), the point between them staying put. */
    private func pinch(fit: Double, baseLeft: Double, baseTop: Double) -> some Gesture {
        MagnifyGesture()
            .onChanged { v in
                if pinchStart == nil {
                    pinchStart = (zoom, pan)
                    // A second finger drops whatever the first had started.
                    if moving?.moved == true || resizing != nil { store.cancel() }
                    moving = nil
                    resizing = nil
                    hit = nil
                }
                guard let s = pinchStart else { return }
                let z = max(1, min(maxZoom, s.zoom * v.magnification))
                let at = v.startLocation
                let ux = (at.x - baseLeft - s.pan.width) / (fit * s.zoom)
                let uy = (at.y - baseTop - s.pan.height) / (fit * s.zoom)
                zoom = z
                pan = z == 1 ? .zero : CGSize(width: at.x - baseLeft - ux * fit * z, height: at.y - baseTop - uy * fit * z)
                zoomed = z > 1
            }
            .onEnded { _ in
                pinchStart = nil
                if zoom <= 1.01 {
                    withAnimation(Theme.quick) {
                        zoom = 1
                        pan = .zero
                    }
                    zoomed = false
                }
            }
    }

    /** Zoomed in, a drag on the background pans. */
    private var zoomPan: some Gesture {
        DragGesture()
            .onChanged { v in
                if panStart == nil { panStart = pan }
                guard let s = panStart else { return }
                pan = CGSize(width: s.width + v.translation.width, height: s.height + v.translation.height)
            }
            .onEnded { _ in panStart = nil }
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
