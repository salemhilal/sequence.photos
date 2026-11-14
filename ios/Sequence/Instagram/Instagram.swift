import AuthenticationServices
import CryptoKit
import Foundation
import Observation
import Security

/** Sequence's Instagram app and server (src/config.ts): public values, as the web app ships them. */
enum InstagramConfig {
    static let appId = "1673773837797048"
    static let authorizeURL = "https://www.instagram.com/oauth/authorize"
    static let graphOrigin = "https://graph.instagram.com"
    /** Matches the server's GRAPH_VERSION. */
    static let graphURL = "\(graphOrigin)/v26.0"
    static let scopes = ["instagram_business_basic", "instagram_business_content_publish"]
    static let server = "https://sequence-server.sequence-photos.workers.dev"
    /**
     * The client the server sends sign-ins back to: the Mac app's, `sequence-photos://instagram`,
     * which ASWebAuthenticationSession catches for this app too.
     */
    static let client = "mac"
    static let callbackScheme = "sequence-photos"
}

/** A connected Instagram account (the server's InstagramConnection), kept in the Keychain. */
struct InstagramConnection: Codable, Equatable {
    var token: String
    /** When the token expires, in seconds since the epoch. */
    var expiresAt: Int
    var refreshedAt: Int
    var userId: String
    var username: String
    /** The server's proof this account signed in through it, renewed as it nears expiry. */
    var enrollment: String
    var server: String = InstagramConfig.server
    var needsReconnect: Bool? = nil

    var ready: Bool { needsReconnect != true }

    /** Checked as the web app's parseConnection checks it. */
    var isValid: Bool {
        !token.isEmpty && !enrollment.isEmpty
            && userId.range(of: "^[0-9]{1,32}$", options: .regularExpression) != nil
            && username.range(of: "^[A-Za-z0-9._]{1,64}$", options: .regularExpression) != nil
    }
}

extension InstagramConnection {
    /** The server's response has no `server` or `needsReconnect`: only this app keeps those. */
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        token = try c.decode(String.self, forKey: .token)
        expiresAt = try c.decode(Int.self, forKey: .expiresAt)
        refreshedAt = try c.decode(Int.self, forKey: .refreshedAt)
        userId = try c.decode(String.self, forKey: .userId)
        username = try c.decode(String.self, forKey: .username)
        enrollment = try c.decode(String.self, forKey: .enrollment)
        server = try c.decodeIfPresent(String.self, forKey: .server) ?? InstagramConfig.server
        needsReconnect = try c.decodeIfPresent(Bool.self, forKey: .needsReconnect)
    }
}

/** Why posting or signing in stopped, to say. */
struct InstagramError: LocalizedError, Equatable {
    let message: String
    var cancelled = false
    var errorDescription: String? { message }

    static let serverUnreachable = InstagramError(message: "Couldn’t connect to the Sequence server. Try again in a moment.")
    static let reconnect = InstagramError(message: "Your Instagram connection needs renewing. Connect again.")
    static let cancelledPost = InstagramError(message: "Cancelled. Nothing was posted.", cancelled: true)
}

/** The server's errors on a sign-in's return, as sentences (nil: cancelled, nothing to say). */
func signInErrorMessage(_ code: String) -> String? {
    switch code {
    case "cancelled": return nil
    case "missing_permission": return "Sequence needs permission to publish to your account. Connect again and allow it."
    case "not_professional":
        return "Posting from Sequence needs an Instagram Business or Creator account. You can switch in Instagram’s settings."
    default: return "Couldn’t connect to Instagram. Try again in a moment."
    }
}

func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func fromBase64URL(_ s: String) -> Data? {
    var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while b.count % 4 != 0 { b += "=" }
    return Data(base64Encoded: b)
}

/** PKCE's challenge for a verifier: its SHA-256, base64url. */
func challengeOf(_ verifier: String) -> String {
    base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
}

private func randomToken() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return base64URL(Data(bytes))
}

/** When an enrollment expires, in seconds since the epoch (0 if it can't be read). */
func enrollmentExpiry(_ enrollment: String) -> Int {
    guard let payload = enrollment.split(separator: ".").first, let data = fromBase64URL(String(payload)),
        let text = String(data: data, encoding: .utf8)
    else { return 0 }
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
    guard lines.count == 4, lines[0] == "v1", lines[1] == "ENROLL" else { return 0 }
    return Int(lines[3]) ?? 0
}

/** Where a sign-in goes, and what to keep to finish it. */
struct SignInPlan {
    var url: URL
    var state: String
    var verifier: String
}

func planSignIn(server: String = InstagramConfig.server) -> SignInPlan? {
    let verifier = randomToken()
    let state = "\(InstagramConfig.client).\(randomToken()).\(challengeOf(verifier))"
    var c = URLComponents(string: InstagramConfig.authorizeURL)
    c?.queryItems = [
        URLQueryItem(name: "client_id", value: InstagramConfig.appId),
        URLQueryItem(name: "redirect_uri", value: "\(server)/auth/callback"),
        URLQueryItem(name: "response_type", value: "code"),
        URLQueryItem(name: "scope", value: InstagramConfig.scopes.joined(separator: ",")),
        URLQueryItem(name: "enable_fb_login", value: "false"),
        URLQueryItem(name: "state", value: state),
    ]
    guard let url = c?.url else { return nil }
    return SignInPlan(url: url, state: state, verifier: verifier)
}

/** What a sign-in brought back, from its return URL's fragment. */
enum SignInReturn: Equatable {
    case connected(sealed: String, state: String)
    case failed(code: String, state: String)
}

func parseSignInReturn(_ url: URL) -> SignInReturn? {
    guard let fragment = URLComponents(url: url, resolvingAgainstBaseURL: false)?.fragment else { return nil }
    var c = URLComponents()
    c.query = fragment
    let params = Dictionary((c.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
    guard let state = params["state"], !state.isEmpty else { return nil }
    if let sealed = params["instagram"], !sealed.isEmpty { return .connected(sealed: sealed, state: state) }
    if let error = params["instagram_error"] { return .failed(code: error, state: state) }
    return nil
}

/** The Keychain item the connection is kept in. */
private enum Keychain {
    static let service = "io.salem.SequencePhotosMobile.instagram"

    static func load() -> Data? {
        let q: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    static func save(_ data: Data?) {
        let q: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service]
        SecItemDelete(q as CFDictionary)
        guard let data else { return }
        var add = q
        add[kSecValueData] = data
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}

/** The app's Instagram connection: signing in, keeping it fresh, and signing out. */
@MainActor
@Observable
final class Instagram {
    static let shared = Instagram()

    private(set) var connection: InstagramConnection?
    private(set) var busy = false
    /** What the last sign-in said, if anything. */
    var message: String?
    @ObservationIgnored private var session: ASWebAuthenticationSession?
    @ObservationIgnored private let anchor = Anchor()

    init() {
        if ProcessInfo.processInfo.arguments.contains("-uiTesting") { return }
        connection = Keychain.load().flatMap { try? JSONDecoder().decode(InstagramConnection.self, from: $0) }
            .flatMap { $0.isValid ? $0 : nil }
    }

    private func set(_ c: InstagramConnection?) {
        connection = c
        Keychain.save(c.flatMap { try? JSONEncoder().encode($0) })
    }

    func disconnect() {
        set(nil)
    }

    func markNeedsReconnect() {
        guard var c = connection, c.needsReconnect != true else { return }
        c.needsReconnect = true
        set(c)
    }

    /** Sign in to Instagram in a browser sheet, then redeem what comes back for a connection. */
    func connect() {
        guard !busy, let plan = planSignIn() else { return }
        busy = true
        message = nil
        let s = ASWebAuthenticationSession(url: plan.url, callbackURLScheme: InstagramConfig.callbackScheme) {
            [weak self] url, error in
            Task { @MainActor in
                guard let self else { return }
                self.session = nil
                if let url {
                    self.message = await self.finish(url, plan: plan)
                }
                _ = error
                self.busy = false
            }
        }
        s.presentationContextProvider = anchor
        s.prefersEphemeralWebBrowserSession = false
        session = s
        if !s.start() {
            busy = false
            message = "Couldn’t open Instagram’s sign-in."
        }
    }

    private func finish(_ url: URL, plan: SignInPlan) async -> String? {
        guard let back = parseSignInReturn(url) else { return signInErrorMessage("exchange_failed") }
        switch back {
        case let .failed(code, state):
            return state == plan.state ? signInErrorMessage(code) : signInErrorMessage("exchange_failed")
        case let .connected(sealed, state):
            guard state == plan.state else { return signInErrorMessage("exchange_failed") }
            var req = URLRequest(url: URL(string: "\(InstagramConfig.server)/auth/redeem")!)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONEncoder().encode(["sealed": sealed, "verifier": plan.verifier])
            guard let (data, res) = try? await URLSession.shared.data(for: req) else {
                return InstagramError.serverUnreachable.message
            }
            guard (res as? HTTPURLResponse)?.statusCode == 200,
                var c = try? JSONDecoder().decode(InstagramConnection.self, from: data), c.isValid
            else { return signInErrorMessage("exchange_failed") }
            c.server = InstagramConfig.server
            c.needsReconnect = nil
            set(c)
            return nil
        }
    }

    /**
     * The connection, refreshed if its token is a month old and its enrollment renewed if it
     * expires within two weeks; throws when it needs signing in again.
     */
    func fresh(now: Int = Int(Date().timeIntervalSince1970)) async throws -> InstagramConnection {
        guard let c = connection, c.ready, c.expiresAt > now else { throw InstagramError.reconnect }
        var next = c
        let day = 24 * 60 * 60
        if now - c.refreshedAt >= 30 * day { next = try await refresh(next, now: now) }
        if enrollmentExpiry(next.enrollment) - now < 15 * day { next = await renew(next) }
        if next != c, connection == c { set(next) }
        return next
    }

    private func refresh(_ c: InstagramConnection, now: Int) async throws -> InstagramConnection {
        var u = URLComponents(string: "\(InstagramConfig.graphOrigin)/refresh_access_token")
        u?.queryItems = [URLQueryItem(name: "grant_type", value: "ig_refresh_token"), URLQueryItem(name: "access_token", value: c.token)]
        guard let url = u?.url, let (data, res) = try? await URLSession.shared.data(from: url) else { return c }
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if (res as? HTTPURLResponse)?.statusCode == 200, let token = body?["access_token"] as? String,
            let expiresIn = body?["expires_in"] as? Double
        {
            var n = c
            n.token = token
            n.expiresAt = now + Int(expiresIn)
            n.refreshedAt = now
            return n
        }
        if (body?["error"] as? [String: Any])?["code"] as? Int == 190 {
            markNeedsReconnect()
            throw InstagramError.reconnect
        }
        return c
    }

    private func renew(_ c: InstagramConnection) async -> InstagramConnection {
        var req = URLRequest(url: URL(string: "\(c.server)/auth/renew")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONEncoder().encode(["enrollment": c.enrollment])
        guard let (data, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200,
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let enrollment = body["enrollment"] as? String
        else { return c }
        var n = c
        n.enrollment = enrollment
        return n
    }
}

/** Where the sign-in sheet is shown: the app's window. */
private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return scene?.keyWindow ?? ASPresentationAnchor()
    }
}
