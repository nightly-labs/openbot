import AppIntents
import SwiftUI
import UIKit

// The cards that iOS shows below the Dynamic Island for a shortcut. iOS draws the card surface. A
// button runs an intent that opens the app.

/// A snippet keeps its place on the screen, so the list shows this many agents and names the rest.
private let listedAgents = 5

private func shortcutAccent(_ hex: String?) -> Color {
  guard let hex, hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else {
    return .accentColor
  }
  return Color(
    red: Double((value >> 16) & 0xFF) / 255,
    green: Double((value >> 8) & 0xFF) / 255,
    blue: Double(value & 0xFF) / 255
  )
}

private struct AgentAvatar: View {
  let file: String?
  let size: CGFloat

  var body: some View {
    Group {
      if let image = ShortcutDirectory.avatar(file) {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        Image(systemName: "bubble.left.fill").font(.system(size: size * 0.45)).foregroundStyle(.secondary)
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
    .accessibilityHidden(true)
  }
}

// MARK: - Agent list

@available(iOS 26.0, *)
struct AgentListSnippetIntent: SnippetIntent {
  static let title: LocalizedStringResource = "OpenBot Agents"
  static let isDiscoverable = false

  func perform() async throws -> some IntentResult & ShowsSnippetView {
    .result(view: AgentListView(directory: ShortcutDirectory.read()))
  }
}

@available(iOS 26.0, *)
private struct AgentListView: View {
  let directory: ShortcutDirectory?

  /// The agent of the shortcuts comes first.
  private var agents: [ShortcutDirectory.Agent] {
    guard let directory else { return [] }
    guard let first = directory.agent else { return directory.agents }
    return [first] + directory.agents.filter { $0.id != first.id || $0.serverId != first.serverId }
  }

  var body: some View {
    let all = agents
    let shown = Array(all.prefix(listedAgents))
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(ShortcutText.text("mobile.settings.shortcuts.card.agents", in: directory)).font(.headline)
        Spacer(minLength: 8)
        if all.count > shown.count {
          Text(verbatim: "+\(all.count - shown.count)").font(.subheadline).foregroundStyle(.secondary)
        }
      }
      .padding(.bottom, 4)
      if shown.isEmpty {
        Text(ShortcutText.text("mobile.settings.shortcuts.card.noAgents", in: directory))
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      ForEach(shown) { agent in
        Button(intent: OpenOpenBotIntent(screen: "chat", agentId: agent.id)) {
          HStack(spacing: 12) {
            AgentAvatar(file: agent.avatar, size: 36)
            VStack(alignment: .leading, spacing: 1) {
              Text(agent.name).font(.body.weight(.medium)).foregroundStyle(.primary).lineLimit(1)
              Text(agent.server).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.tertiary)
              .accessibilityHidden(true)
          }
          .padding(.vertical, 6)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
    .padding(16)
  }
}

// MARK: - Send result and notices

/// The result of Send Message, or the reason why a shortcut cannot run.
@available(iOS 26.0, *)
struct ShortcutCardSnippetIntent: SnippetIntent {
  static let title: LocalizedStringResource = "OpenBot Shortcut"
  static let isDiscoverable = false

  /// A `ShortcutNotice`.
  @Parameter(title: "Notice")
  var notice: String?

  /// A `ShortcutSendOutcome`, with the message that it is for.
  @Parameter(title: "Outcome")
  var outcome: String?

  @Parameter(title: "Message")
  var message: String?

  init() {}

  init(notice: ShortcutNotice) {
    self.notice = notice.rawValue
  }

  init(outcome: ShortcutSendOutcome, message: String) {
    self.outcome = outcome.rawValue
    self.message = message
  }

  func perform() async throws -> some IntentResult & ShowsSnippetView {
    let directory = ShortcutDirectory.read()
    let sent = outcome.flatMap(ShortcutSendOutcome.init(rawValue:))
    let shown = notice.flatMap(ShortcutNotice.init(rawValue:)) ?? ShortcutNotice.current(directory)
    return .result(
      view: Group {
        if let sent, let agent = directory?.agent {
          SendResultView(outcome: sent, message: message ?? "", agent: agent, directory: directory)
        } else {
          NoticeView(notice: shown ?? .setUp, directory: directory)
        }
      }
      .padding(16)
    )
  }
}

@available(iOS 26.0, *)
private struct SendResultView: View {
  let outcome: ShortcutSendOutcome
  let message: String
  let agent: ShortcutDirectory.Agent
  let directory: ShortcutDirectory?

  private func text(_ key: String) -> String {
    ShortcutText.text(key, in: directory)
  }

  private var status: (text: String, symbol: String, color: Color) {
    switch outcome {
    case .sent:
      return (text("mobile.settings.shortcuts.send.sent"), "checkmark.circle.fill", .green)
    case .failed:
      return (text("mobile.settings.shortcuts.send.failed"), "exclamationmark.triangle.fill", .orange)
    case .unconfirmed:
      return (text("mobile.settings.shortcuts.send.unconfirmed"), "questionmark.circle.fill", .orange)
    }
  }

  /// A message that did not go opens in the composer of the chat, where the user sends it. A
  /// message that can be in the chat does not: a second send would repeat it.
  private var action: (label: String, intent: OpenOpenBotIntent) {
    outcome == .failed
      ? (
        text("mobile.settings.shortcuts.send.inApp"),
        OpenOpenBotIntent(draft: message, for: agent)
      )
      : (text("mobile.settings.shortcuts.send.openChat"), OpenOpenBotIntent(screen: "chat", agentId: agent.id))
  }

  var body: some View {
    let status = status
    let action = action
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        AgentAvatar(file: agent.avatar, size: 36)
        VStack(alignment: .leading, spacing: 1) {
          Text(agent.name).font(.headline).lineLimit(1)
          Label(status.text, systemImage: status.symbol)
            .font(.subheadline)
            .foregroundStyle(status.color)
            .lineLimit(3)
        }
        Spacer(minLength: 0)
      }
      Text(message).font(.title3).lineLimit(6).privacySensitive()
      Button(intent: action.intent) {
        Text(action.label).font(.body.weight(.semibold)).lineLimit(1).frame(maxWidth: .infinity)
      }
      .controlSize(.large)
      .buttonBorderShape(.capsule)
      .modifier(ActionStyle(primary: outcome == .failed, accent: shortcutAccent(directory?.accent)))
    }
  }
}

private struct ActionStyle: ViewModifier {
  let primary: Bool
  let accent: Color

  func body(content: Content) -> some View {
    if primary {
      content.buttonStyle(.borderedProminent).tint(accent)
    } else {
      content.buttonStyle(.bordered).tint(.primary)
    }
  }
}

@available(iOS 26.0, *)
private struct NoticeView: View {
  let notice: ShortcutNotice
  let directory: ShortcutDirectory?

  private func text(_ key: String) -> String {
    ShortcutText.text(key, in: directory)
  }

  private var title: String {
    switch notice {
    case .setUp: return text("mobile.settings.shortcuts.card.setUp.title")
    case .noAgent: return text("mobile.settings.shortcuts.card.noAgent.title")
    case .locked: return text("mobile.settings.shortcuts.card.locked.title")
    }
  }

  private var detail: String? {
    notice == .noAgent ? text("mobile.settings.shortcuts.card.noAgent.detail") : nil
  }

  private var action: String {
    switch notice {
    case .setUp: return text("mobile.settings.shortcuts.card.setUp.action")
    case .noAgent: return text("mobile.settings.shortcuts.card.noAgent.action")
    case .locked: return text("mobile.settings.shortcuts.card.locked.action")
    }
  }

  /// Where the button goes: the place that fixes the reason.
  private var destination: OpenOpenBotIntent {
    switch notice {
    case .noAgent: return OpenOpenBotIntent(screen: "settings")
    case .locked:
      if let agent = directory?.agent { return OpenOpenBotIntent(screen: "chat", agentId: agent.id) }
      return OpenOpenBotIntent(screen: "home")
    case .setUp: return OpenOpenBotIntent(screen: "home")
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.headline)
        if let detail {
          Text(detail).font(.subheadline).foregroundStyle(.secondary)
        }
      }
      Button(intent: destination) {
        Text(action).font(.body.weight(.semibold)).lineLimit(1).frame(maxWidth: .infinity)
      }
      .controlSize(.large)
      .buttonBorderShape(.capsule)
      .buttonStyle(.borderedProminent)
      .tint(shortcutAccent(directory?.accent))
    }
  }
}
