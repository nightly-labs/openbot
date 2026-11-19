import Foundation
import Security
import UIKit

struct ShortcutDirectory: Decodable {
  struct Server: Decodable {
    let id: String
    let publicKey: String
    let hosted: Bool
  }

  struct Agent: Decodable, Identifiable {
    let serverId: String
    let id: String
    let name: String
    let server: String
    let avatar: String?
  }

  let version: Int
  let apiUrl: String
  let userId: String
  let locked: Bool
  let agent: Agent?
  let agents: [Agent]
  let text: [String: String]
  let accent: String

  private static let appGroup = "group.run.openbot.mobile"
  private static let directoryFile = "shortcuts.json"
  private static let shareDirectoryFile = "share-extension.json"
  private static let avatarFolder = "share-extension-avatars"

  private struct ShareFile: Decodable {
    let apiUrl: String
    let userId: String
    let servers: [Server]
  }

  private static var container: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  }

  static func read() -> ShortcutDirectory? {
    guard let file = container?.appendingPathComponent(directoryFile),
      let data = try? Data(contentsOf: file),
      let directory = try? JSONDecoder().decode(ShortcutDirectory.self, from: data),
      directory.version == 2
    else { return nil }
    return directory
  }

  func server(of agent: Agent) -> Server? {
    guard let file = Self.container?.appendingPathComponent(Self.shareDirectoryFile),
      let data = try? Data(contentsOf: file),
      let share = try? JSONDecoder().decode(ShareFile.self, from: data),
      share.apiUrl == apiUrl, share.userId == userId
    else { return nil }
    return share.servers.first { $0.id == agent.serverId }
  }

  static func avatar(_ name: String?) -> UIImage? {
    guard let name, !name.isEmpty, let folder = container?.appendingPathComponent(avatarFolder) else { return nil }
    return UIImage(contentsOfFile: folder.appendingPathComponent(name).path)
  }
}

struct ShortcutSession: Decodable {
  let apiUrl: String
  let userId: String
  let sessionToken: String

  static func read(for directory: ShortcutDirectory) -> ShortcutSession? {
    guard let accessGroup = Bundle.main.object(forInfoDictionaryKey: "OpenBotShareKeychainGroup") as? String else {
      return nil
    }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "openbot.share-extension",
      kSecAttrAccount as String: "session",
      kSecAttrAccessGroup as String: accessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
      let session = try? JSONDecoder().decode(ShortcutSession.self, from: data),
      session.apiUrl == directory.apiUrl, session.userId == directory.userId
    else { return nil }
    return session
  }
}

enum ShortcutText {
  static let fallback: [String: String] = [
    "mobile.settings.shortcuts.card.agents": "Agents",
    "mobile.settings.shortcuts.card.noAgents": "No agents yet",
    "mobile.settings.shortcuts.card.setUp.title": "Open OpenBot to set up shortcuts",
    "mobile.settings.shortcuts.card.setUp.action": "Open OpenBot",
    "mobile.settings.shortcuts.card.noAgent.title": "Choose an agent for shortcuts",
    "mobile.settings.shortcuts.card.noAgent.detail": "Shortcuts send to one agent.",
    "mobile.settings.shortcuts.card.noAgent.action": "Choose agent",
    "mobile.settings.shortcuts.card.locked.title": "OpenBot is locked",
    "mobile.settings.shortcuts.card.locked.action": "Open OpenBot",
  ]

  static func text(_ key: String, in directory: ShortcutDirectory?) -> String {
    if let value = directory?.text[key], !value.isEmpty { return value }
    return fallback[key] ?? ""
  }
}

func shortcutPayload(_ value: [String: String]) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: value),
    let text = String(data: data, encoding: .utf8)
  else { return "{}" }
  return text
}
