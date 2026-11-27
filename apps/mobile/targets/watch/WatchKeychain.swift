import Foundation
import Security

enum WatchKeychain {
  private static let service = "run.openbot.mobile.watch.direct"
  private static let signingKeyAccount = "signing-key"
  private static let credentialsAccount = "credentials"
  private static let groupKey = "OpenBotKeychainGroup"

  private struct StoredSigningKey: Codable {
    var enclave: Bool
    var key: Data
  }

  private static let group: String? = {
    guard let value = Bundle.main.object(forInfoDictionaryKey: groupKey) as? String,
      !value.isEmpty, !value.hasPrefix("$(")
    else { return nil }
    return value
  }()

  static func signingKey() -> WatchSigningKey {
    if let key = existingSigningKey() { return key }
    let key = WatchSigningKey.create()
    if let data = try? JSONEncoder().encode(StoredSigningKey(enclave: key.isEnclave, key: key.stored)) {
      write(signingKeyAccount, data)
    }
    return key
  }

  static func existingSigningKey() -> WatchSigningKey? {
    guard let data = read(signingKeyAccount),
      let stored = try? JSONDecoder().decode(StoredSigningKey.self, from: data)
    else { return nil }
    return WatchSigningKey(stored: stored.key, enclave: stored.enclave)
  }

  static func credentials() -> WatchDirectCredentials? {
    guard let data = read(credentialsAccount) else { return nil }
    return try? JSONDecoder().decode(WatchDirectCredentials.self, from: data)
  }

  static func save(_ credentials: WatchDirectCredentials) {
    guard let data = try? JSONEncoder().encode(credentials) else { return }
    write(credentialsAccount, data)
  }

  static func removeCredentials() {
    remove(credentialsAccount)
  }

  static func removeAll() {
    remove(credentialsAccount)
    remove(signingKeyAccount)
  }

  private static func query(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private static func read(_ account: String) -> Data? {
    var request = query(account)
    request[kSecReturnData as String] = true
    request[kSecReturnAttributes as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
      let found = item as? [String: Any],
      let data = found[kSecValueData as String] as? Data
    else { return nil }
    if let group, found[kSecAttrAccessGroup as String] as? String != group {
      write(account, data)
    }
    return data
  }

  private static func write(_ account: String, _ data: Data) {
    let value = [kSecValueData as String: data]
    if let group {
      var shared = query(account)
      shared[kSecAttrAccessGroup as String] = group
      if SecItemUpdate(shared as CFDictionary, value as CFDictionary) == errSecSuccess
        || SecItemAdd(newItem(account, data, group: group) as CFDictionary, nil) == errSecSuccess
      {
        removeCopies(account, outside: group)
        return
      }
    }
    if SecItemUpdate(query(account) as CFDictionary, value as CFDictionary) != errSecSuccess {
      SecItemAdd(newItem(account, data, group: nil) as CFDictionary, nil)
    }
  }

  private static func newItem(_ account: String, _ data: Data, group: String?) -> [String: Any] {
    var item = query(account)
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    if let group { item[kSecAttrAccessGroup as String] = group }
    return item
  }

  private static func removeCopies(_ account: String, outside group: String) {
    var request = query(account)
    request[kSecReturnAttributes as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitAll
    var items: CFTypeRef?
    guard SecItemCopyMatching(request as CFDictionary, &items) == errSecSuccess,
      let found = items as? [[String: Any]]
    else { return }
    for item in found {
      guard let other = item[kSecAttrAccessGroup as String] as? String, other != group else { continue }
      var copy = query(account)
      copy[kSecAttrAccessGroup as String] = other
      SecItemDelete(copy as CFDictionary)
    }
  }

  private static func remove(_ account: String) {
    SecItemDelete(query(account) as CFDictionary)
  }
}
