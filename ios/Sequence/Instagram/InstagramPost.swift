import Foundation

// Posting to Instagram (src/instagramPost.ts): the frames as JPEGs, uploaded to Sequence's
// server for Instagram to fetch, then made into a post (or stories) with Instagram's API.

/** Where a post is, to show. */
enum PostStep: Equatable {
    case preparing(done: Int, total: Int)
    case uploading(done: Int, total: Int)
    case processing
    case publishing(done: Int, total: Int)

    var label: String {
        switch self {
        case let .preparing(done, total): return "Preparing slide \(done + 1) of \(total)…"
        case let .uploading(done, total): return "Uploading slide \(done + 1) of \(total)…"
        case .processing: return "Instagram is processing the post…"
        case let .publishing(done, total): return total > 1 ? "Publishing story \(done + 1) of \(total)…" : "Publishing…"
        }
    }
}

/** What Instagram's errors mean, as sentences. */
func graphErrorMessage(code: Int?, userMessage: String?, status: Int) -> String {
    switch code {
    case 190: return "Your Instagram connection expired. Connect again."
    case 4, 17, 32, 613, 9: return "Instagram’s posting limit was reached. Try again later."
    case 10, 200: return "Sequence doesn’t have permission to post. Connect again."
    case 9004: return "Instagram couldn’t fetch the images. Try again in a moment."
    case 36003: return "Instagram doesn’t accept this image shape. Try cropping or expanding the slides."
    default:
        if let userMessage, !userMessage.isEmpty { return userMessage }
        return "Instagram couldn’t post this (\(code.map { "error \($0)" } ?? "HTTP \(status)"))."
    }
}

/** Instagram's ids are numbers too long for JSON's: quoted before parsing, as strings. */
func quoteIds(_ text: String) -> String {
    text.replacingOccurrences(of: "(\"(?:id|user_id)\"\\s*:\\s*)(\\d+)", with: "$1\"$2\"", options: .regularExpression)
}

/** Parameters as a form (or a URL's query): everything but unreserved characters escaped. */
func formEncoded(_ params: [String: String]) -> String {
    // ASCII only: CharacterSet.alphanumerics would let accented letters through unescaped.
    let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    let esc = { (s: String) in s.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
    return params.sorted { $0.key < $1.key }.map { "\(esc($0.key))=\(esc($0.value))" }.joined(separator: "&")
}

private func fail(_ message: String) -> InstagramError {
    InstagramError(message: message)
}

/** One post's work: cancellable between steps (and during waits). */
struct InstagramPoster {
    let connection: InstagramConnection
    let onReconnect: @MainActor () -> Void

    private func graph(_ method: String, _ path: String, _ params: [String: String]) async throws -> [String: Any] {
        try Task.checkCancellation()
        var all = params
        all["access_token"] = connection.token
        let query = formEncoded(all)
        var req: URLRequest
        if method == "GET" {
            req = URLRequest(url: URL(string: "\(InstagramConfig.graphURL)/\(path)?\(query)")!)
        } else {
            req = URLRequest(url: URL(string: "\(InstagramConfig.graphURL)/\(path)")!)
            req.httpMethod = method
            req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            req.httpBody = Data(query.utf8)
        }
        let data: Data
        let res: URLResponse
        do {
            (data, res) = try await URLSession.shared.data(for: req)
        } catch {
            try Task.checkCancellation()
            throw fail("Couldn’t reach Instagram. Check your connection and try again.")
        }
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: Data(quoteIds(String(decoding: data, as: UTF8.self)).utf8)))
            as? [String: Any]
        if status == 200, let json { return json }
        let error = json?["error"] as? [String: Any]
        let code = error?["code"] as? Int
        if code == 190 { await onReconnect() }
        throw fail(graphErrorMessage(code: code, userMessage: error?["error_user_msg"] as? String, status: status))
    }

    private func idOf(_ json: [String: Any]) throws -> String {
        guard let id = json["id"] as? String, !id.isEmpty else { throw fail("Instagram sent an unexpected answer.") }
        return id
    }

    private func waitUntilReady(_ container: String) async throws {
        let started = Date()
        for delay in [1, 2, 3, 5, 8, 13, 21, 30, 60, 60, 60, 60] {
            let json = try await graph("GET", container, ["fields": "status_code"])
            let status = json["status_code"] as? String
            if status == "FINISHED" || status == "PUBLISHED" { return }
            if status == "ERROR" || status == "EXPIRED" { throw fail("Instagram couldn’t process the images. Try again in a moment.") }
            if Date().timeIntervalSince(started) > 300 { break }
            try await Task.sleep(for: .seconds(delay))
        }
        throw fail("Instagram is taking too long to process the post. Try again later.")
    }

    private struct Batch: Decodable {
        struct Frame: Decodable {
            var put: String
            var url: String
        }

        var id: String
        var frames: [Frame]
        var delete: String
    }

    private func startUpload(count: Int) async throws -> Batch {
        var req = URLRequest(url: URL(string: "\(connection.server)/uploads")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["enrollment": connection.enrollment, "count": count])
        let data: Data
        let res: URLResponse
        do {
            (data, res) = try await URLSession.shared.data(for: req)
        } catch {
            try Task.checkCancellation()
            throw InstagramError.serverUnreachable
        }
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 {
            await onReconnect()
            throw InstagramError.reconnect
        }
        if status == 429 { throw fail("Too many posts in a row. Wait a minute and try again.") }
        guard status == 200, let batch = try? JSONDecoder().decode(Batch.self, from: data), batch.frames.count == count else {
            throw fail("The Sequence server couldn’t take the images (HTTP \(status)).")
        }
        return batch
    }

    private func upload(_ put: String, _ image: Data) async throws {
        guard let url = URL(string: put) else { throw InstagramError.serverUnreachable }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        let res: URLResponse
        do {
            (_, res) = try await URLSession.shared.upload(for: req, from: image)
        } catch {
            try Task.checkCancellation()
            throw InstagramError.serverUnreachable
        }
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        if status != 200 { throw fail("The Sequence server refused an image (HTTP \(status)).") }
    }

    /**
     * Post `images` (JPEGs, at most 10) as a feed post (a carousel if several) or as stories;
     * returns the post's link, if Instagram gives one.
     */
    func post(_ images: [Data], kind: PostKind, caption: String, onStep: @MainActor (PostStep) -> Void) async throws -> URL? {
        let user = connection.userId
        let needed = kind == .story ? images.count : 1
        // Instagram's daily limit, checked first (a failure to check isn't one to stop for).
        if let limit = try? await graph("GET", "\(user)/content_publishing_limit", ["fields": "quota_usage,config"]),
            let data = (limit["data"] as? [[String: Any]])?.first, let used = data["quota_usage"] as? Int,
            let total = (data["config"] as? [String: Any])?["quota_total"] as? Int, used + needed > total
        {
            throw fail("Instagram allows \(total) posts a day through apps, and that’s been reached. Try again later.")
        }
        try Task.checkCancellation()
        let batch = try await startUpload(count: images.count)
        var result = "failed"
        defer {
            // The server deletes the images now, and logs how it went.
            if var c = URLComponents(string: batch.delete) {
                c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "result", value: result)]
                if let url = c.url {
                    var req = URLRequest(url: url)
                    req.httpMethod = "DELETE"
                    URLSession.shared.dataTask(with: req).resume()
                }
            }
        }
        do {
            for (i, image) in images.enumerated() {
                try Task.checkCancellation()
                await onStep(.uploading(done: i, total: images.count))
                try await upload(batch.frames[i].put, image)
            }
            await onStep(.processing)
            let urls = batch.frames.map(\.url)
            let create = { (params: [String: String]) in try idOf(await graph("POST", "\(user)/media", params)) }
            var toPublish: [String] = []
            if kind == .story {
                for u in urls { toPublish.append(try await create(["image_url": u, "media_type": "STORIES"])) }
            } else if urls.count == 1 {
                toPublish = [try await create(["image_url": urls[0], "caption": caption])]
            } else {
                var children: [String] = []
                for u in urls { children.append(try await create(["image_url": u, "is_carousel_item": "true"])) }
                for child in children { try await waitUntilReady(child) }
                toPublish = [try await create(["media_type": "CAROUSEL", "children": children.joined(separator: ","), "caption": caption])]
            }
            for c in toPublish { try await waitUntilReady(c) }
            try Task.checkCancellation()
            var published: [String] = []
            for (i, container) in toPublish.enumerated() {
                await onStep(.publishing(done: i, total: toPublish.count))
                do {
                    // Past here, it isn't cancelled: Instagram may have posted it.
                    published.append(try idOf(await graph("POST", "\(user)/media_publish", ["creation_id": container])))
                    result = "posted"
                } catch {
                    if published.isEmpty { throw error }
                    throw fail("\(published.count) of \(toPublish.count) stories were posted, then it stopped. \(error.localizedDescription)")
                }
            }
            guard let first = published.first else { return nil }
            let link = try? await graph("GET", first, ["fields": "permalink"])
            return (link?["permalink"] as? String).flatMap(URL.init(string:))
        } catch is CancellationError {
            result = "cancelled"
            throw InstagramError.cancelledPost
        }
    }
}
