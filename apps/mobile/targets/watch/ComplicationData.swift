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
    picture = [agent.face, agent.avatar].compactMap { $0 }.first(where: WatchSession.hasPicture)
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

  static let storageKey = "openbot.watch.complication"
  static let none = ComplicationData(state: "none", count: 0, text: "", name: nil, color: nil)
  static let locked = ComplicationData(state: "locked", count: 0, text: "", name: nil, color: nil)

  static func ready(_ all: WatchReadySnapshot, previous: WatchReadySnapshot? = nil) -> ComplicationData {
    let chosen = UserDefaults.standard.string(forKey: WatchSession.serverKey) ?? ""
    let snapshot = all.forServer(chosen)
    let previous = previous?.forServer(chosen)
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
    let shown = featured(snapshot.agents, previous: previous?.agents, shown: stored()?.agent)
    let others = AgentCounts(
      snapshot.agents.filter { $0.key != shown?.key }, channels: snapshot.channels ?? [])
    return ComplicationData(
      state: "ready", count: waiting.count, text: label, name: waiting.first?.name,
      color: waiting.first?.color, serverId: waiting.first?.serverId, agentId: waiting.first?.id,
      working: counts.working, agent: shown.map { ComplicationAgent($0, text: text) },
      unread: counts.unread, moreWaiting: others.waiting, moreUnread: others.unread,
      moreLabel: AgentCounts(waiting: others.waiting, unread: others.unread).line(text))
  }

  private static func featured(
    _ agents: [WatchAgent], previous: [WatchAgent]?, shown: ComplicationAgent?
  ) -> WatchAgent? {
    let kept = shown.flatMap { shown in agents.first { $0.serverId == shown.serverId && $0.id == shown.id } }
    let waiting = agents.filter { $0.wait != nil || $0.state == .waiting }
    if let kept, waiting.contains(where: { $0.key == kept.key }) { return kept }
    if let first = waiting.first { return first }
    if let changed = agents.first(where: { hasNews($0, since: previous) }) { return changed }
    if let kept { return kept }
    return agents.first { $0.state == .working }
      ?? agents.first { ($0.unread ?? 0) > 0 }
      ?? agents.first
  }

  private static func hasNews(_ agent: WatchAgent, since previous: [WatchAgent]?) -> Bool {
    guard let old = previous?.first(where: { $0.key == agent.key }) else { return false }
    return agent.reply != old.reply || agent.updated != old.updated || (agent.unread ?? 0) > (old.unread ?? 0)
  }

  private static func stored() -> ComplicationData? {
    guard let stored = UserDefaults(suiteName: watchAppGroup)?.data(forKey: storageKey) else { return nil }
    return try? JSONDecoder().decode(ComplicationData.self, from: stored)
  }

  static func write(_ data: ComplicationData) {
    guard let defaults = UserDefaults(suiteName: watchAppGroup) else { return }
    if stored() == data {
      return
    }
    guard let encoded = try? JSONEncoder().encode(data) else { return }
    defaults.set(encoded, forKey: storageKey)
    WidgetCenter.shared.reloadAllTimelines()
  }

  static func remove() {
    UserDefaults(suiteName: watchAppGroup)?.removeObject(forKey: storageKey)
    WidgetCenter.shared.reloadAllTimelines()
  }
}
