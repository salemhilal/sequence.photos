import SwiftUI

@main
struct SequenceApp: App {
    @State private var model = AppModel(library: .standard())
    @Environment(\.scenePhase) private var phase

    init() {
        // Navigation titles are UIKit's: in Inter Tight too.
        let bar = UINavigationBar.appearance()
        bar.titleTextAttributes = [.font: UIFont.sans(.headline, size: 17)]
        bar.largeTitleTextAttributes = [.font: UIFont.sans(.largeTitle, "InterTight-Bold", size: 34)]
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .font(.sans(.body))
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
        .onChange(of: phase) { _, now in
            // Saved before iOS may end the app in the background.
            if now != .active { model.store?.save() }
        }
    }
}
