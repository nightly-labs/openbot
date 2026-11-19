import ExpoModulesCore
import UIKit

final class AppIconChangeException: GenericException<String>, @unchecked Sendable {
  override var reason: String { "The app icon did not change: \(param)" }
}

private let iconPrefix = "AppIcon"
private let defaultIcon = "default"

/// The app icon of the home screen. The icons are the desktop logo colors
/// (`packages/contracts/src/app-logo-color.ts`); `plugins/with-app-icons.js` names the icon of the
/// color `green` `AppIconGreen`. The default color is the main icon, `default` here. All calls run on
/// the main queue.
public class AppIconModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotAppIcon")

    /// The ID of the variant on the home screen, or nil when the phone cannot change the icon.
    AsyncFunction("getIcon") { () -> String? in
      guard UIApplication.shared.supportsAlternateIcons else { return nil }
      guard let name = UIApplication.shared.alternateIconName, name.hasPrefix(iconPrefix) else {
        return defaultIcon
      }
      let suffix = name.dropFirst(iconPrefix.count)
      return suffix.prefix(1).lowercased() + suffix.dropFirst()
    }.runOnQueue(.main)

    /// iOS shows its own alert after the change. It has no public way to change the icon without it,
    /// and its private method shows the alert too on current iOS versions.
    AsyncFunction("setIcon") { (id: String, promise: Promise) in
      let name: String? = id == defaultIcon ? nil : iconPrefix + id.prefix(1).uppercased() + id.dropFirst()
      guard UIApplication.shared.alternateIconName != name else {
        promise.resolve(nil)
        return
      }
      UIApplication.shared.setAlternateIconName(name) { error in
        if let error {
          promise.reject(AppIconChangeException(error.localizedDescription))
        } else {
          promise.resolve(nil)
        }
      }
    }.runOnQueue(.main)
  }
}

