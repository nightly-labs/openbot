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
    var channels: [WatchChannel] = []
    for id in order {
      let known = listed?.servers.first { $0.id == id }
      if let part = parts[id] {
        var server = part.servers.first { $0.id == id } ?? part.servers.first ?? WatchServer(
          id: id, name: known?.name ?? id, online: true)
        server.id = id
        server.online = true
        if server.watchKey == nil { server.watchKey = known?.watchKey }
        let sameLook =
          (server.color == nil || server.color == known?.color) && (server.shape == nil || server.shape == known?.shape)
        if server.color == nil { server.color = known?.color }
        if server.shape == nil { server.shape = known?.shape }
        if server.picture == nil, sameLook { server.picture = known?.picture }
        server.hiddenAgents = known?.hiddenAgents
        server.hiddenChannels = known?.hiddenChannels
        servers.append(server)
        let hiddenAgents = Set(known?.hiddenAgents ?? [])
        let hiddenChannels = Set(known?.hiddenChannels ?? [])
        agents += part.agents.filter { !hiddenAgents.contains($0.id) }.map { agent in
          var copy = agent
          copy.serverId = id
          copy.avatar = picture(for: copy, known: [phone, previous], hasPicture: hasPicture)
          if copy.faces == nil { copy.faces = faces(for: copy, known: [phone, previous]) }
          if copy.updatedAt == nil { copy.updatedAt = updatedAt(for: copy, known: [phone, previous]) }
          return copy
        }
        let partChannels = part.channels?.filter { !hiddenChannels.contains($0.id) }.map { channel in
          var copy = channel
          copy.serverId = id
          return copy
        }
        channels += partChannels ?? (listed?.channels ?? []).filter { $0.serverId == id }
      } else if let listed, let known {
        servers.append(known)
        agents += listed.agents.filter { $0.serverId == id }
        channels += (listed.channels ?? []).filter { $0.serverId == id }
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
      agents: shown,
      channels: channels)
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

  static func updatedAt(for agent: WatchAgent, known snapshots: [WatchReadySnapshot?]) -> Double? {
    snapshots.lazy.compactMap { snapshot in
      snapshot?.agents.first { $0.serverId == agent.serverId && $0.id == agent.id }?.updatedAt
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
