import Foundation

// Where things go on a frame: snapping, fitting, resizing (src/geometry.ts, for frames).
// A frame's x = 0 is its left edge; units are the page's.

struct Rect: Equatable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double

    var right: Double { x + w }
    var bottom: Double { y + h }
    var midX: Double { x + w / 2 }
    var midY: Double { y + h / 2 }

    func contains(_ px: Double, _ py: Double) -> Bool {
        px >= x && px <= right && py >= y && py <= bottom
    }
}

/** Lines a moving edge snaps to: x positions and y positions. */
struct GuideLines: Equatable {
    var xs: [Double]
    var ys: [Double]

    static let none = GuideLines(xs: [], ys: [])
}

/** The guide lines a snap landed on, to show it. */
typealias SnapHit = GuideLines

/** The whole frame. */
func pageRect(_ page: PageSetup) -> Rect {
    Rect(x: 0, y: 0, w: page.w, h: page.h)
}

/** A border guide's box on a frame (a frame is laid out like a left page: outside is its left). */
func borderBox(_ page: PageSetup, _ guide: BorderGuide) -> Rect {
    let e = guide.edges
    return Rect(x: e.outside, y: e.top, w: page.w - e.outside - e.inside, h: page.h - e.top - e.bottom)
}

/** The border guide photos dropped on a frame fit in: the chosen one, or else the largest. */
func dropGuide(_ settings: Settings) -> BorderGuide? {
    if let id = settings.dropBorder, let g = settings.borders.first(where: { $0.id == id }) { return g }
    return settings.borders.min { a, b in
        let ea = a.edges
        let eb = b.edges
        return ea.top + ea.bottom + ea.inside + ea.outside < eb.top + eb.bottom + eb.inside + eb.outside
    }
}

/** Where a photo dropped on a frame is fitted: the drop guide's box, or the frame. */
func dropBox(_ page: PageSetup, _ settings: Settings) -> Rect {
    dropGuide(settings).map { borderBox(page, $0) } ?? pageRect(page)
}

/** The largest rect with the photo's (cropped) shape that fits in `box`, centered in `center`. */
func fitCentered(_ photo: PhotoMeta, _ box: Rect, center: Rect? = nil) -> Rect {
    let size = visibleSize(photo)
    let aspect = size.w / size.h
    var w = box.w
    var h = w / aspect
    if h > box.h {
        h = box.h
        w = h * aspect
    }
    let c = center ?? box
    return Rect(x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w: w, h: h)
}

/** Everything a photo snaps to on a frame: its edges, center lines, border guides, line guides. */
func snapLines(_ page: PageSetup, _ settings: Settings) -> GuideLines {
    var xs: [Double] = [0, page.w]
    var ys: [Double] = [0, page.h]
    if settings.centerV { xs.append(page.w / 2) }
    if settings.centerH { ys.append(page.h / 2) }
    for g in settings.borders {
        let b = borderBox(page, g)
        xs += [b.x, b.right]
        ys += [b.y, b.bottom]
    }
    for l in settings.lines where l.at > 0 && l.at < (l.axis == .vertical ? page.w : page.h) {
        if l.axis == .vertical { xs.append(l.at) } else { ys.append(l.at) }
    }
    let round = { (v: Double) in (v * 1e6).rounded() / 1e6 }
    return GuideLines(xs: Array(Set(xs.map(round))).sorted(), ys: Array(Set(ys.map(round))).sorted())
}

/** The smallest adjustment that lands one of `points` on one of `lines`, within `threshold`. */
func snapPoints(_ points: [Double], _ lines: [Double], _ threshold: Double) -> (delta: Double, line: Double?) {
    var best: (delta: Double, line: Double?) = (0, nil)
    var bestDist = threshold
    for p in points {
        for l in lines where abs(l - p) <= bestDist {
            bestDist = abs(l - p)
            best = (l - p, l)
        }
    }
    return best
}

/** Snap a moving rect's edges and center to guides. */
func snapMove(_ r: Rect, _ lines: GuideLines, _ threshold: Double) -> (rect: Rect, hit: SnapHit) {
    let sx = snapPoints([r.x, r.midX, r.right], lines.xs, threshold)
    let sy = snapPoints([r.y, r.midY, r.bottom], lines.ys, threshold)
    var out = r
    out.x += sx.delta
    out.y += sy.delta
    return (out, SnapHit(xs: sx.line.map { [$0] } ?? [], ys: sy.line.map { [$0] } ?? []))
}

enum Corner: CaseIterable {
    case nw, ne, sw, se

    var west: Bool { self == .nw || self == .sw }
    var north: Bool { self == .nw || self == .ne }
}

/**
 * Resize `start` by dragging `corner` by (dx, dy), anchored at the opposite corner, keeping
 * its shape, the moving corner snapping to `lines`. `min` is the smallest a side gets.
 */
func resizeRect(
    _ start: Rect, _ corner: Corner, _ dx: Double, _ dy: Double, _ lines: GuideLines, _ threshold: Double,
    min: Double = 10
) -> (rect: Rect, hit: SnapHit) {
    let ax = corner.west ? start.right : start.x
    let ay = corner.north ? start.bottom : start.y
    var mx = (corner.west ? start.x : start.right) + dx
    var my = (corner.north ? start.y : start.bottom) + dy
    let aspect = start.w / start.h
    var hit = SnapHit.none
    let sx = snapPoints([mx], lines.xs, threshold)
    let sy = snapPoints([my], lines.ys, threshold)
    var w = abs(mx - ax)
    var h = abs(my - ay)
    let useX: Bool
    if let _ = sx.line, sy.line == nil || abs(sx.delta) <= abs(sy.delta) {
        useX = true
    } else if sy.line != nil {
        useX = false
    } else {
        useX = w / aspect >= h
    }
    if useX {
        if let l = sx.line {
            mx += sx.delta
            hit.xs = [l]
        }
        w = Swift.max(min, abs(mx - ax))
        h = w / aspect
    } else {
        if let l = sy.line {
            my += sy.delta
            hit.ys = [l]
        }
        h = Swift.max(min, abs(my - ay))
        w = h * aspect
    }
    return (Rect(x: corner.west ? ax - w : ax, y: corner.north ? ay - h : ay, w: w, h: h), hit)
}

/** A placed photo's box with its border: what it takes up on the frame. */
func outerRect(_ r: Rect, _ border: PhotoBorder?) -> Rect {
    let b = border?.width ?? 0
    return Rect(x: r.x - b, y: r.y - b, w: r.w + 2 * b, h: r.h + 2 * b)
}

/** Snap a moving photo by its outer edge (border and all); returns the photo's box. */
func snapPhoto(_ r: Rect, _ border: PhotoBorder?, _ lines: GuideLines, _ threshold: Double) -> (rect: Rect, hit: SnapHit)
{
    let snapped = snapMove(outerRect(r, border), lines, threshold)
    let b = border?.width ?? 0
    var out = r
    out.x = snapped.rect.x + b
    out.y = snapped.rect.y + b
    return (out, snapped.hit)
}

/** The topmost placed photo under a point (in the frame's units), border and all. */
func photoAt(_ items: [Placement], _ x: Double, _ y: Double) -> Placement? {
    items.sorted { $0.z > $1.z }.first { outerRect($0.rect, $0.border).contains(x, y) }
}

/** A frame's width that fits a box, keeping its shape. */
func fitWidth(_ page: PageSetup, w: Double, h: Double) -> Double {
    Swift.min(w, h * page.w / page.h)
}

/**
 * Where a frame goes as two fingers move on it: its size follows how far apart they are, and
 * the spot between them stays under them, so they seem to hold the frame. `pan` is the frame's
 * offset from where it sits fitted (`baseLeft`, `baseTop`), at `fit` points per unit.
 */
func anchoredZoom(
    zoom: Double, pan: CGSize, fit: Double, baseLeft: Double, baseTop: Double, maxZoom: Double,
    from: (a: CGPoint, b: CGPoint), to: (a: CGPoint, b: CGPoint)
) -> (zoom: Double, pan: CGSize) {
    let apart = { (a: CGPoint, b: CGPoint) in hypot(a.x - b.x, a.y - b.y) }
    let middle = { (a: CGPoint, b: CGPoint) in CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2) }
    let z = max(1, min(maxZoom, zoom * apart(to.a, to.b) / max(1, apart(from.a, from.b))))
    let was = middle(from.a, from.b)
    let now = middle(to.a, to.b)
    let ux = (was.x - baseLeft - pan.width) / (fit * zoom)
    let uy = (was.y - baseTop - pan.height) / (fit * zoom)
    return (z, CGSize(width: now.x - baseLeft - ux * fit * z, height: now.y - baseTop - uy * fit * z))
}
