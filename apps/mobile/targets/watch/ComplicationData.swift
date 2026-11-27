import Foundation
import WidgetKit

let watchAppGroup = "group.run.openbot.mobile"

struct ComplicationData: Codable, Equatable {
  var state: String
  var count: Int
  var text: String
  var name: String?
  var color: String?
  var serverId: String?
  var agentId: String?

  static let storageKey = "openbot.watch.complication"
  static let none = ComplicationData(state: "none", count: 0, text: "", name: nil, color: nil)
  static let locked = ComplicationData(state: "locked", count: 0, text: "", name: nil, color: nil)

  static func ready(_ snapshot: WatchReadySnapshot) -> ComplicationData {
    let waiting = snapshot.agents.filter { $0.state == .waiting }
    let text = WatchText(values: snapshot.text)
    let label =
      waiting.isEmpty
      ? text(TextKey.complicationClear)
      : text(TextKey.complicationWaiting, ["count": String(waiting.count)])
    return ComplicationData(
      state: "ready", count: waiting.count, text: label, name: waiting.first?.name,
      color: waiting.first?.color, serverId: waiting.first?.serverId, agentId: waiting.first?.id)
  }

  static func write(_ data: ComplicationData) {
    guard let defaults = UserDefaults(suiteName: watchAppGroup) else { return }
    if let stored = defaults.data(forKey: storageKey),
      let previous = try? JSONDecoder().decode(ComplicationData.self, from: stored),
      previous == data
    {
      return
    }
    guard let encoded = try? JSONEncoder().encode(data) else { return }
    defaults.set(encoded, forKey: storageKey)
    WidgetCenter.shared.reloadAllTimelines()
  }

  static func remove() {
    UserDefaults(suiteName: watchAppGroup)?.removeObject(forKey: storageKey)
    WidgetCenter.shared.reloadAllTimelines()
  }
}
