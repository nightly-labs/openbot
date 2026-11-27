import ImageIO
import SwiftUI
import UIKit
import WidgetKit

extension ComplicationAgent {
  var isWaiting: Bool { kind == WatchAgentState.waiting.rawValue }
  var isWorking: Bool { kind == WatchAgentState.working.rawValue }

  var url: URL? { ComplicationData.agentURL(serverId: serverId, agentId: id) }

  func image(side: CGFloat) -> UIImage? {
    guard let picture, let url = WatchAvatarFiles.url(picture),
      let source = CGImageSourceCreateWithURL(url as CFURL, nil)
    else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: side,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
  }
}

extension ComplicationData {
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
    stored() ?? .none
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
    if #available(watchOS 26.0, *) {
      return configuration.pushHandler(OpenBotWidgetPushHandler.self)
    }
    return configuration
  }

  private var configuration: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "OpenBotComplication", intent: ServerIntent.self, provider: ComplicationProvider()
    ) { entry in
      ComplicationView(data: entry.data)
    }
    .configurationDisplayName(Text(verbatim: "OpenBot"))
    .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular])
  }
}

@available(watchOS 26.0, *)
struct OpenBotWidgetPushHandler: WidgetPushHandler {
  func pushTokenDidChange(_ pushInfo: WidgetPushInfo, widgets: [WidgetInfo]) {
    WidgetPushRegistry.save(token: pushInfo.token)
  }
}
