import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

/**
 * The photos every project shares, as files: each one's original as it came
 * (`<id>.original`) and a smaller copy to show (`<id>.jpg`, at most `thumbMax` on its long
 * side, upright). Exports draw from the originals.
 */
final class PhotoStore {
    let root: URL
    /** The shown copy's longest side, in pixels: sharp on a phone screen at full width. */
    static let thumbMax = 1400

    private let cache = NSCache<NSString, UIImage>()

    init(root: URL) {
        self.root = root
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        cache.countLimit = 80
    }

    func originalURL(_ id: String) -> URL { root.appendingPathComponent("\(id).original") }
    func thumbURL(_ id: String) -> URL { root.appendingPathComponent("\(id).jpg") }

    /**
     * Store a photo's data (as chosen from the library or taken with the camera); returns
     * its meta, or nil if it isn't an image this can read.
     */
    func add(data: Data, name: String) -> PhotoMeta? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let size = uprightSize(source),
            let thumb = makeThumb(source)
        else { return nil }
        let id = newId()
        do {
            try data.write(to: originalURL(id), options: .atomic)
            guard let jpeg = UIImage(cgImage: thumb).jpegData(compressionQuality: 0.85) else { return nil }
            try jpeg.write(to: thumbURL(id), options: .atomic)
        } catch {
            delete(id)
            return nil
        }
        return PhotoMeta(id: id, name: name, pxW: size.w, pxH: size.h)
    }

    /** Copy a stored photo under a new id; false if it isn't stored. */
    func copy(_ id: String, to newID: String) -> Bool {
        let fm = FileManager.default
        do {
            try fm.copyItem(at: originalURL(id), to: originalURL(newID))
            try fm.copyItem(at: thumbURL(id), to: thumbURL(newID))
            return true
        } catch {
            return false
        }
    }

    func delete(_ id: String) {
        try? FileManager.default.removeItem(at: originalURL(id))
        try? FileManager.default.removeItem(at: thumbURL(id))
        cache.removeObject(forKey: id as NSString)
    }

    func storedIds() -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        return Array(Set(names.map { ($0 as NSString).deletingPathExtension }))
    }

    /** The shown copy, or nil if it isn't stored. */
    func thumb(_ id: String) -> UIImage? {
        if let img = cache.object(forKey: id as NSString) { return img }
        guard let img = UIImage(contentsOfFile: thumbURL(id).path) else { return nil }
        cache.setObject(img, forKey: id as NSString)
        return img
    }

    /** The original, upright, at most `maxPixels` on its long side (for exports). */
    func original(_ id: String, maxPixels: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(originalURL(id) as CFURL, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary)
    }

    private func makeThumb(_ source: CGImageSource) -> CGImage? {
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: Self.thumbMax,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary)
    }

    /** The image's pixel size, upright (its EXIF orientation applied). */
    private func uprightSize(_ source: CGImageSource) -> (w: Double, h: Double)? {
        guard let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let w = props[kCGImagePropertyPixelWidth] as? Double,
            let h = props[kCGImagePropertyPixelHeight] as? Double, w > 0, h > 0
        else { return nil }
        let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
        return orientation >= 5 ? (h, w) : (w, h)
    }
}
