import Foundation

/// Gives JavaScript the screen that a button of a shortcut card opens: the chat of an agent, or
/// Settings > Shortcuts. The App Intents are in the app target (`plugins/shortcuts`), and the router
/// is in JavaScript (`src/features/shortcuts/shortcuts-native.ts`).
///
/// The shortcuts themselves need no JavaScript: List Agents reads a file, and Send Message sends
/// from native code. Only a button that opens the app comes here.
public final class ShortcutBridge: @unchecked Sendable {
  public static let shared = ShortcutBridge()

  private struct Request {
    /// JSON text.
    let payload: String
    let date = Date()
  }

  /// A request that waited longer than this is dropped. A button that opens the app waits for the
  /// app to start. A request from an earlier day must not open a chat at the next start.
  private static let waitLimit: TimeInterval = 60

  private let lock = NSLock()
  private var deliver: ((_ payload: String) -> Void)?
  /// The requests that came before JavaScript listened. A button can start the app.
  private var waiting: [Request] = []

  private init() {}

  /// Asks JavaScript to open a screen. `payload` is JSON text.
  public func open(_ payload: String) {
    lock.lock()
    let deliver = self.deliver
    if deliver == nil { waiting.append(Request(payload: payload)) }
    lock.unlock()
    deliver?(payload)
  }

  // MARK: - The module side

  func listen(_ deliver: ((_ payload: String) -> Void)?) {
    lock.lock()
    self.deliver = deliver
    let pending = deliver == nil ? [] : waiting
    if deliver != nil { waiting = [] }
    lock.unlock()
    guard let deliver else { return }
    for request in pending where request.date.timeIntervalSinceNow > -Self.waitLimit {
      deliver(request.payload)
    }
  }
}
