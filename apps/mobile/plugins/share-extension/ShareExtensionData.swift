import Foundation
import Security

struct ShareDirectory: Decodable {
  struct Server: Decodable {
    let id: String
    let name: String
    let publicKey: String
    let hosted: Bool
  }

  struct Agent: Decodable, Identifiable {
    let serverId: String
    let id: String
    let name: String
    let avatar: String?

    var conversationId: String { "\(serverId)/\(id)" }
  }

  struct Target: Codable, Equatable {
    let serverId: String
    let agentId: String
  }

  let version: Int
  let apiUrl: String
  let userId: String
  let locked: Bool
  let servers: [Server]
  let agents: [Agent]
  let lastTarget: Target?
  let text: [String: String]
  let accent: String

  static let textKeys = [
    "mobile.app.route.share",
    "mobile.share.content",
    "mobile.share.lastUsed",
    "mobile.share.noAgents",
    "mobile.share.extension.send",
    "mobile.share.extension.footer",
    "mobile.share.extension.sending",
    "mobile.share.extension.sent",
    "mobile.share.extension.failed",
    "mobile.share.extension.unconfirmed",
    "mobile.share.extension.openApp",
    "common.cancel",
    "common.done",
  ]

  func t(_ key: String, name: String? = nil) -> String {
    let value = text[key] ?? ""
    guard let name else { return value }
    return value.replacingOccurrences(of: "{name}", with: name)
  }
}

struct ShareSession: Decodable {
  let apiUrl: String
  let userId: String
  let sessionToken: String
}

enum ShareExtensionData {
  private static let directoryFile = "share-extension.json"
  private static let lastTargetKey = "openbot.share-extension.last-target"
  private static let keychainService = "openbot.share-extension"
  private static let keychainAccount = "session"
  private static let avatarFolder = "share-extension-avatars"

  static func avatars(appGroupId: String, directory: ShareDirectory) -> [String: Data] {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
      return [:]
    }
    let folder = container.appendingPathComponent(avatarFolder, isDirectory: true)
    var avatars: [String: Data] = [:]
    for name in Set(directory.agents.compactMap(\.avatar)) {
      avatars[name] = try? Data(contentsOf: folder.appendingPathComponent(name))
    }
    return avatars
  }

  static func load(appGroupId: String) -> (ShareDirectory, ShareSession)? {
    guard
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId),
      let data = try? Data(contentsOf: container.appendingPathComponent(directoryFile)),
      let directory = try? JSONDecoder().decode(ShareDirectory.self, from: data),
      directory.version == 1,
      !directory.locked,
      ShareDirectory.textKeys.allSatisfy({ !(directory.text[$0] ?? "").isEmpty }),
      let session = session(),
      session.apiUrl == directory.apiUrl,
      session.userId == directory.userId
    else { return nil }
    return (directory, session)
  }

  private static func session() -> ShareSession? {
    guard let accessGroup = Bundle.main.object(forInfoDictionaryKey: "OpenBotShareKeychainGroup") as? String else {
      return nil
    }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecAttrAccessGroup as String: accessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
      return nil
    }
    return try? JSONDecoder().decode(ShareSession.self, from: data)
  }

  static func lastTarget(appGroupId: String, directory: ShareDirectory) -> ShareDirectory.Target? {
    guard
      let data = UserDefaults(suiteName: appGroupId)?.data(forKey: lastTargetKey),
      let saved = try? JSONDecoder().decode(SavedTarget.self, from: data),
      saved.apiUrl == directory.apiUrl,
      saved.userId == directory.userId
    else { return directory.lastTarget }
    return saved.target
  }

  static func saveLastTarget(_ target: ShareDirectory.Target, appGroupId: String, directory: ShareDirectory) {
    let saved = SavedTarget(apiUrl: directory.apiUrl, userId: directory.userId, target: target)
    guard let data = try? JSONEncoder().encode(saved) else { return }
    UserDefaults(suiteName: appGroupId)?.set(data, forKey: lastTargetKey)
  }

  private struct SavedTarget: Codable {
    let apiUrl: String
    let userId: String
    let target: ShareDirectory.Target
  }
}
