import SwiftUI
import UIKit
import WatchConnectivity
import WatchKit

enum WatchPhase: Equatable {
  case starting
  case firstRun
  case offline
  case locked(WatchLockedSnapshot)
  case ready(WatchReadySnapshot)
}

struct WatchFeedback: Equatable, Identifiable {
  let id = UUID()
  var text: String
  var success: Bool
  var color: String?
}

@MainActor
final class WatchSession: NSObject, ObservableObject {
  static let freshness: TimeInterval = 90
  static let refreshInterval: TimeInterval = 15
  static let directRefreshInterval: TimeInterval = 5
  static let answerTimeout: TimeInterval = 25
  static let offlineGrace: TimeInterval = 4
  static let backgroundLimit: TimeInterval = 10
  static let avatarBatch = WatchMerge.agentLimit
  static let avatarLoadLimit: TimeInterval = 10
  static let backgroundRefreshInterval: TimeInterval = 15 * 60
  static let backgroundRefreshIdentifier = "run.openbot.mobile.watch.refresh"
  static let pairMargin: TimeInterval = 7 * 24 * 60 * 60
  static let pairRetry: TimeInterval = 60 * 60
  static let pairFailureRetry: TimeInterval = 30
  static let urlScheme = "openbot-watch"
  nonisolated static let serverKey = "openbot.watch.server"
  static let themeKey = "openbot.watch.theme"
  static let shared = WatchSession()

  private static let snapshotKey = "openbot.watch.snapshot"

  @Published private(set) var snapshot: WatchSnapshot?
  @Published private(set) var activated = false
  @Published private(set) var reachable = false
  @Published private(set) var phoneNeedsUnlock = false
  @Published var focus: AgentKey?
  @Published private(set) var lastFresh: Date?
  @Published private(set) var busy = false
  @Published private(set) var refreshError: String?
  @Published var feedback: WatchFeedback?
  @Published private(set) var avatarRevision = 0
  @Published private(set) var clock = Date()
  @Published private(set) var directActive = false

  private let session: WCSession? = WCSession.isSupported() ? WCSession.default : nil
  private let defaults = UserDefaults(suiteName: watchAppGroup) ?? .standard
  private var refreshing = false
  private var feedbackTask: Task<Void, Never>?
  private var offlineTask: Task<Void, Never>?
  private var pictures: [String: UIImage] = [:]
  private var pictureTints: [String: Color?] = [:]
  private let direct = WatchDirect()
  private var credentials: WatchDirectCredentials?
  private var nextPairAttempt = Date.distantPast

  private enum Origin {
    case phone
    case merged
  }

  private override init() {
    super.init()
    if let json = defaults.string(forKey: Self.snapshotKey), let cached = WatchSnapshot.decode(json: json) {
      if case .signedOut = cached {
        snapshot = nil
      } else {
        snapshot = cached
      }
    }
    credentials = snapshot == nil ? nil : WatchKeychain.credentials()
    session?.delegate = self
    session?.activate()
  }

  var text: WatchText {
    switch snapshot {
    case .ready(let ready): return WatchText(values: ready.text)
    case .locked(let locked): return WatchText(values: locked.text)
    case .signedOut, .none: return WatchText()
    }
  }

  var phase: WatchPhase {
    guard let snapshot else {
      guard activated else { return .starting }
      return reachable ? .firstRun : .offline
    }
    switch snapshot {
    case .ready(let ready): return .ready(ready)
    case .locked(let locked): return .locked(locked)
    case .signedOut: return .firstRun
    }
  }

  var connected: Bool {
    reachable || directActive
  }

  var fresh: Bool {
    guard connected, let lastFresh else { return false }
    return clock.timeIntervalSince(lastFresh) <= Self.freshness
  }

  var canAct: Bool {
    guard activated || usableCredentials != nil, !busy, case .ready = snapshot else { return false }
    return true
  }

  private var usableCredentials: WatchDirectCredentials? {
    guard let credentials, credentials.expiresAt / 1000 > Date().timeIntervalSince1970 else { return nil }
    return credentials
  }

  private func directServer(_ serverId: String) -> WatchDirectServer? {
    usableCredentials?.servers.first { $0.serverId == serverId }
  }

  var updatedAt: Date? {
    switch snapshot {
    case .ready(let ready): return Date(timeIntervalSince1970: ready.generatedAt / 1000)
    case .locked(let locked): return Date(timeIntervalSince1970: locked.generatedAt / 1000)
    case .signedOut, .none: return nil
    }
  }

  var showsAge: Bool {
    !fresh && updatedAt != nil
  }

  var showsConnectionNote: Bool {
    serversOffline || showsAge
  }

  var serversOffline: Bool {
    guard case .ready(let ready) = snapshot else { return false }
    return !ready.live && !(ready.paused ?? false)
  }

  func agent(_ key: AgentKey) -> WatchAgent? {
    guard case .ready(let ready) = snapshot else { return nil }
    return ready.agents.first { $0.key == key }
  }

  func channel(_ key: AgentKey) -> WatchChannel? {
    guard case .ready(let ready) = snapshot else { return nil }
    return ready.channels?.first { $0.key == key }
  }

  var live: Bool {
    if case .ready(let ready) = snapshot { return ready.live }
    return false
  }

  private var missingAvatars: [String] {
    guard case .ready(let ready) = snapshot else { return [] }
    let ordered =
      ready.agents.compactMap(\.avatar)
      + ready.agents.flatMap { [$0.faces?.waiting, $0.faces?.working].compactMap { $0 } }
      + ready.servers.compactMap(\.picture)
    var seen = Set<String>()
    return ordered.filter { Self.avatarURL($0) != nil && !Self.hasPicture($0) && seen.insert($0).inserted }
  }

  var language: String {
    if case .ready(let ready) = snapshot { return ready.language }
    return Locale.current.identifier
  }

  func picture(_ server: WatchServer) -> UIImage? {
    server.picture.flatMap(picture(named:))
  }

  func tint(_ server: WatchServer, accent: String) -> Color {
    pictureTint(server) ?? server.tint(accent: accent)
  }

  private func pictureTint(_ server: WatchServer) -> Color? {
    guard let name = server.picture, let image = picture(named: name) else { return nil }
    if let known = pictureTints[name] { return known }
    let found = image.dominantColor
    pictureTints.updateValue(found, forKey: name)
    return found
  }

  func picture(_ agent: WatchAgent) -> UIImage? {
    if let face = agent.face, let image = picture(named: face) { return image }
    return agent.avatar.flatMap(picture(named:))
  }

  private func picture(named name: String) -> UIImage? {
    _ = avatarRevision
    guard let url = Self.avatarURL(name) else { return nil }
    if let image = pictures[name] { return image }
    guard let image = UIImage(contentsOfFile: url.path) else { return nil }
    pictures[name] = image
    return image
  }

  func open(_ url: URL) {
    guard url.scheme == Self.urlScheme, url.host == "agent",
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
      let serverId = items.first(where: { $0.name == "server" })?.value,
      let id = items.first(where: { $0.name == "agent" })?.value
    else { return }
    focus = AgentKey(serverId: serverId, id: id)
  }

  func finishBackgroundDelivery() async {
    let deadline = Date().addingTimeInterval(Self.backgroundLimit)
    while Date() < deadline, let session, session.activationState != .activated || session.hasContentPending {
      try? await Task.sleep(nanoseconds: 200_000_000)
    }
    await Task.yield()
  }

  func runWhileActive() async {
    scheduleBackgroundRefresh()
    if let session, session.activationState == .activated {
      linkChanged(reachable: session.isReachable, needsUnlock: session.iOSDeviceNeedsUnlockAfterRebootForReachability)
    }
    var lastRefresh = Date.distantPast
    while !Task.isCancelled {
      clock = Date()
      if Date().timeIntervalSince(lastRefresh) >= currentRefreshInterval {
        lastRefresh = Date()
        Task { await refresh() }
      }
      try? await Task.sleep(nanoseconds: 5_000_000_000)
    }
  }

  private var currentRefreshInterval: TimeInterval {
    usableCredentials?.servers.isEmpty == false ? Self.directRefreshInterval : Self.refreshInterval
  }

  func refresh() async {
    await refresh(phoneAllowed: true)
  }

  func backgroundRefresh() async {
    defer { scheduleBackgroundRefresh() }
    guard usableCredentials != nil, snapshot != nil else { return }
    await refresh(phoneAllowed: false)
  }

  func scheduleBackgroundRefresh() {
    guard usableCredentials != nil else { return }
    WKApplication.shared().scheduleBackgroundRefresh(
      withPreferredDate: Date().addingTimeInterval(Self.backgroundRefreshInterval),
      userInfo: Self.backgroundRefreshIdentifier as NSString
    ) { _ in }
  }

  private func refresh(phoneAllowed: Bool) async {
    let phoneReady = phoneAllowed && activated
    guard !refreshing, phoneReady || usableCredentials != nil else { return }
    refreshing = true
    defer { refreshing = false }
    if phoneReady { await pairIfNeeded() }
    let result = await refreshEverywhere(phoneAllowed: phoneReady)
    if result.ok {
      refreshError = nil
      markFresh()
    } else if result.error == .timeout {
      refreshError = text(TextKey.error(.timeout))
    } else {
      refreshError = result.message ?? text(TextKey.error(result.error ?? .failed))
    }
    if result.ok { await loadMissingAvatars(phoneAllowed: phoneReady) }
  }

  private func pairIfNeeded() async {
    let now = Date()
    guard reachable, now >= nextPairAttempt else { return }
    if let credentials = usableCredentials,
      credentials.expiresAt / 1000 - now.timeIntervalSince1970 > Self.pairMargin
    {
      return
    }
    nextPairAttempt = now.addingTimeInterval(Self.pairRetry)
    let publicKey = WatchKeychain.signingKey().publicKey
    let result = await exchange(.pair(publicKey: publicKey))
    if !result.ok {
      nextPairAttempt = Date().addingTimeInterval(Self.pairFailureRetry)
    } else if let next = result.direct, URL(string: next.authUrl)?.scheme == "https" {
      await useCredentials(next)
    }
    if let json = result.snapshot { apply(json: json, fresh: result.ok, origin: .phone) }
  }

  private func useCredentials(_ next: WatchDirectCredentials?) async {
    credentials = next
    if let next {
      WatchKeychain.save(next)
    } else {
      WatchKeychain.removeCredentials()
      directActive = false
    }
    await direct.reset()
    scheduleBackgroundRefresh()
  }

  private func runDirect(_ command: WatchCommand, on server: WatchDirectServer) async -> WatchResult? {
    guard let credentials = usableCredentials else { return nil }
    do {
      let result = try await direct.run(command, server: server, credentials: credentials)
      directActive = true
      return result
    } catch WatchDirectFailure.sessionEnded {
      if self.credentials?.watchSessionId == credentials.watchSessionId {
        nextPairAttempt = .distantPast
        await useCredentials(nil)
      }
      return nil
    } catch {
      return nil
    }
  }

  private func refreshEverywhere(phoneAllowed: Bool) async -> WatchResult {
    guard let credentials = usableCredentials, !credentials.servers.isEmpty else {
      guard phoneAllowed else { return WatchResult(ok: false, error: .offline) }
      let result = await exchange(.refresh(language: nil))
      if let json = result.snapshot { apply(json: json, fresh: result.ok, origin: .phone) }
      return result
    }
    let previous = readySnapshot
    let language = previous?.language
    let order = previous?.servers.map(\.id) ?? credentials.servers.map(\.serverId)
    let reachableServers = credentials.servers.filter { order.contains($0.serverId) || previous == nil }
    let needsPhoneNow = phoneAllowed && order.contains { id in !reachableServers.contains { $0.serverId == id } }
    async let phoneEarly = phoneRefresh(needsPhoneNow)
    var parts: [String: WatchReadySnapshot] = [:]
    await withTaskGroup(of: (String, WatchResult?).self) { group in
      for server in reachableServers {
        group.addTask { @MainActor in
          (server.serverId, await self.runDirect(.refresh(language: language), on: server))
        }
      }
      for await (serverId, result) in group {
        guard let result, result.ok, let json = result.snapshot,
          case .ready(let ready)? = WatchSnapshot.decode(json: json)
        else { continue }
        parts[serverId] = ready
      }
    }
    var phoneResult = await phoneEarly
    let failed = reachableServers.contains { parts[$0.serverId] == nil }
    if phoneResult == nil, failed, phoneAllowed {
      phoneResult = await exchange(.refresh(language: nil))
    }
    var phone: WatchReadySnapshot?
    if let json = phoneResult?.snapshot, let decoded = WatchSnapshot.decode(json: json) {
      if case .ready(let ready) = decoded {
        phone = ready
        learnDirectServers(from: ready)
      } else {
        apply(json: json, fresh: phoneResult?.ok ?? false, origin: .phone)
        return phoneResult ?? WatchResult(ok: false, error: .failed)
      }
    }
    if parts.isEmpty {
      directActive = false
      if let phone, let phoneResult { apply(.ready(phone), fresh: phoneResult.ok, origin: .phone) }
      return phoneResult ?? WatchResult(ok: false, error: .offline)
    }
    guard let merged = WatchMerge.merge(parts: parts, phone: phone, previous: previous, hasPicture: Self.hasPicture) else {
      return WatchResult(ok: false, error: .failed)
    }
    apply(.ready(merged), fresh: true, origin: .merged)
    return WatchResult(ok: true)
  }

  private func phoneRefresh(_ needed: Bool) async -> WatchResult? {
    needed ? await exchange(.refresh(language: nil)) : nil
  }

  private var readySnapshot: WatchReadySnapshot? {
    if case .ready(let ready) = snapshot { return ready }
    return nil
  }

  private func learnDirectServers(from ready: WatchReadySnapshot) {
    guard var next = credentials else { return }
    var servers: [WatchDirectServer] = []
    for server in ready.servers {
      let known = next.servers.first { $0.serverId == server.id }
      if let watchKey = server.watchKey {
        servers.append(
          WatchDirectServer(serverId: server.id, hostId: known?.hostId ?? server.id, watchKey: watchKey))
      } else if let known {
        servers.append(known)
      }
    }
    guard servers != next.servers else { return }
    next.servers = servers
    credentials = next
    WatchKeychain.save(next)
  }

  private func applyHostResult(_ result: WatchResult, serverId: String) {
    guard let json = result.snapshot, case .ready(let ready)? = WatchSnapshot.decode(json: json),
      let merged = WatchMerge.merge(
        parts: [serverId: ready], phone: nil, previous: readySnapshot, hasPicture: Self.hasPicture)
    else { return }
    apply(.ready(merged), fresh: true, origin: .merged)
  }

  private func route(_ command: WatchCommand) async -> WatchResult {
    if case .open = command {
      return await exchange(command)
    }
    if let serverId = command.serverId, let server = directServer(serverId),
      let result = await runDirect(command, on: server)
    {
      applyHostResult(result, serverId: serverId)
      return result
    }
    let result = await exchange(command)
    if let json = result.snapshot { apply(json: json, fresh: true, origin: .phone) }
    return result
  }

  func markRead(_ agent: WatchAgent) async {
    guard (agent.unread ?? 0) > 0, canAct else { return }
    _ = await route(.read(serverId: agent.serverId, agentId: agent.id))
  }

  func markRead(_ channel: WatchChannel) async {
    guard (channel.unread ?? 0) > 0, canAct else { return }
    _ = await route(.readChannel(serverId: channel.serverId, channelId: channel.id))
  }

  private func loadMissingAvatars(phoneAllowed: Bool) async {
    let names = missingAvatars
    guard !names.isEmpty, let ready = readySnapshot else { return }
    let deadline = Date().addingTimeInterval(Self.avatarLoadLimit)
    var byServer: [String: [String]] = [:]
    for name in names {
      for serverId in Set(ready.agents.filter { $0.pictureNames.contains(name) }.map(\.serverId)) {
        byServer[serverId, default: []].append(name)
      }
    }
    var remaining = Set(names)
    for (serverId, serverNames) in byServer {
      guard let server = directServer(serverId) else { continue }
      let saved = await loadAvatars(serverNames.filter(remaining.contains), until: deadline) { batch in
        guard let result = await self.runDirect(.avatars(names: batch), on: server), result.ok else { return nil }
        return result.avatars
      }
      remaining.subtract(saved)
    }
    guard phoneAllowed else { return }
    _ = await loadAvatars(names.filter(remaining.contains), until: deadline) { batch in
      let result = await self.exchange(.avatars(names: batch))
      return result.ok ? result.avatars : nil
    }
  }

  private func loadAvatars(
    _ names: [String], until deadline: Date, request: ([String]) async -> [String: String]?
  ) async -> Set<String> {
    var pending = names
    var saved = Set<String>()
    while !pending.isEmpty, Date() < deadline {
      let batch = Array(pending.prefix(Self.avatarBatch))
      guard let avatars = await request(batch), let arrived = saveAvatars(avatars, wanted: Set(batch)) else { break }
      saved.formUnion(arrived)
      let done = arrived.isEmpty ? Set(batch) : arrived
      pending.removeAll { done.contains($0) }
    }
    return saved
  }

  private func saveAvatars(_ avatars: [String: String], wanted: Set<String>) -> Set<String>? {
    guard case .ready = snapshot, let folder = Self.avatarFolder else { return nil }
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    var saved = Set<String>()
    for (name, base64) in avatars where wanted.contains(name) {
      guard let url = Self.avatarURL(name), let data = Data(base64Encoded: base64),
        (try? data.write(to: url, options: .atomic)) != nil
      else { continue }
      saved.insert(name)
    }
    if !saved.isEmpty { pictureArrived() }
    return saved
  }

  @discardableResult
  func perform(_ command: WatchCommand, done: String) async -> Bool {
    guard canAct else { return false }
    busy = true
    WKInterfaceDevice.current().play(.click)
    let result = await route(command)
    busy = false
    if result.ok {
      markFresh()
      WKInterfaceDevice.current().play(.success)
      let color = command.agentKey.flatMap(agent)?.color ?? command.channelKey.flatMap(channel)?.color
      show(WatchFeedback(text: done, success: true, color: color))
    } else {
      WKInterfaceDevice.current().play(.failure)
      let message = result.message.flatMap { $0.isEmpty ? nil : $0 } ?? text(TextKey.error(result.error ?? .failed))
      show(WatchFeedback(text: message, success: false))
    }
    return result.ok
  }

  private func show(_ next: WatchFeedback) {
    feedback = next
    feedbackTask?.cancel()
    let seconds: UInt64 = next.success ? 2 : 4
    feedbackTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
      guard !Task.isCancelled else { return }
      self?.feedback = nil
    }
  }

  private func linkChanged(reachable next: Bool, needsUnlock: Bool) {
    phoneNeedsUnlock = needsUnlock
    offlineTask?.cancel()
    offlineTask = nil
    if next {
      reachable = true
      return
    }
    guard reachable else { return }
    offlineTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(Self.offlineGrace * 1_000_000_000))
      guard !Task.isCancelled, let self else { return }
      self.reachable = false
      self.lastFresh = nil
    }
  }

  private func markFresh() {
    lastFresh = Date()
    clock = Date()
  }

  private func exchange(_ command: WatchCommand) async -> WatchResult {
    let failed = WatchResult(ok: false, error: .failed, message: text(TextKey.error(.failed)))
    guard let session, session.activationState == .activated, let json = command.json() else {
      return failed
    }
    let timeout = WatchResult(ok: false, error: .timeout, message: text(TextKey.error(.timeout)))
    return await withCheckedContinuation { continuation in
      let once = ResumeOnce(continuation)
      session.sendMessage(
        [watchProtocolKey: watchProtocolVersion, "command": json],
        replyHandler: { reply in
          let result = (reply["result"] as? String).flatMap(WatchResult.decode(json:)) ?? failed
          once.resume(result)
        },
        errorHandler: { _ in
          once.resume(timeout)
        })
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.answerTimeout) {
        once.resume(timeout)
      }
    }
  }

  private func apply(json: String, fresh: Bool, origin: Origin) {
    guard let next = WatchSnapshot.decode(json: json) else { return }
    apply(next, json: json, fresh: fresh, origin: origin)
  }

  private func apply(_ next: WatchSnapshot, fresh: Bool, origin: Origin) {
    guard let data = try? JSONEncoder().encode(next), let json = String(data: data, encoding: .utf8) else { return }
    apply(next, json: json, fresh: fresh, origin: origin)
  }

  private func apply(_ next: WatchSnapshot, json: String, fresh: Bool, origin: Origin) {
    if let snapshot, next.generatedAt < snapshot.generatedAt {
      return
    }
    switch next {
    case .signedOut:
      removeEverything()
      snapshot = nil
      lastFresh = nil
      return
    case .locked:
      Self.removeAvatars(keeping: [])
      pictures = [:]
      pictureTints = [:]
      ComplicationData.write(.locked)
    case .ready(let ready):
      if origin == .phone {
        forgetCredentials(ifAccountIsNot: ready.account)
        learnDirectServers(from: ready)
      }
      let kept = Set(ready.agents.flatMap(\.pictureNames) + ready.servers.compactMap(\.picture))
      Self.removeAvatars(keeping: kept)
      pictures = pictures.filter { name, _ in kept.contains(name) }
      pictureTints = pictureTints.filter { name, _ in kept.contains(name) }
      ComplicationData.write(.ready(ready, previous: readySnapshot))
    }
    defaults.set(json, forKey: Self.snapshotKey)
    snapshot = next
    if fresh { markFresh() }
  }

  private func forgetCredentials(ifAccountIsNot account: String?) {
    guard let account, let credentials, credentials.account != account else { return }
    self.credentials = nil
    WatchKeychain.removeCredentials()
    directActive = false
    nextPairAttempt = .distantPast
    Task { await direct.reset() }
  }

  private func removeEverything() {
    WatchKeychain.removeAll()
    credentials = nil
    directActive = false
    nextPairAttempt = .distantPast
    Task { await direct.reset() }
    defaults.removeObject(forKey: Self.snapshotKey)
    UserDefaults.standard.removeObject(forKey: Self.serverKey)
    if let folder = Self.avatarFolder { try? FileManager.default.removeItem(at: folder) }
    pictures = [:]
    pictureTints = [:]
    avatarRevision += 1
    ComplicationData.remove()
  }

  nonisolated static func payload(_ message: [String: Any]) -> String? {
    guard (message[watchProtocolKey] as? Int) == watchProtocolVersion else { return nil }
    return message["payload"] as? String
  }

  private func pictureArrived() {
    if case .locked = snapshot {
      Self.removeAvatars(keeping: [])
      return
    }
    pictures = [:]
    pictureTints = [:]
    avatarRevision += 1
    refreshComplication()
  }

  func refreshComplication() {
    if let readySnapshot { ComplicationData.write(.ready(readySnapshot)) }
  }

  nonisolated static var avatarFolder: URL? {
    let base =
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: watchAppGroup)
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    return base?.appendingPathComponent("watch-avatars", isDirectory: true)
  }

  nonisolated static func avatarURL(_ name: String) -> URL? {
    guard !name.isEmpty, name.count <= 200, !name.contains("/"), !name.hasPrefix(".") else { return nil }
    return avatarFolder?.appendingPathComponent(name, isDirectory: false)
  }

  nonisolated static func hasPicture(_ name: String) -> Bool {
    guard let url = avatarURL(name) else { return false }
    return FileManager.default.fileExists(atPath: url.path)
  }

  nonisolated static func removeAvatars(keeping names: Set<String>) {
    guard let folder = avatarFolder,
      let files = try? FileManager.default.contentsOfDirectory(atPath: folder.path)
    else { return }
    for file in files where !names.contains(file) {
      try? FileManager.default.removeItem(at: folder.appendingPathComponent(file))
    }
  }
}

extension WatchSession: WCSessionDelegate {
  nonisolated func session(
    _ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?
  ) {
    let reachable = session.isReachable
    let needsUnlock = session.iOSDeviceNeedsUnlockAfterRebootForReachability
    let json = Self.payload(session.receivedApplicationContext)
    Task { @MainActor in
      self.activated = activationState == .activated
      self.linkChanged(reachable: reachable, needsUnlock: needsUnlock)
      if let json { self.apply(json: json, fresh: false, origin: .phone) }
      if reachable { await self.refresh() }
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    let reachable = session.isReachable
    let needsUnlock = session.iOSDeviceNeedsUnlockAfterRebootForReachability
    Task { @MainActor in
      self.linkChanged(reachable: reachable, needsUnlock: needsUnlock)
      if reachable { await self.refresh() }
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    guard let json = Self.payload(applicationContext) else { return }
    Task { @MainActor in self.apply(json: json, fresh: true, origin: .phone) }
  }

  nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    guard let json = Self.payload(userInfo) else { return }
    Task { @MainActor in self.apply(json: json, fresh: false, origin: .phone) }
  }
}

private final class ResumeOnce: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<WatchResult, Never>?

  init(_ continuation: CheckedContinuation<WatchResult, Never>) {
    self.continuation = continuation
  }

  func resume(_ result: WatchResult) {
    lock.lock()
    let pending = continuation
    continuation = nil
    lock.unlock()
    pending?.resume(returning: result)
  }
}
