import SwiftUI

enum WatchRecipient {
  case agent(WatchAgent)
  case channel(WatchChannel)

  var name: String {
    switch self {
    case .agent(let agent): return agent.name
    case .channel(let channel): return channel.name
    }
  }

  var server: String {
    switch self {
    case .agent(let agent): return agent.server
    case .channel(let channel): return channel.server
    }
  }

  var color: String {
    switch self {
    case .agent(let agent): return agent.color
    case .channel(let channel): return channel.color
    }
  }
}

struct RecipientAvatar: View {
  let recipient: WatchRecipient
  var size: CGFloat = 44

  var body: some View {
    switch recipient {
    case .agent(let agent): AgentAvatar(agent: agent, size: size)
    case .channel(let channel): ChannelAvatar(channel: channel, size: size)
    }
  }
}

struct ChannelAvatar: View {
  static let shownMembers = 4

  @EnvironmentObject private var session: WatchSession
  let channel: WatchChannel
  var size: CGFloat = 44

  var body: some View {
    let members = Array(memberAgents.prefix(Self.shownMembers))
    Group {
      if members.count > 1 {
        let face = size * ClusterLayout.face
        ZStack {
          ForEach(Array(zip(members, ClusterLayout.cells(members.count))), id: \.0.id) { agent, cell in
            AgentAvatar(agent: agent, size: face)
              .offset(x: cell.x * size, y: cell.y * size)
          }
        }
        .frame(width: size, height: size)
      } else if let only = members.first {
        AgentAvatar(agent: only, size: size)
      } else {
        ZStack {
          Circle().fill(Color(hex: channel.color) ?? .accentColor)
          Image(systemName: "number")
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
      }
    }
    .accessibilityHidden(true)
  }

  private var memberAgents: [WatchAgent] {
    channel.members.compactMap { session.agent(AgentKey(serverId: channel.serverId, id: $0)) }
  }
}

private enum ClusterLayout {
  static let face: CGFloat = 0.63
  static let pitch: CGFloat = 0.34

  static func cells(_ count: Int) -> [CGPoint] {
    let half = pitch / 2
    switch count {
    case 2:
      return [CGPoint(x: -half, y: 0), CGPoint(x: half, y: 0)]
    case 3:
      return [CGPoint(x: -half, y: -half), CGPoint(x: half, y: -half), CGPoint(x: 0, y: half)]
    default:
      return [
        CGPoint(x: -half, y: -half), CGPoint(x: half, y: -half), CGPoint(x: -half, y: half),
        CGPoint(x: half, y: half),
      ]
    }
  }
}

struct ChannelRow: View {
  @Environment(\.watchText) private var text
  @Environment(\.themed) private var themed
  let channel: WatchChannel
  var divided = false

  var body: some View {
    NavigationLink(value: WatchRoute.channel(channel.key)) {
      HStack(spacing: 8) {
        ChannelAvatar(channel: channel, size: 32)
        VStack(alignment: .leading, spacing: 1) {
          Text(channel.name)
            .font(.headline)
            .lineLimit(1)
          if channel.isWorking {
            Label(text(TextKey.stateWorking), systemImage: "ellipsis")
              .font(.caption2)
              .lineLimit(1)
              .foregroundStyle(themed ? AgentRow.workingTint : .blue)
          } else if let line = channel.activityLine {
            Label(line, systemImage: "number")
              .font(.caption2)
              .lineLimit(1)
              .foregroundStyle(.secondary)
          }
        }
        Spacer(minLength: 0)
        if let unread = channel.unread, unread > 0 {
          UnreadBadge(count: unread)
        }
      }
      .padding(.vertical, 2)
    }
    .overlay(alignment: .top) {
      if divided {
        Divider()
          .padding(.leading, AgentRow.dividerInset)
          .offset(y: -4)
      }
    }
  }
}

extension WatchChannel {
  var activityLine: String? {
    let parts = [author, updated].compactMap { $0 }.filter { !$0.isEmpty }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
}

struct ChannelStateCapsule: View {
  @Environment(\.watchText) private var text
  let channel: WatchChannel

  var body: some View {
    if channel.isWorking {
      capsule(text(TextKey.stateWorking), symbol: "ellipsis", tint: Color.stateTint(hex: channel.color))
    } else if let updated = channel.updated, !updated.isEmpty {
      capsule(updated, symbol: "number", tint: .secondary)
    }
  }

  private func capsule(_ title: String, symbol: String, tint: Color) -> some View {
    Label(title, systemImage: symbol)
      .font(.caption2.weight(.semibold))
      .lineLimit(1)
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .foregroundStyle(tint)
      .background(tint.opacity(0.2), in: Capsule())
  }
}

struct ChannelPage: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let channel: WatchChannel
  @Binding var path: [WatchRoute]
  @State private var messageFits: Bool?

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        if session.showsConnectionNote {
          ConnectionNote()
        }
        ChannelAvatar(channel: channel, size: 44)
        Text(channel.name)
          .font(.headline)
          .lineLimit(1)
        ChannelStateCapsule(channel: channel)
        VStack(spacing: 6) {
          if let message = channel.message {
            TextCard(
              text: message, lines: 3,
              open: { path.append(.channelDetail(channel.key)) },
              fits: { messageFits = $0 })
          } else {
            Text(text(TextKey.replyNone))
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
          DictateLink(target: .channel(channel.key), path: $path) {
            ActionLabel(title: text(TextKey.message), symbol: "mic.fill")
          }
          .tint(Color(hex: channel.color) ?? .blue)
          .disabled(!session.canAct)
          if channel.message != nil {
            Button {
              path.append(.channelListen(channel.key))
            } label: {
              ActionLabel(title: text(TextKey.listen), symbol: "speaker.wave.2")
            }
          }
        }
      }
      .frame(maxWidth: .infinity)
    }
    .colorBackground(channel.color)
    .task(id: "\(channel.unread ?? 0)|\(String(describing: messageFits))") {
      if channel.message == nil || messageFits == true { await session.markRead(channel) }
    }
  }
}

struct ChannelDetailView: View {
  @EnvironmentObject private var session: WatchSession
  let channel: WatchChannel

  var body: some View {
    ScrollView {
      VStack(spacing: 6) {
        ChannelAvatar(channel: channel, size: 36)
        ChannelStateCapsule(channel: channel)
        if let message = channel.message {
          TextCard(text: message, lines: nil)
        }
      }
      .frame(maxWidth: .infinity)
      .task(id: channel.unread ?? 0) { await session.markRead(channel) }
    }
    .colorBackground(channel.color)
    .navigationTitle(channel.name)
  }
}
