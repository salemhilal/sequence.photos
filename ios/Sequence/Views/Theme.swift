import SwiftUI

/**
 * The desktop app's dark theme (src/phone/phone.css), at touch sizes: grey controls, amber
 * only for selection, checkmarks, warnings, and the main export actions.
 */
enum Theme {
    static let bg = Color(hex: 0x1b1b1b)
    static let panel = Color(hex: 0x242424)
    static let header = Color(hex: 0x2c2c2c)
    static let control = Color(hex: 0x333333)
    static let inset = Color(hex: 0x181818)
    static let well = Color(hex: 0x0e0e0e)
    static let text = Color(hex: 0xe6e6e6)
    static let muted = Color(hex: 0x8e8e8e)
    static let faint = Color(hex: 0x5a5a5a)
    static let accent = Color(hex: 0xe0a13a)
    static let onAccent = Color(hex: 0x1f1606)
    static let warn = Color(hex: 0xf0a44b)
    static let danger = Color(hex: 0xf07a62)
    static let desk = Color(hex: 0x787878)
    static let guide = Color(red: 74 / 255, green: 178 / 255, blue: 214 / 255).opacity(0.55)
    static let guideHit = Color(hex: 0x1f9fcc)
    static let guideCenter = Color(red: 206 / 255, green: 70 / 255, blue: 170 / 255).opacity(0.75)

    /** How things move: quick, easing out like iOS's own. */
    static let quick = Animation.snappy(duration: 0.22)
    static let drawer = Animation.snappy(duration: 0.3)

    static func ink(_ ink: Ink?) -> Color {
        ink == .black ? .black : .white
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255)
    }
}

extension Font {
    /** Numbers and sizes, as the web app's mono. */
    static func mono(_ size: CGFloat) -> Font {
        .system(size: size, design: .monospaced)
    }
}
