import UIKit

/// What happened to a message of the Send Message shortcut.
enum ShortcutSendOutcome: String {
  case sent
  /// The message did not go. The card offers to send it from the app.
  case failed
  /// The message request went out and no answer came, or the time ended. The message can be in
  /// the chat, so the card does not offer to send it again.
  case unconfirmed
}

/// Sends one message to one agent from native code, with no JavaScript of the app. iOS runs a
/// shortcut in the background, also when the app is not in memory, and there the app has no window
/// and React Native does not run.
///
/// It uses the sender of the share extension (`plugins/share-extension/ShareSender.swift`, which
/// `plugins/with-shortcuts.js` also adds to the app target): a hidden web view with the page
/// `share-sender.html`, which holds the Team client. It connects to the agent's server, sends the
/// message, and closes. The server then sends the reply as a notification, as for each message.
@MainActor
enum ShortcutMessageSender {
  /// iOS stops an intent that performs for about 30 seconds. A send that takes longer, such as to a
  /// hosted server that must start, ends as not confirmed.
  private static let limit: TimeInterval = 24

  /// Resumes the caller once: with the result of the send, or when the time ends.
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
    // The web view is in a window. An app that iOS started for the shortcut has none, so it gets one
    // that never shows.
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
        // The window stays until the send ends.
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
