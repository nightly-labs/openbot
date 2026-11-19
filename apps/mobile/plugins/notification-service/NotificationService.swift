import CryptoKit
import Foundation
import Intents
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    self.contentHandler = contentHandler
    bestAttempt = content
    var userInfo = content.userInfo
    let sealed = userInfo.removeValue(forKey: "sealed") as? String
    content.userInfo = userInfo
    if let sealed, let notification = SealedNotification.open(sealed) {
      content.title = notification.title
      content.body = notification.body
      if let serverName = notification.serverName { content.subtitle = serverName }
      content.threadIdentifier = "\(notification.serverId)/\(notification.agentId)"
      let data: [String: Any] = [
        "serverId": notification.serverId,
        "agentId": notification.agentId,
        "threadId": notification.threadId as Any? ?? NSNull(),
        "kind": notification.kind,
      ]
      userInfo["body"] = data
      content.userInfo = userInfo
      if let sender = AgentSender.content(content, for: notification) {
        contentHandler(sender)
        self.contentHandler = nil
        return
      }
    }
    contentHandler(content)
    self.contentHandler = nil
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let bestAttempt { contentHandler(bestAttempt) }
    contentHandler = nil
  }
}

enum AgentSender {
  private static let directoryFile = "share-extension.json"
  private static let avatarFolder = "share-extension-avatars"

  static func content(_ content: UNMutableNotificationContent, for notification: OpenedNotification) -> UNNotificationContent? {
    guard let image = picture(serverId: notification.serverId, agentId: notification.agentId) else { return nil }
    let conversationId = "\(notification.serverId)/\(notification.agentId)"
    let sender = INPerson(
      personHandle: INPersonHandle(value: conversationId, type: .unknown),
      nameComponents: nil,
      displayName: content.title,
      image: image,
      contactIdentifier: nil,
      customIdentifier: conversationId
    )
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: nil,
      speakableGroupName: nil,
      conversationIdentifier: conversationId,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.groupIdentifier = conversationId
    interaction.donate(completion: nil)
    return try? content.updating(from: intent)
  }

  private static func picture(serverId: String, agentId: String) -> INImage? {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "OpenBotAppGroup") as? String,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
      let data = try? Data(contentsOf: container.appendingPathComponent(directoryFile)),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      json["version"] as? Int == 1,
      let agents = json["agents"] as? [[String: Any]],
      let agent = agents.first(where: { $0["serverId"] as? String == serverId && $0["id"] as? String == agentId }),
      let name = agent["avatar"] as? String,
      !name.contains("/"),
      let image = try? Data(contentsOf: container.appendingPathComponent(avatarFolder).appendingPathComponent(name))
    else { return nil }
    return INImage(imageData: image)
  }
}

struct OpenedNotification {
  let serverId: String
  let agentId: String
  let threadId: String?
  let kind: String
  let title: String
  let body: String
  let serverName: String?
}

enum SealedNotification {
  private static let nonceBytes = 16
  private static let tagBytes = 16
  private static let blockBytes = 32
  private static let keysFile = "push-notifications.json"

  static func open(_ sealed: String) -> OpenedNotification? {
    let servers = loadServers()
    guard let bytes = decodeBase64URL(sealed), bytes.count > nonceBytes + tagBytes else { return nil }
    let body = Array(bytes[0..<(bytes.count - tagBytes)])
    let tag = Array(bytes[(bytes.count - tagBytes)...])
    let nonce = Array(body[0..<nonceBytes])
    let cipher = Array(body[nonceBytes...])
    for server in servers {
      let expected = Array(HMAC<SHA256>.authenticationCode(for: body, using: server.tag)).prefix(tagBytes)
      guard constantTimeEqual(Array(expected), tag) else { continue }
      var plain = [UInt8]()
      plain.reserveCapacity(cipher.count)
      var counter: UInt32 = 0
      var offset = 0
      while offset < cipher.count {
        let block = nonce + withUnsafeBytes(of: counter.bigEndian) { Array($0) }
        let stream = Array(HMAC<SHA256>.authenticationCode(for: block, using: server.seal))
        for index in 0..<min(blockBytes, cipher.count - offset) {
          plain.append(cipher[offset + index] ^ stream[index])
        }
        offset += blockBytes
        counter += 1
      }
      guard
        let json = try? JSONSerialization.jsonObject(with: Data(plain)) as? [String: Any],
        json["serverId"] as? String == server.serverId,
        let agentId = json["agentId"] as? String,
        let kind = json["kind"] as? String,
        let title = json["title"] as? String,
        let text = json["body"] as? String
      else { return nil }
      return OpenedNotification(
        serverId: server.serverId,
        agentId: agentId,
        threadId: json["threadId"] as? String,
        kind: kind,
        title: title,
        body: text,
        serverName: servers.count > 1 ? server.name : nil
      )
    }
    return nil
  }

  private struct ServerKeys {
    let serverId: String
    let name: String
    let seal: SymmetricKey
    let tag: SymmetricKey
  }

  private static func loadServers() -> [ServerKeys] {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "OpenBotAppGroup") as? String,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
      let data = try? Data(contentsOf: container.appendingPathComponent(keysFile)),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      json["version"] as? Int == 1,
      let servers = json["servers"] as? [[String: Any]]
    else { return [] }
    return servers.compactMap { server in
      guard
        let serverId = server["serverId"] as? String,
        let name = server["name"] as? String,
        let seal = (server["seal"] as? String).flatMap(decodeBase64URL),
        let tag = (server["tag"] as? String).flatMap(decodeBase64URL)
      else { return nil }
      return ServerKeys(serverId: serverId, name: name, seal: SymmetricKey(data: seal), tag: SymmetricKey(data: tag))
    }
  }

  private static func decodeBase64URL(_ value: String) -> [UInt8]? {
    var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64.append("=") }
    return Data(base64Encoded: base64).map { Array($0) }
  }

  private static func constantTimeEqual(_ left: [UInt8], _ right: [UInt8]) -> Bool {
    guard left.count == right.count else { return false }
    var difference: UInt8 = 0
    for index in 0..<left.count { difference |= left[index] ^ right[index] }
    return difference == 0
  }
}
