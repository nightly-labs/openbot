import Foundation

actor WidgetRefresh {
  static let shared = WidgetRefresh()

  private static let freshness: TimeInterval = 5
  private static let timeout: TimeInterval = 8

  private let direct = WatchDirect(timeout: WidgetRefresh.timeout, loadKey: { WatchKeychain.existingSigningKey() })
  private var running: Task<Void, Never>?

  func run() async {
    WidgetPushRegistry.confirmEnvironment()
    if let running {
      await running.value
      return
    }
    let task = Task {
      await fetch()
      await register()
    }
    running = task
    await task.value
    running = nil
  }

  private func fetch() async {
    guard WidgetSource.age >= Self.freshness,
      let previous = WidgetSource.snapshot(),
      let credentials = WatchKeychain.credentials(),
      credentials.expiresAt / 1000 > Date().timeIntervalSince1970
    else { return }
    let known = Set(previous.servers.map(\.id))
    let servers = credentials.servers.filter { known.contains($0.serverId) }
    guard !servers.isEmpty else { return }
    let language = previous.language
    let direct = direct
    var parts: [String: WatchReadySnapshot] = [:]
    await withTaskGroup(of: (String, WatchReadySnapshot?).self) { group in
      for server in servers {
        group.addTask {
          guard
            let result = try? await direct.run(
              .refresh(language: language), server: server, credentials: credentials),
            result.ok, let json = result.snapshot, case .ready(let ready)? = WatchSnapshot.decode(json: json)
          else { return (server.serverId, nil) }
          return (server.serverId, ready)
        }
      }
      for await (serverId, ready) in group {
        if let ready { parts[serverId] = ready }
      }
    }
    if !parts.isEmpty, Self.sessionKept(credentials),
      let merged = WatchMerge.merge(parts: parts, phone: nil, previous: previous, hasPicture: WatchAvatarFiles.has)
    {
      _ = ComplicationData.save(merged, previous: previous, chosen: WidgetSource.chosen)
      WidgetSource.store(merged)
    }
  }

  private static func sessionKept(_ credentials: WatchDirectCredentials) -> Bool {
    WatchKeychain.credentials()?.watchSessionId == credentials.watchSessionId && WidgetSource.snapshot() != nil
  }

  private func register() async {
    guard let credentials = WatchKeychain.credentials(),
      credentials.expiresAt / 1000 > Date().timeIntervalSince1970
    else { return }
    await WidgetPushRegistry.register(credentials: credentials, direct: direct)
  }
}
