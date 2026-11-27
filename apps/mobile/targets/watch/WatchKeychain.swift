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
    SecItemDelete(query(account) as CFDictionary)
    var item = query(account)
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    guard let group else {
      SecItemAdd(item as CFDictionary, nil)
      return
    }
    var shared = item
    shared[kSecAttrAccessGroup as String] = group
    if SecItemAdd(shared as CFDictionary, nil) != errSecSuccess {
      SecItemAdd(item as CFDictionary, nil)
    }
  }

  private static func remove(_ account: String) {
    SecItemDelete(query(account) as CFDictionary)
  }
}
