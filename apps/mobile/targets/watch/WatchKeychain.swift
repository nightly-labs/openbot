import Foundation
import Security

enum WatchKeychain {
  private static let service = "run.openbot.mobile.watch.direct"
  private static let signingKeyAccount = "signing-key"
  private static let credentialsAccount = "credentials"

  private struct StoredSigningKey: Codable {
    var enclave: Bool
    var key: Data
  }

  static func signingKey() -> WatchSigningKey {
    if let data = read(signingKeyAccount),
      let stored = try? JSONDecoder().decode(StoredSigningKey.self, from: data),
      let key = WatchSigningKey(stored: stored.key, enclave: stored.enclave)
    {
      return key
    }
    let key = WatchSigningKey.create()
    if let data = try? JSONEncoder().encode(StoredSigningKey(enclave: key.isEnclave, key: key.stored)) {
      write(signingKeyAccount, data)
    }
    return key
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
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess else { return nil }
    return item as? Data
  }

  private static func write(_ account: String, _ data: Data) {
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(query(account) as CFDictionary, attributes as CFDictionary)
    guard status == errSecItemNotFound else { return }
    var item = query(account)
    item.merge(attributes) { _, new in new }
    SecItemAdd(item as CFDictionary, nil)
  }

  private static func remove(_ account: String) {
    SecItemDelete(query(account) as CFDictionary)
  }
}
