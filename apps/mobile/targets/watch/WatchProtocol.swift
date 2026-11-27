import Foundation

let watchProtocolVersion = 1

let watchProtocolKey = "openbot"

enum WatchAgentState: String, Codable, Hashable {
  case waiting
  case working
  case idle
}

struct WatchApprovalWait: Codable, Hashable {
  var requestId: String
  var title: String
  var body: String
  var location: String?
  var why: String?
  var whole: Bool

  enum CodingKeys: String, CodingKey {
    case requestId, title, body, why, whole
    case location = "where"
  }
}

struct WatchQuestion: Codable, Hashable, Identifiable {
  var id: String
  var header: String
  var question: String
  var options: [String]
  var multiSelect: Bool
}

struct WatchQuestionWait: Codable, Hashable {
  var requestId: String
  var questions: [WatchQuestion]
}

enum WatchPhoneReason: String, Codable, Hashable {
  case question
  case approval
  case takeover
}

enum WatchWait: Codable, Hashable {
  case approval(WatchApprovalWait)
  case question(WatchQuestionWait)
  case phone(WatchPhoneReason, text: String?)
  case unknown

  private enum CodingKeys: String, CodingKey {
    case kind, reason, text
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(String.self, forKey: .kind) {
    case "approval":
      self = .approval(try WatchApprovalWait(from: decoder))
    case "question":
      self = .question(try WatchQuestionWait(from: decoder))
    case "phone":
      let reason = try? container.decode(WatchPhoneReason.self, forKey: .reason)
      let text = try? container.decodeIfPresent(String.self, forKey: .text)
      self = reason.map { .phone($0, text: text ?? nil) } ?? .unknown
    default:
      self = .unknown
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .approval(let wait):
      try container.encode("approval", forKey: .kind)
      try wait.encode(to: encoder)
    case .question(let wait):
      try container.encode("question", forKey: .kind)
      try wait.encode(to: encoder)
    case .phone(let reason, let text):
      try container.encode("phone", forKey: .kind)
      try container.encode(reason, forKey: .reason)
      try container.encodeIfPresent(text, forKey: .text)
    case .unknown:
      try container.encode("unknown", forKey: .kind)
    }
  }
}

struct AgentKey: Hashable {
  var serverId: String
  var id: String
}

struct WatchChannel: Codable, Hashable, Identifiable {
  var serverId: String
  var id: String
  var name: String
  var server: String
  var color: String
  var members: [String]
  var pinned: Bool?
  var folder: String?
  var position: Int?
  var unread: Int?
  var working: Bool?
  var updated: String?
  var author: String?
  var reply: String?

  var key: AgentKey { AgentKey(serverId: serverId, id: id) }
  var isWorking: Bool { working ?? false }
  var isPinned: Bool { pinned ?? false }
  var message: String? {
    guard let reply else { return nil }
    guard let author, !author.isEmpty else { return reply }
    return "\(author): \(reply)"
  }
}

struct WatchFaces: Codable, Hashable {
  var waiting: String?
  var working: String?
}

struct WatchAgent: Codable, Hashable, Identifiable {
  var serverId: String
  var id: String
  var name: String
  var server: String
  var color: String
  var avatar: String?
  var faces: WatchFaces?
  var pinned: Bool?
  var folder: String?
  var position: Int?
  var unread: Int?
  var state: WatchAgentState
  var detail: String?
  var updated: String?
  var updatedAt: Double?
  var turnId: String?
  var reply: String?
  var wait: WatchWait?

  var key: AgentKey { AgentKey(serverId: serverId, id: id) }
  var isPinned: Bool { pinned ?? false }
  var isBusy: Bool { state != .idle || wait != nil }
  var face: String? {
    switch state {
    case .waiting: return faces?.waiting
    case .working: return faces?.working
    case .idle: return nil
    }
  }
  var pictureNames: [String] { [avatar, faces?.waiting, faces?.working].compactMap { $0 } }
}

struct WatchServer: Codable, Hashable {
  var id: String
  var name: String
  var online: Bool
  var color: String?
  var shape: String?
  var picture: String?
  var watchKey: String?
  var hiddenAgents: [String]?
  var hiddenChannels: [String]?
}

struct WatchDirectServer: Codable, Hashable {
  var serverId: String
  var hostId: String
  var watchKey: String
}

struct WatchDirectCredentials: Codable, Hashable {
  var account: String?
  var authUrl: String
  var watchSessionId: String
  var token: String
  var expiresAt: Double
  var servers: [WatchDirectServer]
}

struct WatchReadySnapshot: Codable, Hashable {
  var version: Int
  var generatedAt: Double
  var account: String?
  var live: Bool
  var paused: Bool?
  var accent: String
  var language: String
  var text: [String: String]
  var servers: [WatchServer]
  var agents: [WatchAgent]
  var channels: [WatchChannel]?
}

struct WatchLockedSnapshot: Codable, Hashable {
  var version: Int
  var generatedAt: Double
  var text: [String: String]
}

enum WatchSnapshot: Codable, Hashable {
  case ready(WatchReadySnapshot)
  case locked(WatchLockedSnapshot)
  case signedOut(generatedAt: Double)

  private enum CodingKeys: String, CodingKey {
    case version, state, generatedAt
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let version = try container.decode(Int.self, forKey: .version)
    guard version == watchProtocolVersion else {
      throw DecodingError.dataCorruptedError(
        forKey: .version, in: container, debugDescription: "Unknown protocol version")
    }
    switch try container.decode(String.self, forKey: .state) {
    case "ready":
      self = .ready(try WatchReadySnapshot(from: decoder))
    case "locked":
      self = .locked(try WatchLockedSnapshot(from: decoder))
    case "signedOut":
      self = .signedOut(generatedAt: try container.decode(Double.self, forKey: .generatedAt))
    default:
      throw DecodingError.dataCorruptedError(
        forKey: .state, in: container, debugDescription: "Unknown snapshot state")
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .ready(let snapshot):
      try snapshot.encode(to: encoder)
      try container.encode("ready", forKey: .state)
    case .locked(let snapshot):
      try snapshot.encode(to: encoder)
      try container.encode("locked", forKey: .state)
    case .signedOut(let generatedAt):
      try container.encode(watchProtocolVersion, forKey: .version)
      try container.encode("signedOut", forKey: .state)
      try container.encode(generatedAt, forKey: .generatedAt)
    }
  }

  var generatedAt: Double {
    switch self {
    case .ready(let snapshot): return snapshot.generatedAt
    case .locked(let snapshot): return snapshot.generatedAt
    case .signedOut(let generatedAt): return generatedAt
    }
  }

  static func decode(json: String) -> WatchSnapshot? {
    guard let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(WatchSnapshot.self, from: data)
  }
}

enum WatchCommand: Encodable, Hashable {
  case refresh(language: String?)
  case pair(publicKey: String)
  case avatars(names: [String])
  case approve(serverId: String, agentId: String, requestId: String)
  case deny(serverId: String, agentId: String, requestId: String)
  case answer(serverId: String, agentId: String, requestId: String, answers: [String: [String]])
  case send(serverId: String, agentId: String, text: String, messageId: String)
  case stop(serverId: String, agentId: String, turnId: String)
  case open(serverId: String, agentId: String)
  case read(serverId: String, agentId: String)
  case sendChannel(serverId: String, channelId: String, text: String, messageId: String)
  case readChannel(serverId: String, channelId: String)
  case widgetPush(token: String, environment: String)

  private enum CodingKeys: String, CodingKey {
    case type, serverId, agentId, channelId, requestId, answers, text, turnId, messageId, names, language, publicKey
    case token, environment
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .refresh(let language):
      try container.encode("refresh", forKey: .type)
      try container.encodeIfPresent(language, forKey: .language)
    case .pair(let publicKey):
      try container.encode("pair", forKey: .type)
      try container.encode(publicKey, forKey: .publicKey)
    case .avatars(let names):
      try container.encode("avatars", forKey: .type)
      try container.encode(names, forKey: .names)
    case .approve(let serverId, let agentId, let requestId):
      try container.encode("approve", forKey: .type)
      try container.encode(serverId, forKey: .serverId)
      try container.encode(agentId, forKey: .agentId)
      try container.encode(requestId, forKey: .requestId)
    case .deny(let serverId, let agentId, let requestId):
      try container.encode("deny", forKey: .type)
      try container.encode(serverId, forKey: .serverId)
      try container.encode(agentId, forKey: .agentId)
      try container.encode(requestId, forKey: .requestId)
    case .answer(let serverId, let agentId, let requestId, let answers):
      try container.encode("answer", forKey: .type)
      try container.encode(serverId, forKey: .serverId)
      try container.encode(agentId, forKey: .agentId)
      try container.encode(requestId, forKey: .requestId)
      try container.encode(answers, forKey: .answers)
    case .send(let serverId, let agentId, let text, let messageId):
      try container.encode("send", forKey: .type)
      try container.encode(serverId, forKey: .serverId)
      try container.encode(agentId, forKey: .agentId)
      try container.encode(text, forKey: .text)
      try container.encode(messageId, forKey: .messageId)
    case .stop(let serverId, let agentId, let turnId):
      try container.encode("stop", forKey: .type)
      try container.encode(serverId, forKey: .serverId)
      try container.encode(agentId, forKey: .agentId)
      try container.encode(turnId, forKey: .turnId)
    case .open(let serverId, let agentId):
      try container.encode("open", forKey: .type)
      try container.encode(serverId, forKey: .serverId)
      try container.encode(agentId, forKey: .agentId)
    case .read(let serverId, let agentId):
      try container.encode("read", forKey: .type)
      try container.encode(serverId, forKey: .serverId)
      try container.encode(agentId, forKey: .agentId)
    case .sendChannel(let serverId, let channelId, let text, let messageId):
      try container.encode("sendChannel", forKey: .type)
      try container.encode(serverId, forKey: .serverId)
      try container.encode(channelId, forKey: .channelId)
      try container.encode(text, forKey: .text)
      try container.encode(messageId, forKey: .messageId)
    case .readChannel(let serverId, let channelId):
      try container.encode("readChannel", forKey: .type)
      try container.encode(serverId, forKey: .serverId)
      try container.encode(channelId, forKey: .channelId)
    case .widgetPush(let token, let environment):
      try container.encode("widgetPush", forKey: .type)
      try container.encode(token, forKey: .token)
      try container.encode(environment, forKey: .environment)
    }
  }

  func json() -> String? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .withoutEscapingSlashes
    guard let data = try? encoder.encode(self) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  var serverId: String? {
    switch self {
    case .refresh, .pair, .avatars, .widgetPush: return nil
    case .approve(let serverId, _, _), .deny(let serverId, _, _), .answer(let serverId, _, _, _),
      .send(let serverId, _, _, _), .stop(let serverId, _, _), .open(let serverId, _), .read(let serverId, _),
      .sendChannel(let serverId, _, _, _), .readChannel(let serverId, _):
      return serverId
    }
  }

  var channelKey: AgentKey? {
    switch self {
    case .sendChannel(let serverId, let channelId, _, _), .readChannel(let serverId, let channelId):
      return AgentKey(serverId: serverId, id: channelId)
    default:
      return nil
    }
  }

  var agentKey: AgentKey? {
    switch self {
    case .refresh, .pair, .avatars, .sendChannel, .readChannel, .widgetPush: return nil
    case .approve(let serverId, let agentId, _), .deny(let serverId, let agentId, _),
      .answer(let serverId, let agentId, _, _), .send(let serverId, let agentId, _, _),
      .stop(let serverId, let agentId, _), .open(let serverId, let agentId), .read(let serverId, let agentId):
      return AgentKey(serverId: serverId, id: agentId)
    }
  }
}

enum WatchErrorCode: String, Codable, Hashable {
  case inactive
  case offline
  case locked
  case failed
  case timeout
  case asleep
}

struct WatchResult: Codable, Hashable {
  var ok: Bool
  var error: WatchErrorCode?
  var message: String?
  var snapshot: String?
  var avatars: [String: String]?
  var direct: WatchDirectCredentials?

  private enum CodingKeys: String, CodingKey {
    case ok, error, message, snapshot, avatars, direct
  }

  init(ok: Bool, error: WatchErrorCode? = nil, message: String? = nil, snapshot: String? = nil) {
    self.ok = ok
    self.error = error
    self.message = message
    self.snapshot = snapshot
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    ok = try container.decode(Bool.self, forKey: .ok)
    message = try container.decodeIfPresent(String.self, forKey: .message)
    snapshot = try container.decodeIfPresent(String.self, forKey: .snapshot)
    avatars = try container.decodeIfPresent([String: String].self, forKey: .avatars)
    direct = try? container.decodeIfPresent(WatchDirectCredentials.self, forKey: .direct)
    if ok {
      error = nil
    } else {
      let code = try container.decodeIfPresent(String.self, forKey: .error)
      error = code.flatMap(WatchErrorCode.init(rawValue:)) ?? .failed
    }
  }

  static func decode(json: String) -> WatchResult? {
    guard let data = json.data(using: .utf8) else { return nil }
    return decode(data: data)
  }

  static func decode(data: Data) -> WatchResult? {
    try? JSONDecoder().decode(WatchResult.self, from: data)
  }
}
