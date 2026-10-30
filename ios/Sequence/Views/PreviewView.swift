import SwiftUI

/** Every frame, full screen, one at a time as it'll be seen: swipe through; tap for the controls. */
struct PreviewView: View {
    @Environment(\.dismiss) private var dismiss
    let project: Project
    let start: Int
    @State private var at: Int?
    @State private var chrome = true

    var body: some View {
        let frames = project.frames
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(Array(frames.enumerated()), id: \.offset) { i, f in
                        FittedFrame(frame: f, page: project.page, photos: project.photos)
                            .padding(12)
                            .containerRelativeFrame(.horizontal)
                            .id(i)
                            .accessibilityLabel("Frame \(i + 1)")
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $at)
            .scrollIndicators(.hidden)
            .onTapGesture { withAnimation(Theme.quick) { chrome.toggle() } }
            .accessibilityLabel("Preview")
            if chrome {
                HStack {
                    Button("Close the preview", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly).font(.title3)
                        .frame(width: 44, height: 44)
                    Spacer()
                    Text("\(min(at ?? start, frames.count - 1) + 1) / \(frames.count)").font(.mono(13))
                        .contentTransition(.numericText())
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, 8)
                .transition(.opacity)
            }
        }
        .statusBarHidden(!chrome)
        .onAppear { at = start }
    }
}
