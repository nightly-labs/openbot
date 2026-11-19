import Foundation

public final class ShortcutBridge: @unchecked Sendable {
  public static let shared = ShortcutBridge()

  private struct Request {
    let payload: String
    let date = Date()
  }

  private static let waitLimit: TimeInterval = 60

  private let lock = NSLock()
  private var deliver: ((_ payload: String) -> Void)?
  private var waiting: [Request] = []

  private init() {}

  public func open(_ payload: String) {
    lock.lock()
    let deliver = self.deliver
    if deliver == nil { waiting.append(Request(payload: payload)) }
    lock.unlock()
    deliver?(payload)
  }

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
