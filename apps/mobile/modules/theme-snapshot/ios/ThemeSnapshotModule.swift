import ExpoModulesCore
import UIKit

final class ThemeSnapshotException: Exception, @unchecked Sendable {
  override var reason: String { "The window has no picture" }
}

public class ThemeSnapshotModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotThemeSnapshot")

    AsyncFunction("snapshot") { () throws -> Data in
      let window = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .filter { $0.activationState == .foregroundActive }
        .flatMap(\.windows)
        .first(where: \.isKeyWindow)
      guard let window, window.bounds.width > 0, window.bounds.height > 0 else { throw ThemeSnapshotException() }
      let format = UIGraphicsImageRendererFormat(for: window.traitCollection)
      format.opaque = true
      let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
        window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
      }
      guard let data = image.jpegData(compressionQuality: 0.92) else { throw ThemeSnapshotException() }
      return data
    }.runOnQueue(.main)
  }
}
