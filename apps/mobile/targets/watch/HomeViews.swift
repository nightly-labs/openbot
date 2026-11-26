import SwiftUI

enum HomePage: Hashable {
  case summary
  case list
}

struct HomeView: View {
  @Environment(\.scenePhase) private var scenePhase
  let snapshot: WatchReadySnapshot
  @Binding var path: [WatchRoute]
  @AppStorage(WatchSession.serverKey) private var chosenServerId = ""
  @State private var page = HomePage.summary

  var body: some View {
    TabView(selection: $page) {
      SummaryView(snapshot: shown, serverCount: snapshot.servers.count, path: $path)
        .tag(HomePage.summary)
      AgentListView(snapshot: shown) { path.append(.agent($0)) }
        .tag(HomePage.list)
    }
    .tabViewStyle(.page(indexDisplayMode: .always))
    .onChange(of: scenePhase) { previous, phase in
      if previous == .background, phase != .background, path.isEmpty { page = .summary }
    }
  }

  private var shown: WatchReadySnapshot {
    snapshot.forServer(chosenServerId)
  }
}

extension WatchReadySnapshot {
  func chosenServer(_ id: String) -> WatchServer? {
    servers.first { $0.id == id } ?? servers.first
  }

  func forServer(_ id: String) -> WatchReadySnapshot {
    guard servers.count > 1, let server = chosenServer(id) else { return self }
    var copy = self
    copy.servers = [server]
    copy.agents = agents.filter { $0.serverId == server.id }
    return copy
  }
}

struct AgentCounts {
  let waiting: Int
  let unread: Int
  let working: Int

  init(_ agents: [WatchAgent]) {
    waiting = agents.filter { $0.state == .waiting }.count
    unread = agents.filter { ($0.unread ?? 0) > 0 }.count
    working = agents.filter { $0.state == .working }.count
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

struct SummaryView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let snapshot: WatchReadySnapshot
  let serverCount: Int
  @Binding var path: [WatchRoute]

  var body: some View {
    GeometryReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 6) {
          if session.showsConnectionNote {
            ConnectionNote()
          }
          title
          if snapshot.agents.isEmpty {
            Text(text(TextKey.empty))
              .font(.footnote)
              .foregroundStyle(.secondary)
          } else {
            let counts = AgentCounts(snapshot.agents)
            CountLine(count: counts.waiting, title: text(TextKey.needsYou), color: .orange)
            CountLine(count: counts.unread, title: text(TextKey.unread), color: .blue)
            CountLine(count: counts.working, title: text(TextKey.stateWorking), color: .green)
            AvatarStack(agents: stacked)
              .padding(.top, 4)
          }
        }
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .leading)
      }
    }
  }

  @ViewBuilder
  private var title: some View {
    let name = snapshot.servers.first?.name ?? ""
    if serverCount > 1 {
      Button {
        path.append(.servers)
      } label: {
        HStack(spacing: 4) {
          Text(name)
            .font(.title3.weight(.semibold))
            .lineLimit(2)
            .multilineTextAlignment(.leading)
          Image(systemName: "chevron.up.chevron.down")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
        }
      }
      .buttonStyle(.plain)
      .accessibilityLabel(Text(verbatim: "\(text(TextKey.servers)), \(name)"))
    } else {
      Text(name)
        .font(.title3.weight(.semibold))
        .lineLimit(2)
    }
  }

  private var stacked: [WatchAgent] {
    let waiting = snapshot.agents.filter { $0.state == .waiting }
    let unread = snapshot.agents.filter { $0.state != .waiting && ($0.unread ?? 0) > 0 }
    let rest = snapshot.agents.filter { $0.state != .waiting && ($0.unread ?? 0) == 0 }
    return waiting + unread + rest
  }
}

struct CountLine: View {
  let count: Int
  let title: String
  let color: Color

  var body: some View {
    if count > 0 {
      HStack(spacing: 6) {
        Circle()
          .fill(color)
          .frame(width: 8, height: 8)
          .accessibilityHidden(true)
        Text(verbatim: String(count))
          .fontWeight(.semibold)
        Text(title)
          .lineLimit(1)
      }
      .font(.footnote)
      .accessibilityElement(children: .combine)
    }
  }
}

struct AvatarStack: View {
  static let shown = 5
  let agents: [WatchAgent]

  var body: some View {
    HStack(spacing: -8) {
      ForEach(agents.prefix(Self.shown)) { agent in
        AgentAvatar(agent: agent, size: 28)
      }
      if agents.count > Self.shown {
        Text(verbatim: "+\(agents.count - Self.shown)")
          .font(.caption2)
          .foregroundStyle(.secondary)
          .padding(.leading, 2)
      }
    }
    .accessibilityHidden(true)
  }
}

struct ServerPickerView: View {
  @Environment(\.watchText) private var text
  let snapshot: WatchReadySnapshot
  @Binding var path: [WatchRoute]
  @AppStorage(WatchSession.serverKey) private var chosenServerId = ""

  var body: some View {
    let chosen = snapshot.chosenServer(chosenServerId)
    List(snapshot.servers, id: \.id) { server in
      Button {
        chosenServerId = server.id
        if !path.isEmpty { path.removeLast() }
      } label: {
        HStack(spacing: 8) {
          Circle()
            .fill(server.online ? Color.green : Color.secondary)
            .frame(width: 8, height: 8)
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 1) {
            Text(server.name)
              .font(.headline)
              .lineLimit(1)
            if let line = AgentCounts(snapshot.agents.filter { $0.serverId == server.id }).line(text) {
              Text(line)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
          }
          Spacer(minLength: 0)
          if server.id == chosen?.id {
            Image(systemName: "checkmark")
              .foregroundStyle(.blue)
              .accessibilityHidden(true)
          }
        }
      }
      .accessibilityAddTraits(server.id == chosen?.id ? .isSelected : [])
    }
    .navigationTitle(text(TextKey.servers))
  }
}
