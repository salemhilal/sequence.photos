import SwiftUI

@main
struct SequenceApp: App {
    @State private var model = AppModel(library: .standard())
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
        .onChange(of: phase) { _, now in
            // Saved before iOS may end the app in the background.
            if now != .active { model.store?.save() }
        }
    }
}
