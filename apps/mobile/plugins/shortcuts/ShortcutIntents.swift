import AppIntents
import Foundation

#if canImport(OpenBotShortcuts)
  internal import OpenBotShortcuts
#endif

// The shortcuts of OpenBot: List Agents, Send Message and Open Agent.
//
// They run without the JavaScript of the app. iOS runs a shortcut in the background, also when the
// app is not in memory, and there the app has no window and React Native does not run. List Agents
// reads the file that the app wrote, and Send Message sends from native code (`ShortcutSend.swift`).
//
// The snippets that show the cards need iOS 26 (`SnippetIntent`), so an older iOS has no shortcuts.
//
// iOS reads the names and the phrases of the shortcuts when the app is built, so they are English
// here and not from the `@openbot/i18n` catalog. The text of the cards is from the catalog: the app
// writes it to `shortcuts.json`.

/// Why a shortcut cannot run now. The card names the reason and has one button.
enum ShortcutNotice: String {
  /// The app wrote no data: no session, or it has not opened since it got shortcuts.
  case setUp
  /// The user has not chosen the agent that gets the shortcut messages.
  case noAgent
  /// The app lock is on, so the app must open and ask for it.
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
  static let description = IntentDescription(
    "Shows your OpenBot agents. A tap on an agent opens its chat. The message button sends a message, and the app does not open."
  )
  static let supportedModes: IntentModes = .background
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  func perform() async throws -> some IntentResult & ReturnsValue<[String]> & ShowsSnippetIntent {
    let directory = ShortcutDirectory.read()
    // The names are behind the app lock, as in the app.
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
    guard let directory, let agent = directory.agent else {
      return .result(snippetIntent: ShortcutCardSnippetIntent(notice: .noAgent))
    }
    return .result(snippetIntent: await ShortcutCardSnippetIntent.sending(text, to: agent, in: directory))
  }
}

@available(iOS 26.0, *)
struct MessageAgentIntent: AppIntent {
  static let title: LocalizedStringResource = "Message Agent"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .background
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Agent")
  var agentId: String?

  @Parameter(title: "Server")
  var serverId: String?

  @Parameter(
    title: "Message",
    inputOptions: String.IntentInputOptions(keyboardType: .default, multiline: true)
  )
  var message: String?

  init() {}

  init(agent: ShortcutDirectory.Agent) {
    self.agentId = agent.id
    self.serverId = agent.serverId
  }

  func perform() async throws -> some IntentResult & ShowsSnippetIntent {
    guard let directory = ShortcutDirectory.read() else {
      return .result(snippetIntent: ShortcutCardSnippetIntent(notice: .setUp))
    }
    if directory.locked {
      return .result(snippetIntent: ShortcutCardSnippetIntent(notice: .locked))
    }
    guard let agentId, let serverId, let agent = directory.agent(id: agentId, serverId: serverId) else {
      return .result(snippetIntent: AgentListSnippetIntent())
    }
    let prompt = ShortcutText.text("mobile.settings.shortcuts.card.messagePrompt", in: directory, name: agent.name)
    var text = message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if text.isEmpty {
      text = try await $message.requestValue("\(prompt)").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    guard !text.isEmpty else { throw $message.needsValueError("\(prompt)") }
    return .result(snippetIntent: await ShortcutCardSnippetIntent.sending(text, to: agent, in: directory))
  }
}

/// Opens the chat of the agent that the user chose in Settings > Shortcuts. With no agent, it opens
/// Settings > Shortcuts, and with no data from the app, the home screen. A locked app asks for the
/// lock before the chat shows.
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

/// Opens the app: the chat of an agent, or Settings > Shortcuts. JavaScript takes the request when
/// its screens show, so it also waits for an app that starts now.
@available(iOS 26.0, *)
struct OpenOpenBotIntent: AppIntent {
  static let title: LocalizedStringResource = "Open OpenBot"
  static let isDiscoverable = false
  static let supportedModes: IntentModes = .foreground(.immediate)

  /// `chat`, `settings` or `home`.
  @Parameter(title: "Screen")
  var screen: String?

  @Parameter(title: "Agent")
  var agentId: String?

  /// A message that the shortcut could not send, for the composer of the chat, with the server of
  /// the agent.
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
