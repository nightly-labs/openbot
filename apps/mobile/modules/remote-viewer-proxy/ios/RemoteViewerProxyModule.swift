import CryptoKit
import ExpoModulesCore
import Foundation
import Network

private let maxHeadBytes = 32 * 1024
private let maxBodyBytes = 2 * 1024 * 1024
private let maxMessageBytes = 1024 * 1024
/// Another app on the phone can also connect to the loopback port. These limits keep it small.
private let maxPeers = 128
private let readTimeout: TimeInterval = 30
private let responseTimeout: TimeInterval = 60
private let closeTimeout: TimeInterval = 2
private let methods: Set<String> = ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]
private let ownedHeaders: Set<String> = ["content-length", "transfer-encoding", "connection"]
private let webSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

final class InvalidTokenException: Exception, @unchecked Sendable {
  override var reason: String {
    "The remote viewer token is not valid"
  }
}

final class ListenException: Exception, @unchecked Sendable {
  override var reason: String {
    "The remote viewer proxy could not listen on the loopback address"
  }
}

/// Tells if a start promise is settled. Only the server queue reads and writes it.
private final class Settled {
  var done = false
}

private final class Peer {
  enum Phase {
    case head, body, waiting, responding, upgrading, webSocket, closing, closed
  }

  let id = UUID().uuidString
  let connection: NWConnection
  var phase = Phase.head
  var buffer: [UInt8] = []
  var deadline: DispatchWorkItem?
  var method = ""
  var target = ""
  var headers: [String: String] = [:]
  var bodyLength = 0
  var requestId: String?
  var socketId: String?
  /// The opcode of the message that continuation frames add to, or 0.
  var fragmentOpcode: UInt8 = 0
  var fragments: [UInt8] = []

  init(connection: NWConnection) {
    self.connection = connection
  }
}

private struct Pending {
  let peer: Peer
  let head: Bool
  let timeout: DispatchWorkItem
}

/// A loopback HTTP/1.1 and WebSocket server. It only reads the framing. JavaScript answers each request
/// and each socket message. All state and all methods belong to `queue`.
final class RemoteViewerServer {
  private let queue: DispatchQueue
  private let emit: (String, [String: Any?]) -> Void
  private var listener: NWListener?
  private var token = ""
  private var peers: [String: Peer] = [:]
  private var pending: [String: Pending] = [:]
  private var sockets: [String: Peer] = [:]

  init(queue: DispatchQueue, emit: @escaping (String, [String: Any?]) -> Void) {
    self.queue = queue
    self.emit = emit
  }

  func start(token: String, promise: Promise) {
    stop()
    guard token.range(of: "^[A-Za-z0-9]{16,64}$", options: .regularExpression) != nil else {
      promise.reject(InvalidTokenException())
      return
    }
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
    parameters.includePeerToPeer = false
    guard let listener = try? NWListener(using: parameters) else {
      promise.reject(ListenException())
      return
    }
    self.token = token
    self.listener = listener
    let settled = Settled()
    listener.stateUpdateHandler = { [weak self, weak listener] state in
      guard let self, let listener, self.listener === listener else {
        // A stop or a new start came first.
        if !settled.done {
          settled.done = true
          promise.reject(ListenException())
        }
        return
      }
      switch state {
      case .ready:
        guard !settled.done else { return }
        settled.done = true
        if let port = listener.port?.rawValue, port != 0 {
          promise.resolve(Int(port))
        } else {
          self.stop()
          promise.reject(ListenException())
        }
      case .failed, .cancelled:
        if !settled.done {
          settled.done = true
          promise.reject(ListenException())
        }
        self.stop()
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    listener.start(queue: queue)
  }

  func stop() {
    let listener = self.listener
    self.listener = nil
    token = ""
    listener?.newConnectionHandler = nil
    listener?.cancel()
    for peer in Array(peers.values) {
      if peer.phase == .webSocket {
        report(peer, code: 1001, reason: "")
        drop(peer, lastFrame: encodeFrame(opcode: 0x8, payload: closePayload(code: 1001, reason: "")))
      } else {
        drop(peer)
      }
    }
    for request in pending.values { request.timeout.cancel() }
    pending = [:]
    sockets = [:]
  }

  func respond(requestId: String, status: Int, headers: [String: String], bodyBase64: String) {
    guard let request = pending.removeValue(forKey: requestId) else { return }
    request.timeout.cancel()
    guard let body = Data(base64Encoded: bodyBase64) else {
      writeResponse(request.peer, status: 502, headers: [:], body: Data(), head: request.head)
      return
    }
    writeResponse(request.peer, status: status, headers: headers, body: body, head: request.head)
  }

  func socketSend(socketId: String, text: String?, binaryBase64: String?) {
    guard let peer = sockets[socketId], peer.phase == .webSocket else { return }
    if let text {
      sendFrame(peer, opcode: 0x1, payload: Array(text.utf8))
    } else if let binaryBase64, let data = Data(base64Encoded: binaryBase64) {
      sendFrame(peer, opcode: 0x2, payload: Array(data))
    }
  }

  func socketClose(socketId: String, code: Int, reason: String) {
    guard let peer = sockets[socketId] else { return }
    closeSocket(peer, code: sendableCloseCode(code), reason: truncated(reason, bytes: 123))
  }

  // MARK: - Connections

  private func accept(_ connection: NWConnection) {
    guard listener != nil, peers.count < maxPeers, isLoopback(connection.endpoint) else {
      connection.cancel()
      return
    }
    let peer = Peer(connection: connection)
    peers[peer.id] = peer
    connection.stateUpdateHandler = { [weak self, weak peer] state in
      guard let self, let peer else { return }
      switch state {
      case .failed, .cancelled:
        self.drop(peer)
      default:
        break
      }
    }
    connection.start(queue: queue)
    peer.deadline = schedule(readTimeout) { [weak self, weak peer] in
      guard let self, let peer, peer.phase == .head || peer.phase == .body else { return }
      // A browser can open a spare connection and send nothing on it.
      if peer.buffer.isEmpty && peer.phase == .head {
        self.drop(peer)
      } else {
        self.reject(peer, status: 408)
      }
    }
    receive(peer)
  }

  private func receive(_ peer: Peer) {
    peer.connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
      [weak self, weak peer] data, _, isComplete, error in
      guard let self, let peer, peer.phase != .closed else { return }
      if let data, !data.isEmpty {
        peer.buffer.append(contentsOf: data)
        self.process(peer)
      }
      if peer.phase == .closed { return }
      if error != nil || isComplete {
        self.drop(peer)
        return
      }
      switch peer.phase {
      case .head, .body, .webSocket, .closing:
        self.receive(peer)
      default:
        break
      }
    }
  }

  private func process(_ peer: Peer) {
    switch peer.phase {
    case .head:
      readHead(peer)
    case .body:
      readBody(peer)
    case .webSocket, .closing:
      readFrames(peer)
    default:
      break
    }
  }

  /// Ends the connection. A WebSocket that did not report its close yet reports 1006. A last frame goes
  /// out before the connection closes, or the connection closes after a short time.
  private func drop(_ peer: Peer, lastFrame: [UInt8]? = nil) {
    guard peer.phase != .closed else { return }
    peer.phase = .closed
    peer.deadline?.cancel()
    peer.deadline = nil
    peers[peer.id] = nil
    if let requestId = peer.requestId { pending.removeValue(forKey: requestId)?.timeout.cancel() }
    report(peer, code: 1006, reason: "")
    let connection = peer.connection
    connection.stateUpdateHandler = nil
    guard let lastFrame else { return connection.cancel() }
    connection.send(
      content: Data(lastFrame),
      contentContext: .finalMessage,
      isComplete: true,
      completion: .contentProcessed { _ in connection.cancel() }
    )
    queue.asyncAfter(deadline: .now() + closeTimeout) { connection.cancel() }
  }

  private func schedule(_ seconds: TimeInterval, _ work: @escaping () -> Void) -> DispatchWorkItem {
    let item = DispatchWorkItem(block: work)
    queue.asyncAfter(deadline: .now() + seconds, execute: item)
    return item
  }

  // MARK: - HTTP

  private func readHead(_ peer: Peer) {
    guard let end = headEnd(peer.buffer) else {
      if peer.buffer.count > maxHeadBytes { reject(peer, status: 431) }
      return
    }
    guard end <= maxHeadBytes else { return reject(peer, status: 431) }
    let head = String(bytes: peer.buffer[0..<end - 4], encoding: .isoLatin1) ?? ""
    peer.buffer.removeFirst(end)
    var lines = head.components(separatedBy: "\r\n")
    let requestLine = lines.removeFirst().split(separator: " ", omittingEmptySubsequences: false)
    guard requestLine.count == 3, requestLine[2] == "HTTP/1.1" || requestLine[2] == "HTTP/1.0" else {
      return reject(peer, status: 400)
    }
    peer.method = String(requestLine[0])
    peer.target = String(requestLine[1])
    var headers: [String: String] = [:]
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else { return reject(peer, status: 400) }
      let name = String(line[..<colon])
      guard isToken(name) else { return reject(peer, status: 400) }
      let value = line[line.index(after: colon)...].trimmingCharacters(in: CharacterSet(charactersIn: " \t"))
      let key = name.lowercased()
      headers[key] = headers[key].map { "\($0), \(value)" } ?? value
    }
    peer.headers = headers
    guard !token.isEmpty, peer.target.hasPrefix("/\(token)/") else { return reject(peer, status: 404) }
    guard methods.contains(peer.method) else { return reject(peer, status: 405) }
    guard headers["transfer-encoding"] == nil else { return reject(peer, status: 411) }
    if let upgrade = headers["upgrade"],
      upgrade.split(separator: ",").contains(where: {
        $0.trimmingCharacters(in: .whitespaces).lowercased() == "websocket"
      })
    {
      return upgradeSocket(peer)
    }
    if let value = headers["content-length"] {
      guard !value.isEmpty, value.count <= 9, value.allSatisfy({ $0.isASCII && $0.isNumber }),
        let length = Int(value)
      else {
        return reject(peer, status: 400)
      }
      guard length <= maxBodyBytes else { return reject(peer, status: 413) }
      peer.bodyLength = length
    }
    peer.phase = .body
    readBody(peer)
  }

  private func readBody(_ peer: Peer) {
    guard peer.buffer.count >= peer.bodyLength else { return }
    let body = Data(peer.buffer[0..<peer.bodyLength])
    peer.buffer = []
    peer.phase = .waiting
    peer.deadline?.cancel()
    peer.deadline = nil
    let requestId = UUID().uuidString
    peer.requestId = requestId
    let timeout = schedule(responseTimeout) { [weak self] in
      guard let self, let request = self.pending.removeValue(forKey: requestId) else { return }
      self.writeResponse(request.peer, status: 504, headers: [:], body: Data(), head: request.head)
    }
    pending[requestId] = Pending(peer: peer, head: peer.method == "HEAD", timeout: timeout)
    emit("onRequest", [
      "requestId": requestId,
      "method": peer.method,
      "target": peer.target,
      "headers": peer.headers,
      "bodyBase64": body.base64EncodedString()
    ])
  }

  private func reject(_ peer: Peer, status: Int, headers: [String: String] = [:]) {
    writeResponse(peer, status: status, headers: headers, body: Data(), head: false)
  }

  /// Sends one response and closes the connection.
  private func writeResponse(_ peer: Peer, status: Int, headers: [String: String], body: Data, head: Bool) {
    guard peer.phase != .closed, peer.phase != .responding else { return }
    peer.phase = .responding
    peer.deadline?.cancel()
    peer.deadline = nil
    let status = (200...599).contains(status) ? status : 502
    var lines = ["HTTP/1.1 \(status) \(reasonPhrase(status))"]
    var cacheControl = false
    for (name, value) in headers.sorted(by: { $0.key < $1.key }) {
      let key = name.lowercased()
      guard !ownedHeaders.contains(key), isToken(name),
        !value.unicodeScalars.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" })
      else { continue }
      if key == "cache-control" { cacheControl = true }
      lines.append("\(name): \(value)")
    }
    if !cacheControl { lines.append("Cache-Control: no-store") }
    let bodyless = status == 204 || status == 304
    if !bodyless { lines.append("Content-Length: \(body.count)") }
    lines.append("Connection: close")
    var data = Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
    if !head && !bodyless { data.append(body) }
    peer.connection.send(
      content: data,
      contentContext: .finalMessage,
      isComplete: true,
      completion: .contentProcessed { [weak self, weak peer] _ in
        guard let self, let peer else { return }
        self.drop(peer)
      }
    )
  }

  // MARK: - WebSocket

  private func upgradeSocket(_ peer: Peer) {
    guard peer.method == "GET", let key = peer.headers["sec-websocket-key"],
      Data(base64Encoded: key)?.count == 16
    else {
      return reject(peer, status: 400)
    }
    guard peer.headers["sec-websocket-version"] == "13" else {
      return reject(peer, status: 426, headers: ["Sec-WebSocket-Version": "13"])
    }
    let accept = Data(Insecure.SHA1.hash(data: Data((key + webSocketGuid).utf8))).base64EncodedString()
    var lines = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Accept: \(accept)"
    ]
    if let first = peer.headers["sec-websocket-protocol"]?.split(separator: ",").first?
      .trimmingCharacters(in: .whitespaces), isToken(first)
    {
      lines.append("Sec-WebSocket-Protocol: \(first)")
    }
    peer.phase = .upgrading
    peer.deadline?.cancel()
    peer.deadline = nil
    let data = Data((lines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
    peer.connection.send(content: data, completion: .contentProcessed { [weak self, weak peer] error in
      guard let self, let peer, peer.phase == .upgrading else { return }
      guard error == nil else { return self.drop(peer) }
      let socketId = UUID().uuidString
      peer.socketId = socketId
      peer.phase = .webSocket
      self.sockets[socketId] = peer
      self.emit("onSocketOpen", ["socketId": socketId, "target": peer.target])
      // The page can send frames before it reads the 101.
      self.readFrames(peer)
      if peer.phase == .webSocket || peer.phase == .closing { self.receive(peer) }
    })
  }

  private func readFrames(_ peer: Peer) {
    var start = 0
    defer {
      if start > 0 { peer.buffer.removeFirst(min(start, peer.buffer.count)) }
    }
    while peer.phase == .webSocket || peer.phase == .closing {
      let available = peer.buffer.count - start
      guard available >= 2 else { return }
      let first = peer.buffer[start]
      let second = peer.buffer[start + 1]
      let fin = first & 0x80 != 0
      let opcode = first & 0x0F
      guard first & 0x70 == 0, second & 0x80 != 0 else { return fail(peer, code: 1002) }
      var length = Int(second & 0x7F)
      var offset = 2
      if length == 126 {
        guard available >= 4 else { return }
        length = Int(peer.buffer[start + 2]) << 8 | Int(peer.buffer[start + 3])
        offset = 4
      } else if length == 127 {
        guard available >= 10 else { return }
        var value: UInt64 = 0
        for index in 2..<10 { value = value << 8 | UInt64(peer.buffer[start + index]) }
        guard value <= UInt64(maxMessageBytes) else { return fail(peer, code: 1009) }
        length = Int(value)
        offset = 10
      }
      if opcode & 0x08 != 0, !fin || length > 125 { return fail(peer, code: 1002) }
      guard length <= maxMessageBytes else { return fail(peer, code: 1009) }
      guard available >= offset + 4 + length else { return }
      let maskStart = start + offset
      let mask = [
        peer.buffer[maskStart], peer.buffer[maskStart + 1], peer.buffer[maskStart + 2], peer.buffer[maskStart + 3]
      ]
      var payload = Array(peer.buffer[maskStart + 4..<maskStart + 4 + length])
      for index in payload.indices { payload[index] ^= mask[index & 3] }
      start = maskStart + 4 + length
      handleFrame(peer, opcode: opcode, fin: fin, payload: payload)
    }
  }

  private func handleFrame(_ peer: Peer, opcode: UInt8, fin: Bool, payload: [UInt8]) {
    switch opcode {
    case 0x0:
      guard peer.fragmentOpcode != 0 else { return fail(peer, code: 1002) }
      guard peer.fragments.count + payload.count <= maxMessageBytes else { return fail(peer, code: 1009) }
      peer.fragments.append(contentsOf: payload)
      if fin {
        let opcode = peer.fragmentOpcode
        let message = peer.fragments
        peer.fragmentOpcode = 0
        peer.fragments = []
        deliver(peer, opcode: opcode, message: message)
      }
    case 0x1, 0x2:
      guard peer.fragmentOpcode == 0 else { return fail(peer, code: 1002) }
      if fin {
        deliver(peer, opcode: opcode, message: payload)
      } else {
        peer.fragmentOpcode = opcode
        peer.fragments = payload
      }
    case 0x8:
      closeReceived(peer, payload: payload)
    case 0x9:
      if peer.phase == .webSocket { sendFrame(peer, opcode: 0xA, payload: payload) }
    case 0xA:
      break
    default:
      fail(peer, code: 1002)
    }
  }

  private func deliver(_ peer: Peer, opcode: UInt8, message: [UInt8]) {
    guard peer.phase == .webSocket, let socketId = peer.socketId else { return }
    if opcode == 0x1 {
      guard let text = String(data: Data(message), encoding: .utf8) else { return fail(peer, code: 1007) }
      emit("onSocketMessage", ["socketId": socketId, "text": text])
    } else {
      emit("onSocketMessage", ["socketId": socketId, "binaryBase64": Data(message).base64EncodedString()])
    }
  }

  private func closeReceived(_ peer: Peer, payload: [UInt8]) {
    // The page answered the close that the server sent.
    if peer.phase == .closing { return drop(peer) }
    var code = 1005
    var reason = ""
    if payload.count == 1 { return fail(peer, code: 1002) }
    if payload.count >= 2 {
      code = Int(payload[0]) << 8 | Int(payload[1])
      guard validCloseCode(code) else { return fail(peer, code: 1002) }
      guard let text = String(data: Data(payload[2...]), encoding: .utf8) else { return fail(peer, code: 1007) }
      reason = text
    }
    report(peer, code: code, reason: reason)
    peer.phase = .closing
    let echo = closePayload(code: code == 1005 ? 1000 : code, reason: "")
    sendFrame(peer, opcode: 0x8, payload: echo) { [weak self, weak peer] _ in
      guard let self, let peer else { return }
      self.drop(peer)
    }
  }

  /// A frame that breaks the protocol ends the socket at once.
  private func fail(_ peer: Peer, code: Int) {
    if peer.phase == .closing { return drop(peer) }
    closeSocket(peer, code: code, reason: "", wait: false)
  }

  /// Reports the close once, sends a close frame, and ends the connection after the page answers or after
  /// a short time.
  private func closeSocket(_ peer: Peer, code: Int, reason: String, wait: Bool = true) {
    guard peer.phase == .webSocket else { return }
    report(peer, code: code, reason: reason)
    peer.phase = .closing
    sendFrame(peer, opcode: 0x8, payload: closePayload(code: code, reason: reason)) { [weak self, weak peer] error in
      guard let self, let peer, error != nil || !wait else { return }
      self.drop(peer)
    }
    peer.deadline?.cancel()
    peer.deadline = schedule(closeTimeout) { [weak self, weak peer] in
      guard let self, let peer else { return }
      self.drop(peer)
    }
  }

  private func report(_ peer: Peer, code: Int, reason: String) {
    guard let socketId = peer.socketId, sockets[socketId] === peer else { return }
    sockets[socketId] = nil
    emit("onSocketClose", ["socketId": socketId, "code": code, "reason": reason])
  }

  private func sendFrame(
    _ peer: Peer,
    opcode: UInt8,
    payload: [UInt8],
    completion: ((NWError?) -> Void)? = nil
  ) {
    guard peer.phase != .closed else { return }
    let frame = encodeFrame(opcode: opcode, payload: payload)
    peer.connection.send(content: Data(frame), completion: .contentProcessed { [weak self, weak peer] error in
      if let completion {
        completion(error)
      } else if error != nil, let self, let peer {
        self.drop(peer)
      }
    })
  }
}

// MARK: - Helpers

private func isLoopback(_ endpoint: NWEndpoint) -> Bool {
  guard case let .hostPort(host, _) = endpoint else { return false }
  switch host {
  case let .ipv4(address):
    return address.isLoopback
  case let .ipv6(address):
    return address.isLoopback || address.asIPv4?.isLoopback == true
  default:
    return false
  }
}

/// The index after the first empty line, or nil.
private func headEnd(_ bytes: [UInt8]) -> Int? {
  guard bytes.count >= 4 else { return nil }
  for index in 0...(bytes.count - 4)
  where bytes[index] == 13 && bytes[index + 1] == 10 && bytes[index + 2] == 13 && bytes[index + 3] == 10 {
    return index + 4
  }
  return nil
}

/// An HTTP token, such as a header name.
private func isToken<S: StringProtocol>(_ value: S) -> Bool {
  !value.isEmpty
    && value.unicodeScalars.allSatisfy { scalar in
      scalar.isASCII
        && (CharacterSet.alphanumerics.contains(scalar) || "!#$%&'*+-.^_`|~".unicodeScalars.contains(scalar))
    }
}

private func validCloseCode(_ code: Int) -> Bool {
  (1000...1014).contains(code) && code != 1004 && code != 1005 && code != 1006 || (3000...4999).contains(code)
}

/// The same rule as the desktop proxy: a reserved code cannot cross the socket, and an abnormal close stays a failure.
private func sendableCloseCode(_ code: Int) -> Int {
  if code == 1005 { return 1000 }
  return validCloseCode(code) ? code : 1011
}

/// One unmasked server frame with the FIN bit.
private func encodeFrame(opcode: UInt8, payload: [UInt8]) -> [UInt8] {
  var frame: [UInt8] = [0x80 | opcode]
  let count = payload.count
  if count < 126 {
    frame.append(UInt8(count))
  } else if count <= 0xFFFF {
    frame.append(126)
    frame.append(UInt8(count >> 8))
    frame.append(UInt8(count & 0xFF))
  } else {
    frame.append(127)
    for shift in stride(from: 56, through: 0, by: -8) { frame.append(UInt8((UInt64(count) >> UInt64(shift)) & 0xFF)) }
  }
  frame.append(contentsOf: payload)
  return frame
}

private func closePayload(code: Int, reason: String) -> [UInt8] {
  [UInt8((code >> 8) & 0xFF), UInt8(code & 0xFF)] + Array(reason.utf8)
}

/// Cuts the text at a character boundary so that its UTF-8 form has at most `bytes` bytes.
private func truncated(_ text: String, bytes: Int) -> String {
  var result = String.UnicodeScalarView()
  var count = 0
  for scalar in text.unicodeScalars {
    let size = String(scalar).utf8.count
    if count + size > bytes { break }
    count += size
    result.append(scalar)
  }
  return String(result)
}

private func reasonPhrase(_ status: Int) -> String {
  switch status {
  case 200: return "OK"
  case 201: return "Created"
  case 204: return "No Content"
  case 206: return "Partial Content"
  case 301: return "Moved Permanently"
  case 302: return "Found"
  case 304: return "Not Modified"
  case 400: return "Bad Request"
  case 401: return "Unauthorized"
  case 403: return "Forbidden"
  case 404: return "Not Found"
  case 405: return "Method Not Allowed"
  case 408: return "Request Timeout"
  case 411: return "Length Required"
  case 413: return "Content Too Large"
  case 426: return "Upgrade Required"
  case 431: return "Request Header Fields Too Large"
  case 500: return "Internal Server Error"
  case 502: return "Bad Gateway"
  case 503: return "Service Unavailable"
  case 504: return "Gateway Timeout"
  default: return "Status"
  }
}

public class RemoteViewerProxyModule: Module {
  private let queue = DispatchQueue(label: "run.openbot.remoteviewerproxy", qos: .userInitiated)
  /// Only `queue` creates and uses it.
  private lazy var server = RemoteViewerServer(queue: queue) { [weak self] name, body in
    self?.sendEvent(name, body)
  }

  public func definition() -> ModuleDefinition {
    Name("OpenBotRemoteViewerProxy")

    Events("onRequest", "onSocketOpen", "onSocketMessage", "onSocketClose")

    /// Stops an earlier server, then listens on 127.0.0.1 on a free port, and returns the port.
    AsyncFunction("start") { (token: String, promise: Promise) in
      self.server.start(token: token, promise: promise)
    }
    .runOnQueue(queue)

    /// Closes the listener, every connection and every socket.
    AsyncFunction("stop") {
      self.server.stop()
    }
    .runOnQueue(queue)

    AsyncFunction("respond") { (requestId: String, status: Int, headers: [String: String], bodyBase64: String) in
      self.server.respond(requestId: requestId, status: status, headers: headers, bodyBase64: bodyBase64)
    }
    .runOnQueue(queue)

    AsyncFunction("socketSend") { (socketId: String, text: String?, binaryBase64: String?) in
      self.server.socketSend(socketId: socketId, text: text, binaryBase64: binaryBase64)
    }
    .runOnQueue(queue)

    AsyncFunction("socketClose") { (socketId: String, code: Int, reason: String) in
      self.server.socketClose(socketId: socketId, code: code, reason: reason)
    }
    .runOnQueue(queue)

    /// Android only. iOS has no flag that keeps a view out of screenshots.
    AsyncFunction("setSecure") { (_: Bool) in }

    OnDestroy {
      self.queue.sync { self.server.stop() }
    }
  }
}
