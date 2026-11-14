import SwiftUI
import UIKit

/**
 * Reports where two fingers are on this view, from the moment both are down. SwiftUI's own
 * pinch gives only a scale and where it started, and doesn't begin for a drag. Other gestures
 * carry on alongside it, so what they'd started is for `began` to drop.
 */
struct TwoFingers: UIViewRepresentable {
    let began: (CGPoint, CGPoint) -> Void
    let changed: (CGPoint, CGPoint) -> Void
    let ended: () -> Void

    func makeUIView(context: Context) -> Probe { Probe() }

    func updateUIView(_ view: Probe, context: Context) {
        view.recognizer.began = began
        view.recognizer.changed = changed
        view.recognizer.ended = ended
    }

    /** Marks out the area. The recognizer sits on the window, since photos above it take the touches. */
    final class Probe: UIView {
        let recognizer = TwoFingerRecognizer()

        init() {
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            recognizer.area = self
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("not from a storyboard") }

        override func willMove(toWindow window: UIWindow?) {
            recognizer.view?.removeGestureRecognizer(recognizer)
            window?.addGestureRecognizer(recognizer)
        }
    }
}

/** Follows the first two fingers to land in its area, ending when either lifts. */
final class TwoFingerRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
    weak var area: UIView?
    var began: (CGPoint, CGPoint) -> Void = { _, _ in }
    var changed: (CGPoint, CGPoint) -> Void = { _, _ in }
    var ended: () -> Void = {}
    private var touches: [UITouch] = []

    init() {
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesEnded = false
        delegate = self
    }

    private func report(_ report: (CGPoint, CGPoint) -> Void) {
        guard touches.count == 2, let area else { return }
        report(touches[0].location(in: area), touches[1].location(in: area))
    }

    override func touchesBegan(_ new: Set<UITouch>, with event: UIEvent) {
        for touch in new {
            // Not over a sheet, or outside the canvas (off-screen pages have one each).
            let covered = view?.window?.rootViewController?.presentedViewController != nil
            guard let area, !covered, area.window != nil, touches.count < 2,
                area.bounds.contains(touch.location(in: area))
            else {
                ignore(touch, for: event)
                continue
            }
            touches.append(touch)
        }
        if touches.count == 2, state == .possible {
            report(began)
            state = .began
        }
    }

    override func touchesMoved(_ moved: Set<UITouch>, with event: UIEvent) {
        guard state == .began || state == .changed else { return }
        report(changed)
        state = .changed
    }

    override func touchesEnded(_ gone: Set<UITouch>, with event: UIEvent) { finish(gone) }
    override func touchesCancelled(_ gone: Set<UITouch>, with event: UIEvent) { finish(gone) }

    private func finish(_ gone: Set<UITouch>) {
        touches.removeAll { gone.contains($0) }
        if state == .began || state == .changed {
            ended()
            state = .ended
        } else if touches.isEmpty {
            state = .failed
        }
    }

    override func reset() {
        super.reset()
        touches = []
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool { true }
}
