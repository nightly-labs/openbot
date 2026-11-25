import BackgroundTasks
import ExpoModulesCore
import UIKit
import os

private let refreshLog = Logger(subsystem: "run.openbot.mobile", category: "BackgroundRefresh")
private let refreshIdentifier = "run.openbot.mobile.refresh"
private let refreshEvent = "onRefresh"
private let expireEvent = "onExpire"
private let intervalKey = "run.openbot.mobile.backgroundRefreshMinutes"
private let listenerWaitSeconds: TimeInterval = 10

final class BackgroundRefreshNotScheduled: GenericException<String>, @unchecked Sendable {
  override var reason: String { "Background refresh is not scheduled: \(param)" }
}

final class BackgroundRefreshRuns {
  static let shared = BackgroundRefreshRuns()
  private var runs: [String: BGTask] = [:]
  private var waiting: [String: BGTask] = [:]
  private var owner: ObjectIdentifier?
  private var deliver: ((String) -> Void)?
  private var expire: ((String) -> Void)?

  func register() {
    _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshIdentifier, using: .main) { task in
      BackgroundRefreshRuns.shared.receive(task)
    }
  }

  func listen(owner: ObjectIdentifier, deliver: @escaping (String) -> Void, expire: @escaping (String) -> Void) {
    self.owner = owner
    self.deliver = deliver
    self.expire = expire
    let pending = waiting
    waiting.removeAll()
    for (id, task) in pending { start(id, task) }
  }

  func stopListening(owner: ObjectIdentifier) {
    guard self.owner == owner else { return }
    self.owner = nil
    deliver = nil
    expire = nil
  }

  func enable(minutes: Int) throws {
    UserDefaults.standard.set(minutes, forKey: intervalKey)
    try schedule()
  }

  func disable() {
    UserDefaults.standard.removeObject(forKey: intervalKey)
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: refreshIdentifier)
  }

  func finish(_ id: String, success: Bool) {
    guard let task = runs.removeValue(forKey: id) else { return }
    refreshLog.notice("Background refresh finished, success: \(success, privacy: .public)")
    task.setTaskCompleted(success: success)
  }

  private func receive(_ task: BGTask) {
    let id = UUID().uuidString
    let listening = deliver != nil
    refreshLog.notice("Background refresh task received, JavaScript listening: \(listening, privacy: .public)")
    task.expirationHandler = {
      DispatchQueue.main.async { BackgroundRefreshRuns.shared.expireRun(id) }
    }
    if listening {
      start(id, task)
      return
    }
    waiting[id] = task
    DispatchQueue.main.asyncAfter(deadline: .now() + listenerWaitSeconds) {
      BackgroundRefreshRuns.shared.giveUp(id)
    }
  }

  private func start(_ id: String, _ task: BGTask) {
    _ = try? schedule()
    runs[id] = task
    refreshLog.notice("Background refresh sent to JavaScript")
    deliver?(id)
  }

  private func giveUp(_ id: String) {
    guard let task = waiting.removeValue(forKey: id) else { return }
    refreshLog.notice("Background refresh ended: JavaScript did not listen")
    task.setTaskCompleted(success: false)
  }

  private func expireRun(_ id: String) {
    refreshLog.notice("Background refresh expired")
    if let task = waiting.removeValue(forKey: id) {
      task.setTaskCompleted(success: false)
      return
    }
    guard let task = runs.removeValue(forKey: id) else { return }
    expire?(id)
    task.setTaskCompleted(success: false)
  }

  private func schedule() throws {
    let minutes = UserDefaults.standard.integer(forKey: intervalKey)
    guard minutes > 0 else { return }
    let request = BGAppRefreshTaskRequest(identifier: refreshIdentifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: TimeInterval(minutes) * 60)
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      throw BackgroundRefreshNotScheduled(error.localizedDescription)
    }
  }
}

private func refreshStatus() -> String {
  switch UIApplication.shared.backgroundRefreshStatus {
  case .available: return "available"
  case .denied: return "denied"
  case .restricted: return "restricted"
  @unknown default: return "unknown"
  }
}

public class BackgroundRefreshModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotBackgroundRefresh")

    Events(refreshEvent, expireEvent)

    AsyncFunction("enable") { (minutes: Int) -> String in
      BackgroundRefreshRuns.shared.listen(
        owner: ObjectIdentifier(self),
        deliver: { [weak self] id in self?.sendEvent(refreshEvent, ["id": id]) },
        expire: { [weak self] id in self?.sendEvent(expireEvent, ["id": id]) }
      )
      try BackgroundRefreshRuns.shared.enable(minutes: minutes)
      return refreshStatus()
    }
    .runOnQueue(.main)

    AsyncFunction("disable") {
      BackgroundRefreshRuns.shared.stopListening(owner: ObjectIdentifier(self))
      BackgroundRefreshRuns.shared.disable()
    }
    .runOnQueue(.main)

    AsyncFunction("finish") { (id: String, success: Bool) in
      BackgroundRefreshRuns.shared.finish(id, success: success)
    }
    .runOnQueue(.main)

    OnDestroy {
      let owner = ObjectIdentifier(self)
      DispatchQueue.main.async { BackgroundRefreshRuns.shared.stopListening(owner: owner) }
    }
  }
}

public class BackgroundRefreshAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    BackgroundRefreshRuns.shared.register()
    return true
  }
}
