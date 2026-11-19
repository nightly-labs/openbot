import ExpoModulesCore
import UIKit

final class AppIconChangeException: GenericException<String>, @unchecked Sendable {
  override var reason: String { "The app icon did not change: \(param)" }
}

private let iconPrefix = "AppIcon"
private let defaultIcon = "default"

public class AppIconModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpenBotAppIcon")

    AsyncFunction("getIcon") { () -> String? in
      guard UIApplication.shared.supportsAlternateIcons else { return nil }
      guard let name = UIApplication.shared.alternateIconName, name.hasPrefix(iconPrefix) else {
        return defaultIcon
      }
      let suffix = name.dropFirst(iconPrefix.count)
      return suffix.prefix(1).lowercased() + suffix.dropFirst()
    }.runOnQueue(.main)

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

