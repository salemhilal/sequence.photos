import SwiftUI

/** A shape crop mode offers, as width over height; nil is any. */
private struct Shape: Identifiable {
    let label: String
    let ratio: Double?
    var id: String { label }
}

/**
 * Crop mode, for a photo on the frame: the whole photo shows, dimmed outside the crop. Drag
 * the crop's edges and corners to crop, or inside it to move it, snapping to the frame's
 * guides; it can be bigger than the photo, as far as the frame. Pick a shape below. Pinned, the crop stays where it is and dragging moves the photo behind it,
 * showing only what's in the crop. Done keeps the crop (one undo step); Cancel puts it back.
 */
struct CropView: View {
    let store: ProjectStore
    let photoId: String
    let frame: Spread
    let onDone: () -> Void

    /** Where it is now: it moves only when dragged behind a pinned crop. */
    @State private var whole: Rect
    @State private var ratio: Double?
    @State private var pinned = false
    /** What a drag started from: the crop and the whole photo. */
    @State private var dragFrom: (crop: Rect, whole: Rect)?
    @State private var hit: SnapHit?
    /** How far the crop can go, and what the view shows: the frame and the photo, as it started. */
    private let reach: Rect

    private let padding = 28.0
    private let snap = 10.0

    init(store: ProjectStore, photoId: String, frame: Spread, onDone: @escaping () -> Void) {
        self.store = store
        self.photoId = photoId
        self.frame = frame
        self.onDone = onDone
        let p = store.project
        let item = frame.items.first { $0.photoId == photoId }
        let w = item.map { wholeRect($0.rect, p.photos[photoId].map(cropOf) ?? .whole) } ?? Rect(x: 0, y: 0, w: 1, h: 1)
        _whole = State(initialValue: w)
        let all = [pageRect(p.page), w, item?.rect ?? w]
        let left = all.map(\.x).min() ?? 0
        let top = all.map(\.y).min() ?? 0
        reach = Rect(
            x: left, y: top, w: (all.map(\.right).max() ?? 1) - left, h: (all.map(\.bottom).max() ?? 1) - top)
    }

    private var project: Project { store.project }
    private var page: PageSetup { project.page }
    private var crop: Rect { project.placement(photoId)?.rect ?? whole }

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                canvas(geo.size)
            }
            panel
        }
        .onAppear { store.begin() }
        .onDisappear { store.end() }
    }

    private func canvas(_ size: CGSize) -> some View {
        // The view holds still, whatever's dragged.
        let s = max(0.01, min((size.width - 2 * padding) / reach.w, (size.height - 2 * padding) / reach.h))
        let left = (size.width - reach.w * s) / 2 - reach.x * s
        let top = (size.height - reach.h * s) / 2 - reach.y * s
        func box(_ r: Rect) -> (CGSize, CGSize) {
            (CGSize(width: r.w * s, height: r.h * s), CGSize(width: left + r.x * s, height: top + r.y * s))
        }
        let c = crop
        // The photo outside the crop, which can reach past the photo.
        let midTop = max(c.y, whole.y)
        let midHeight = min(c.bottom, whole.bottom) - midTop
        let dims = [
            Rect(x: whole.x, y: whole.y, w: whole.w, h: c.y - whole.y),
            Rect(x: whole.x, y: c.bottom, w: whole.w, h: whole.bottom - c.bottom),
            Rect(x: whole.x, y: midTop, w: c.x - whole.x, h: midHeight),
            Rect(x: c.right, y: midTop, w: whole.right - c.right, h: midHeight),
        ].filter { $0.w > 0 && $0.h > 0 }

        return ZStack(alignment: .topLeading) {
            let (ps, po) = box(pageRect(page))
            Theme.ink(frame.background).frame(width: ps.width, height: ps.height).offset(po)
                .shadow(color: .black.opacity(0.35), radius: 6, y: 2)
            let (ws, wo) = box(whole)
            PhotoImage(id: photoId).frame(width: ws.width, height: ws.height)
                .mask(alignment: .topLeading) {
                    // Pinned, only what's in the crop shows.
                    if pinned {
                        let (cs, co) = box(c)
                        Rectangle().frame(width: cs.width, height: cs.height)
                            .offset(x: co.width - wo.width, y: co.height - wo.height)
                    } else {
                        Rectangle()
                    }
                }
                .offset(wo)
            if !pinned {
                ForEach(Array(dims.enumerated()), id: \.offset) { _, r in
                    let (ds, d) = box(r)
                    Color.black.opacity(0.55).frame(width: ds.width, height: ds.height).offset(d)
                }
            }
            FrameGuides(page: page, settings: project.settings, scale: s, showing: true, hit: hit)
                .offset(po)
            let (cs, co) = box(c)
            cropWindow(cs, scale: s)
                .offset(co)
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .clipped()
    }

    private func cropWindow(_ size: CGSize, scale s: Double) -> some View {
        ZStack(alignment: .topLeading) {
            Rectangle()
                .strokeBorder(pinned ? Theme.accent : .white, lineWidth: pinned ? 2 : 1.5)
                .shadow(color: .black.opacity(0.7), radius: 1)
                .contentShape(Rectangle())
                .gesture(insideDrag(scale: s))
                .accessibilityLabel(pinned ? "Drag to move the photo in the crop" : "Drag to move the crop")
            if !pinned {
                ForEach([1.0, 2.0], id: \.self) { n in
                    Rectangle().fill(.white.opacity(0.35)).frame(width: 1, height: size.height)
                        .offset(x: size.width * n / 3)
                    Rectangle().fill(.white.opacity(0.35)).frame(width: size.width, height: 1)
                        .offset(y: size.height * n / 3)
                }
                .allowsHitTesting(false)
                ForEach(CropHandle.allCases.filter { ratio == nil || $0.rawValue.count == 2 }, id: \.self) { h in
                    handle(h)
                        .offset(
                            x: (h.west ? 0 : h.east ? size.width : size.width / 2) - 22,
                            y: (h.north ? 0 : h.south ? size.height : size.height / 2) - 22
                        )
                        .gesture(handleDrag(h, scale: s))
                }
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    private func handle(_ h: CropHandle) -> some View {
        let corner = h.rawValue.count == 2
        let vertical = h == .e || h == .w
        return RoundedRectangle(cornerRadius: 2).fill(.white)
            .frame(width: corner ? 14 : (vertical ? 5 : 22), height: corner ? 14 : (vertical ? 22 : 5))
            // Seen against a white frame, or a pale photo.
            .shadow(color: .black.opacity(0.7), radius: 1.5)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
    }

    private func show(_ f: Rect, _ w: Rect) {
        store.preview { $0.setCropFrame(photoId, frame: f, whole: w) }
    }

    /** The frame's guides, and the photo's own edges, to come back to. */
    private func lines(_ w: Rect) -> GuideLines {
        let g = snapLines(page, project.settings)
        return GuideLines(xs: g.xs + [w.x, w.right], ys: g.ys + [w.y, w.bottom])
    }

    // Measured on the screen: the crop itself moves, so its own space would shift under the finger.
    private func handleDrag(_ h: CropHandle, scale s: Double) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { v in
                if dragFrom == nil { dragFrom = (crop, whole) }
                guard let from = dragFrom else { return }
                let r = dragCropHandle(
                    from.crop, from.whole, h, v.translation.width / s, v.translation.height / s, ratio: ratio, min: 10,
                    lines: lines(from.whole), threshold: snap / s, within: reach)
                hit = r.hit
                show(r.frame, from.whole)
            }
            .onEnded { _ in
                dragFrom = nil
                hit = nil
            }
    }

    private func insideDrag(scale s: Double) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { v in
                if dragFrom == nil { dragFrom = (crop, whole) }
                guard let from = dragFrom else { return }
                let dx = v.translation.width / s
                let dy = v.translation.height / s
                if pinned {
                    let w = panCrop(from.crop, from.whole, dx, dy)
                    whole = w
                    show(from.crop, w)
                } else {
                    let r = moveCrop(from.crop, from.whole, dx, dy, lines: lines(from.whole), threshold: snap / s, within: reach)
                    hit = r.hit
                    show(r.frame, from.whole)
                }
            }
            .onEnded { _ in
                dragFrom = nil
                hit = nil
            }
    }

    private var shapes: [Shape] {
        [
            Shape(label: "Free", ratio: nil),
            Shape(label: "Original", ratio: whole.w / whole.h),
            Shape(label: "Square", ratio: 1),
            Shape(label: "4:5", ratio: 4 / 5),
            Shape(label: "3:2", ratio: 3 / 2),
            Shape(label: "16:9", ratio: 16 / 9),
            Shape(label: "The frame", ratio: page.w / page.h),
        ]
    }

    private func chosen(_ sh: Shape) -> Bool {
        switch (sh.ratio, ratio) {
        case (nil, nil): return true
        case let (a?, b?): return abs(a - b) < 1e-6
        default: return false
        }
    }

    private var panel: some View {
        VStack(spacing: 12) {
            Text(pinned ? "The crop is pinned. Drag to move the photo in it." : "Drag an edge or corner to crop. Drag inside to move the crop.")
                .font(.sans(.footnote)).foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .contentTransition(.opacity)
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(shapes) { sh in
                        let on = chosen(sh)
                        Button(sh.label) {
                            ratio = sh.ratio
                            if let r = sh.ratio { withAnimation(Theme.quick) { show(frameToRatio(crop, whole, r), whole) } }
                        }
                        .font(.sans(.subheadline))
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(on ? Theme.accent : Theme.control, in: Capsule())
                        .foregroundStyle(on ? Theme.onAccent : Theme.text)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
            .disabled(pinned)
            .opacity(pinned ? 0.4 : 1)
            HStack(spacing: 16) {
                Button("Reset", systemImage: "arrow.counterclockwise") {
                    ratio = nil
                    withAnimation(Theme.quick) { show(whole, whole) }
                }
                .disabled(pinned)
                Button(pinned ? "Pinned" : "Pin", systemImage: pinned ? "pin.fill" : "pin") {
                    withAnimation(Theme.quick) { pinned.toggle() }
                }
                .foregroundStyle(pinned ? Theme.accent : Theme.text)
                .accessibilityAddTraits(pinned ? .isSelected : [])
                Spacer()
                Button("Cancel") {
                    store.cancel()
                    onDone()
                }
                Button("Done") {
                    store.end()
                    onDone()
                }
                .buttonStyle(.borderedProminent)
                .tint(.white)
                .foregroundStyle(.black)
            }
            .font(.sans(.subheadline))
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 12)
        .background(Theme.panel)
    }
}
