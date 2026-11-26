import SwiftUI

struct DictateLink<Content: View>: View {
  let target: ComposeTarget
  @Binding var path: [WatchRoute]
  @ViewBuilder let label: () -> Content

  var body: some View {
    TextFieldLink(label: label) { value in
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return }
      path.append(.review(target, trimmed))
    }
  }
}

struct ReviewView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  let target: ComposeTarget
  @State var draft: String
  @State private var messageId = UUID().uuidString
  @Binding var path: [WatchRoute]

  init(agent: WatchAgent, target: ComposeTarget, text: String, path: Binding<[WatchRoute]>) {
    self.agent = agent
    self.target = target
    _draft = State(initialValue: text)
    _path = path
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        HStack(spacing: 6) {
          AgentAvatar(agent: agent, size: 22)
          VStack(alignment: .leading, spacing: 0) {
            Text(agent.name)
              .font(.footnote.weight(.semibold))
              .lineLimit(1)
            Text(subtitle)
              .font(.caption2)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
          Spacer(minLength: 0)
        }
        Text(draft)
          .font(.body)
          .privacySensitive()
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(8)
          .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        Button {
          Task { await send() }
        } label: {
          Label(text(TextKey.send), systemImage: "checkmark")
            .frame(maxWidth: .infinity)
        }
        .tint(Color(hex: agent.color) ?? .blue)
        .disabled(!session.canAct)
        .primaryActionShortcut()
        TextFieldLink {
          Label(text(TextKey.again), systemImage: "mic")
        } onSubmit: { value in
          let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
          guard !trimmed.isEmpty, trimmed != draft else { return }
          draft = trimmed
          messageId = UUID().uuidString
        }
      }
    }
    .navigationTitle(text(TextKey.review))
  }

  private var subtitle: String {
    switch target {
    case .message: return "\(text(TextKey.newMessage)) · \(agent.server)"
    case .answer: return "\(text(TextKey.answer)) · \(agent.server)"
    }
  }

  private func send() async {
    let done: Bool
    switch target {
    case .message:
      done = await session.perform(
        .send(serverId: agent.serverId, agentId: agent.id, text: draft, messageId: messageId),
        done: text(TextKey.doneSent, ["name": agent.name]))
    case .answer(_, let requestId, let questionId):
      done = await session.perform(
        .answer(serverId: agent.serverId, agentId: agent.id, requestId: requestId, answers: [questionId: [draft]]),
        done: text(TextKey.doneAnswered))
    }
    if done { path = [] }
  }
}

extension View {
  @ViewBuilder
  func primaryActionShortcut() -> some View {
    if #available(watchOS 11, *) {
      handGestureShortcut(.primaryAction)
    } else {
      self
    }
  }
}
