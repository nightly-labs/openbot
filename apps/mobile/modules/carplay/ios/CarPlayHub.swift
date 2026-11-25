import CarPlay
import UIKit

struct CarPlayAgent: Equatable {
  let key: String
  let name: String
  let detail: String?
  let picture: String?
  let unread: Bool
}

struct CarPlayHome: Equatable {
  var title: String
  var message: String?
  var pinnedTitle: String
  var newTitle: String
  var agentsTitle: String
  var pinned: [CarPlayAgent]
  var fresh: [CarPlayAgent]
  var quiet: [CarPlayAgent]

  static let empty = CarPlayHome(
    title: "", message: nil, pinnedTitle: "", newTitle: "", agentsTitle: "", pinned: [], fresh: [], quiet: []
  )

  var agents: [CarPlayAgent] { pinned + fresh + quiet }
}

struct CarPlayVoiceText {
  let listening: String
  let muted: String
  let thinking: String
  let speaking: String
  let offline: String
  let unavailable: String
}

struct CarPlayVoiceImage {
  let image: UIImage?
  let repeats: Bool
}

enum CarPlayVoiceState: String, CaseIterable {
  case listening
  case muted
  case thinking
  case speaking
  case offline
  case unavailable
}

@MainActor
public final class CarPlayHub: NSObject, CPInterfaceControllerDelegate {
  public static let shared = CarPlayHub()

  var onConnection: ((Bool) -> Void)?
  var onOpen: ((String) -> Void)?
  var onVoiceEnd: (() -> Void)?
  var onMute: (() -> Void)?

  private var controller: CPInterfaceController?
  private var list: CPListTemplate?
  private var pinnedList: CPListTemplate?
  private var home = CarPlayHome.empty
  private var voice: CPVoiceControlTemplate?
  private var voiceSession = 0
  private var voiceState = CarPlayVoiceState.thinking
  private var shownState = CarPlayVoiceState.thinking
  private var shownStates: Set<CarPlayVoiceState> = []
  private var shownAt = Date.distantPast
  private var voiceOnScreen = false
  private var presenting = false
  private var needsPresent = false
  private var voiceChange: Task<Void, Never>?
  private var voiceMuted = false
  private var mic: CPBarButton?
  private var voiceText: CarPlayVoiceText?
  private var voiceImages: [CarPlayVoiceState: CarPlayVoiceImage] = [:]
  private var pictureRetry: Task<Void, Never>?
  private var pictureRetries = 0

  private static let pictureRetryLimit = 4
  private static let pictureRetryDelay: UInt64 = 1_500_000_000
  private static let voiceStateGap: TimeInterval = 0.6

  var connected: Bool { controller != nil }

  public func connect(_ controller: CPInterfaceController) {
    controller.delegate = self
    self.controller = controller
    list = nil
    pinnedList = nil
    presenting = false
    resetVoice()
    render()
    onConnection?(true)
  }

  public func disconnect() {
    pictureRetry?.cancel()
    pictureRetry = nil
    resetVoice()
    controller = nil
    list = nil
    pinnedList = nil
    onConnection?(false)
  }

  func update(_ next: CarPlayHome) {
    guard next != home else { return }
    home = next
    pictureRetries = 0
    render()
  }

  func showVoice(
    _ text: CarPlayVoiceText,
    state initial: CarPlayVoiceState,
    frames: [CarPlayVoiceState: [String]]
  ) {
    guard let controller else { return }
    voiceSession += 1
    voiceText = text
    voiceImages = images(of: frames, text: text, traits: controller.carTraitCollection)
    voiceState = initial
    presentVoice(animated: true)
  }

  func setVoiceFrames(_ frames: [CarPlayVoiceState: [String]]) {
    guard let controller, let text = voiceText else { return }
    voiceImages = images(of: frames, text: text, traits: controller.carTraitCollection)
    presentVoice(animated: false)
  }

  func setVoiceMuted(_ muted: Bool) {
    guard muted != voiceMuted else { return }
    voiceMuted = muted
    mic?.image = CarPlayImages.voiceButton(micSymbol)
  }

  func setVoiceState(_ state: CarPlayVoiceState) {
    voiceState = state
    guard voiceText != nil, shownStates.contains(state) else {
      presentVoice(animated: false)
      return
    }
    applyVoiceState()
  }

  func hideVoice() {
    guard voiceText != nil else { return }
    let shown = voice
    resetVoice()
    guard let controller, let shown, controller.presentedTemplate === shown else { return }
    controller.dismissTemplate(animated: true) { _, _ in }
  }

  public func templateDidDisappear(_ aTemplate: CPTemplate, animated: Bool) {
    if aTemplate === pinnedList { pinnedList = nil }
    guard let voice, aTemplate === voice else { return }
    resetVoice()
    onVoiceEnd?()
  }

  private var micSymbol: String { voiceMuted ? "mic.slash.fill" : "mic.fill" }

  private func resetVoice() {
    voiceSession += 1
    voiceChange?.cancel()
    voiceChange = nil
    voice = nil
    voiceOnScreen = false
    shownStates = []
    mic = nil
    voiceText = nil
    voiceImages = [:]
    needsPresent = false
  }

  private func images(
    of frames: [CarPlayVoiceState: [String]],
    text: CarPlayVoiceText,
    traits: UITraitCollection
  ) -> [CarPlayVoiceState: CarPlayVoiceImage] {
    Dictionary(uniqueKeysWithValues: CarPlayVoiceState.allCases.map { state in
      let files = frames[state] ?? []
      let image = CarPlayVoiceImage(
        image: CarPlayImages.voice(state, frames: files, caption: title(of: state, in: text), traits: traits),
        repeats: CarPlayImages.voiceRepeats(state, frames: files)
      )
      return (state, image)
    })
  }

  private func presentVoice(animated: Bool) {
    guard let controller, voiceText != nil else { return }
    guard !presenting else {
      needsPresent = true
      return
    }
    let session = voiceSession
    let initial = voiceState
    let left: CarPlayVoiceState = initial == .unavailable ? .muted : .unavailable
    let order = [initial] + CarPlayVoiceState.allCases.filter { $0 != initial && $0 != left }
    let template = CPVoiceControlTemplate(voiceControlStates: order.map { state in
      CPVoiceControlState(
        identifier: state.rawValue,
        titleVariants: nil,
        image: voiceImages[state]?.image,
        repeats: voiceImages[state]?.repeats ?? false
      )
    })
    if #available(iOS 26.4, *) {
      let button = CPBarButton(image: CarPlayImages.voiceButton(micSymbol)) { [weak self] _ in self?.onMute?() }
      mic = button
      template.trailingNavigationBarButtons = [button]
    }
    voiceChange?.cancel()
    voiceChange = nil
    shownState = initial
    shownStates = Set(order)
    let previous = voice
    voice = template
    voiceOnScreen = false
    let present = { [weak self] in
      guard let self, self.voiceSession == session, self.voice === template, self.controller === controller else { return }
      self.presenting = true
      controller.presentTemplate(template, animated: animated) { [weak self] success, _ in
        Task { @MainActor [weak self] in self?.presented(template, success: success) }
      }
    }
    guard let previous, controller.presentedTemplate === previous else {
      present()
      return
    }
    controller.dismissTemplate(animated: false) { _, _ in present() }
  }

  private func presented(_ template: CPVoiceControlTemplate, success: Bool) {
    presenting = false
    if needsPresent {
      needsPresent = false
      presentVoice(animated: false)
      return
    }
    guard success else { return }
    guard voice === template else {
      if let controller, controller.presentedTemplate === template {
        controller.dismissTemplate(animated: false) { _, _ in }
      }
      return
    }
    voiceOnScreen = true
    shownAt = Date()
    applyVoiceState()
  }

  private func applyVoiceState() {
    guard let voice, voiceOnScreen, voiceChange == nil, voiceState != shownState else { return }
    let wait = Self.voiceStateGap - Date().timeIntervalSince(shownAt)
    guard wait <= 0 else {
      voiceChange = Task { @MainActor [weak self] in
        try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
        guard !Task.isCancelled, let self else { return }
        self.voiceChange = nil
        self.applyVoiceState()
      }
      return
    }
    voice.activateVoiceControlState(withIdentifier: voiceState.rawValue)
    shownState = voiceState
    shownAt = Date()
  }

  private func title(of state: CarPlayVoiceState, in text: CarPlayVoiceText) -> String {
    switch state {
    case .listening: return text.listening
    case .muted: return text.muted
    case .thinking: return text.thinking
    case .speaking: return text.speaking
    case .offline: return text.offline
    case .unavailable: return text.unavailable
    }
  }

  private func render() {
    guard let controller else { return }
    if list == nil || list?.title != home.title {
      let next = CPListTemplate(title: home.title, sections: [])
      list = next
      controller.setRootTemplate(next, animated: false) { _, _ in }
    }
    guard let list else { return }
    let scale = controller.carTraitCollection.displayScale
    if #available(iOS 18.4, *) { list.showsSpinnerWhileEmpty = home == .empty }
    if let message = home.message {
      list.emptyViewTitleVariants = [message]
      list.updateSections([])
      if pinnedList != nil { controller.popToRootTemplate(animated: false) { _, _ in } }
      pinnedList = nil
    } else {
      list.emptyViewTitleVariants = []
      list.updateSections(sections(scale: scale))
      pinnedList?.updateSections(pinnedRows(scale: scale))
    }
    retryMissingPictures()
  }

  private func sections(scale: CGFloat) -> [CPListSection] {
    var result: [CPListSection] = []
    var room = Int(CPListTemplate.maximumItemCount)
    if !home.pinned.isEmpty {
      let pinned = pinnedSection(scale: scale)
      result.append(pinned)
      room -= pinned.items.count
    }
    let fresh = Array(home.fresh.prefix(max(room, 0)))
    room -= fresh.count
    if !fresh.isEmpty {
      result.append(CPListSection(items: fresh.map { row($0, scale: scale) }, header: home.newTitle, sectionIndexTitle: nil))
    }
    let quiet = Array(home.quiet.prefix(max(room, 0)))
    if !quiet.isEmpty {
      result.append(CPListSection(items: quiet.map { row($0, scale: scale) }, header: home.agentsTitle, sectionIndexTitle: nil))
    }
    return result
  }

  private func pinnedSection(scale: CGFloat) -> CPListSection {
    let agents = home.pinned
    guard #available(iOS 26.0, *) else {
      return CPListSection(items: agents.map { row($0, scale: scale) }, header: home.pinnedTitle, sectionIndexTitle: nil)
    }
    let size = CPListImageRowItemCondensedElement.maximumImageSize
    let elements = agents.map { agent in
      CPListImageRowItemCondensedElement(
        image: CarPlayImages.avatar(agent, size: size, scale: scale),
        imageShape: .circular,
        title: agent.name,
        subtitle: nil,
        accessorySymbolName: agent.unread ? "circle.fill" : nil
      )
    }
    let item = CPListImageRowItem(text: home.pinnedTitle, condensedElements: elements, allowsMultipleLines: false)
    item.listImageRowHandler = { [weak self] _, index, completion in
      if agents.indices.contains(index) { self?.onOpen?(agents[index].key) }
      completion()
    }
    item.handler = { [weak self] _, completion in
      self?.showAllPinned(scale: scale)
      completion()
    }
    return CPListSection(items: [item])
  }

  private func showAllPinned(scale: CGFloat) {
    guard let controller, pinnedList == nil else { return }
    let template = CPListTemplate(title: home.pinnedTitle, sections: pinnedRows(scale: scale))
    pinnedList = template
    controller.pushTemplate(template, animated: true) { _, _ in }
  }

  private func pinnedRows(scale: CGFloat) -> [CPListSection] {
    [CPListSection(items: home.pinned.map { row($0, scale: scale) })]
  }

  private func row(_ agent: CarPlayAgent, scale: CGFloat) -> CPListItem {
    let item = CPListItem(
      text: agent.name,
      detailText: agent.detail,
      image: CarPlayImages.avatar(agent, size: CPListItem.maximumImageSize, scale: scale),
      accessoryImage: agent.unread ? CarPlayImages.unreadDot(scale: scale) : nil,
      accessoryType: agent.unread ? .none : .disclosureIndicator
    )
    item.handler = { [weak self] _, completion in
      self?.onOpen?(agent.key)
      completion()
    }
    return item
  }

  private func retryMissingPictures() {
    pictureRetry?.cancel()
    pictureRetry = nil
    guard pictureRetries < Self.pictureRetryLimit, home.agents.contains(where: CarPlayImages.pictureMissing) else { return }
    pictureRetries += 1
    pictureRetry = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: Self.pictureRetryDelay)
      guard !Task.isCancelled else { return }
      self?.render()
    }
  }
}
