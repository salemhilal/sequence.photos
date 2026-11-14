import Foundation

/**
 * Any JSON, kept as it came: for the parts of a project this app reads only a little of
 * (the Export choices), so it writes back what the web and Mac app saved there unchanged.
 */
enum JSONValue: Codable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? c.decode(Double.self) {
            self = .number(n)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else if let a = try? c.decode([JSONValue].self) {
            self = .array(a)
        } else {
            self = .object(try c.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(b): try c.encode(b)
        case let .number(n): try c.encode(n)
        case let .string(s): try c.encode(s)
        case let .array(a): try c.encode(a)
        case let .object(o): try c.encode(o)
        }
    }

    subscript(key: String) -> JSONValue? {
        get {
            if case let .object(o) = self { return o[key] }
            return nil
        }
        set {
            var o: [String: JSONValue] = [:]
            if case let .object(was) = self { o = was }
            o[key] = newValue
            self = .object(o)
        }
    }

    var string: String? {
        if case let .string(s) = self { return s }
        return nil
    }

    var number: Double? {
        if case let .number(n) = self { return n }
        return nil
    }

    var strings: [String]? {
        if case let .array(a) = self { return a.compactMap(\.string) }
        return nil
    }
}

/**
 * The Export choices this app reads and changes (src/types.ts's ExportState): where to, the
 * images' format and quality, and the Instagram post being written. Everything else in the
 * project's `export` stays as it was.
 */
struct ExportChoices {
    var value: JSONValue

    init(_ value: JSONValue?) {
        self.value = value ?? .object([:])
    }

    var to: String? {
        get { value["to"]?.string }
        set { value["to"] = newValue.map(JSONValue.string) }
    }

    var format: String? {
        get { value["options"]?["format"]?.string }
        set { value["options", default: .object([:])]["format"] = newValue.map(JSONValue.string) }
    }

    var quality: Double? {
        get { value["options"]?["quality"]?.number }
        set { value["options", default: .object([:])]["quality"] = newValue.map(JSONValue.number) }
    }

    var postKind: String? {
        get { value["instagram"]?["kind"]?.string }
        set { value["instagram", default: .object([:])]["kind"] = newValue.map(JSONValue.string) }
    }

    var fit: String? {
        get { value["instagram"]?["fit"]?.string }
        set { value["instagram", default: .object([:])]["fit"] = newValue.map(JSONValue.string) }
    }

    var caption: String? {
        get { value["instagram"]?["caption"]?.string }
        set { value["instagram", default: .object([:])]["caption"] = newValue.map(JSONValue.string) }
    }

    var chosen: [String]? {
        get { value["instagram"]?["chosen"]?.strings }
        set { value["instagram", default: .object([:])]["chosen"] = newValue.map { .array($0.map(JSONValue.string)) } }
    }
}

extension JSONValue {
    subscript(key: String, default fallback: JSONValue) -> JSONValue {
        get { self[key] ?? fallback }
        set { self[key] = newValue }
    }
}
