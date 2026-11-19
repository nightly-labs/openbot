import AppIntents
import Foundation

#if canImport(OpenBotShortcuts)
  internal import OpenBotShortcuts
#endif

enum ShortcutNotice: String {
  case setUp
  case noAgent
  case locked

  static func current(_ directory: ShortcutDirectory?) -> ShortcutNotice? {
    guard let directory else { return .setUp }
    if directory.locked { return .locked }
    return directory.agent == nil ? .noAgent : nil
  }
}

@available(iOS 26.0, *)
struct ListAgentsIntent: AppIntent {
  static let title: LocalizedStringResource = "List Agents"
  static let description = IntentDescription("Shows your OpenBot agents. A tap on an agent opens its chat.")
  static let supportedModes: IntentModes = .background
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  func perform() async throws -> some IntentResult & ReturnsValue<[String]> & ShowsSnippetIntent {
    let directory = ShortcutDirectory.read()
    if directory == nil || directory?.locked == true {
      let notice: ShortcutNotice = directory == nil ? .setUp : .locked
      return .result(value: [], snippetIntent: ShortcutCardSnippetIntent(notice: notice))
    }
    return .result(value: directory?.agents.map(\.name) ?? [], snippetIntent: AgentListSnippetIntent())
  }
}

@available(iOS 26.0, *)
struct SendMessageIntent: AppIntent {
  static let title: LocalizedStringResource = "Send Message"
  static let description = IntentDescription(
    "Sends a message to the agent that you chose in OpenBot Settings > Shortcuts. The app does not open."
  )
  static let supportedModes: IntentModes = .background
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(
    title: "Message",
    inputOptions: String.IntentInputOptions(keyboardType: .default, multiline: true),
    requestValueDialog: "What should it say?"
  )
  var message: String

  static var parameterSummary: some ParameterSummary {
    Summary("Send \(\.$message) to my agent")
  }

  func perform() async throws -> some IntentResult & ShowsSnippetIntent {
    let directory = ShortcutDirectory.read()
    if let notice = ShortcutNotice.current(directory) {
      return .result(snippetIntent: ShortcutCardSnippetIntent(notice: notice))
    }
    let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { throw $message.needsValueError("What should it say?") }
    guard let directory, let agent = directory.agent,
      let server = directory.server(of: agent),
      let session = ShortcutSession.read(for: directory)
    else {
      return .result(snippetIntent: ShortcutCardSnippetIntent(outcome: .failed, message: text))
    }
    let outcome = await ShortcutMessageSender.send(text: text, to: agent, on: server, session: session)
    return .result(snippetIntent: ShortcutCardSnippetIntent(outcome: outcome, message: text))
  }
}

@available(iOS 26.0, *)
struct OpenAgentIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Agent"
  static let description = IntentDescription(
    "Opens the chat of the agent that you chose in OpenBot Settings > Shortcuts."
  )
  static let supportedModes: IntentModes = .foreground(.immediate)

  func perform() async throws -> some IntentResult {
    let directory = ShortcutDirectory.read()
    var payload = ["screen": "home"]
    if let agent = directory?.agent {
      payload = ["screen": "chat", "agentId": agent.id]
    } else if directory != nil {
      payload = ["screen": "settings"]
    }
    ShortcutBridge.shared.open(shortcutPayload(payload))
    return .result()
  }
}

@available(iOS 26.0, *)
struct OpenOpenBotIntent: AppIntent {
  static let title: LocalizedStringResource = "Open OpenBot"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .foreground(.immediate)

  @Parameter(title: "Screen")
  var screen: String?

  @Parameter(title: "Agent")
  var agentId: String?

  @Parameter(title: "Text")
  var text: String?

  @Parameter(title: "Server")
  var serverId: String?

  init() {}

  init(screen: String, agentId: String? = nil) {
    self.screen = screen
    self.agentId = agentId
  }

  init(draft text: String, for agent: ShortcutDirectory.Agent) {
    self.screen = "chat"
    self.agentId = agent.id
    self.serverId = agent.serverId
    self.text = text
  }

  func perform() async throws -> some IntentResult {
    var payload = ["screen": screen ?? "home"]
    if let agentId { payload["agentId"] = agentId }
    if let text, let serverId {
      payload["text"] = text
      payload["serverId"] = serverId
    }
    ShortcutBridge.shared.open(shortcutPayload(payload))
    return .result()
  }
}

@available(iOS 26.0, *)
struct OpenBotAppShortcuts: AppShortcutsProvider {
  static let shortcutTileColor: ShortcutTileColor = .grape

  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ListAgentsIntent(),
      phrases: ["List \(.applicationName) agents", "Show my agents in \(.applicationName)"],
      shortTitle: "List Agents",
      systemImageName: "list.bullet"
    )
    AppShortcut(
      intent: SendMessageIntent(),
      phrases: ["Send a message with \(.applicationName)", "Message my agent in \(.applicationName)"],
      shortTitle: "Send Message",
      systemImageName: "paperplane"
    )
    AppShortcut(
      intent: OpenAgentIntent(),
      phrases: ["Open my agent in \(.applicationName)", "Open \(.applicationName) agent"],
      shortTitle: "Open Agent",
      systemImageName: "bubble.left.and.bubble.right"
    )
  }
}
