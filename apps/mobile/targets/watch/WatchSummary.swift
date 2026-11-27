import SwiftUI

extension WatchReadySnapshot {
  func chosenServer(_ id: String) -> WatchServer? {
    servers.first { $0.id == id } ?? servers.first
  }

  var isEmpty: Bool {
    agents.isEmpty && (channels ?? []).isEmpty
  }

  func forServer(_ id: String) -> WatchReadySnapshot {
    guard servers.count > 1, let server = chosenServer(id) else { return self }
    var copy = self
    copy.servers = [server]
    copy.agents = agents.filter { $0.serverId == server.id }
    copy.channels = channels?.filter { $0.serverId == server.id }
    return copy
  }
}

struct AgentCounts {
  let waiting: Int
  let unread: Int
  let working: Int

  init(_ agents: [WatchAgent], channels: [WatchChannel] = []) {
    waiting = agents.filter { $0.state == .waiting }.count
    unread = agents.filter { ($0.unread ?? 0) > 0 }.count + channels.filter { ($0.unread ?? 0) > 0 }.count
    working = agents.filter { $0.state == .working }.count + channels.filter(\.isWorking).count
  }

  init(waiting: Int, unread: Int, working: Int = 0) {
    self.waiting = waiting
    self.unread = unread
    self.working = working
  }

  func line(_ text: WatchText) -> String? {
    let parts = [
      waiting > 0 ? "\(waiting) \(text(TextKey.needsYou))" : nil,
      unread > 0 ? "\(unread) \(text(TextKey.unread))" : nil,
      working > 0 ? "\(working) \(text(TextKey.stateWorking))" : nil,
    ].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
}

struct AgentStateStyle {
  let title: String
  let symbol: String
  let tint: Color

  init(agent: WatchAgent, text: WatchText, working: Color? = nil) {
    switch agent.wait {
    case .approval, .phone(.approval, _), .unknown:
      title = text(TextKey.stateApproval)
      symbol = "checkmark.shield"
    case .question, .phone(.question, _):
      title = text(TextKey.stateQuestion)
      symbol = "questionmark.bubble"
    case .phone(.takeover, _):
      title = text(TextKey.stateTakeover)
      symbol = "safari"
    case .none:
      switch agent.state {
      case .working, .waiting:
        title = text(TextKey.stateWorking)
        symbol = "ellipsis"
      case .idle:
        let idle = text(TextKey.stateIdle)
        if let updated = agent.updated, !updated.isEmpty {
          title = "\(idle) · \(updated)"
        } else {
          title = idle
        }
        symbol = "moon.zzz"
      }
    }
    if agent.wait != nil {
      tint = .orange
    } else {
      tint = agent.state == .idle ? .secondary : working ?? Color.stateTint(hex: agent.color)
    }
  }
}
