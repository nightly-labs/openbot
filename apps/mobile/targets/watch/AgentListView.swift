import SwiftUI

struct AgentGroup: Identifiable {
  let id: String
  let title: String
  var agents: [WatchAgent]
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
        if let title {
          Text(title)
            .font(.title3.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .minimumScaleFactor(0.8)
            .listRowBackground(Color.clear)
        }
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
    }
  }

  private var title: String? {
    snapshot.servers.count == 1 ? snapshot.servers.first?.name : nil
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
    let manyServers = Set(snapshot.agents.map(\.serverId)).count > 1
    var folders: [AgentGroup] = []
    for agent in rest {
      let id = "folder-\(agent.serverId)-\(agent.folder ?? "")"
      if let index = folders.firstIndex(where: { $0.id == id }) {
        folders[index].agents.append(agent)
      } else {
        folders.append(AgentGroup(id: id, title: folderTitle(agent, manyServers: manyServers), agents: [agent]))
      }
    }
    return result + folders
  }
}

private func folderTitle(_ agent: WatchAgent, manyServers: Bool) -> String {
  guard let folder = agent.folder, !folder.isEmpty else { return agent.server }
  return manyServers ? "\(agent.server) · \(folder)" : folder
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
