import SwiftUI

@main
struct OpenBotWatchApp: App {
  @StateObject private var session: WatchSession

  init() {
    let shared = WatchSession.shared
    _session = StateObject(wrappedValue: shared)
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(session)
        .environment(\.watchText, session.text)
        .onOpenURL { url in session.open(url) }
    }
    .backgroundTask(.watchConnectivity) {
      await WatchSession.shared.finishBackgroundDelivery()
    }
    .backgroundTask(.appRefresh(WatchSession.backgroundRefreshIdentifier)) {
      await WatchSession.shared.backgroundRefresh()
    }
  }
}

enum WatchRoute: Hashable {
  case servers
  case agent(AgentKey)
  case channel(AgentKey)
  case channelDetail(AgentKey)
  case channelListen(AgentKey)
  case detail(AgentKey)
  case questions(AgentKey)
  case review(ComposeTarget, String)
  case listen(AgentKey)
  case stop(AgentKey)
}

enum ComposeTarget: Hashable {
  case message(AgentKey)
  case answer(AgentKey, requestId: String, questionId: String)
  case channel(AgentKey)
}

struct RootView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage(WatchSession.themeKey) private var themed = true
  @State private var path: [WatchRoute] = []

  var body: some View {
    NavigationStack(path: $path) {
      content
        .navigationDestination(for: WatchRoute.self) { route in
          destination(route)
        }
    }
    .environment(\.themed, themed)
    .overlay(alignment: .bottom) {
      if let feedback = session.feedback {
        FeedbackView(feedback: feedback)
          .transition(.move(edge: .bottom).combined(with: .opacity))
          .onTapGesture { session.feedback = nil }
      }
    }
    .animation(.snappy, value: session.feedback)
    .task(id: scenePhase) {
      guard scenePhase == .active else { return }
      await session.runWhileActive()
    }
    .onChange(of: session.phase) { _, phase in
      if case .ready = phase { return }
      path = []
    }
    .onChange(of: session.focus, initial: true) { _, _ in openFocus() }
    .onChange(of: session.phase) { _, _ in openFocus() }
  }

  private func openFocus() {
    guard let focus = session.focus, case .ready = session.phase else { return }
    session.focus = nil
    guard session.agent(focus) != nil else { return }
    path = [.agent(focus)]
  }

  @ViewBuilder
  private var content: some View {
    switch session.phase {
    case .starting:
      ProgressView()
    case .firstRun:
      FirstRunView()
    case .offline:
      OfflineView()
    case .locked:
      LockedView()
    case .ready(let snapshot):
      HomeView(snapshot: snapshot, path: $path)
    }
  }

  @ViewBuilder
  private func destination(_ route: WatchRoute) -> some View {
    switch route {
    case .servers:
      if case .ready(let snapshot) = session.phase {
        ServerPickerView(snapshot: snapshot, path: $path)
      }
    case .agent(let key):
      AgentScreen(key: key) { agent in AgentPage(agent: agent, path: $path) }
    case .detail(let key):
      AgentScreen(key: key) { agent in AgentDetailView(agent: agent, path: $path) }
    case .questions(let key):
      AgentScreen(key: key) { agent in QuestionFlowView(agent: agent, path: $path) }
    case .channel(let key):
      ChannelScreen(key: key) { channel in ChannelPage(channel: channel, path: $path) }
    case .channelDetail(let key):
      ChannelScreen(key: key) { channel in ChannelDetailView(channel: channel) }
    case .channelListen(let key):
      ChannelScreen(key: key) { channel in ListenView(recipient: .channel(channel), reply: channel.message ?? "") }
    case .review(.channel(let key), let text):
      ChannelScreen(key: key) { channel in
        ReviewView(recipient: .channel(channel), target: .channel(key), text: text, path: $path)
      }
    case .review(.message(let key), let text):
      AgentScreen(key: key) { agent in
        ReviewView(recipient: .agent(agent), target: .message(key), text: text, path: $path)
      }
    case .review(.answer(let key, let requestId, let questionId), let text):
      AgentScreen(key: key) { agent in
        ReviewView(
          recipient: .agent(agent), target: .answer(key, requestId: requestId, questionId: questionId), text: text,
          path: $path)
      }
    case .listen(let key):
      AgentScreen(key: key) { agent in ListenView(recipient: .agent(agent), reply: agent.reply ?? "") }
    case .stop(let key):
      AgentScreen(key: key) { agent in StopConfirmView(agent: agent, path: $path) }
    }
  }
}

struct AgentScreen<Content: View>: View {
  @EnvironmentObject private var session: WatchSession
  let key: AgentKey
  @ViewBuilder let content: (WatchAgent) -> Content

  var body: some View {
    if let agent = session.agent(key) {
      content(agent)
    } else {
      Image(systemName: "person.crop.circle.badge.questionmark")
        .font(.title)
        .foregroundStyle(.secondary)
    }
  }
}

struct ChannelScreen<Content: View>: View {
  @EnvironmentObject private var session: WatchSession
  let key: AgentKey
  @ViewBuilder let content: (WatchChannel) -> Content

  var body: some View {
    if let channel = session.channel(key) {
      content(channel)
    } else {
      Image(systemName: "number.circle")
        .font(.title)
        .foregroundStyle(.secondary)
    }
  }
}
