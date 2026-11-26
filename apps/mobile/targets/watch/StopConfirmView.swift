import SwiftUI

struct StopConfirmView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.watchText) private var text
  @Environment(\.dismiss) private var dismiss
  let agent: WatchAgent
  @Binding var path: [WatchRoute]

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        AgentAvatar(agent: agent, size: 36)
        Text(text(TextKey.stopTitle, ["name": agent.name]))
          .font(.headline)
          .multilineTextAlignment(.center)
        Text(text(TextKey.stopDetail))
          .font(.footnote)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
        if let turnId = agent.turnId {
          Button(role: .destructive) {
            Task {
              let done = await session.perform(
                .stop(serverId: agent.serverId, agentId: agent.id, turnId: turnId),
                done: text(TextKey.doneStopped))
              if done { path = [] }
            }
          } label: {
            Text(text(TextKey.stop))
              .frame(maxWidth: .infinity)
          }
          .disabled(!session.canAct)
        }
        Button(text(TextKey.cancel)) {
          dismiss()
        }
      }
    }
    .navigationTitle(text(TextKey.stop))
  }
}
