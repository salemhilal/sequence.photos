import Foundation

// Cropping (src/crop.ts): a photo shows only part of its original, the same wherever it is.
// The crop is a rectangle in fractions of the upright original; the photo's frame (its
// placement) has the crop's shape. Nothing of the original is lost.

extension Crop {
    /** The whole photo. */
    static let whole = Crop(x: 0, y: 0, w: 1, h: 1)

    /** Whether it's just the photo: no more of it hidden, and no room around it. */
    var isWhole: Bool { abs(x) < 1e-4 && abs(y) < 1e-4 && abs(w - 1) < 1e-4 && abs(h - 1) < 1e-4 }
}

/** The smallest crop, as a share of each side, so a photo can't be cropped to nothing. */
let minCrop = 0.02

func cropOf(_ photo: PhotoMeta) -> Crop {
    photo.crop ?? .whole
}

/** The pixels of the original that show: the size every layout and resolution works from. */
func visibleSize(_ photo: PhotoMeta) -> (w: Double, h: Double) {
    let c = cropOf(photo)
    return (photo.pxW * c.w, photo.pxH * c.h)
}

/** The most a crop's frame can be, as a share of each side of the photo. */
let maxCrop = 50.0

/**
 * A crop no smaller than `minCrop`, and still showing some of the photo (its frame can be
 * bigger than the photo, leaving room around it), rounded a little; none when whole.
 */
func cleanCrop(_ c: Crop) -> Crop? {
    let round = { (n: Double) in (n * 1e5).rounded() / 1e5 }
    guard [c.x, c.y, c.w, c.h].allSatisfy(\.isFinite) else { return nil }
    let w = min(maxCrop, max(minCrop, c.w))
    let h = min(maxCrop, max(minCrop, c.h))
    let x = min(1 - minCrop, max(minCrop - w, c.x))
    let y = min(1 - minCrop, max(minCrop - h, c.y))
    let crop = Crop(x: round(x), y: round(y), w: round(w), h: round(h))
    return crop.isWhole ? nil : crop
}

/** Where the whole photo goes, given its frame (showing the crop), in the frame's units. */
func wholeRect(_ frame: Rect, _ crop: Crop) -> Rect {
    let w = frame.w / crop.w
    let h = frame.h / crop.h
    return Rect(x: frame.x - crop.x * w, y: frame.y - crop.y * h, w: w, h: h)
}

/** The crop a frame makes of the whole photo placed at `whole` (both in the same units). */
func cropFrom(_ frame: Rect, _ whole: Rect) -> Crop {
    Crop(x: (frame.x - whole.x) / whole.w, y: (frame.y - whole.y) / whole.h, w: frame.w / whole.w, h: frame.h / whole.h)
}

/** A crop frame's handles: its edges and corners. */
enum CropHandle: String, CaseIterable {
    case n, s, e, w, nw, ne, sw, se

    var west: Bool { rawValue.contains("w") }
    var east: Bool { rawValue.contains("e") }
    var north: Bool { rawValue.contains("n") }
    var south: Bool { rawValue.contains("s") }
}

/**
 * Drag a crop frame's handle by (dx, dy): the edges it holds move, inside `within` (the whole
 * photo, unless given) and still over some of the photo, which stays put, snapping to `lines`. With a ratio, the frame keeps its shape: a corner
 * anchors the opposite one, an edge stays centered on its axis.
 */
func dragCropHandle(
    _ start: Rect, _ whole: Rect, _ handle: CropHandle, _ dx: Double, _ dy: Double,
    ratio: Double?, min minSide: Double, lines: GuideLines? = nil, threshold: Double = 0, within: Rect? = nil
) -> (frame: Rect, hit: SnapHit) {
    let limit = within ?? whole
    var hit = SnapHit.none
    func snap(_ v: Double, vertical: Bool) -> Double {
        guard let lines else { return v }
        let s = snapPoints([v], vertical ? lines.xs : lines.ys, threshold)
        if let l = s.line {
            if vertical { hit.xs.append(l) } else { hit.ys.append(l) }
        }
        return v + s.delta
    }
    let right = start.right
    let bottom = start.bottom
    var x1 = start.x
    var y1 = start.y
    var x2 = right
    var y2 = bottom
    if handle.west { x1 = min(right - minSide, whole.right - minSide, max(limit.x, snap(start.x + dx, vertical: true))) }
    if handle.east { x2 = max(start.x + minSide, whole.x + minSide, min(limit.right, snap(right + dx, vertical: true))) }
    if handle.north { y1 = min(bottom - minSide, whole.bottom - minSide, max(limit.y, snap(start.y + dy, vertical: false))) }
    if handle.south { y2 = max(start.y + minSide, whole.y + minSide, min(limit.bottom, snap(bottom + dy, vertical: false))) }
    guard let ratio else { return (Rect(x: x1, y: y1, w: x2 - x1, h: y2 - y1), hit) }

    var w = x2 - x1
    var h = y2 - y1
    let horizontal = handle == .e || handle == .w
    let vertical = handle == .n || handle == .s
    if horizontal || (!vertical && abs(w - start.w) / start.w >= abs(h - start.h) / start.h) {
        h = w / ratio
    } else {
        w = h * ratio
    }
    let ax = handle.west ? right : handle.east ? start.x : start.midX
    let ay = handle.north ? bottom : handle.south ? start.y : start.midY
    let fx = handle.west ? 1.0 : handle.east ? 0 : 0.5
    let fy = handle.north ? 1.0 : handle.south ? 0 : 0.5
    let room = min(
        fx > 0 ? (ax - limit.x) / (w * fx) : .infinity,
        fx < 1 ? (limit.right - ax) / (w * (1 - fx)) : .infinity,
        fy > 0 ? (ay - limit.y) / (h * fy) : .infinity,
        fy < 1 ? (limit.bottom - ay) / (h * (1 - fy)) : .infinity,
        1)
    w *= room
    h *= room
    return (Rect(x: ax - w * fx, y: ay - h * fy, w: w, h: h), .none)
}

/**
 * Move the crop frame (the photo stays put), inside `within` (the whole photo, unless given)
 * and still over some of the photo, its edges and center snapping.
 */
func moveCrop(
    _ start: Rect, _ whole: Rect, _ dx: Double, _ dy: Double, lines: GuideLines? = nil, threshold: Double = 0,
    within: Rect? = nil
) -> (frame: Rect, hit: SnapHit) {
    let limit = within ?? whole
    func clamp(_ r: Rect) -> Rect {
        let overlap = 10.0
        var out = r
        out.x = min(limit.right - r.w, whole.right - min(overlap, r.w), max(limit.x, whole.x - r.w + min(overlap, r.w), r.x))
        out.y = min(limit.bottom - r.h, whole.bottom - min(overlap, r.h), max(limit.y, whole.y - r.h + min(overlap, r.h), r.y))
        return out
    }
    var start = start
    start.x += dx
    start.y += dy
    let moved = clamp(start)
    guard let lines else { return (moved, .none) }
    let snapped = snapMove(moved, lines, threshold)
    let frame = clamp(snapped.rect)
    return (frame, frame.x == snapped.rect.x && frame.y == snapped.rect.y ? snapped.hit : .none)
}

/**
 * Move the photo behind its crop frame by (dx, dy): as far as the frame stays on it or, where
 * the frame is the bigger, as far as the photo stays in it.
 */
func panCrop(_ frame: Rect, _ whole: Rect, _ dx: Double, _ dy: Double) -> Rect {
    var out = whole
    out.x = min(max(frame.x, frame.right - whole.w), max(min(frame.x, frame.right - whole.w), whole.x + dx))
    out.y = min(max(frame.y, frame.bottom - whole.h), max(min(frame.y, frame.bottom - whole.h), whole.y + dy))
    return out
}

/** The largest frame of shape `ratio` on the whole photo, centered on the frame now. */
func frameToRatio(_ frame: Rect, _ whole: Rect, _ ratio: Double) -> Rect {
    var w = whole.w
    var h = w / ratio
    if h > whole.h {
        h = whole.h
        w = h * ratio
    }
    return Rect(
        x: min(whole.right - w, max(whole.x, frame.midX - w / 2)),
        y: min(whole.bottom - h, max(whole.y, frame.midY - h / 2)), w: w, h: h)
}
