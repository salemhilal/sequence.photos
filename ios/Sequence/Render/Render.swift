import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// What exports draw (src/renderPlan.ts), and drawing it with Core Graphics. A plan says, for
// one frame, which part of each photo shows and where it goes, in output pixels (the frame's
// units times its pxPerUnit), so the image and Instagram exports agree.

/** A photo drawn onto an output image. */
struct Draw: Equatable {
    var photoId: String
    /** The part of the photo that shows (within its crop), in its own upright pixels. */
    var src: Rect
    /** Where that part goes, in output pixels. */
    var dst: Rect
    /** The whole placed photo, in output pixels, including what's off the image. */
    var placed: Rect
    /** Its border, around `placed`, in output pixels. */
    var border: PhotoBorder?
}

struct PagePlan: Equatable {
    var pxW: Int
    var pxH: Int
    var background: Ink
    /** Output pixels per unit: the page's, or less. */
    var pxPerUnit: Double
    /** Back to front; photos entirely off the image are left out. */
    var draws: [Draw]
}

/**
 * What to draw for a frame, in output pixels. `pxPerUnit` lowers the page's resolution
 * (a smaller image); it never raises it, which would only enlarge the photos.
 */
func planFrame(_ frame: Spread, _ page: PageSetup, _ photos: [String: PhotoMeta], pxPerUnit: Double? = nil) -> PagePlan {
    let k = min(page.pxPerUnit, pxPerUnit ?? .infinity)
    let pxW = max(1, Int((page.w * k).rounded()))
    let pxH = max(1, Int((page.h * k).rounded()))
    let kx = Double(pxW) / page.w
    let ky = Double(pxH) / page.h
    var draws: [Draw] = []
    for item in frame.items.sorted(by: { $0.z < $1.z }) {
        guard let photo = photos[item.photoId] else { continue }
        let placed = Rect(x: item.x * kx, y: item.y * ky, w: item.w * kx, h: item.h * ky)
        let border = item.border.map { PhotoBorder(width: $0.width * kx, color: $0.color) }
        let x1 = max(0, placed.x)
        let y1 = max(0, placed.y)
        let x2 = min(Double(pxW), placed.right)
        let y2 = min(Double(pxH), placed.bottom)
        if x2 <= x1 || y2 <= y1 { continue }
        let dst = Rect(x: x1, y: y1, w: x2 - x1, h: y2 - y1)
        let c = cropOf(photo)
        let crop = Rect(x: c.x * photo.pxW, y: c.y * photo.pxH, w: c.w * photo.pxW, h: c.h * photo.pxH)
        let sx = crop.w / placed.w
        let sy = crop.h / placed.h
        let src = Rect(x: crop.x + (x1 - placed.x) * sx, y: crop.y + (y1 - placed.y) * sy, w: dst.w * sx, h: dst.h * sy)
        draws.append(Draw(photoId: item.photoId, src: src, dst: dst, placed: placed, border: border))
    }
    return PagePlan(pxW: pxW, pxH: pxH, background: frame.background ?? .white, pxPerUnit: k, draws: draws)
}

/** An sRGB bitmap context, white-filled, `w` × `h` pixels, drawn top-down. */
func makeContext(_ w: Int, _ h: Int) -> CGContext? {
    guard
        let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }
    // Top-left origin, as the plan's rects are.
    ctx.translateBy(x: 0, y: CGFloat(h))
    ctx.scaleBy(x: 1, y: -1)
    ctx.interpolationQuality = .high
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    return ctx
}

private func cg(_ r: Rect) -> CGRect {
    CGRect(x: r.x, y: r.y, width: r.w, height: r.h)
}

private func color(_ ink: Ink) -> CGColor {
    ink == .black ? CGColor(red: 0, green: 0, blue: 0, alpha: 1) : CGColor(red: 1, green: 1, blue: 1, alpha: 1)
}

/**
 * Draw a plan from the stored originals (each decoded no larger than it's drawn, for
 * memory); returns the image, or nil if it couldn't be drawn.
 */
func renderPlan(_ plan: PagePlan, photos store: PhotoStore, meta: [String: PhotoMeta]) -> CGImage? {
    guard let ctx = makeContext(plan.pxW, plan.pxH) else { return nil }
    ctx.setFillColor(color(plan.background))
    ctx.fill(CGRect(x: 0, y: 0, width: plan.pxW, height: plan.pxH))
    for d in plan.draws {
        // The border first, under the photo.
        if let b = d.border {
            ctx.setFillColor(color(b.color))
            ctx.fill(cg(Rect(x: d.placed.x - b.width, y: d.placed.y - b.width, w: d.placed.w + 2 * b.width, h: d.placed.h + 2 * b.width)))
        }
        guard let photo = meta[d.photoId] else { continue }
        // Decoded at the size it's drawn at (or the original's, if smaller).
        let need = max(d.placed.w / (d.src.w / photo.pxW) / max(1, photo.pxW), d.placed.h / (d.src.h / photo.pxH) / max(1, photo.pxH))
        let wholePx = max(photo.pxW, photo.pxH) * min(1, max(need, 0.01)) * 1.02
        guard let image = store.original(d.photoId, maxPixels: Int(wholePx.rounded(.up))) else { continue }
        let kx = Double(image.width) / photo.pxW
        let ky = Double(image.height) / photo.pxH
        let src = CGRect(x: d.src.x * kx, y: d.src.y * ky, width: d.src.w * kx, height: d.src.h * ky).integral
        guard let part = image.cropping(to: src) else { continue }
        ctx.saveGState()
        // Drawn upright: Core Graphics draws images bottom-up.
        let dst = cg(d.dst)
        ctx.translateBy(x: dst.minX, y: dst.maxY)
        ctx.scaleBy(x: 1, y: -1)
        ctx.draw(part, in: CGRect(x: 0, y: 0, width: dst.width, height: dst.height))
        ctx.restoreGState()
    }
    return ctx.makeImage()
}

/** An image as JPEG (at `quality`) or PNG. */
func encodeImage(_ image: CGImage, as type: UTType, quality: Double = 0.92) -> Data? {
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else { return nil }
    let opts: [CFString: Any] = type == .jpeg ? [kCGImageDestinationLossyCompressionQuality: quality] : [:]
    CGImageDestinationAddImage(dest, image, opts as CFDictionary)
    return CGImageDestinationFinalize(dest) ? data as Data : nil
}

// Instagram's shapes and sizes (src/instagramImage.ts).

enum PostKind: String, CaseIterable {
    case feed, story
}

/** How a frame outside the feed's shapes is fitted: trimmed, or given margins. */
enum PostFit: String, CaseIterable {
    case crop, expand
}

/** Instagram's API limits. */
enum PostLimits {
    static let minRatio = 4.0 / 5
    static let maxRatio = 1.91
    static let maxItems = 10
    static let minWidth = 320.0
    static let maxWidth = 1440.0
    /** Sequence's server refuses taller images. */
    static let maxHeight = 2560.0
    static let maxBytes = 8 * 1024 * 1024
    static let captionLength = 2200
    static let hashtags = 30
}

private func ratioRange(_ kind: PostKind) -> (min: Double, max: Double) {
    kind == .feed ? (PostLimits.minRatio, PostLimits.maxRatio) : (PostLimits.minWidth / PostLimits.maxHeight, .infinity)
}

/** Whether a frame of this size can be posted as it is. */
func postFits(w: Double, h: Double, _ kind: PostKind) -> Bool {
    let r = ratioRange(kind)
    let x = w / h
    return x >= r.min - 1e-9 && x <= r.max + 1e-9
}

/** The nearest shape Instagram takes, as width / height. */
func targetRatio(w: Double, h: Double, _ kind: PostKind) -> Double {
    let r = ratioRange(kind)
    return min(r.max, max(r.min, w / h))
}

/** A ratio as people say it: 4:5, 1.91:1, or 3:4. */
func ratioLabel(_ r: Double) -> String {
    for (a, b) in [(4, 5), (3, 4), (1, 1), (9, 16), (16, 9), (2, 3), (3, 2)] where abs(r - Double(a) / Double(b)) < 0.005 {
        return "\(a):\(b)"
    }
    let n = (r * 100).rounded() / 100
    return "\(n.formatted(.number.precision(.fractionLength(0...2)))):1"
}

/** An image as posted: its size, the part of the frame it shows, and where that goes. */
struct PostImageLayout: Equatable {
    var width: Int
    var height: Int
    /** The part of the frame shown, in its output pixels. */
    var source: Rect
    /** Where it's drawn, in image pixels (the rest is white). */
    var target: Rect
}

/**
 * How a frame becomes an image for Instagram: one outside the shapes Instagram takes is
 * cropped (centered) or expanded with white margins to the nearest one, then scaled to
 * Instagram's widths and the server's height limit, rounding within the allowed shapes.
 */
func postImageLayout(w: Double, h: Double, _ kind: PostKind, _ fit: PostFit) -> PostImageLayout {
    var source = Rect(x: 0, y: 0, w: w, h: h)
    var canvas = (w: w, h: h)
    let r = targetRatio(w: w, h: h, kind)
    if !postFits(w: w, h: h, kind) {
        let tall = w / h < r
        if fit == .crop {
            source = tall ? Rect(x: 0, y: (h - w / r) / 2, w: w, h: w / r) : Rect(x: (w - h * r) / 2, y: 0, w: h * r, h: h)
            canvas = (source.w, source.h)
        } else {
            canvas = tall ? (h * r, h) : (w, w / r)
        }
    }
    let scale = max(PostLimits.minWidth / canvas.w, min(1, PostLimits.maxWidth / canvas.w, PostLimits.maxHeight / canvas.h))
    var width = (canvas.w * scale).rounded()
    var height = (canvas.h * scale).rounded()
    let range = ratioRange(kind)
    if width / height < range.min { height = (width / range.min).rounded(.down) }
    if width / height > range.max { width = (height * range.max).rounded(.down) }
    height = min(height, PostLimits.maxHeight)
    let tw = min(width, source.w * scale)
    let th = min(height, source.h * scale)
    return PostImageLayout(
        width: Int(width), height: Int(height), source: source,
        target: Rect(x: (width - tw) / 2, y: (height - th) / 2, w: tw, h: th))
}

/** Lower qualities to try, in turn, until an image is under Instagram's size limit. */
let postQualities = [0.92, 0.85, 0.75, 0.6]

/** One frame as the JPEG Instagram gets, or nil if it can't fit the size limit. */
func renderPostImage(
    _ frame: Spread, _ page: PageSetup, _ photos: [String: PhotoMeta], store: PhotoStore, layout: PostImageLayout
) -> Data? {
    let scale = min(1, layout.target.w / layout.source.w)
    let plan = planFrame(frame, page, photos, pxPerUnit: page.pxPerUnit * scale)
    guard let rendered = renderPlan(plan, photos: store, meta: photos), let ctx = makeContext(layout.width, layout.height)
    else { return nil }
    let r = plan.pxPerUnit / page.pxPerUnit
    let s = layout.source
    let src = CGRect(x: s.x * r, y: s.y * r, width: s.w * r, height: s.h * r).integral
    guard let part = rendered.cropping(to: src) else { return nil }
    let t = layout.target
    ctx.translateBy(x: t.x, y: t.y + t.h)
    ctx.scaleBy(x: 1, y: -1)
    ctx.draw(part, in: CGRect(x: 0, y: 0, width: t.w, height: t.h))
    guard let out = ctx.makeImage() else { return nil }
    for q in postQualities {
        if let data = encodeImage(out, as: .jpeg, quality: q), data.count <= PostLimits.maxBytes { return data }
    }
    return nil
}

/** Hashtags in a caption (Instagram allows 30). */
func hashtagCount(_ caption: String) -> Int {
    let re = try? NSRegularExpression(pattern: "(^|\\s)#[\\p{L}\\p{N}_]+")
    return re?.numberOfMatches(in: caption, range: NSRange(caption.startIndex..., in: caption)) ?? 0
}
