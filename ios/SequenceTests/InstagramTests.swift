import XCTest

@testable import Sequence

final class InstagramTests: XCTestCase {
    func testConnectionDecodesTheServersResponse() throws {
        // What /auth/redeem sends: no `server`, which only this app keeps.
        let json = #"{"token":"t","expiresAt":2,"refreshedAt":1,"userId":"123","username":"sal.em","enrollment":"e"}"#
        let c = try JSONDecoder().decode(InstagramConnection.self, from: Data(json.utf8))
        XCTAssertTrue(c.isValid)
        XCTAssertEqual(c.server, InstagramConfig.server)
        XCTAssertNil(c.needsReconnect)
    }

    func testConnectionKeepsItsServerWhenSaved() throws {
        var c = InstagramConnection(token: "t", expiresAt: 2, refreshedAt: 1, userId: "123", username: "sal.em", enrollment: "e")
        c.server = "https://example.test"
        XCTAssertEqual(try JSONDecoder().decode(InstagramConnection.self, from: JSONEncoder().encode(c)), c)
    }

    func testPlansASignInWithPKCE() throws {
        let plan = try XCTUnwrap(planSignIn())
        let parts = plan.state.split(separator: ".")
        XCTAssertEqual(parts.count, 3)
        XCTAssertEqual(parts[0], "mac")
        XCTAssertEqual(String(parts[2]), challengeOf(plan.verifier))
        let q = URLComponents(url: plan.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(q.first { $0.name == "redirect_uri" }?.value, "\(InstagramConfig.server)/auth/callback")
        XCTAssertEqual(q.first { $0.name == "state" }?.value, plan.state)
    }

    func testChallengeIsBase64URLSHA256() {
        // As openssl dgst -sha256 -binary | base64, made URL-safe and unpadded.
        XCTAssertEqual(challengeOf("dBjftJeZ4CVP-mJ92K9q75bIS5bNFl8hqGDAFt4ITlI"), "k9dgdCHAiqf2i6QNjwxvh8YcNuWhuccBahLwzVVWSM8")
    }

    func testReadsWhatASignInBringsBack() throws {
        let ok = try XCTUnwrap(URL(string: "sequence-photos://instagram#instagram=abc.def&state=mac.n.c"))
        XCTAssertEqual(parseSignInReturn(ok), .connected(sealed: "abc.def", state: "mac.n.c"))
        let no = try XCTUnwrap(URL(string: "sequence-photos://instagram#instagram_error=not_professional&state=mac.n.c"))
        XCTAssertEqual(parseSignInReturn(no), .failed(code: "not_professional", state: "mac.n.c"))
        XCTAssertNil(parseSignInReturn(try XCTUnwrap(URL(string: "sequence-photos://instagram"))))
        XCTAssertNil(signInErrorMessage("cancelled"))
    }

    func testReadsAnEnrollmentsExpiry() {
        let payload = base64URL(Data("v1\nENROLL\n123\n1800000000".utf8))
        XCTAssertEqual(enrollmentExpiry("\(payload).sig"), 1_800_000_000)
        XCTAssertEqual(enrollmentExpiry("nonsense"), 0)
    }

    func testEncodesFormsStrictly() {
        XCTAssertEqual(formEncoded(["caption": "Walks & talks + café #35mm", "a": "1"]), "a=1&caption=Walks%20%26%20talks%20%2B%20caf%C3%A9%20%2335mm")
    }

    func testQuotesLongIds() {
        XCTAssertEqual(quoteIds(#"{"id": 17895695668004550, "x": 1}"#), #"{"id": "17895695668004550", "x": 1}"#)
    }

    func testSaysWhatInstagramsErrorsMean() {
        XCTAssertEqual(graphErrorMessage(code: 4, userMessage: nil, status: 400), "Instagram’s posting limit was reached. Try again later.")
        XCTAssertEqual(graphErrorMessage(code: nil, userMessage: nil, status: 502), "Instagram couldn’t post this (HTTP 502).")
    }

    func testChecksAConnection() {
        var c = InstagramConnection(token: "t", expiresAt: 1, refreshedAt: 1, userId: "123", username: "sal.em", enrollment: "e")
        XCTAssertTrue(c.isValid)
        c.username = "no spaces"
        XCTAssertFalse(c.isValid)
    }
}
