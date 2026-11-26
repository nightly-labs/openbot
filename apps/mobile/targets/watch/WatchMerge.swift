import Foundation

enum WatchMerge {
  static let agentLimit = 40

  static func merge(
    parts: [String: WatchReadySnapshot], phone: WatchReadySnapshot?, previous: WatchReadySnapshot?,
    hasPicture: (String) -> Bool
  ) -> WatchReadySnapshot? {
    let listed = phone ?? previous
    guard let base = listed ?? parts.keys.sorted().first.flatMap({ parts[$0] }) else { return nil }
    var order = listed?.servers.map(\.id) ?? []
    for id in parts.keys.sorted() where !order.contains(id) { order.append(id) }

    var servers: [WatchServer] = []
    var agents: [WatchAgent] = []
    for id in order {
      let known = listed?.servers.first { $0.id == id }
      if let part = parts[id] {
        var server = part.servers.first { $0.id == id } ?? part.servers.first ?? WatchServer(
          id: id, name: known?.name ?? id, online: true)
        server.id = id
        server.online = true
        if server.watchKey == nil { server.watchKey = known?.watchKey }
        servers.append(server)
        agents += part.agents.map { agent in
          var copy = agent
          copy.serverId = id
          copy.avatar = picture(for: copy, known: [phone, previous], hasPicture: hasPicture)
          if copy.faces == nil { copy.faces = faces(for: copy, known: [phone, previous]) }
          return copy
        }
      } else if let listed, let known {
        servers.append(known)
        agents += listed.agents.filter { $0.serverId == id }
      }
    }

    let shown = withinLimit(agents)
    let waiting = shown.filter { $0.state == .waiting }.count
    var text = base.text
    let sources = [phone, previous].compactMap { $0 } + order.compactMap { parts[$0] }
    if let match = sources.first(where: { $0.agents.filter { $0.state == .waiting }.count == waiting }),
      let label = match.text[TextKey.complicationWaiting]
    {
      text[TextKey.complicationWaiting] = label
    }
    let now = Date().timeIntervalSince1970 * 1000
    return WatchReadySnapshot(
      version: watchProtocolVersion,
      generatedAt: max(now, (previous?.generatedAt ?? 0) + 1),
      account: phone?.account ?? previous?.account,
      live: servers.contains { $0.online },
      paused: parts.isEmpty ? base.paused : false,
      accent: base.accent,
      language: base.language,
      text: text,
      servers: servers,
      agents: shown)
  }

  static func picture(
    for agent: WatchAgent, known snapshots: [WatchReadySnapshot?], hasPicture: (String) -> Bool
  ) -> String? {
    let names = snapshots.compactMap { snapshot in
      snapshot?.agents.first { $0.serverId == agent.serverId && $0.id == agent.id }?.avatar
    }
    return names.first(where: hasPicture) ?? agent.avatar ?? names.first
  }

  static func faces(for agent: WatchAgent, known snapshots: [WatchReadySnapshot?]) -> WatchFaces? {
    snapshots.lazy.compactMap { snapshot in
      snapshot?.agents.first { $0.serverId == agent.serverId && $0.id == agent.id }?.faces
    }.first
  }

  static func withinLimit(_ agents: [WatchAgent]) -> [WatchAgent] {
    let room = max(0, agentLimit - agents.filter { $0.state == .waiting }.count)
    var others = 0
    let kept = agents.filter { agent in
      if agent.state == .waiting { return true }
      others += 1
      return others <= room
    }
    return Array(kept.prefix(agentLimit))
  }
}
