import SwiftUI

enum TextKey {
  static let stateApproval = "mobile.watch.state.approval"
  static let stateQuestion = "mobile.watch.state.question"
  static let stateTakeover = "mobile.watch.state.takeover"
  static let stateWorking = "mobile.watch.state.working"
  static let stateIdle = "mobile.watch.state.idle"
  static let openOnPhone = "mobile.watch.action.openOnPhone"
  static let dictate = "mobile.watch.action.dictate"
  static let message = "mobile.watch.action.message"
  static let listen = "mobile.watch.action.listen"
  static let stop = "mobile.watch.action.stop"
  static let send = "mobile.watch.action.send"
  static let again = "mobile.watch.action.again"
  static let retry = "mobile.watch.action.retry"
  static let approvalTooLong = "mobile.watch.approval.tooLong"
  static let approvalWhere = "mobile.watch.approval.where"
  static let approvalOnPhone = "mobile.watch.approval.onPhone"
  static let questionOnPhone = "mobile.watch.question.onPhone"
  static let takeoverOnPhone = "mobile.watch.takeover.onPhone"
  static let stopTitle = "mobile.watch.stop.title"
  static let stopDetail = "mobile.watch.stop.detail"
  static let newMessage = "mobile.watch.compose.newMessage"
  static let pinned = "mobile.watch.list.pinned"
  static let needsYou = "mobile.agent.list.waiting.title"
  static let unread = "mobile.agent.list.unreadGroup.title"
  static let questionPrivate = "mobile.watch.question.private"
  static let position = "mobile.chat.question.position"
  static let next = "mobile.chat.question.next"
  static let answer = "mobile.watch.compose.answer"
  static let review = "mobile.watch.compose.review"
  static let doneAllowed = "mobile.watch.done.allowed"
  static let doneDenied = "mobile.watch.done.denied"
  static let doneAnswered = "mobile.watch.done.answered"
  static let doneSent = "mobile.watch.done.sent"
  static let doneStopped = "mobile.watch.done.stopped"
  static let doneOnPhone = "mobile.watch.done.onPhone"
  static let listenReading = "mobile.watch.listen.reading"
  static let replyNone = "mobile.watch.reply.none"
  static let offlineTitle = "mobile.watch.offline.title"
  static let offlineDetail = "mobile.watch.offline.detail"
  static let offlineUnlock = "mobile.watch.offline.unlock"
  static let updated = "mobile.watch.updated"
  static let disconnectedTitle = "mobile.watch.disconnected.title"
  static let disconnectedDetail = "mobile.watch.disconnected.detail"
  static let lockedTitle = "mobile.watch.locked.title"
  static let lockedDetail = "mobile.watch.locked.detail"
  static let empty = "mobile.watch.empty"
  static let complicationWaiting = "mobile.watch.complication.waiting"
  static let complicationClear = "mobile.watch.complication.clear"
  static let allow = "mobile.chat.approval.allow"
  static let deny = "mobile.chat.approval.deny"
  static let cancel = "common.cancel"

  static func error(_ code: WatchErrorCode) -> String {
    "mobile.watch.error.\(code.rawValue)"
  }
}

struct WatchText: Equatable {
  var values: [String: String] = [:]

  func callAsFunction(_ key: String, _ fill: [String: String] = [:]) -> String {
    var text = values[key] ?? ""
    for (name, value) in fill {
      text = text.replacingOccurrences(of: "{\(name)}", with: value)
    }
    return text
  }

  func optional(_ key: String) -> String? {
    guard let text = values[key], !text.isEmpty else { return nil }
    return text
  }
}

private struct WatchTextKey: EnvironmentKey {
  static let defaultValue = WatchText()
}

extension EnvironmentValues {
  var watchText: WatchText {
    get { self[WatchTextKey.self] }
    set { self[WatchTextKey.self] = newValue }
  }
}

extension Color {
  init?(hex: String) {
    var digits = hex.trimmingCharacters(in: .whitespaces)
    if digits.hasPrefix("#") { digits.removeFirst() }
    guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
    self.init(
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255)
  }
}
