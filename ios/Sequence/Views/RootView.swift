import SwiftUI

/** Where the app is: the list of sequences, a sequence's frames, or a frame being edited. */
enum Route: Hashable {
    case frames(String)
    case editor(String, frame: String)
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            SequencesView(path: $path)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case let .frames(id): FramesView(id: id, path: $path)
                    case let .editor(id, frame): EditorView(id: id, frameId: frame)
                    }
                }
        }
        .alert(
            "Something went wrong", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })
        ) {
            Button("OK") {}
        } message: {
            Text(model.notice ?? "")
        }
    }
}
