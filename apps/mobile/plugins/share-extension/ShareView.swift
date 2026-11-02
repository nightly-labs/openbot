import Combine
import SwiftUI
import UIKit

@MainActor
final class ShareModel: ObservableObject {
  enum Phase: Equatable {
    case choosing
    case sending(String)
    case sent(String)
    /// `unconfirmed`: the message can be in the chat, so the share is not offered to the app again.
    case failed(unconfirmed: Bool)
  }

  @Published var phase: Phase = .choosing
  @Published var selected: String?
  /// The servers whose agents show. The first server of the app's list and the server of the
  /// selected agent start open, so a long list of one server does not hide the others.
  @Published var expanded: Set<String>
  let directory: ShareDirectory
  let content: ShareContent
  let lastAgent: ShareDirectory.Agent?
  let avatars: [String: UIImage]
  var onSend: (ShareDirectory.Agent) -> Void = { _ in }
  var onCancel: () -> Void = {}
  var onOpenApp: () -> Void = {}

  init(
    directory: ShareDirectory,
    content: ShareContent,
    selected: String?,
    lastAgent: ShareDirectory.Agent?,
    avatars: [String: Data]
  ) {
    self.directory = directory
    self.content = content
    self.selected = selected
    self.lastAgent = lastAgent
    self.avatars = avatars.compactMapValues { UIImage(data: $0) }
    let selectedServer = directory.agents.first { $0.conversationId == selected }?.serverId
    expanded = Set([directory.servers.first?.id, selectedServer].compactMap { $0 })
  }

  var selectedAgent: ShareDirectory.Agent? {
    directory.agents.first { $0.conversationId == selected }
  }

  func avatar(of agent: ShareDirectory.Agent) -> UIImage? {
    agent.avatar.flatMap { avatars[$0] }
  }
}

/// The extension's sheet: what is shared, the agents by server, and Send. It looks like the app's
/// share sheet (`share-screen.tsx`), in a native list.
struct ShareView: View {
  @ObservedObject var model: ShareModel

  private var directory: ShareDirectory { model.directory }
  private var accent: Color { Color(hex: directory.accent) ?? Color.accentColor }

  var body: some View {
    NavigationStack {
      Group {
        if model.phase == .choosing {
          chooser
        } else {
          status
        }
      }
      .tint(accent)
      .navigationTitle(directory.t("mobile.app.route.share"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        if model.phase == .choosing {
          ToolbarItem(placement: .cancellationAction) {
            Button(directory.t("common.cancel"), action: model.onCancel)
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(directory.t("mobile.share.extension.send")) {
              if let agent = model.selectedAgent { model.onSend(agent) }
            }
            .disabled(model.selectedAgent == nil)
          }
        }
      }
    }
  }

  private var chooser: some View {
    List {
      Section {
        if !model.content.text.isEmpty {
          Text(model.content.text).lineLimit(4)
        }
        ForEach(model.content.files.indices, id: \.self) { index in
          Label(model.content.files[index].name, systemImage: "doc").lineLimit(1)
        }
      } header: {
        Text(directory.t("mobile.share.content"))
      } footer: {
        Text(directory.t("mobile.share.extension.footer"))
      }
      if let last = model.lastAgent {
        Section(directory.t("mobile.share.lastUsed")) {
          agentRow(last)
        }
      }
      ForEach(directory.servers, id: \.id) { server in
        let agents = directory.agents.filter {
          $0.serverId == server.id && $0.conversationId != model.lastAgent?.conversationId
        }
        // One server needs no fold.
        let open = directory.servers.count == 1 || model.expanded.contains(server.id)
        Section {
          if open {
            if agents.isEmpty {
              Text(directory.t("mobile.share.noAgents")).foregroundStyle(.secondary)
            } else {
              ForEach(agents) { agentRow($0) }
            }
          }
        } header: {
          if directory.servers.count == 1 {
            Text(server.name)
          } else {
            serverHeader(server, count: agents.count, open: open)
          }
        }
      }
    }
  }

  private func serverHeader(_ server: ShareDirectory.Server, count: Int, open: Bool) -> some View {
    Button {
      withAnimation {
        if open { model.expanded.remove(server.id) } else { model.expanded.insert(server.id) }
      }
    } label: {
      HStack {
        Text(server.name)
        Spacer()
        Text(String(count)).accessibilityHidden(true)
        Image(systemName: "chevron.right")
          .rotationEffect(.degrees(open ? 90 : 0))
          .accessibilityHidden(true)
      }
      .foregroundStyle(Color.secondary)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(.isHeader)
  }

  private func agentRow(_ agent: ShareDirectory.Agent) -> some View {
    Button {
      model.selected = agent.conversationId
    } label: {
      HStack(spacing: 12) {
        avatar(agent).frame(width: 36, height: 36).clipShape(Circle()).accessibilityHidden(true)
        // A list button gives its label the tint; the name keeps the text color.
        Text(agent.name).foregroundStyle(Color.primary).lineLimit(1)
        Spacer()
        if model.selected == agent.conversationId {
          Image(systemName: "checkmark").foregroundStyle(accent).accessibilityHidden(true)
        }
      }
    }
    .accessibilityAddTraits(model.selected == agent.conversationId ? .isSelected : [])
  }

  @ViewBuilder
  private func avatar(_ agent: ShareDirectory.Agent) -> some View {
    if let image = model.avatar(of: agent) {
      Image(uiImage: image).resizable().scaledToFill()
    } else {
      Text(String(agent.name.prefix(1)).uppercased())
        .font(.headline)
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(accent)
    }
  }

  @ViewBuilder
  private var status: some View {
    VStack(spacing: 16) {
      switch model.phase {
      case .choosing:
        EmptyView()
      case let .sending(name):
        ProgressView()
        Text(directory.t("mobile.share.extension.sending", name: name))
      case let .sent(name):
        Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(.green)
        Text(directory.t("mobile.share.extension.sent", name: name))
      case let .failed(unconfirmed):
        Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle).foregroundStyle(.orange)
        Text(directory.t(unconfirmed ? "mobile.share.extension.unconfirmed" : "mobile.share.extension.failed"))
          .multilineTextAlignment(.center)
        if unconfirmed {
          Button(directory.t("common.done"), action: model.onCancel).buttonStyle(.borderedProminent)
        } else {
          Button(directory.t("mobile.share.extension.openApp"), action: model.onOpenApp)
            .buttonStyle(.borderedProminent)
          Button(directory.t("common.cancel"), action: model.onCancel)
        }
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(uiColor: .systemGroupedBackground))
  }
}

private extension Color {
  /// A `#rrggbb` color, or nil for any other text.
  init?(hex: String) {
    guard hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    self.init(
      red: Double((value >> 16) & 0xff) / 255,
      green: Double((value >> 8) & 0xff) / 255,
      blue: Double(value & 0xff) / 255
    )
  }
}
