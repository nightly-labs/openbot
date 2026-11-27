import AppIntents
import SwiftUI
import WidgetKit

struct ServerEntity: AppEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "OpenBot")
  static let defaultQuery = ServerQuery()

  let id: String
  let name: String

  init(_ server: ComplicationServer) {
    id = server.id
    name = server.name
  }

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)")
  }
}

struct ServerQuery: EntityQuery {
  func entities(for identifiers: [ServerEntity.ID]) async throws -> [ServerEntity] {
    suggested().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [ServerEntity] {
    suggested()
  }

  private func suggested() -> [ServerEntity] {
    (ComplicationStore.stored()?.servers ?? []).map(ServerEntity.init)
  }
}

struct ServerIntent: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "OpenBot"

  @Parameter(title: "OpenBot")
  var server: ServerEntity?

  init() {}

  init(server: ServerEntity) {
    self.server = server
  }
}

extension ComplicationData {
  static func load(server: String?) -> ComplicationData {
    guard let server, let data = ComplicationStore.stored()?.data[server] else { return load() }
    return data
  }
}

struct ComplicationProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> ComplicationEntry {
    ComplicationEntry(date: Date(), data: .none)
  }

  func snapshot(for configuration: ServerIntent, in context: Context) async -> ComplicationEntry {
    ComplicationEntry(
      date: Date(), data: context.isPreview ? .none : ComplicationData.load(server: configuration.server?.id))
  }

  func timeline(for configuration: ServerIntent, in context: Context) async -> Timeline<ComplicationEntry> {
    await WidgetRefresh.shared.run()
    let entry = ComplicationEntry(date: Date(), data: ComplicationData.load(server: configuration.server?.id))
    return Timeline(entries: [entry], policy: .never)
  }

  func recommendations() -> [AppIntentRecommendation<ServerIntent>] {
    let chosen = AppIntentRecommendation(intent: ServerIntent(), description: Text(verbatim: "OpenBot"))
    let servers = ComplicationStore.stored()?.servers ?? []
    guard servers.count > 1 else { return [chosen] }
    return [chosen]
      + servers.map { server in
        AppIntentRecommendation(
          intent: ServerIntent(server: ServerEntity(server)),
          description: Text(verbatim: "OpenBot · \(server.name)"))
      }
  }
}
