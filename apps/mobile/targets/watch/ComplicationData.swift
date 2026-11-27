import Foundation
import WidgetKit

let watchAppGroup = "group.run.openbot.mobile"

struct ComplicationAgent: Codable, Equatable {
  var serverId: String
  var id: String
  var name: String
  var color: String
  var kind: String
  var status: String
  var line: String?
  var picture: String?

  private static let lineLimit = 160

  init(_ agent: WatchAgent, text: WatchText) {
    serverId = agent.serverId
    id = agent.id
    name = agent.name
    color = agent.color
    kind = Self.kind(agent).rawValue
    status = AgentStateStyle(agent: agent, text: text).title
    line = Self.line(agent).map { String($0.prefix(Self.lineLimit)) }
    picture = [agent.face, agent.avatar].compactMap { $0 }.first(where: WatchAvatarFiles.has)
  }

  private static func kind(_ agent: WatchAgent) -> WatchAgentState {
    if agent.wait != nil { return .waiting }
    return agent.state
  }

  private static func line(_ agent: WatchAgent) -> String? {
    switch agent.wait {
    case .approval(let wait):
      return firstLine(wait.body) ?? firstLine(wait.title)
    case .question(let wait):
      return wait.questions.first.flatMap { firstLine($0.question) }
    case .phone(_, let text):
      return text.flatMap(firstLine) ?? agent.detail.flatMap(firstLine)
    case .unknown, .none:
      let order = agent.state == .idle ? [agent.reply, agent.detail] : [agent.detail, agent.reply]
      return order.compactMap { $0.flatMap(firstLine) }.first
    }
  }

  private static func firstLine(_ text: String) -> String? {
    text.split(whereSeparator: \.isNewline)
      .lazy
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .first { !$0.isEmpty }
  }
}

struct ComplicationData: Codable, Equatable {
  var state: String
  var count: Int
  var text: String
  var name: String?
  var color: String?
  var serverId: String?
  var agentId: String?
  var working: Int?
  var agent: ComplicationAgent?
  var unread: Int?
  var moreWaiting: Int?
  var moreUnread: Int?
  var moreLabel: String?
  var server: String?

  static let storageKey = "openbot.watch.complication"
  static let none = ComplicationData(state: "none", count: 0, text: "", name: nil, color: nil)
  static let locked = ComplicationData(state: "locked", count: 0, text: "", name: nil, color: nil)

  @MainActor
  static func update(_ all: WatchReadySnapshot, previous: WatchReadySnapshot?, chosen: String) {
    let change = save(all, previous: previous, chosen: chosen)
    if change.data { WidgetReload.schedule(newServers: change.servers) }
  }

  static func save(_ all: WatchReadySnapshot, previous: WatchReadySnapshot?, chosen: String) -> ComplicationChange {
    let main = ready(all, previous: previous, server: chosen, kept: stored()?.agent)
    var store: ComplicationStore?
    if all.servers.count > 1 {
      let kept = ComplicationStore.stored()?.data ?? [:]
      var data: [String: ComplicationData] = [:]
      for server in all.servers {
        data[server.id] = ready(all, previous: previous, server: server.id, kept: kept[server.id]?.agent)
      }
      let servers = all.servers.map { ComplicationServer(id: $0.id, name: $0.name) }
      store = ComplicationStore(servers: servers, data: data)
    }
    WidgetSource.save(all, chosen: chosen)
    return persist(main, store: store)
  }

  private static func ready(
    _ all: WatchReadySnapshot, previous: WatchReadySnapshot?, server: String, kept: ComplicationAgent?
  ) -> ComplicationData {
    let snapshot = all.forServer(server)
    let previous = previous?.forServer(server)
    let waiting = snapshot.agents.filter { $0.state == .waiting }
    let allWaiting = all.agents.filter { $0.state == .waiting }.count
    let counts = AgentCounts(snapshot.agents, channels: snapshot.channels ?? [])
    let text = WatchText(values: snapshot.text)
    let label: String
    if !waiting.isEmpty {
      label =
        waiting.count == allWaiting
        ? text(TextKey.complicationWaiting, ["count": String(waiting.count)])
        : "\(waiting.count) \(text(TextKey.needsYou))"
    } else if counts.unread > 0 {
      label = "\(counts.unread) \(text(TextKey.unread))"
    } else if counts.working > 0 {
      label = text(TextKey.stateWorking)
    } else {
      label = text(TextKey.complicationClear)
    }
    let shown = featured(snapshot.agents, previous: previous?.agents, shown: kept)
    let others = AgentCounts(
      snapshot.agents.filter { $0.key != shown?.key }, channels: snapshot.channels ?? [])
    return ComplicationData(
      state: "ready", count: waiting.count, text: label, name: waiting.first?.name,
      color: waiting.first?.color, serverId: waiting.first?.serverId, agentId: waiting.first?.id,
      working: counts.working, agent: shown.map { ComplicationAgent($0, text: text) },
      unread: counts.unread, moreWaiting: others.waiting, moreUnread: others.unread,
      moreLabel: AgentCounts(waiting: others.waiting, unread: others.unread).line(text),
      server: all.servers.count > 1 ? snapshot.servers.first?.name : nil)
  }

  private static func featured(
    _ agents: [WatchAgent], previous: [WatchAgent]?, shown: ComplicationAgent?
  ) -> WatchAgent? {
    let kept = shown.flatMap { shown in agents.first { $0.serverId == shown.serverId && $0.id == shown.id } }
    let waiting = agents.filter { $0.wait != nil || $0.state == .waiting }
    if let kept, waiting.contains(where: { $0.key == kept.key }) { return kept }
    if let first = waiting.first { return first }
    let unread = agents.filter { ($0.unread ?? 0) > 0 }
    if let newest = newest(unread) { return newest }
    if let kept, unread.contains(where: { $0.key == kept.key }) { return kept }
    if let first = unread.first { return first }
    if let newest = newest(agents) { return newest }
    if let changed = agents.first(where: { hasNews($0, since: previous) }) { return changed }
    if let kept { return kept }
    return agents.first { $0.state == .working } ?? agents.first
  }

  private static func newest(_ agents: [WatchAgent]) -> WatchAgent? {
    var newest: WatchAgent?
    for agent in agents {
      guard let time = agent.updatedAt else { continue }
      if time > newest?.updatedAt ?? -.infinity { newest = agent }
    }
    return newest
  }

  private static func hasNews(_ agent: WatchAgent, since previous: [WatchAgent]?) -> Bool {
    guard let old = previous?.first(where: { $0.key == agent.key }) else { return false }
    return agent.reply != old.reply || agent.updated != old.updated || (agent.unread ?? 0) > (old.unread ?? 0)
  }

  static func stored() -> ComplicationData? {
    guard let stored = UserDefaults(suiteName: watchAppGroup)?.data(forKey: storageKey) else { return nil }
    return try? JSONDecoder().decode(ComplicationData.self, from: stored)
  }

  @MainActor
  static func write(_ data: ComplicationData) {
    WidgetSource.remove()
    let change = persist(data, store: nil)
    if change.data { WidgetReload.schedule(newServers: change.servers) }
  }

  private static func persist(_ data: ComplicationData, store: ComplicationStore?) -> ComplicationChange {
    guard let defaults = UserDefaults(suiteName: watchAppGroup) else { return ComplicationChange() }
    let previousStore = ComplicationStore.stored()
    let dataChanged = stored() != data
    let storeChanged = previousStore != store
    guard dataChanged || storeChanged else { return ComplicationChange() }
    if dataChanged, let encoded = try? JSONEncoder().encode(data) {
      defaults.set(encoded, forKey: storageKey)
    }
    if storeChanged {
      if let store, let encoded = try? JSONEncoder().encode(store) {
        defaults.set(encoded, forKey: ComplicationStore.storageKey)
      } else {
        defaults.removeObject(forKey: ComplicationStore.storageKey)
      }
    }
    return ComplicationChange(data: true, servers: previousStore?.servers ?? [] != store?.servers ?? [])
  }

  @MainActor
  static func remove() {
    let defaults = UserDefaults(suiteName: watchAppGroup)
    defaults?.removeObject(forKey: storageKey)
    defaults?.removeObject(forKey: ComplicationStore.storageKey)
    WidgetSource.remove()
    WidgetReload.schedule(newServers: true)
    WidgetReload.flush()
  }
}

@MainActor
enum WidgetReload {
  private static let delay: Duration = .seconds(1)
  private static var pending: Task<Void, Never>?
  private static var newServers = false

  static func schedule(newServers changed: Bool) {
    newServers = newServers || changed
    pending?.cancel()
    pending = Task {
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled else { return }
      run()
    }
  }

  static func flush() {
    guard pending != nil else { return }
    run()
  }

  private static func run() {
    pending?.cancel()
    pending = nil
    if newServers { WidgetCenter.shared.invalidateConfigurationRecommendations() }
    newServers = false
    WidgetCenter.shared.reloadAllTimelines()
  }
}

struct ComplicationChange {
  var data = false
  var servers = false
}

enum WidgetSource {
  private static let snapshotKey = "openbot.watch.widget.snapshot"
  private static let chosenKey = "openbot.watch.widget.server"
  private static let freshKey = "openbot.watch.widget.fresh"

  static func save(_ snapshot: WatchReadySnapshot, chosen: String) {
    guard let defaults = UserDefaults(suiteName: watchAppGroup),
      let encoded = try? JSONEncoder().encode(snapshot)
    else { return }
    if defaults.data(forKey: snapshotKey) != encoded { defaults.set(encoded, forKey: snapshotKey) }
    if defaults.string(forKey: chosenKey) != chosen { defaults.set(chosen, forKey: chosenKey) }
    defaults.set(Date().timeIntervalSince1970, forKey: freshKey)
  }

  static func snapshot() -> WatchReadySnapshot? {
    guard let data = UserDefaults(suiteName: watchAppGroup)?.data(forKey: snapshotKey) else { return nil }
    return try? JSONDecoder().decode(WatchReadySnapshot.self, from: data)
  }

  static var chosen: String {
    UserDefaults(suiteName: watchAppGroup)?.string(forKey: chosenKey) ?? ""
  }

  static var age: TimeInterval {
    guard let fresh = UserDefaults(suiteName: watchAppGroup)?.object(forKey: freshKey) as? Double else {
      return .infinity
    }
    return Date().timeIntervalSince1970 - fresh
  }

  static func remove() {
    let defaults = UserDefaults(suiteName: watchAppGroup)
    defaults?.removeObject(forKey: snapshotKey)
    defaults?.removeObject(forKey: chosenKey)
    defaults?.removeObject(forKey: freshKey)
  }
}

struct ComplicationServer: Codable, Equatable {
  var id: String
  var name: String
}

struct ComplicationStore: Codable, Equatable {
  var servers: [ComplicationServer]
  var data: [String: ComplicationData]

  static let storageKey = "openbot.watch.complication.servers"

  static func stored() -> ComplicationStore? {
    guard let stored = UserDefaults(suiteName: watchAppGroup)?.data(forKey: storageKey) else { return nil }
    return try? JSONDecoder().decode(ComplicationStore.self, from: stored)
  }
}
