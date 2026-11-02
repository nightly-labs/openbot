import Intents
import SwiftUI
import UIKit

/// The OpenBot share extension. It sends a share to the chosen agent without the app. The share
/// sheet also offers the agents that got messages last (`INSendMessageIntent`); a tap on one opens
/// this sheet with that agent selected.
///
/// When the extension cannot send by itself, the app takes the share as before: the payloads go into
/// the App Group defaults of expo-sharing and the app opens. That happens with no saved data, the app
/// lock on, a share that one message cannot hold, or a failed send that the user gives to the app.
///
/// `plugins/with-share-target.js` puts this file in place of expo-sharing's controller of the same name.
class ShareIntoViewController: UIViewController {
  // Only these two crash the extension, because only a wrong config plugin causes them.
  private var hostAppScheme: String {
    guard let scheme = Bundle.main.object(forInfoDictionaryKey: "MainTargetUrlScheme") as? String else {
      fatalError("The share extension has no MainTargetUrlScheme in Info.plist.")
    }
    return scheme
  }

  private var appGroupId: String {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "AppGroupId") as? String else {
      fatalError("The share extension has no AppGroupId in Info.plist.")
    }
    return group
  }

  private var started = false
  private var payloads: [SharePayload] = []
  private var content: ShareContent?
  private var sender: ShareSender?
  private var finished = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemGroupedBackground
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    guard !started else { return }
    started = true
    Task { await start() }
  }

  private func start() async {
    let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
    let appGroupId = appGroupId
    payloads = await Task.detached(priority: .userInitiated) {
      await ShareInput.payloads(items, appGroupId: appGroupId)
    }.value
    guard !payloads.isEmpty else { return complete() }
    let payloads = payloads
    let prepared = await Task.detached(priority: .userInitiated) { ShareContent.prepare(payloads) }.value
    guard let loaded = ShareExtensionData.load(appGroupId: appGroupId), let content = prepared else {
      ShareContent.removeFiles(prepared?.madeFiles ?? [])
      return openApp()
    }
    let (directory, session) = loaded
    self.content = content
    let suggested = (extensionContext?.intent as? INSendMessageIntent)?.conversationIdentifier
    let last = ShareExtensionData.lastTarget(appGroupId: appGroupId, directory: directory)
    let lastAgent = directory.agents.first { $0.serverId == last?.serverId && $0.id == last?.agentId }
    let selected = directory.agents.first { $0.conversationId == suggested }?.conversationId
      ?? lastAgent?.conversationId
    let model = ShareModel(
      directory: directory,
      content: content,
      selected: selected,
      lastAgent: lastAgent,
      avatars: ShareExtensionData.avatars(appGroupId: appGroupId, directory: directory)
    )
    model.onCancel = { [weak self] in self?.cancel() }
    model.onOpenApp = { [weak self] in self?.openApp() }
    model.onSend = { [weak self, weak model] agent in
      guard let self, let model else { return }
      Task { await self.send(agent, model: model, directory: directory, session: session) }
    }
    show(ShareView(model: model))
  }

  private func show(_ root: ShareView) {
    let host = UIHostingController(rootView: root)
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)
  }

  private func send(
    _ agent: ShareDirectory.Agent,
    model: ShareModel,
    directory: ShareDirectory,
    session: ShareSession
  ) async {
    guard sender == nil, let content, let server = directory.servers.first(where: { $0.id == agent.serverId }) else {
      return
    }
    model.phase = .sending(agent.name)
    // A swipe would end the extension in the middle of the send.
    isModalInPresentation = true
    let sender = ShareSender(container: view, apiUrl: session.apiUrl, files: content.files)
    self.sender = sender
    let request: [String: Any] = [
      "apiUrl": session.apiUrl,
      "sessionToken": session.sessionToken,
      "hostId": server.id,
      "hostPublicKey": server.publicKey,
      "hosted": server.hosted,
      "agentId": agent.id,
      "text": content.text,
      "files": content.files.map { ["name": $0.name, "mimeType": $0.mimeType] },
      "clientMessageId": UUID().uuidString,
      "timezone": TimeZone.current.identifier,
    ]
    let outcome = await sender.send(request)
    self.sender = nil
    isModalInPresentation = false
    switch outcome {
    case .sent:
      ShareExtensionData.saveLastTarget(
        ShareDirectory.Target(serverId: agent.serverId, agentId: agent.id),
        appGroupId: appGroupId,
        directory: directory
      )
      donate(agent, avatar: model.avatar(of: agent)?.pngData())
      model.phase = .sent(agent.name)
      try? await Task.sleep(nanoseconds: 900_000_000)
      cancel()
    case let .failed(unconfirmed, detail):
      NSLog("OpenBot share extension: send failed at %@", detail)
      model.phase = .failed(unconfirmed: unconfirmed)
    }
  }

  /// The share sheet offers the agents that get messages most often first, as the app's messages do.
  private func donate(_ agent: ShareDirectory.Agent, avatar: Data?) {
    let recipient = INPerson(
      personHandle: INPersonHandle(value: agent.conversationId, type: .unknown),
      nameComponents: nil,
      displayName: agent.name,
      image: avatar.map { INImage(imageData: $0) },
      contactIdentifier: nil,
      customIdentifier: agent.conversationId
    )
    let intent = INSendMessageIntent(
      recipients: [recipient],
      outgoingMessageType: .outgoingMessageText,
      content: nil,
      speakableGroupName: nil,
      conversationIdentifier: agent.conversationId,
      serviceName: nil,
      sender: nil,
      attachments: nil
    )
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .outgoing
    interaction.groupIdentifier = agent.conversationId
    interaction.donate(completion: nil)
  }

  // MARK: - Finish

  /// Sent, or dropped by the user: the copies of the share go.
  private func cancel() {
    ShareContent.removeFiles(ShareContent.payloadFiles(payloads) + (content?.madeFiles ?? []))
    complete()
  }

  /// The app takes the share, as it did before the extension could send.
  private func openApp() {
    guard !finished else { return }
    ShareContent.removeFiles(content?.madeFiles ?? [])
    guard let defaults = UserDefaults(suiteName: appGroupId), let encoded = try? JSONEncoder().encode(payloads) else {
      return complete()
    }
    defaults.set(encoded, forKey: SHARE_INTO_DEFAULTS_KEY)
    guard let url = URL(string: "\(hostAppScheme)://expo-sharing") else { return complete() }
    // expo-sharing opens the app through the responder chain. Apps that do this pass App Store review.
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication {
        application.open(url, options: [:], completionHandler: nil)
        break
      }
      responder = current.next
    }
    complete()
  }

  private func complete() {
    guard !finished else { return }
    finished = true
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}
