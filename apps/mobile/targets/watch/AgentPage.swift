import SwiftUI

struct AgentPage: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  @Binding var path: [WatchRoute]

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        if session.showsConnectionNote {
          ConnectionNote()
        }
        AgentAvatar(agent: agent, size: 44)
        Text(agent.name)
          .font(.headline)
          .lineLimit(1)
        StateCapsule(agent: agent)
        stateContent
      }
      .frame(maxWidth: .infinity)
    }
    .agentBackground(agent)
    .task(id: agent.unread ?? 0) {
      if agent.message == nil { await session.markRead(agent) }
    }
  }

  @ViewBuilder
  private var stateContent: some View {
    switch agent.wait {
    case .approval(let wait):
      ApprovalPageContent(agent: agent, wait: wait, path: $path)
    case .question(let wait):
      QuestionPageContent(agent: agent, wait: wait, path: $path)
    case .phone(let reason, let question):
      PhoneWaitContent(agent: agent, reason: reason, question: question)
    case .unknown:
      PhoneWaitContent(agent: agent, reason: nil, question: nil)
    case .none:
      switch agent.state {
      case .working, .waiting:
        WorkingPageContent(agent: agent, path: $path)
      case .idle:
        IdlePageContent(agent: agent, path: $path)
      }
    }
  }
}

struct AgentStateStyle {
  let title: String
  let symbol: String
  let tint: Color

  init(agent: WatchAgent, text: WatchText) {
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
      tint = agent.state == .idle ? .secondary : .blue
    }
  }
}

struct StateCapsule: View {
  @Environment(\.watchText) private var text
  let agent: WatchAgent

  var body: some View {
    let style = AgentStateStyle(agent: agent, text: text)
    Label(style.title, systemImage: style.symbol)
      .font(.caption2.weight(.semibold))
      .lineLimit(1)
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .foregroundStyle(style.tint)
      .background(style.tint.opacity(0.2), in: Capsule())
  }
}

extension WatchAgent {
  var message: String? {
    guard wait == nil, state == .idle else { return nil }
    return reply ?? detail
  }
}

struct TextCard: View {
  let text: String
  var lines: Int? = 3
  var monospaced = false
  var open: (() -> Void)?
  var fits: ((Bool) -> Void)?
  @State private var shownHeight: CGFloat = 0
  @State private var fullHeight: CGFloat = 0

  private var styled: some View {
    Text(text)
      .font(monospaced ? .system(.footnote, design: .monospaced) : .footnote)
      .multilineTextAlignment(.leading)
      .privacySensitive()
  }

  var body: some View {
    let card = styled
      .lineLimit(lines)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(alignment: .topLeading) {
        if fits != nil {
          styled
            .fixedSize(horizontal: false, vertical: true)
            .hidden()
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fullHeight = $0 }
        }
      }
      .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { shownHeight = $0 }
      .onChange(of: fullHeight > 0 && shownHeight > 0 ? fullHeight <= shownHeight + 1 : nil) { _, whole in
        if let whole { fits?(whole) }
      }
      .padding(8)
      .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    if let open {
      Button(action: open) { card }
        .buttonStyle(.plain)
    } else {
      card
    }
  }
}

struct ActionLabel: View {
  let title: String
  let symbol: String

  var body: some View {
    Label(title, systemImage: symbol)
      .lineLimit(1)
      .minimumScaleFactor(0.75)
      .frame(maxWidth: .infinity)
  }
}

struct ApprovalPageContent: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  let wait: WatchApprovalWait
  @Binding var path: [WatchRoute]

  var body: some View {
    VStack(spacing: 6) {
      TextCard(text: wait.body, lines: 3, monospaced: true) {
        path.append(.detail(agent.key))
      }
      if !wait.whole {
        Text(text(TextKey.approvalTooLong))
          .font(.caption2)
          .foregroundStyle(.orange)
          .multilineTextAlignment(.center)
      }
      VStack(spacing: 6) {
        if wait.whole {
          Button {
            Task { await session.perform(.approve(serverId: agent.serverId, agentId: agent.id, requestId: wait.requestId), done: text(TextKey.doneAllowed)) }
          } label: {
            ActionLabel(title: text(TextKey.allow), symbol: "checkmark")
          }
          .tint(.green)
          .armed(for: wait.requestId)
        } else {
          OpenOnPhoneButton(agent: agent)
        }
        Button {
          Task { await session.perform(.deny(serverId: agent.serverId, agentId: agent.id, requestId: wait.requestId), done: text(TextKey.doneDenied)) }
        } label: {
          ActionLabel(title: text(TextKey.deny), symbol: "xmark")
        }
      }
      .disabled(!session.canAct)
    }
  }
}

struct PhoneWaitContent: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  let reason: WatchPhoneReason?
  let question: String?

  var body: some View {
    VStack(spacing: 6) {
      if let question {
        TextCard(text: question, lines: nil)
      }
      if let note {
        Text(note)
          .font(.footnote)
          .foregroundStyle(question == nil ? .primary : .secondary)
          .multilineTextAlignment(.center)
      }
      OpenOnPhoneButton(agent: agent)
        .disabled(!session.canAct)
    }
  }

  private var note: String? {
    switch reason {
    case .question:
      return question == nil ? text.optional(TextKey.questionOnPhone) : text.optional(TextKey.questionPrivate)
    case .takeover: return text.optional(TextKey.takeoverOnPhone)
    case .approval, .none: return text.optional(TextKey.approvalOnPhone)
    }
  }
}

struct OpenOnPhoneButton: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent

  var body: some View {
    Button {
      Task { await session.perform(.open(serverId: agent.serverId, agentId: agent.id), done: text(TextKey.doneOnPhone)) }
    } label: {
      ActionLabel(title: text(TextKey.openOnPhone), symbol: "iphone")
    }
  }
}

struct MessageButton: View {
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  @Binding var path: [WatchRoute]

  var body: some View {
    DictateLink(target: .message(agent.key), path: $path) {
      ActionLabel(title: text(TextKey.message), symbol: "mic.fill")
    }
    .tint(Color(hex: agent.color) ?? .blue)
  }
}

struct WorkingPageContent: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  @Binding var path: [WatchRoute]

  var body: some View {
    VStack(spacing: 6) {
      if let detail = agent.detail {
        Text(detail)
          .font(.footnote)
          .lineLimit(3)
          .multilineTextAlignment(.center)
          .privacySensitive()
      }
      if let updated = agent.updated {
        Text(updated)
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      VStack(spacing: 6) {
        MessageButton(agent: agent, path: $path)
        if agent.turnId != nil {
          Button(role: .destructive) {
            path.append(.stop(agent.key))
          } label: {
            ActionLabel(title: text(TextKey.stop), symbol: "stop.fill")
          }
        }
      }
      .disabled(!session.canAct)
    }
  }
}

struct IdlePageContent: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  @Binding var path: [WatchRoute]
  @State private var messageFits: Bool?

  var body: some View {
    VStack(spacing: 6) {
      if let message = agent.message {
        TextCard(
          text: message, lines: 3,
          open: { path.append(.detail(agent.key)) },
          fits: { messageFits = $0 })
      } else {
        Text(text(TextKey.replyNone))
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      VStack(spacing: 6) {
        MessageButton(agent: agent, path: $path)
          .disabled(!session.canAct)
        if agent.reply != nil {
          Button {
            path.append(.listen(agent.key))
          } label: {
            ActionLabel(title: text(TextKey.listen), symbol: "speaker.wave.2")
          }
        }
      }
    }
    .task(id: "\(agent.unread ?? 0)|\(String(describing: messageFits))") {
      if messageFits == true { await session.markRead(agent) }
    }
  }
}

struct ArmDelay: ViewModifier {
  static let delay: UInt64 = 600_000_000

  let id: String
  @State private var armedId: String?

  func body(content: Content) -> some View {
    content
      .disabled(armedId != id)
      .task(id: id) {
        armedId = nil
        try? await Task.sleep(nanoseconds: Self.delay)
        guard !Task.isCancelled else { return }
        armedId = id
      }
  }
}

extension View {
  func armed(for id: String) -> some View {
    modifier(ArmDelay(id: id))
  }

  func agentBackground(_ agent: WatchAgent) -> some View {
    let color = Color(hex: agent.color) ?? .accentColor
    return containerBackground(
      LinearGradient(colors: [color.opacity(0.55), .black], startPoint: .top, endPoint: .bottom),
      for: .navigation)
  }
}
