import SwiftUI

struct AgentGroup: Identifiable {
  let id: String
  let title: String
  let agents: [WatchAgent]
}

struct AgentListView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let snapshot: WatchReadySnapshot

  var body: some View {
    if snapshot.agents.isEmpty {
      EmptyAgentsView(live: snapshot.live)
    } else {
      List {
        if session.showsConnectionNote {
          ConnectionNote()
            .listRowBackground(Color.clear)
        }
        ForEach(groups) { group in
          Section {
            ForEach(group.agents) { agent in
              AgentRow(agent: agent)
            }
          } header: {
            Text(group.title)
              .textCase(nil)
          }
        }
      }
      .navigationTitle(Text(verbatim: "OpenBot"))
    }
  }

  private var groups: [AgentGroup] {
    let pinned = snapshot.agents.filter(\.isPinned)
    let others = snapshot.agents.filter { !$0.isPinned }
    let waiting = others.filter { $0.state == .waiting }
    let unread = others.filter { $0.state != .waiting && ($0.unread ?? 0) > 0 }
    let rest = others.filter { $0.state != .waiting && ($0.unread ?? 0) == 0 }
    var result: [AgentGroup] = []
    if !pinned.isEmpty {
      result.append(AgentGroup(id: "pinned", title: text(TextKey.pinned), agents: pinned))
    }
    if !unread.isEmpty {
      result.append(AgentGroup(id: "unread", title: text(TextKey.unread), agents: unread))
    }
    if !waiting.isEmpty {
      result.append(AgentGroup(id: "waiting", title: text(TextKey.needsYou), agents: waiting))
    }
    for server in snapshot.servers {
      let agents = rest.filter { $0.serverId == server.id }
      if !agents.isEmpty {
        result.append(AgentGroup(id: "server-\(server.id)", title: server.name, agents: agents))
      }
    }
    let known = Set(snapshot.servers.map(\.id))
    let unlisted = rest.filter { !known.contains($0.serverId) }
    if !unlisted.isEmpty {
      result.append(AgentGroup(id: "other", title: unlisted[0].server, agents: unlisted))
    }
    return result
  }
}

struct AgentRow: View {
  @Environment(\.watchText) private var text
  let agent: WatchAgent

  var body: some View {
    let style = AgentStateStyle(agent: agent, text: text)
    NavigationLink(value: WatchRoute.agent(agent.key)) {
      HStack(spacing: 8) {
        AgentAvatar(agent: agent, size: 32)
        VStack(alignment: .leading, spacing: 1) {
          Text(agent.name)
            .font(.headline)
            .lineLimit(1)
          Label(style.title, systemImage: style.symbol)
            .font(.caption2)
            .lineLimit(1)
            .foregroundStyle(style.tint)
        }
        Spacer(minLength: 0)
        if let unread = agent.unread, unread > 0 {
          Text(verbatim: unread > 99 ? "99+" : String(unread))
            .font(.caption2.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.blue, in: Capsule())
        }
      }
      .padding(.vertical, 2)
    }
  }
}
