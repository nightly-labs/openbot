import SwiftUI
import WidgetKit

private let appGroup = "group.run.openbot.mobile"

struct ComplicationData: Codable, Equatable {
  var state: String
  var count: Int
  var text: String
  var name: String?
  var color: String?
  var serverId: String?
  var agentId: String?

  static let storageKey = "openbot.watch.complication"
  static let none = ComplicationData(
    state: "none", count: 0, text: "", name: nil, color: nil, serverId: nil, agentId: nil)

  var agentURL: URL? {
    guard state == "ready", count > 0, let serverId, let agentId else { return nil }
    var components = URLComponents()
    components.scheme = "openbot-watch"
    components.host = "agent"
    components.queryItems = [URLQueryItem(name: "server", value: serverId), URLQueryItem(name: "agent", value: agentId)]
    return components.url
  }

  static func load() -> ComplicationData {
    guard let stored = UserDefaults(suiteName: appGroup)?.data(forKey: storageKey),
      let data = try? JSONDecoder().decode(ComplicationData.self, from: stored)
    else { return .none }
    return data
  }
}

struct ComplicationEntry: TimelineEntry {
  static let relevanceLimit = 5

  let date: Date
  let data: ComplicationData

  var relevance: TimelineEntryRelevance? {
    TimelineEntryRelevance(score: Float(min(data.count, Self.relevanceLimit)))
  }
}

struct ComplicationProvider: TimelineProvider {
  func placeholder(in context: Context) -> ComplicationEntry {
    ComplicationEntry(date: Date(), data: .none)
  }

  func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
    completion(ComplicationEntry(date: Date(), data: context.isPreview ? .none : ComplicationData.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ComplicationEntry>) -> Void) {
    let entry = ComplicationEntry(date: Date(), data: ComplicationData.load())
    completion(Timeline(entries: [entry], policy: .never))
  }
}

@main
struct OpenBotComplicationBundle: WidgetBundle {
  var body: some Widget {
    OpenBotComplication()
  }
}

struct OpenBotComplication: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "OpenBotComplication", provider: ComplicationProvider()) { entry in
      ComplicationView(data: entry.data)
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(entry.data.agentURL)
    }
    .configurationDisplayName(Text(verbatim: "OpenBot"))
    .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
  }
}
