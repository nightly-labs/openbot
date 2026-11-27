import Foundation
import UIKit
import WatchConnectivity

public final class WatchLink: NSObject, WCSessionDelegate, @unchecked Sendable {
  public static let shared = WatchLink()

  private static let replyLimit: TimeInterval = 24
  private static let listenLimit: TimeInterval = 6
  private static let keepAwakeTime: TimeInterval = 40
  private static let asleepReply = #"{"ok":false,"error":"asleep","message":""}"#

  private struct Pending {
    let reply: ([String: Any]) -> Void
    let command: String
    var task: UIBackgroundTaskIdentifier
    var delivered: Bool
  }

  private let lock = NSLock()
  private var deliver: ((_ id: String, _ command: String) -> Void)?
  private var stateListener: (() -> Void)?
  private var pending: [String: Pending] = [:]
  private var queuedPayload: String?
  private var complicationState: ComplicationState?
  private var started = false
  private var keepTask: UIBackgroundTaskIdentifier = .invalid
  private var keepGeneration = 0

  private override init() {
    super.init()
  }

  private var session: WCSession? {
    WCSession.isSupported() ? WCSession.default : nil
  }

  public var supported: Bool { WCSession.isSupported() }

  public func activate() {
    lock.lock()
    let first = !started
    started = true
    lock.unlock()
    guard first, let session else { return }
    session.delegate = self
    session.activate()
  }

  func state() -> [String: Bool] {
    guard let session, session.activationState == .activated else {
      return ["supported": supported, "paired": false, "installed": false, "reachable": false]
    }
    return [
      "supported": true,
      "paired": session.isPaired,
      "installed": session.isWatchAppInstalled,
      "reachable": session.isReachable,
    ]
  }

  func listen(commands: ((_ id: String, _ command: String) -> Void)?, state: (() -> Void)?) {
    lock.lock()
    deliver = commands
    stateListener = state
    let waiting = commands == nil ? [] : pending.filter { !$0.value.delivered }.map { ($0.key, $0.value.command) }
    for (id, _) in waiting { pending[id]?.delivered = true }
    lock.unlock()
    guard let commands else { return }
    for (id, command) in waiting { commands(id, command) }
  }

  func update(payload: String) {
    lock.lock()
    queuedPayload = payload
    lock.unlock()
    flushPayload()
  }

  func respond(id: String, result: String) {
    finish(id: id, reply: ["result": result])
    keepAwake()
  }

  private func keepAwake() {
    DispatchQueue.main.async { [self] in
      keepGeneration += 1
      let generation = keepGeneration
      let previous = keepTask
      keepTask = UIApplication.shared.beginBackgroundTask(withName: "OpenBot watch link") { [weak self] in
        self?.endKeepAwake(generation: generation)
      }
      if previous != .invalid { UIApplication.shared.endBackgroundTask(previous) }
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.keepAwakeTime) { [weak self] in
        self?.endKeepAwake(generation: generation)
      }
    }
  }

  private func endKeepAwake(generation: Int) {
    guard generation == keepGeneration, keepTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(keepTask)
    keepTask = .invalid
  }

  private func finishIfUnheard(id: String) {
    lock.lock()
    let unheard = pending[id]?.delivered == false
    lock.unlock()
    if unheard { finish(id: id, reply: ["result": Self.asleepReply]) }
  }

  private func flushPayload() {
    guard let session, session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else {
      return
    }
    lock.lock()
    let payload = queuedPayload
    lock.unlock()
    guard let payload else { return }
    do {
      try session.updateApplicationContext(["openbot": 1, "payload": payload])
      lock.lock()
      if queuedPayload == payload { queuedPayload = nil }
      lock.unlock()
      pushComplication(payload: payload, session: session)
    } catch {
      NSLog("[OpenBotWatch] The snapshot did not go to the watch: %@", error.localizedDescription)
    }
  }

  private func pushComplication(payload: String, session: WCSession) {
    guard let next = ComplicationState(payload: payload) else { return }
    lock.lock()
    let previous = complicationState
    complicationState = next
    lock.unlock()
    guard session.isComplicationEnabled,
      next.needsPush(after: previous, remaining: session.remainingComplicationUserInfoTransfers)
    else { return }
    session.transferCurrentComplicationUserInfo(["openbot": 1, "payload": payload])
  }

  private func notifyState() {
    lock.lock()
    let listener = stateListener
    lock.unlock()
    listener?()
  }

  public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if let error { NSLog("[OpenBotWatch] The session did not start: %@", error.localizedDescription) }
    flushPayload()
    notifyState()
  }

  public func sessionDidBecomeInactive(_ session: WCSession) {}

  public func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  public func sessionWatchStateDidChange(_ session: WCSession) {
    flushPayload()
    notifyState()
  }

  public func sessionReachabilityDidChange(_ session: WCSession) {
    notifyState()
  }

  public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
  }

  public func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    guard message["openbot"] as? Int == 1, let command = message["command"] as? String, command.count <= 8_000 else {
      replyHandler(["result": #"{"ok":false,"error":"failed","message":""}"#])
      return
    }
    let id = UUID().uuidString
    DispatchQueue.main.async { [self] in
      let task = UIApplication.shared.beginBackgroundTask(withName: "OpenBot watch command") { [weak self] in
        self?.finish(id: id, reply: ["result": #"{"ok":false,"error":"timeout","message":""}"#])
      }
      lock.lock()
      let deliver = self.deliver
      pending[id] = Pending(reply: replyHandler, command: command, task: task, delivered: deliver != nil)
      lock.unlock()
      deliver?(id, command)
      if deliver == nil {
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.listenLimit) { [weak self] in
          self?.finishIfUnheard(id: id)
        }
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.replyLimit) { [weak self] in
        self?.finish(id: id, reply: ["result": #"{"ok":false,"error":"timeout","message":""}"#])
      }
    }
  }

  private func finish(id: String, reply: [String: Any]) {
    lock.lock()
    let entry = pending.removeValue(forKey: id)
    lock.unlock()
    guard let entry else { return }
    entry.reply(reply)
    let task = entry.task
    DispatchQueue.main.async {
      if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
    }
  }
}

struct ComplicationState: Equatable {
  static let reservedTransfers = 10

  let state: String
  let waiting: Int
  let unread: Int

  init?(payload: String) {
    guard let data = payload.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let state = object["state"] as? String
    else { return nil }
    let agents = object["agents"] as? [[String: Any]] ?? []
    self.state = state
    self.waiting = agents.filter { $0["state"] as? String == "waiting" }.count
    self.unread = agents.reduce(0) { $0 + (($1["unread"] as? Int) ?? 0) }
  }

  func needsPush(after previous: ComplicationState?, remaining: Int) -> Bool {
    guard let previous else { return false }
    if state != previous.state || waiting > previous.waiting { return remaining > 0 }
    return unread > previous.unread && remaining > Self.reservedTransfers
  }
}
