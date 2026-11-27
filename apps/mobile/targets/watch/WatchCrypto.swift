import CryptoKit
import Foundation
import Security

enum WatchCryptoError: Error {
  case invalidKey
  case invalidValue
}

enum Base64URL {
  static func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func decode(_ text: String) -> Data? {
    guard text.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else {
      return nil
    }
    var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    let remainder = base64.count % 4
    if remainder > 0 { base64 += String(repeating: "=", count: 4 - remainder) }
    return Data(base64Encoded: base64)
  }

  static func random(byteCount: Int) -> String {
    encode(SymmetricKey(size: SymmetricKeySize(bitCount: byteCount * 8)).withUnsafeBytes { Data($0) })
  }
}

enum WatchJSON {
  static func string(_ value: String) -> String {
    var out = "\""
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    return out + "\""
  }

  static func object(_ fields: [(String, String)]) -> String {
    "{" + fields.map { "\(string($0.0)):\($0.1)" }.joined(separator: ",") + "}"
  }
}

enum WatchCrypto {
  static let requestInfo = "openbot-watch-request-v1"
  static let proofLabel = "openbot-watch-request-v1"
  static let ticketProofLabel = "openbot-watch-ticket-v1"
  static let envelopeVersion = 1
  static let responseKeyBytes = 32

  static func requestNonce(hostId: String, ticketId: String) -> String {
    "\(hostId)\n\(ticketId)"
  }

  static func proofMessage(hostId: String, ticketId: String, sealedDigest: String, ts: Int64) -> String {
    "[\(WatchJSON.string(proofLabel)),\(WatchJSON.string(hostId)),\(WatchJSON.string(ticketId)),\(WatchJSON.string(sealedDigest)),\(ts)]"
  }

  static func ticketProofMessage(watchSessionId: String, hostId: String, ts: Int64) -> String {
    "[\(WatchJSON.string(ticketProofLabel)),\(WatchJSON.string(watchSessionId)),\(WatchJSON.string(hostId)),\(ts)]"
  }

  static func sealedDigest(_ sealed: String) -> String {
    Base64URL.encode(Data(SHA256.hash(data: Data(sealed.utf8))))
  }

  static func requestPlaintext(id: String, ts: Int64, responseKey: String, command: String) -> Data {
    Data(
      WatchJSON.object([
        ("id", WatchJSON.string(id)),
        ("ts", String(ts)),
        ("responseKey", WatchJSON.string(responseKey)),
        ("command", WatchJSON.string(command)),
      ]).utf8)
  }

  static func sealRequest(hostWatchKey: String, hostId: String, ticketId: String, plaintext: Data) throws -> String {
    guard let raw = Base64URL.decode(hostWatchKey), raw.count == 65, raw.first == 4,
      let recipient = try? P256.KeyAgreement.PublicKey(x963Representation: raw)
    else { throw WatchCryptoError.invalidKey }
    let ephemeral = P256.KeyAgreement.PrivateKey()
    let ephemeralPublic = ephemeral.publicKey.x963Representation
    let shared = try ephemeral.sharedSecretFromKeyAgreement(with: recipient)
    let key = shared.hkdfDerivedSymmetricKey(
      using: SHA256.self, salt: ephemeralPublic, sharedInfo: Data(requestInfo.utf8), outputByteCount: 32)
    let box = try AES.GCM.seal(
      plaintext, using: key, nonce: AES.GCM.Nonce(),
      authenticating: Data(requestNonce(hostId: hostId, ticketId: ticketId).utf8))
    let iv = box.nonce.withUnsafeBytes { Data($0) }
    let envelope = WatchJSON.object([
      ("v", String(envelopeVersion)),
      ("epk", WatchJSON.string(Base64URL.encode(ephemeralPublic))),
      ("iv", WatchJSON.string(Base64URL.encode(iv))),
      ("ct", WatchJSON.string(Base64URL.encode(box.ciphertext + box.tag))),
    ])
    return Base64URL.encode(Data(envelope.utf8))
  }

  static func openReply(responseKey: String, requestId: String, sealed: String) throws -> Data {
    guard let key = Base64URL.decode(responseKey), key.count == responseKeyBytes else {
      throw WatchCryptoError.invalidKey
    }
    guard let bytes = Base64URL.decode(sealed), bytes.count > 12 + 16 else { throw WatchCryptoError.invalidValue }
    let box = try AES.GCM.SealedBox(combined: bytes)
    return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: Data(requestId.utf8))
  }

  static func sealReply(responseKey: String, requestId: String, reply: Data) throws -> String {
    guard let key = Base64URL.decode(responseKey), key.count == responseKeyBytes else {
      throw WatchCryptoError.invalidKey
    }
    let box = try AES.GCM.seal(reply, using: SymmetricKey(data: key), authenticating: Data(requestId.utf8))
    guard let combined = box.combined else { throw WatchCryptoError.invalidValue }
    return Base64URL.encode(combined)
  }
}

struct WatchSigningKey {
  private enum Storage {
    case enclave(SecureEnclave.P256.Signing.PrivateKey)
    case software(P256.Signing.PrivateKey)
  }

  private let storage: Storage

  static func create(preferEnclave: Bool = true) -> WatchSigningKey {
    if preferEnclave, SecureEnclave.isAvailable,
      let access = SecAccessControlCreateWithFlags(
        nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, .privateKeyUsage, nil),
      let key = try? SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
    {
      return WatchSigningKey(storage: .enclave(key))
    }
    return WatchSigningKey(storage: .software(P256.Signing.PrivateKey()))
  }

  init?(stored: Data, enclave: Bool) {
    if enclave {
      guard SecureEnclave.isAvailable, let key = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: stored)
      else { return nil }
      storage = .enclave(key)
    } else {
      guard let key = try? P256.Signing.PrivateKey(rawRepresentation: stored) else { return nil }
      storage = .software(key)
    }
  }

  private init(storage: Storage) {
    self.storage = storage
  }

  var isEnclave: Bool {
    if case .enclave = storage { return true }
    return false
  }

  var stored: Data {
    switch storage {
    case .enclave(let key): return key.dataRepresentation
    case .software(let key): return key.rawRepresentation
    }
  }

  var publicKey: String {
    switch storage {
    case .enclave(let key): return Base64URL.encode(key.publicKey.x963Representation)
    case .software(let key): return Base64URL.encode(key.publicKey.x963Representation)
    }
  }

  func proof(_ message: String) throws -> String {
    let data = Data(message.utf8)
    switch storage {
    case .enclave(let key): return Base64URL.encode(try key.signature(for: data).rawRepresentation)
    case .software(let key): return Base64URL.encode(try key.signature(for: data).rawRepresentation)
    }
  }
}
