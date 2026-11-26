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
  case agent(AgentKey)
  case detail(AgentKey)
  case questions(AgentKey)
  case review(ComposeTarget, String)
  case listen(AgentKey)
  case stop(AgentKey)
}

enum ComposeTarget: Hashable {
  case message(AgentKey)
  case answer(AgentKey, requestId: String, questionId: String)

  var agent: AgentKey {
    switch self {
    case .message(let key): return key
    case .answer(let key, _, _): return key
    }
  }
}

struct RootView: View {
  @EnvironmentObject private var session: WatchSession
  @Environment(\.scenePhase) private var scenePhase
  @State private var path: [WatchRoute] = []

  var body: some View {
    NavigationStack(path: $path) {
      content
        .navigationDestination(for: WatchRoute.self) { route in
          destination(route)
        }
    }
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
      AgentListView(snapshot: snapshot)
    }
  }

  @ViewBuilder
  private func destination(_ route: WatchRoute) -> some View {
    switch route {
    case .agent(let key):
      AgentScreen(key: key) { agent in AgentPage(agent: agent, path: $path) }
    case .detail(let key):
      AgentScreen(key: key) { agent in AgentDetailView(agent: agent, path: $path) }
    case .questions(let key):
      AgentScreen(key: key) { agent in QuestionFlowView(agent: agent, path: $path) }
    case .review(let target, let text):
      AgentScreen(key: target.agent) { agent in ReviewView(agent: agent, target: target, text: text, path: $path) }
    case .listen(let key):
      AgentScreen(key: key) { agent in ListenView(agent: agent) }
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
