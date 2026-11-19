import UIKit

enum ShortcutSendOutcome: String {
  case sent
  case failed
  case unconfirmed
}

@MainActor
enum ShortcutMessageSender {
  private static let limit: TimeInterval = 24

  private final class Pending {
    private var continuation: CheckedContinuation<ShortcutSendOutcome, Never>?

    init(_ continuation: CheckedContinuation<ShortcutSendOutcome, Never>) {
      self.continuation = continuation
    }

    func finish(_ outcome: ShortcutSendOutcome) {
      continuation?.resume(returning: outcome)
      continuation = nil
    }
  }

  static func send(
    text: String,
    to agent: ShortcutDirectory.Agent,
    on server: ShortcutDirectory.Server,
    session: ShortcutSession
  ) async -> ShortcutSendOutcome {
    let window = UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.windows.first }
      .first ?? UIWindow(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
    let sender = ShareSender(container: window, apiUrl: session.apiUrl, files: [])
    let request: [String: Any] = [
      "apiUrl": session.apiUrl,
      "sessionToken": session.sessionToken,
      "hostId": server.id,
      "hostPublicKey": server.publicKey,
      "hosted": server.hosted,
      "agentId": agent.id,
      "text": text,
      "files": [[String: String]](),
      "clientMessageId": UUID().uuidString,
      "timezone": TimeZone.current.identifier,
    ]
    return await withCheckedContinuation { continuation in
      let result = Pending(continuation)
      Task { @MainActor in
        let outcome = await sender.send(request)
        _ = window
        switch outcome {
        case .sent:
          result.finish(.sent)
        case let .failed(unconfirmed, detail):
          NSLog("OpenBot shortcut: send failed at %@", detail)
          result.finish(unconfirmed ? .unconfirmed : .failed)
        }
      }
      Task { @MainActor in
        try? await Task.sleep(nanoseconds: UInt64(limit * 1_000_000_000))
        result.finish(.unconfirmed)
      }
    }
  }
}
