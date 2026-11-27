import SwiftUI

struct AgentDetailView: View {
  @EnvironmentObject private var session: WatchSession
  let agent: WatchAgent
  @Binding var path: [WatchRoute]

  var body: some View {
    ScrollView {
      switch agent.wait {
      case .approval(let wait):
        ApprovalDetailView(agent: agent, wait: wait, path: $path)
      case .question(let wait):
        QuestionPageContent(agent: agent, wait: wait, path: $path, full: true)
      default:
        VStack(spacing: 6) {
          AgentAvatar(agent: agent, size: 36)
          StateCapsule(agent: agent)
          if let message = agent.message {
            TextCard(text: message, lines: nil)
          }
        }
        .frame(maxWidth: .infinity)
        .task(id: agent.unread ?? 0) { await session.markRead(agent) }
      }
    }
    .agentBackground(agent)
    .navigationTitle(agent.name)
  }
}

struct ApprovalDetailView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  let agent: WatchAgent
  let wait: WatchApprovalWait
  @Binding var path: [WatchRoute]

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        AgentAvatar(agent: agent, size: 24)
        VStack(alignment: .leading, spacing: 0) {
          Text(wait.title)
            .font(.footnote.weight(.semibold))
          Text(agent.server)
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
      Text(wait.body)
        .font(.system(.footnote, design: .monospaced))
        .privacySensitive()
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
      if let location = wait.location, !location.isEmpty {
        Text(text(TextKey.approvalWhere, ["path": location]))
          .font(.caption2)
          .privacySensitive()
          .foregroundStyle(.secondary)
      }
      if let why = wait.why, !why.isEmpty {
        Text(why)
          .font(.caption2)
          .privacySensitive()
      }
      if wait.whole {
        Button {
          Task { await run(.approve(serverId: agent.serverId, agentId: agent.id, requestId: wait.requestId), done: text(TextKey.doneAllowed)) }
        } label: {
          Label(text(TextKey.allow), systemImage: "checkmark")
            .frame(maxWidth: .infinity)
        }
        .tint(.green)
        .disabled(!session.canAct)
        .armed(for: wait.requestId)
      } else {
        Label(text(TextKey.approvalTooLong), systemImage: "iphone")
          .font(.caption2)
          .foregroundStyle(.orange)
        OpenOnPhoneButton(agent: agent)
          .disabled(!session.canAct)
      }
      Button {
        Task { await run(.deny(serverId: agent.serverId, agentId: agent.id, requestId: wait.requestId), done: text(TextKey.doneDenied)) }
      } label: {
        Label(text(TextKey.deny), systemImage: "xmark")
          .frame(maxWidth: .infinity)
      }
      .disabled(!session.canAct)
    }
  }

  private func run(_ command: WatchCommand, done: String) async {
    if await session.perform(command, done: done) { path = [] }
  }
}
