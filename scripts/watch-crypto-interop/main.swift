import Foundation

func emit(_ fields: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys, .withoutEscapingSlashes])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

func readInput() -> [String: Any] {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
}

let input = readInput()
let mode = CommandLine.arguments.dropFirst().first ?? ""

switch mode {
case "seal":
  let hostWatchKey = input["watchKey"] as! String
  let hostId = input["hostId"] as! String
  let ticketId = input["ticketId"] as! String
  let watchSessionId = input["watchSessionId"] as! String
  let command = input["command"] as! String
  let ts = (input["ts"] as! NSNumber).int64Value
  let key = WatchSigningKey.create(preferEnclave: false)
  let id = Base64URL.random(byteCount: 16)
  let responseKey = Base64URL.random(byteCount: 32)
  let plaintext = WatchCrypto.requestPlaintext(id: id, ts: ts, responseKey: responseKey, command: command)
  let sealed = try! WatchCrypto.sealRequest(
    hostWatchKey: hostWatchKey, hostId: hostId, ticketId: ticketId, plaintext: plaintext)
  let digest = WatchCrypto.sealedDigest(sealed)
  let proofMessage = WatchCrypto.proofMessage(hostId: hostId, ticketId: ticketId, sealedDigest: digest, ts: ts)
  let ticketProofMessage = WatchCrypto.ticketProofMessage(watchSessionId: watchSessionId, hostId: hostId, ts: ts)
  let restored = WatchSigningKey(stored: key.stored, enclave: false)!
  emit([
    "publicKey": key.publicKey,
    "restoredPublicKey": restored.publicKey,
    "id": id,
    "responseKey": responseKey,
    "sealed": sealed,
    "digest": digest,
    "proofMessage": proofMessage,
    "proof": try! key.proof(proofMessage),
    "ticketProofMessage": ticketProofMessage,
    "ticketProof": try! restored.proof(ticketProofMessage),
  ])
case "open":
  let plaintext = try! WatchCrypto.openReply(
    responseKey: input["responseKey"] as! String, requestId: input["id"] as! String,
    sealed: input["sealed"] as! String)
  let wrongId = (try? WatchCrypto.openReply(
    responseKey: input["responseKey"] as! String, requestId: "wrong-request-id",
    sealed: input["sealed"] as! String)) != nil
  emit(["plaintext": String(decoding: plaintext, as: UTF8.self), "openedWithWrongId": wrongId])
case "stringify":
  let values = input["values"] as! [String]
  emit(["strings": values.map(WatchJSON.string)])
default:
  FileHandle.standardError.write(Data("unknown mode\n".utf8))
  exit(2)
}
