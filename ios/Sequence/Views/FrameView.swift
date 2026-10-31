import SwiftUI

/** A stored photo's shown copy, filling its box; grey while missing. */
struct PhotoImage: View {
    /** Optional: iOS draws lift and drag previews apart from the app, where it may be missing. */
    @Environment(AppModel.self) private var model: AppModel?
    let id: String

    var body: some View {
        if let img = model?.library.photos.thumb(id) {
            Image(uiImage: img).resizable().interpolation(.high)
        } else {
            Rectangle().fill(Theme.faint)
        }
    }
}

/**
 * A placed photo at `scale` points per unit: cropped (the whole photo laid out behind its
 * frame and clipped to it), with its border outside it.
 */
struct PlacedPhoto: View {
    let item: Placement
    let photo: PhotoMeta?
    let scale: Double

    var body: some View {
        let crop = photo.map(cropOf) ?? .whole
        let whole = wholeRect(Rect(x: 0, y: 0, w: item.w, h: item.h), crop)
        let b = (item.border?.width ?? 0) * scale
        PhotoImage(id: item.photoId)
            .frame(width: whole.w * scale, height: whole.h * scale)
            .offset(x: whole.x * scale, y: whole.y * scale)
            .frame(width: item.w * scale, height: item.h * scale, alignment: .topLeading)
            .clipped()
            .padding(b)
            .background(item.border.map { Theme.ink($0.color) } ?? .clear)
    }
}

/**
 * A frame, as it exports: its background, and its photos cropped and bordered, `width`
 * points wide. `soft` marks each photo enlarged past its own pixels.
 */
struct FrameView: View {
    let frame: Spread
    let page: PageSetup
    let photos: [String: PhotoMeta]
    let width: Double
    var soft = false

    var body: some View {
        let scale = width / page.w
        let mark = max(12, min(22, width / 9))
        ZStack(alignment: .topLeading) {
            Theme.ink(frame.background)
            ForEach(frame.items.sorted { $0.z < $1.z }, id: \.photoId) { item in
                let b = item.border?.width ?? 0
                PlacedPhoto(item: item, photo: photos[item.photoId], scale: scale)
                    .offset(x: (item.x - b) * scale, y: (item.y - b) * scale)
            }
            if soft {
                ForEach(frame.items.filter { isSoft(photos[$0.photoId], $0, page) }, id: \.photoId) { item in
                    SoftMark(size: mark)
                        .offset(markOffset(item, scale: scale, size: mark))
                        .accessibilityLabel("\(photos[item.photoId]?.name ?? "A photo") is enlarged")
                }
            }
        }
        .frame(width: width, height: page.h * scale, alignment: .topLeading)
        .clipped()
    }

    /** Inside the photo's top-right corner, kept on the frame where the photo hangs off. */
    private func markOffset(_ item: Placement, scale: Double, size: Double) -> CGSize {
        let inset = size / 4
        return CGSize(
            width: max(0, min(item.rect.right, page.w) * scale - size - inset),
            height: max(0, item.y) * scale + inset)
    }
}

/** The warning on a photo that's enlarged past its pixels. */
struct SoftMark: View {
    let size: Double

    var body: some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .font(.system(size: size * 0.55, weight: .semibold))
            .foregroundStyle(Theme.onAccent)
            .frame(width: size, height: size)
            .background(Theme.warn, in: RoundedRectangle(cornerRadius: size / 4))
    }
}

/** A frame fitted into whatever space it's given, keeping its shape. */
struct FittedFrame: View {
    let frame: Spread
    let page: PageSetup
    let photos: [String: PhotoMeta]
    var soft = false

    var body: some View {
        GeometryReader { geo in
            let w = fitWidth(page, w: geo.size.width, h: geo.size.height)
            FrameView(frame: frame, page: page, photos: photos, width: w, soft: soft)
                .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}
