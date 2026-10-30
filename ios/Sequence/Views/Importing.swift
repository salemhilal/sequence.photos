import PhotosUI
import SwiftUI

/** Photos chosen to add, read and stored, waiting to be told where to go. */
struct PendingPhotos: Identifiable {
    let id = UUID()
    var photos: [PhotoMeta]
    var failed: Int
}

/** Read photos chosen in the picker and store them; returns those read, and how many couldn't be. */
@MainActor
func importPicked(_ items: [PhotosPickerItem], into store: PhotoStore, progress: (Int, Int) -> Void) async
    -> PendingPhotos
{
    var photos: [PhotoMeta] = []
    var failed = 0
    for (n, item) in items.enumerated() {
        progress(n, items.count)
        let name = item.itemIdentifier.map { "\($0.prefix(8)).jpg" } ?? "Photo \(n + 1).jpg"
        if let data = try? await item.loadTransferable(type: Data.self),
            let meta = await Task.detached(operation: { store.add(data: data, name: name) }).value
        {
            photos.append(meta)
        } else {
            failed += 1
        }
    }
    return PendingPhotos(photos: photos, failed: failed)
}

/** The camera, for Take photo: hands back a JPEG of what was taken. */
struct CameraPicker: UIViewControllerRepresentable {
    let onDone: (Data?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let c = UIImagePickerController()
        c.sourceType = .camera
        c.delegate = context.coordinator
        return c
    }

    func updateUIViewController(_ c: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onDone: (Data?) -> Void
        init(onDone: @escaping (Data?) -> Void) { self.onDone = onDone }

        func imagePickerController(
            _ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            let image = info[.originalImage] as? UIImage
            onDone(image?.jpegData(compressionQuality: 0.95))
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onDone(nil)
        }
    }
}

/** "Frame 04", "Frames 04 to 06". */
func frameRange(_ from: Int, _ count: Int) -> String {
    let pad = { (i: Int) in String(format: "%02d", i) }
    return count == 1 ? "Frame \(pad(from))" : "Frames \(pad(from)) to \(pad(from + count - 1))"
}
