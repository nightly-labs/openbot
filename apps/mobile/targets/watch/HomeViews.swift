import SwiftUI

enum HomePage: Hashable {
  case settings
  case summary
  case list
}

struct HomeView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.themed) private var themed
  let snapshot: WatchReadySnapshot
  @Binding var path: [WatchRoute]
  @AppStorage(WatchSession.serverKey) private var chosenServerId = ""
  @State private var page = HomePage.summary

  var body: some View {
    TabView(selection: $page) {
      WatchSettingsView()
        .tag(HomePage.settings)
      SummaryView(snapshot: shown, serverCount: snapshot.servers.count, path: $path)
        .background {
          if themed, let server { ServerBackdrop(server: server, tint: tint(server)) }
        }
        .tag(HomePage.summary)
      AgentListView(snapshot: shown) { path.append($0) }
        .background {
          if themed, let server { ServerBackdrop(server: server, tint: tint(server), page: 1) }
        }
        .tag(HomePage.list)
    }
    .tabViewStyle(.page(indexDisplayMode: .always))
    .environment(\.serverPalette, themed ? server.flatMap { ServerPalette(tint: tint($0)) } : nil)
    .onChange(of: scenePhase) { previous, phase in
      if previous == .background, phase != .background, path.isEmpty { page = .summary }
    }
  }

  private func tint(_ server: WatchServer) -> Color {
    session.tint(server, accent: snapshot.accent)
  }

  private var shown: WatchReadySnapshot {
    snapshot.forServer(chosenServerId)
  }

  private var server: WatchServer? {
    snapshot.chosenServer(chosenServerId)
  }
}

struct SummaryView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  @Environment(\.serverPalette) private var palette
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
          if snapshot.isEmpty {
            Text(text(TextKey.empty))
              .font(.footnote)
              .foregroundStyle(.secondary)
          } else {
            let counts = AgentCounts(snapshot.agents, channels: snapshot.channels ?? [])
            CountLine(count: counts.waiting, title: text(TextKey.needsYou), color: palette?.attention ?? .orange)
            CountLine(count: counts.unread, title: text(TextKey.unread), color: palette?.unread ?? .blue)
            CountLine(count: counts.working, title: text(TextKey.stateWorking), color: palette?.working ?? .green)
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
    let color = palette?.title ?? .primary
    if serverCount > 1 {
      Button {
        path.append(.servers)
      } label: {
        HStack(spacing: 4) {
          Text(name)
            .font(.title3.weight(.semibold))
            .foregroundStyle(color)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
          Image(systemName: "chevron.up.chevron.down")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(palette?.label ?? .secondary)
        }
      }
      .buttonStyle(.plain)
      .accessibilityLabel(Text(verbatim: "\(text(TextKey.servers)), \(name)"))
    } else {
      Text(name)
        .font(.title3.weight(.semibold))
        .foregroundStyle(color)
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
  @Environment(\.serverPalette) private var palette
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
      .foregroundStyle(palette?.label ?? .primary)
      .accessibilityElement(children: .combine)
    }
  }
}

struct AvatarStack: View {
  static let shown = 5
  static let side: CGFloat = 28
  static let overlap: CGFloat = 12

  @Environment(\.serverPalette) private var palette
  let agents: [WatchAgent]

  var body: some View {
    HStack(spacing: 4) {
      HStack(spacing: -Self.overlap) {
        ForEach(agents.prefix(Self.shown)) { agent in
          AgentAvatar(agent: agent, size: Self.side)
        }
      }
      if agents.count > Self.shown {
        Text(verbatim: "+\(agents.count - Self.shown)")
          .font(.caption2)
          .foregroundStyle(palette?.label ?? .secondary)
      }
    }
    .accessibilityHidden(true)
  }
}

struct ServerPickerView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let snapshot: WatchReadySnapshot
  @Binding var path: [WatchRoute]
  @AppStorage(WatchSession.serverKey) private var chosenServerId = ""

  var body: some View {
    let chosen = snapshot.chosenServer(chosenServerId)
    List(snapshot.servers, id: \.id) { server in
      let tint = session.tint(server, accent: snapshot.accent)
      Button {
        chosenServerId = server.id
        session.refreshComplication()
        if !path.isEmpty { path.removeLast() }
      } label: {
        HStack(spacing: 8) {
          ServerBadge(server: server, tint: tint)
          VStack(alignment: .leading, spacing: 1) {
            Text(server.name)
              .font(.headline)
              .lineLimit(1)
            if let line = AgentCounts(
              snapshot.agents.filter { $0.serverId == server.id },
              channels: (snapshot.channels ?? []).filter { $0.serverId == server.id }
            ).line(text) {
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
      .listRowBackground(ServerRowBackdrop(server: server, tint: tint))
    }
    .navigationTitle(text(TextKey.servers))
  }
}

struct WatchSettingsView: View {
  @Environment(\.watchText) private var text
  @AppStorage(WatchSession.themeKey) private var themed = true

  var body: some View {
    List {
      Section {
        Toggle(text(TextKey.settingsTheme), isOn: $themed)
      } header: {
        Text(text(TextKey.settingsTitle))
          .textCase(nil)
      } footer: {
        Text(text(TextKey.settingsThemeDetail))
      }
    }
  }
}
