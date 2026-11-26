import SwiftUI

struct AgentGroup: Identifiable {
  static let pinnedId = "pinned"

  let id: String
  let title: String
  var agents: [WatchAgent]
}

struct AgentListView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let snapshot: WatchReadySnapshot
  let open: (AgentKey) -> Void

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
          if group.id == AgentGroup.pinnedId {
            Section {
              PinnedGrid(agents: group.agents, open: open)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            } header: {
              Text(group.title)
                .textCase(nil)
                .padding(.bottom, 6)
            }
          } else {
            Section {
              ForEach(Array(group.agents.enumerated()), id: \.element.id) { index, agent in
                AgentRow(agent: agent, divided: index > 0)
                  .listRowBackground(Color.clear)
              }
            } header: {
              Text(group.title)
                .textCase(nil)
                .padding(.bottom, 6)
            }
          }
        }
      }
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
      result.append(AgentGroup(id: AgentGroup.pinnedId, title: text(TextKey.pinned), agents: pinned))
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
  static let dividerInset: CGFloat = 40

  @Environment(\.watchText) private var text
  let agent: WatchAgent
  var divided = false

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
    .overlay(alignment: .top) {
      if divided {
        Divider()
          .padding(.leading, Self.dividerInset)
          .offset(y: -4)
      }
    }
  }
}

struct PinnedGrid: View {
  static let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 3)
  let agents: [WatchAgent]
  let open: (AgentKey) -> Void

  var body: some View {
    LazyVGrid(columns: Self.columns, spacing: 8) {
      ForEach(agents) { agent in
        Button {
          open(agent.key)
        } label: {
          VStack(spacing: 3) {
            AgentAvatar(agent: agent, size: 40, stateIcon: true)
              .overlay(alignment: .topTrailing) {
                if let unread = agent.unread, unread > 0 {
                  Text(verbatim: unread > 99 ? "99+" : String(unread))
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 4)
                    .frame(minWidth: 16, minHeight: 16)
                    .background(Color.blue, in: Capsule())
                    .offset(x: 5, y: -3)
                }
              }
            Text(agent.name)
              .font(.caption2)
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(agent.name))
      }
    }
  }
}
