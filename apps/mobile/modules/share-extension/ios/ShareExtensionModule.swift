import ExpoModulesCore
import Intents
import Security

struct ShareTargetRecord: Record {
  @Field var conversationId: String = ""
  @Field var agentName: String = ""
  @Field var avatarUri: String? = nil
}

final class ShareKeychainException: GenericException<OSStatus>, @unchecked Sendable {
  override var reason: String {
    "The share session could not be saved (\(param))"
  }
}

enum ShareKeychain {
  static let service = "openbot.share-extension"
  static let account = "session"

  static var accessGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "OpenBotShareKeychainGroup") as? String
  }

  static func write(_ value: String?) throws {
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

    AsyncFunction("setSession") { (value: String?) throws in
      try ShareKeychain.write(value)
    }

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
      interaction.donate { _ in promise.resolve(nil) }
    }

    AsyncFunction("forget") { (conversationIds: [String]?, promise: Promise) in
      guard let conversationIds else {
        INInteraction.deleteAll { _ in promise.resolve(nil) }
        return
      }
      let group = DispatchGroup()
      for conversationId in conversationIds {
        group.enter()
        INInteraction.delete(with: conversationId) { _ in group.leave() }
      }
      group.notify(queue: .main) { promise.resolve(nil) }
    }
  }
}
