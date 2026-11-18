import ExpoModulesCore
import UIKit

final class ThemeSnapshotException: Exception, @unchecked Sendable {
  override var reason: String { "The window has no picture" }
}

/// A picture of the key window, with the sheets that it presents. The theme change
/// (`src/features/settings/components/theme-sweep.tsx`) shows it as the old theme while the new one
/// comes in under it. A React Native view cannot draw a sheet, because iOS presents the sheet outside
/// the view. The picture stays in memory and goes to JavaScript as JPEG bytes. All calls run on the main queue.
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
        // The screen as it is now: the change has not started.
        window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
      }
      guard let data = image.jpegData(compressionQuality: 0.92) else { throw ThemeSnapshotException() }
      return data
    }.runOnQueue(.main)
  }
}
