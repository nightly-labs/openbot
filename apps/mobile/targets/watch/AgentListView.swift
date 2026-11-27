import SwiftUI

enum ListEntry: Identifiable {
  case agent(WatchAgent)
  case channel(WatchChannel)

  var id: String {
    switch self {
    case .agent(let agent): return "agent-\(agent.serverId)-\(agent.id)"
    case .channel(let channel): return "channel-\(channel.serverId)-\(channel.id)"
    }
  }

  var serverId: String {
    switch self {
    case .agent(let agent): return agent.serverId
    case .channel(let channel): return channel.serverId
    }
  }

  var server: String {
    switch self {
    case .agent(let agent): return agent.server
    case .channel(let channel): return channel.server
    }
  }

  var folder: String? {
    switch self {
    case .agent(let agent): return agent.folder
    case .channel(let channel): return channel.folder
    }
  }

  var position: Int {
    switch self {
    case .agent(let agent): return agent.position ?? Int.max
    case .channel(let channel): return channel.position ?? Int.max
    }
  }
}

struct AgentGroup: Identifiable {
  static let pinnedId = "pinned"

  let id: String
  let title: String
  var entries: [ListEntry] = []
}

struct AgentListView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let snapshot: WatchReadySnapshot
  let open: (WatchRoute) -> Void

  var body: some View {
    if snapshot.isEmpty {
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
              PinnedGrid(entries: group.entries, open: open)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            } header: {
              Text(group.title)
                .textCase(nil)
                .padding(.bottom, 6)
            }
          } else {
            Section {
              ForEach(Array(group.entries.enumerated()), id: \.element.id) { index, entry in
                switch entry {
                case .agent(let agent):
                  AgentRow(agent: agent, divided: index > 0)
                    .listRowBackground(Color.clear)
                case .channel(let channel):
                  ChannelRow(channel: channel, divided: index > 0)
                    .listRowBackground(Color.clear)
                }
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
    let pinned = byPosition(
      snapshot.agents.filter(\.isPinned).map(ListEntry.agent)
        + (snapshot.channels ?? []).filter(\.isPinned).map(ListEntry.channel))
    let others = snapshot.agents.filter { !$0.isPinned }
    let channels = (snapshot.channels ?? []).filter { !$0.isPinned }
    let waiting = others.filter { $0.state == .waiting }
    let unreadAgents = others.filter { $0.state != .waiting && ($0.unread ?? 0) > 0 }
    let unreadChannels = channels.filter { ($0.unread ?? 0) > 0 }
    let unread = byPosition(unreadAgents.map(ListEntry.agent) + unreadChannels.map(ListEntry.channel))
    let rest = byPosition(
      others.filter { $0.state != .waiting && ($0.unread ?? 0) == 0 }.map(ListEntry.agent)
        + channels.filter { ($0.unread ?? 0) == 0 }.map(ListEntry.channel))
    var result: [AgentGroup] = []
    if !pinned.isEmpty {
      result.append(AgentGroup(id: AgentGroup.pinnedId, title: text(TextKey.pinned), entries: pinned))
    }
    if !unread.isEmpty {
      result.append(AgentGroup(id: "unread", title: text(TextKey.unread), entries: unread))
    }
    if !waiting.isEmpty {
      result.append(AgentGroup(id: "waiting", title: text(TextKey.needsYou), entries: waiting.map(ListEntry.agent)))
    }
    let manyServers = Set(rest.map(\.serverId)).count > 1
    var folders: [AgentGroup] = []
    for entry in rest {
      let id = "folder-\(entry.serverId)-\(entry.folder ?? "")"
      if let index = folders.firstIndex(where: { $0.id == id }) {
        folders[index].entries.append(entry)
      } else {
        folders.append(AgentGroup(id: id, title: folderTitle(entry, manyServers: manyServers), entries: [entry]))
      }
    }
    return result + folders
  }
}

private func byPosition(_ entries: [ListEntry]) -> [ListEntry] {
  entries.enumerated()
    .sorted { ($0.element.position, $0.offset) < ($1.element.position, $1.offset) }
    .map(\.element)
}

private func folderTitle(_ entry: ListEntry, manyServers: Bool) -> String {
  guard let folder = entry.folder, !folder.isEmpty else { return entry.server }
  return manyServers ? "\(entry.server) · \(folder)" : folder
}

struct AgentRow: View {
  static let dividerInset: CGFloat = 40

  static let workingTint = Color(white: 0.8)

  @Environment(\.watchText) private var text
  @Environment(\.themed) private var themed
  let agent: WatchAgent
  var divided = false

  var body: some View {
    let style = AgentStateStyle(agent: agent, text: text, working: themed ? Self.workingTint : .blue)
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
          UnreadBadge(count: unread)
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
  let entries: [ListEntry]
  let open: (WatchRoute) -> Void

  var body: some View {
    LazyVGrid(columns: Self.columns, spacing: 8) {
      ForEach(entries) { entry in
        switch entry {
        case .agent(let agent):
          cell(name: agent.name, unread: agent.unread ?? 0, route: .agent(agent.key)) {
            AgentAvatar(agent: agent, size: 40, stateIcon: true)
          }
        case .channel(let channel):
          cell(name: channel.name, unread: channel.unread ?? 0, route: .channel(channel.key)) {
            ChannelAvatar(channel: channel, size: 40)
          }
        }
      }
    }
  }

  private func cell<Picture: View>(
    name: String, unread: Int, route: WatchRoute, @ViewBuilder picture: () -> Picture
  ) -> some View {
    Button {
      open(route)
    } label: {
      VStack(spacing: 3) {
        picture()
          .overlay(alignment: .topTrailing) {
            if unread > 0 {
              UnreadBadge(count: unread, compact: true)
                .offset(x: 5, y: -3)
            }
          }
        Text(name)
          .font(.caption2)
          .lineLimit(1)
      }
      .frame(maxWidth: .infinity)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(Text(name))
  }
}
