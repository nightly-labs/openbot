import CryptoKit
import Foundation
import Intents
import UserNotifications

/// Opens a notification that an OpenBot host sealed, before iOS shows it. The host sends the agent
/// name and the text through the OpenBot relay and Apple, sealed with keys that only this phone and
/// the host know, so the relay and Apple see the app name only. The app writes the keys of each
/// server into the App Group (`push-notification-keys.ts`). A notification that no key opens keeps
/// the app name, so a host credential alone cannot make the phone show its own text.
///
/// The seal is the one of `live-activity-seal.ts` in `@openbot/team-client`: a keystream of
/// HMAC-SHA256 blocks over a 16-byte nonce and a 32-bit counter, then a 16-byte HMAC-SHA256 tag
/// over the nonce and the ciphertext, as base64url.
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
      // iOS groups the notifications of one chat.
      content.threadIdentifier = "\(notification.serverId)/\(notification.agentId)"
      // `expo-notifications` gives the app this dictionary as the notification data.
      let data: [String: Any] = [
        "serverId": notification.serverId,
        "agentId": notification.agentId,
        "threadId": notification.threadId as Any? ?? NSNull(),
        "kind": notification.kind,
      ]
      userInfo["body"] = data
      content.userInfo = userInfo
      // The agent picture takes the place of the app icon. Without a picture, iOS shows the content as before.
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

/// Makes an agent notification a communication notification, with the agent as the sender, so iOS and
/// a paired Apple Watch show the agent picture in place of the app icon. The picture is the one of the
/// share extension: the app writes the agents and their pictures into the App Group
/// (`share-extension.ts`). The title, the text and the data of the notification do not change.
enum AgentSender {
  private static let directoryFile = "share-extension.json"
  private static let avatarFolder = "share-extension-avatars"

  static func content(_ content: UNMutableNotificationContent, for notification: OpenedNotification) -> UNNotificationContent? {
    guard let image = picture(serverId: notification.serverId, agentId: notification.agentId) else { return nil }
    // The ID of the agent's share suggestion, as the app donates it.
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
      // The donation keeps no message text. The notification shows the text of `content`.
      content: nil,
      speakableGroupName: nil,
      conversationIdentifier: conversationId,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    // The app removes the suggestions of an agent by this group (`ShareExtensionModule.swift`).
    interaction.groupIdentifier = conversationId
    interaction.donate(completion: nil)
    // Fails without the Communication Notifications entitlement.
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
      // The file names a picture in the folder only.
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
  /// Set when the phone has more than one server, so the notification says which one it is.
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
        // A host seals with the keys of its own server only, so it cannot speak for another one.
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
