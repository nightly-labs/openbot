import ExpoModulesCore
import Intents
import Security

/// The agent of a share suggestion. `conversationId` is `<server ID>/<agent ID>`, which the share
/// extension reads from the intent of the suggestion that the user taps.
struct ShareTargetRecord: Record {
  @Field var conversationId: String = ""
  @Field var agentName: String = ""
  /// The agent's picture in the App Group, as a `file://` URI. The suggestion shows it.
  @Field var avatarUri: String? = nil
}

final class ShareKeychainException: GenericException<OSStatus> {
  override var reason: String {
    "The share session could not be saved (\(param))"
  }
}

/// The keychain item that the share extension reads to send without the app. Only the app and its
/// extension share the access group, the item opens after the first unlock, and it stays on this
/// device. `plugins/with-share-target.js` names the group in both Info.plist files.
enum ShareKeychain {
  static let service = "openbot.share-extension"
  static let account = "session"

  static var accessGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "OpenBotShareKeychainGroup") as? String
  }

  static func write(_ value: String?) throws {
    // A build without the extension has no shared group, so there is nothing to give.
    guard let accessGroup, !accessGroup.hasPrefix("$(") else { return }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
    ]
    let deleted = SecItemDelete(query as CFDictionary)
    guard deleted == errSecSuccess || deleted == errSecItemNotFound else {
      throw ShareKeychainException(deleted)
    }
    guard let value else { return }
    var item = query
    item[kSecValueData as String] = Data(value.utf8)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let added = SecItemAdd(item as CFDictionary, nil)
    guard added == errSecSuccess else { throw ShareKeychainException(added) }
  }
}

public class ShareExtensionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotShareExtension")

    /// Saves the session for the share extension, or removes it with null.
    AsyncFunction("setSession") { (value: String?) throws in
      try ShareKeychain.write(value)
    }

    /// Tells iOS that the user sent a message to this agent. The share sheet offers the agents that
    /// get messages most often in its first row.
    AsyncFunction("donate") { (target: ShareTargetRecord, promise: Promise) in
      let recipient = INPerson(
        personHandle: INPersonHandle(value: target.conversationId, type: .unknown),
        nameComponents: nil,
        displayName: target.agentName,
        image: target.avatarUri
          .flatMap(URL.init(string:))
          .flatMap { try? Data(contentsOf: $0) }
          .map { INImage(imageData: $0) },
        contactIdentifier: nil,
        customIdentifier: target.conversationId
      )
      let intent = INSendMessageIntent(
        recipients: [recipient],
        outgoingMessageType: .outgoingMessageText,
        content: nil,
        speakableGroupName: nil,
        conversationIdentifier: target.conversationId,
        serviceName: nil,
        sender: nil,
        attachments: nil
      )
      let interaction = INInteraction(intent: intent, response: nil)
      interaction.direction = .outgoing
      interaction.groupIdentifier = target.conversationId
      // A failed donation changes only the order of the suggestions.
      interaction.donate { _ in promise.resolve(nil) }
    }

    /// Removes the suggestions of these agents, or of all agents with null.
    AsyncFunction("forget") { (conversationIds: [String]?, promise: Promise) in
      guard let conversationIds else {
        INInteraction.deleteAll { _ in promise.resolve(nil) }
        return
      }
      // Each donation has the agent as its group.
      let group = DispatchGroup()
      for conversationId in conversationIds {
        group.enter()
        INInteraction.delete(with: conversationId) { _ in group.leave() }
      }
      group.notify(queue: .main) { promise.resolve(nil) }
    }
  }
}
