import Foundation
import Security
import UIKit

/// What the app wrote for the shortcuts (`src/features/shortcuts/model/shortcut-directory.ts`): the
/// agents, the agent that gets the shortcut messages, the app lock, and the text of the cards in the
/// app's language. The intents read it, because they run without JavaScript. The servers and the
/// agent pictures are the ones that the app writes for its share extension.
struct ShortcutDirectory: Decodable {
  struct Server: Decodable {
    let id: String
    /// The key the app connects with. A message goes only to a server with this key.
    let publicKey: String
    /// A hosted server can sleep. The sender then asks it to start and waits for it.
    let hosted: Bool
  }

  struct Agent: Decodable, Identifiable {
    let serverId: String
    let id: String
    let name: String
    /// The name of the agent's server, which the list shows under the agent.
    let server: String
    /// The agent's picture, a file in the picture folder of the share extension.
    let avatar: String?
  }

  let version: Int
  let apiUrl: String
  let userId: String
  /// The app lock is on. A shortcut then opens the app, which asks for the lock.
  let locked: Bool
  /// The agent that gets the messages of the shortcuts. Null until the user chooses one.
  let agent: Agent?
  let agents: [Agent]
  let text: [String: String]
  /// The app's accent color, as `#rrggbb`.
  let accent: String

  private static let appGroup = "group.run.openbot.mobile"
  private static let directoryFile = "shortcuts.json"
  /// `src/features/share/model/share-extension.ts` writes this file and this folder.
  private static let shareDirectoryFile = "share-extension.json"
  private static let avatarFolder = "share-extension-avatars"

  /// The part of the share extension file that Send Message needs.
  private struct ShareFile: Decodable {
    let apiUrl: String
    let userId: String
    let servers: [Server]
  }

  private static var container: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  }

  /// Nil when the app wrote no file: no session, or the app has not opened since it got shortcuts.
  static func read() -> ShortcutDirectory? {
    guard let file = container?.appendingPathComponent(directoryFile),
      let data = try? Data(contentsOf: file),
      let directory = try? JSONDecoder().decode(ShortcutDirectory.self, from: data),
      directory.version == 2
    else { return nil }
    return directory
  }

  /// The server of an agent, with the key to connect with. Nil when the share extension file is
  /// missing or for another account, or it does not have the server.
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

/// The session of the app, from the keychain item that the app writes for its share extension
/// (`modules/share-extension`). Only the app and that extension can read it.
struct ShortcutSession: Decodable {
  let apiUrl: String
  let userId: String
  let sessionToken: String

  /// Nil when there is no session, or it is for another account than the directory.
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

/// The text of the cards. The app writes these keys in its language. English shows only when the
/// app wrote no file, so there is no language to read.
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

/// Makes the JSON text of a request to JavaScript.
func shortcutPayload(_ value: [String: String]) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: value),
    let text = String(data: data, encoding: .utf8)
  else { return "{}" }
  return text
}
