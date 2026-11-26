import Foundation

enum WatchDirectFailure: Error {
  case network
  case status(Int)
  case sessionEnded
  case invalid
}

actor WatchDirect {
  static let requestTimeout: TimeInterval = 20
  static let relayPath = "/v1/watch/request"
  static let ticketPath = "/v2/remote/watch/ticket"
  static let ticketMargin: TimeInterval = 60

  private struct Ticket {
    var ticket: String
    var jti: String
    var expiresAt: Date
    var relayURL: URL
  }

  private struct TicketReply: Decodable {
    var ticket: String
    var expiresAt: Double
    var signalUrl: String
  }

  private struct RelayReply: Decodable {
    var v: Int
    var sealed: String
  }

  private let urlSession: URLSession
  private var tickets: [String: Ticket] = [:]
  private var signingKey: WatchSigningKey?

  init() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = Self.requestTimeout
    configuration.timeoutIntervalForResource = Self.requestTimeout + 5
    configuration.waitsForConnectivity = false
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    urlSession = URLSession(configuration: configuration)
  }

  func reset() {
    tickets = [:]
    signingKey = nil
  }

  func run(_ command: WatchCommand, server: WatchDirectServer, credentials: WatchDirectCredentials) async throws
    -> WatchResult
  {
    do {
      return try await send(command, server: server, credentials: credentials)
    } catch WatchDirectFailure.status(401) {
      tickets[ticketKey(credentials, server)] = nil
      return try await send(command, server: server, credentials: credentials)
    }
  }

  private func send(_ command: WatchCommand, server: WatchDirectServer, credentials: WatchDirectCredentials)
    async throws -> WatchResult
  {
    guard let commandJSON = command.json() else { throw WatchDirectFailure.invalid }
    let ticket = try await ticket(for: server, credentials: credentials)
    let key = key()
    let id = Base64URL.random(byteCount: 16)
    let responseKey = Base64URL.random(byteCount: WatchCrypto.responseKeyBytes)
    let ts = Self.now()
    let plaintext = WatchCrypto.requestPlaintext(id: id, ts: ts, responseKey: responseKey, command: commandJSON)
    let sealed = try WatchCrypto.sealRequest(
      hostWatchKey: server.watchKey, hostId: server.hostId, ticketId: ticket.jti, plaintext: plaintext)
    let message = WatchCrypto.proofMessage(
      hostId: server.hostId, ticketId: ticket.jti, sealedDigest: WatchCrypto.sealedDigest(sealed), ts: ts)
    let body = WatchJSON.object([
      ("v", "1"),
      ("ts", String(ts)),
      ("sealed", WatchJSON.string(sealed)),
      ("proof", WatchJSON.string(try key.proof(message))),
    ])
    let data = try await post(ticket.relayURL, bearer: ticket.ticket, body: Data(body.utf8))
    guard let reply = try? JSONDecoder().decode(RelayReply.self, from: data), reply.v == 1 else {
      throw WatchDirectFailure.invalid
    }
    let opened = try WatchCrypto.openReply(responseKey: responseKey, requestId: id, sealed: reply.sealed)
    guard let result = WatchResult.decode(data: opened) else { throw WatchDirectFailure.invalid }
    return result
  }

  private func key() -> WatchSigningKey {
    if let signingKey { return signingKey }
    let loaded = WatchKeychain.signingKey()
    signingKey = loaded
    return loaded
  }

  private func ticketKey(_ credentials: WatchDirectCredentials, _ server: WatchDirectServer) -> String {
    "\(credentials.watchSessionId)\n\(server.hostId)"
  }

  private func ticket(for server: WatchDirectServer, credentials: WatchDirectCredentials) async throws -> Ticket {
    let cacheKey = ticketKey(credentials, server)
    if let cached = tickets[cacheKey], cached.expiresAt.timeIntervalSinceNow > Self.ticketMargin {
      return cached
    }
    guard let authURL = URL(string: credentials.authUrl), authURL.scheme == "https",
      let ticketURL = URL(string: Self.ticketPath, relativeTo: authURL)?.absoluteURL
    else {
      throw WatchDirectFailure.invalid
    }
    let ts = Self.now()
    let message = WatchCrypto.ticketProofMessage(
      watchSessionId: credentials.watchSessionId, hostId: server.hostId, ts: ts)
    let body = WatchJSON.object([
      ("hostId", WatchJSON.string(server.hostId)),
      ("ts", String(ts)),
      ("proof", WatchJSON.string(try key().proof(message))),
    ])
    let data: Data
    do {
      data = try await post(ticketURL, bearer: credentials.token, body: Data(body.utf8))
    } catch WatchDirectFailure.status(401) {
      throw WatchDirectFailure.sessionEnded
    }
    guard let reply = try? JSONDecoder().decode(TicketReply.self, from: data),
      let jti = Self.ticketId(reply.ticket),
      let relayURL = Self.relayURL(reply.signalUrl)
    else { throw WatchDirectFailure.invalid }
    let ticket = Ticket(
      ticket: reply.ticket, jti: jti, expiresAt: Date(timeIntervalSince1970: reply.expiresAt / 1000),
      relayURL: relayURL)
    tickets[cacheKey] = ticket
    return ticket
  }

  private func post(_ url: URL, bearer: String, body: Data) async throws -> Data {
    var request = URLRequest(url: url, timeoutInterval: Self.requestTimeout)
    request.httpMethod = "POST"
    request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = body
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await urlSession.data(for: request)
    } catch {
      throw WatchDirectFailure.network
    }
    guard let http = response as? HTTPURLResponse else { throw WatchDirectFailure.network }
    guard http.statusCode == 200 else { throw WatchDirectFailure.status(http.statusCode) }
    return data
  }

  nonisolated static func now() -> Int64 {
    Int64((Date().timeIntervalSince1970 * 1000).rounded())
  }

  nonisolated static func ticketId(_ jwt: String) -> String? {
    let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3, let payload = Base64URL.decode(String(parts[1])),
      let claims = try? JSONSerialization.jsonObject(with: payload) as? [String: Any],
      let jti = claims["jti"] as? String, !jti.isEmpty
    else { return nil }
    return jti
  }

  nonisolated static func relayURL(_ signalUrl: String) -> URL? {
    guard var components = URLComponents(string: signalUrl) else { return nil }
    switch components.scheme {
    case "https", "wss": components.scheme = "https"
    default: return nil
    }
    components.path = relayPath
    components.query = nil
    components.fragment = nil
    return components.url
  }
}
