import SwiftUI

/**
 * The desktop app's dark theme, at touch sizes: grey controls, amber
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
    /**
     * The web app's Inter Tight (bundled in Fonts/, by scripts/ios-fonts.mjs), at a text
     * style's size and scaling with it. Named by weight: each weight is its own family.
     */
    static func sans(_ style: TextStyle, _ weight: Weight = .regular) -> Font {
        let name =
            switch weight {
            case .bold, .heavy, .black: "InterTight-Bold"
            case .semibold: "InterTight-SemiBold"
            case .medium: "InterTight-Medium"
            default: "InterTight-Regular"
            }
        return .custom(name, size: style.size, relativeTo: style)
    }

    /** Numbers and sizes, as the web app's mono (IBM Plex Mono). */
    static func mono(_ size: CGFloat, _ weight: Weight = .regular) -> Font {
        .custom(weight == .regular ? "IBMPlexMono-Regular" : "IBMPlexMono-Medium", fixedSize: size)
    }
}

extension Font.TextStyle {
    /** iOS's size for the style at the default text size. */
    var size: CGFloat {
        switch self {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .body, .headline: 17
        case .callout: 16
        case .subheadline: 15
        case .footnote: 13
        case .caption: 12
        default: 11
        }
    }
}

extension UIFont {
    /** Inter Tight for UIKit's own text (navigation titles), scaling with the text size. */
    static func sans(_ style: UIFont.TextStyle, _ name: String = "InterTight-SemiBold", size: CGFloat) -> UIFont {
        guard let font = UIFont(name: name, size: size) else { return .preferredFont(forTextStyle: style) }
        return UIFontMetrics(forTextStyle: style).scaledFont(for: font)
    }
}
