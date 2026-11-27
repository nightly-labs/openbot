import ImageIO
import SwiftUI
import UIKit
import WidgetKit

private let appGroup = "group.run.openbot.mobile"

struct ComplicationAgent: Codable, Equatable {
  var serverId: String
  var id: String
  var name: String
  var color: String
  var kind: String
  var status: String
  var line: String?
  var picture: String?

  var isWaiting: Bool { kind == "waiting" }
  var isWorking: Bool { kind == "working" }

  var url: URL? { ComplicationData.agentURL(serverId: serverId, agentId: id) }

  func image(side: CGFloat) -> UIImage? {
    guard let picture, !picture.isEmpty, !picture.contains("/"), !picture.hasPrefix("."),
      let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    else { return nil }
    let url = folder.appendingPathComponent("watch-avatars", isDirectory: true)
      .appendingPathComponent(picture, isDirectory: false)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: side,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
  }
}

struct ComplicationData: Codable, Equatable {
  var state: String
  var count: Int
  var text: String
  var name: String?
  var color: String?
  var serverId: String?
  var agentId: String?
  var working: Int?
  var agent: ComplicationAgent?
  var unread: Int?
  var moreWaiting: Int?
  var moreUnread: Int?
  var moreLabel: String?
  var server: String?

  static let storageKey = "openbot.watch.complication"
  static let none = ComplicationData(state: "none", count: 0, text: "", name: nil, color: nil)

  var isReady: Bool { state == "ready" }
  var isLocked: Bool { state == "locked" }
  var workingCount: Int { working ?? 0 }
  var unreadCount: Int { unread ?? 0 }

  var waitingURL: URL? {
    guard isReady, count > 0, let serverId, let agentId else { return nil }
    return Self.agentURL(serverId: serverId, agentId: agentId)
  }

  var agentURL: URL? {
    guard isReady else { return nil }
    return agent?.url ?? waitingURL
  }

  static func agentURL(serverId: String, agentId: String) -> URL? {
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

@main
struct OpenBotComplicationBundle: WidgetBundle {
  var body: some Widget {
    OpenBotComplication()
  }
}

struct OpenBotComplication: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "OpenBotComplication", intent: ServerIntent.self, provider: ComplicationProvider()
    ) { entry in
      ComplicationView(data: entry.data)
    }
    .configurationDisplayName(Text(verbatim: "OpenBot"))
    .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular])
  }
}
